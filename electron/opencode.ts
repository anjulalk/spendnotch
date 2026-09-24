import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Row, Total } from '../src/types'

const data = process.env.XDG_DATA_HOME
export const root = data ? join(data, 'opencode') : join(homedir(), '.local', 'share', 'opencode')
const custom = process.env.SPEND_NOTCH_OPENCODE_DB ?? process.env.OPENCODE_DB ?? undefined
const customPath = custom === ':memory:' ? undefined : custom ? (isAbsolute(custom) ? custom : join(root, custom)) : undefined

export const dbs = () => {
  if (custom !== undefined) return customPath ? [customPath] : []
  try {
    return readdirSync(root)
      .filter((name) => /^opencode.*\.db$/i.test(name))
      .sort((a, b) => {
        if (a.toLowerCase() === 'opencode.db') return -1
        if (b.toLowerCase() === 'opencode.db') return 1
        return a.localeCompare(b)
      })
      .map((name) => join(root, name))
  } catch {
    return []
  }
}

export type Use = {
  rows: Row[]
  month: Total
  last?: number
  found: boolean
  err?: string
  warnings?: string[]
}

type DbRow = {
  id: string
  session: string
  at: number
  updated: number
  provider: string | null
  model: string
  usd: number
  tokens: number
  version: string | null
  fork_parent: string | null
  fork_at: number | null
}

type Msg = {
  session: string
  id: string
  at: number
  updated: number
  provider?: string
  model: string
  usd: number
  tokens: number
  hasCost: boolean
  fork?: { parent: string; at: number }
}

type Ranked = Msg & { rank: number }
type Cached = { mtimeMs: number; size: number; msg?: Msg | null }
type Query = { kind: 'new' | 'old' | 'event'; stmt: StatementSync }
type Q = { db: DatabaseSync; rows: Query[]; sessions: StatementSync[]; modern: boolean; warnings: string[]; id: string }
type Layout = { messages: string; parts: string; scoped: boolean }

const cache = new Map<string, Cached>()
const queries = new Map<string, Q>()

const key = (msg: Pick<Msg, 'session' | 'id'>) => `${msg.session}\0${msg.id}`
const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)
const number = (value: unknown) => {
  const result = Number(value)
  return Number.isFinite(result) ? result : 0
}

const rank = (kind: Query['kind'], version: string | null, modern: boolean) => {
  if (kind === 'event') return 7
  if (modern) return kind === 'new' ? 6 : Number.parseInt(version ?? '', 10) >= 2 ? 2 : 1
  const major = Number.parseInt(version ?? '', 10)
  if (kind === 'new') return major ? 2 : 3
  return major >= 2 ? 4 : 5
}

const columns = (db: DatabaseSync, table: string) =>
  new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((row) => row.name))

const has = (cols: Set<string>, names: string[]) => names.every((name) => cols.has(name))

const fileId = (file: string) => {
  const stat = statSync(file, { bigint: true })
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
}

const tokens = (column: string, nested = false) => {
  const path = (value: string) => `$.${nested ? `metadata.assistant.${value}` : value}`
  return `COALESCE(
    json_extract(${column}, '${path('tokens.total')}'),
    CASE WHEN json_type(${column}, '${path('tokens.input')}') IS NOT NULL
        OR json_type(${column}, '${path('tokens.output')}') IS NOT NULL
        OR json_type(${column}, '${path('tokens.reasoning')}') IS NOT NULL
        OR json_type(${column}, '${path('tokens.cache.read')}') IS NOT NULL
        OR json_type(${column}, '${path('tokens.cache.write')}') IS NOT NULL
      THEN COALESCE(json_extract(${column}, '${path('tokens.input')}'), 0) +
        COALESCE(json_extract(${column}, '${path('tokens.output')}'), 0) +
        COALESCE(json_extract(${column}, '${path('tokens.reasoning')}'), 0) +
        COALESCE(json_extract(${column}, '${path('tokens.cache.read')}'), 0) +
        COALESCE(json_extract(${column}, '${path('tokens.cache.write')}'), 0)
    END,
    0)`
}

const open = (file: string) => {
  if (!existsSync(file)) {
    const stale = queries.get(file)
    stale?.db.close()
    queries.delete(file)
    return undefined
  }
  const id = fileId(file)
  const cached = queries.get(file)
  if (cached?.id === id) return cached
  cached?.db.close()
  queries.delete(file)

  const db = new DatabaseSync(file, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 2000')
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((x) => x.name),
    )
    const rows: Query[] = []
    const sessions: StatementSync[] = []
    const warnings: string[] = []
    const split = tables.has('session_v2')
    const newSession = split ? 'session_v2' : tables.has('session') && tables.has('session_message') ? 'session' : undefined
    const sessionCols = newSession ? columns(db, newSession) : new Set<string>()
    const modern = split || (sessionCols.has('fork_session_id') && sessionCols.has('time_created'))
    const add = (kind: Query['kind'], sql: string) => {
      try {
        rows.push({ kind, stmt: db.prepare(sql) })
      } catch (e) {
        warnings.push(`${kind} usage: ${(e as Error).message}`)
      }
    }
    const sessionTables = [...new Set([newSession, tables.has('session') ? 'session' : undefined].filter(Boolean) as string[])]
    for (const table of sessionTables) {
      if (!has(columns(db, table), ['id'])) {
        warnings.push(`session table ${table} is missing id`)
        continue
      }
      try {
        sessions.push(db.prepare(`SELECT id FROM ${table}`))
      } catch (e) {
        warnings.push(`session table ${table}: ${(e as Error).message}`)
      }
    }

    if (tables.has('session_message')) {
      const cols = columns(db, 'session_message')
      if (has(cols, ['id', 'session_id', 'type', 'time_created', 'data'])) {
        const join = newSession && has(sessionCols, ['id']) ? `LEFT JOIN ${newSession} s ON s.id = sm.session_id` : ''
        const version = newSession && sessionCols.has('version') ? 's.version' : 'NULL'
        const provider = newSession && sessionCols.has('fork_session_id') ? 's.fork_session_id' : 'NULL'
        const forkAt = newSession && sessionCols.has('time_created') ? 's.time_created' : 'NULL'
        const updated = cols.has('time_updated') ? 'sm.time_updated' : 'sm.time_created'
        add(
          'new',
          `SELECT sm.id, sm.session_id AS session, sm.time_created AS at,
            CASE WHEN json_valid(sm.data) THEN COALESCE(
              json_extract(sm.data, '$.model.providerID'),
              json_extract(sm.data, '$.providerID'),
              json_extract(sm.data, '$.metadata.assistant.providerID')
            ) END AS provider,
            CASE WHEN json_valid(sm.data) THEN COALESCE(
              json_extract(sm.data, '$.model.id'),
              json_extract(sm.data, '$.modelID'),
              json_extract(sm.data, '$.metadata.assistant.modelID'),
              'unknown'
            ) ELSE 'unknown' END AS model,
            CASE WHEN json_valid(sm.data) THEN COALESCE(
              json_extract(sm.data, '$.cost'),
              json_extract(sm.data, '$.metadata.assistant.cost'),
              0
            ) ELSE 0 END AS usd,
            CASE WHEN json_valid(sm.data) THEN ${tokens('sm.data')} ELSE 0 END AS tokens,
            ${updated} AS updated, ${version}, ${provider} AS fork_parent, ${forkAt} AS fork_at
          FROM session_message sm
          ${join}
          WHERE sm.time_created >= ? AND sm.time_created < ? AND sm.type = 'assistant' AND json_valid(sm.data)`,
        )
      } else warnings.push('session_message table is missing required usage columns')
    }

    if (tables.has('message')) {
      const cols = columns(db, 'message')
      if (has(cols, ['id', 'session_id', 'time_created', 'data'])) {
        const oldSession = tables.has('session') && has(columns(db, 'session'), ['id', 'version']) ? 'session' : undefined
        const oldVersion = oldSession ? 's.version' : 'NULL'
        const join = oldSession ? `LEFT JOIN ${oldSession} s ON s.id = m.session_id` : ''
        const updated = cols.has('time_updated') ? 'm.time_updated' : 'm.time_created'
        const partCols = tables.has('part') ? columns(db, 'part') : new Set<string>()
        const partCost =
          tables.has('part') && has(partCols, ['message_id', 'data'])
            ? `COALESCE((SELECT SUM(CASE WHEN json_valid(p.data) THEN CASE
                WHEN json_extract(p.data, '$.type') = 'step-finish'
                THEN CAST(json_extract(p.data, '$.cost') AS REAL) END END) FROM part p
                WHERE p.message_id = m.id), 0)`
            : '0'
        const cost = `CASE WHEN NOT json_valid(m.data) THEN ${partCost}
          WHEN json_type(m.data, '$.cost') IN ('integer', 'real') THEN json_extract(m.data, '$.cost')
          WHEN json_type(m.data, '$.metadata.assistant.cost') IN ('integer', 'real')
            THEN json_extract(m.data, '$.metadata.assistant.cost')
          ELSE ${partCost} END`
        const tokenExpr = tokens('m.data')
        const oldTokens = tokens('m.data', true)
        const hasOldTokens = `json_type(m.data, '$.metadata.assistant.tokens.input') IS NOT NULL
          OR json_type(m.data, '$.metadata.assistant.tokens.output') IS NOT NULL
          OR json_type(m.data, '$.metadata.assistant.tokens.reasoning') IS NOT NULL
          OR json_type(m.data, '$.metadata.assistant.tokens.cache.read') IS NOT NULL
          OR json_type(m.data, '$.metadata.assistant.tokens.cache.write') IS NOT NULL`
        const usage = `CASE WHEN ${hasOldTokens} THEN (${oldTokens}) ELSE (${tokenExpr}) END`
        add(
          'old',
          `SELECT m.id, m.session_id AS session, m.time_created AS at,
            CASE WHEN json_valid(m.data) THEN COALESCE(
              json_extract(m.data, '$.providerID'),
              json_extract(m.data, '$.metadata.assistant.providerID')
            ) END AS provider,
            CASE WHEN json_valid(m.data) THEN COALESCE(
              json_extract(m.data, '$.modelID'),
              json_extract(m.data, '$.model.id'),
              json_extract(m.data, '$.metadata.assistant.modelID'),
              'unknown'
            ) ELSE 'unknown' END AS model,
            ${cost} AS usd,
            CASE WHEN json_valid(m.data) THEN ${usage} ELSE 0 END AS tokens,
            ${updated} AS updated, ${oldVersion}, NULL AS fork_parent, NULL AS fork_at
          FROM message m
          ${join}
          WHERE m.time_created >= ? AND m.time_created < ?
            AND json_extract(CASE WHEN json_valid(m.data) THEN m.data ELSE '{}' END, '$.role') = 'assistant'`,
        )
      } else warnings.push('message table is missing required usage columns')
    }

    if (tables.has('event')) {
      const cols = columns(db, 'event')
      if (has(cols, ['id', 'aggregate_id', 'type', 'data', 'created'])) {
        const join = newSession && has(sessionCols, ['id']) ? `LEFT JOIN ${newSession} s ON s.id = e.aggregate_id` : ''
        const version = newSession && sessionCols.has('version') ? 's.version' : 'NULL'
        const provider = newSession && sessionCols.has('fork_session_id') ? 's.fork_session_id' : 'NULL'
        const forkAt = newSession && sessionCols.has('time_created') ? 's.time_created' : 'NULL'
        add(
          'event',
          `SELECT e.id, e.aggregate_id AS session, e.created AS at,
            NULL AS provider,
            CASE WHEN json_valid(e.data) THEN COALESCE(json_extract(e.data, '$.source'), 'background') ELSE 'background' END AS model,
            CASE WHEN json_valid(e.data) THEN COALESCE(json_extract(e.data, '$.cost'), 0) ELSE 0 END AS usd,
            CASE WHEN json_valid(e.data) THEN COALESCE(
              json_extract(e.data, '$.tokens.input'), 0
            ) + COALESCE(json_extract(e.data, '$.tokens.output'), 0)
              + COALESCE(json_extract(e.data, '$.tokens.reasoning'), 0)
              + COALESCE(json_extract(e.data, '$.tokens.cache.read'), 0)
              + COALESCE(json_extract(e.data, '$.tokens.cache.write'), 0) ELSE 0 END AS tokens,
            e.created AS updated, ${version}, ${provider} AS fork_parent, ${forkAt} AS fork_at
          FROM event e
          ${join}
          WHERE e.created >= ? AND e.created < ? AND e.type LIKE 'session.usage.recorded%' AND json_valid(e.data)`,
        )
      }
    }

    if (!rows.length) throw new Error(warnings.length ? warnings.join(' · ') : 'No supported OpenCode usage tables found')
    const query = { db, rows, sessions, modern, warnings, id }
    queries.set(file, query)
    return query
  } catch (e) {
    db.close()
    throw e
  }
}

const stamp = (value: unknown) => {
  let n: number
  if (typeof value === 'number') n = value
  else if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    n = Number.isFinite(parsed) ? parsed : Date.parse(value)
  } else n = Date.parse(String(value ?? ''))
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 1e12 ? n * 1000 : n
}

const parse = (path: string, session: string): Msg | null | undefined => {
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (data.role !== 'assistant') return undefined
    const meta = record(data.metadata)
    const assistant = record(meta?.assistant)
    const model = record(data.model)
    const time = record(data.time) ?? record(meta?.time)
    const provider = text(data.providerID) ?? text(assistant?.providerID) ?? text(model?.providerID)
    const name = text(data.modelID) ?? text(assistant?.modelID) ?? text(model?.id) ?? 'unknown'
    const source = record(data.tokens) ?? record(assistant?.tokens)
    const cache = record(source?.cache)
    const input = number(source?.input)
    const output = number(source?.output)
    const reasoning = number(source?.reasoning)
    const read = number(cache?.read)
    const write = number(cache?.write)
    const total = number(source?.total) || input + output + reasoning + read + write
    const rawCost = data.cost ?? assistant?.cost
    const cost = Number(rawCost)
    const hasCost = rawCost !== undefined && rawCost !== null && Number.isFinite(cost)
    const at = stamp(time?.created)
    return {
      session: session || text(meta?.sessionID) || text(data.sessionID) || '',
      id: text(data.id) ?? basename(path, '.json'),
      at,
      updated: stamp(time?.completed) || at,
      provider,
      model: name,
      usd: hasCost ? Math.max(0, cost) : 0,
      tokens: Math.max(0, total),
      hasCost,
    }
  } catch {
    return null
  }
}

const walk = (dir: string) => {
  const out: string[] = []
  const stack = [dir]
  while (stack.length) {
    const next = stack.pop()!
    let entries: Dirent[]
    try {
      entries = readdirSync(next, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = join(next, entry.name)
      if (entry.isDirectory()) stack.push(path)
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(path)
    }
  }
  return out.sort()
}

const layouts = () => {
  if (custom !== undefined) return []
  const out: Layout[] = []
  const add = (base: string, scoped: boolean) => {
    const messages = join(base, 'message')
    if (existsSync(messages)) out.push({ messages, parts: join(base, 'part'), scoped })
  }
  add(join(root, 'storage', 'session'), true)
  add(join(root, 'storage'), false)
  const projects = join(root, 'project')
  try {
    for (const entry of readdirSync(projects, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      add(join(projects, entry.name, 'storage', 'session'), true)
      add(join(projects, entry.name, 'storage'), false)
    }
  } catch {}
  return out
}

const stepUsage = (layout: Layout, msg: Msg) => {
  const dir = layout.scoped ? join(layout.parts, msg.session, msg.id) : join(layout.parts, msg.id)
  let usd = 0
  let tokens = 0
  let found = false
  for (const path of walk(dir)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
      if (data.type !== 'step-finish') continue
      const cost = Number(data.cost)
      const usage = record(data.tokens)
      const cache = record(usage?.cache)
      const count = number(usage?.total) || number(usage?.input) + number(usage?.output) + number(usage?.reasoning) + number(cache?.read) + number(cache?.write)
      if (!Number.isFinite(cost)) continue
      found = true
      usd += Math.max(0, cost)
      tokens += Math.max(0, count)
    } catch {}
  }
  return found ? { usd, tokens } : undefined
}

const jsonMsgs = (month: number, until: number) => {
  const entries = layouts().flatMap((layout) =>
    walk(layout.messages).map((path) => ({ layout, path, session: basename(dirname(path)) })),
  )
  const seen = new Set<string>()
  const byId = new Map<string, Msg>()
  let invalid = 0
  for (const { layout, path, session } of entries) {
    seen.add(path)
    let msg: Msg | null | undefined
    try {
      const stat = statSync(path)
      const hit = cache.get(path)
      if (hit?.mtimeMs === stat.mtimeMs && hit.size === stat.size) msg = hit.msg
      else {
        msg = parse(path, session)
        cache.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, msg })
      }
    } catch {
      invalid++
      continue
    }
    if (msg === null) {
      invalid++
      continue
    }
    if (!msg || msg.at < month || msg.at >= until) continue
    if (!msg.hasCost) {
      const usage = stepUsage(layout, msg)
      if (usage) msg = { ...msg, usd: usage.usd, tokens: msg.tokens || usage.tokens, hasCost: true }
    }
    const id = key(msg)
    if (!byId.has(id)) byId.set(id, msg)
  }
  for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path)
  return { files: entries.map((entry) => entry.path), msgs: [...byId.values()], invalid }
}

const usageScore = (msg: Msg) => (msg.usd > 0 ? 2 : msg.tokens > 0 ? 1 : 0)
const better = (next: Ranked, hit: Ranked) => {
  if (next.hasCost !== hit.hasCost) return next.hasCost
  const usage = usageScore(next) - usageScore(hit)
  if (usage) return usage > 0
  if (next.updated !== hit.updated) return next.updated > hit.updated
  return next.rank > hit.rank
}

const push = (map: Map<string, Ranked>, msg: Msg, score: number) => {
  const id = key(msg)
  const hit = map.get(id)
  const next = { ...msg, rank: score }
  if (!hit || better(next, hit)) map.set(id, next)
}

const add = (map: Map<string, Row>, msg: Msg) => {
  const id = `${msg.provider ?? ''}\0${msg.model}`
  const row = map.get(id) ?? {
    source: 'opencode' as const,
    provider: msg.provider,
    model: msg.model,
    calls: 0,
    usd: 0,
    credits: 0,
  }
  row.calls++
  row.usd += msg.usd
  map.set(id, row)
}

export const read = (day: Date, month: Date, until = Date.now()): Use => {
  const from = month.getTime()
  const today = day.getTime()
  const byId = new Map<string, Ranked>()
  const errors: string[] = []
  const warnings: string[] = []
  const opened = new Map<string, Q>()
  const sessionIds = new Set<string>()
  const paths = dbs()
  const active = new Set(paths)
  let found = paths.some((path) => existsSync(path))

  for (const [path, query] of queries) {
    if (active.has(path)) continue
    query.db.close()
    queries.delete(path)
  }
  for (const path of paths) {
    try {
      const query = open(path)
      if (!query) continue
      opened.set(path, query)
      warnings.push(...query.warnings.map((warning) => `${basename(path)}: ${warning}`))
      for (const stmt of query.sessions) {
        for (const row of stmt.all() as { id: string }[]) sessionIds.add(row.id)
      }
    } catch (e) {
      const query = queries.get(path)
      query?.db.close()
      queries.delete(path)
      errors.push(`${basename(path)}: ${(e as Error).message}`)
    }
  }
  for (const [path, query] of opened) {
    try {
      for (const { kind, stmt } of query.rows) {
        for (const row of stmt.all(from, until) as DbRow[]) {
          const cost = Number(row.usd)
          const provider = typeof row.provider === 'string' ? row.provider.trim() : ''
          const model = typeof row.model === 'string' ? row.model.trim() : ''
          push(
            byId,
            {
              session: row.session,
              id: kind === 'event' ? `event:${row.id}` : row.id,
              at: stamp(row.at),
              updated: stamp(row.updated) || stamp(row.at),
              provider: provider || undefined,
              model: model || 'unknown',
              usd: Number.isFinite(cost) ? Math.max(0, cost) : 0,
              tokens: Math.max(0, number(row.tokens)),
              hasCost: true,
              fork: row.fork_parent && row.fork_at ? { parent: row.fork_parent, at: stamp(row.fork_at) } : undefined,
            },
            rank(kind, row.version, query.modern),
          )
        }
      }
    } catch (e) {
      const query = queries.get(path)
      query?.db.close()
      queries.delete(path)
      opened.delete(path)
      errors.push(`${basename(path)}: ${(e as Error).message}`)
    }
  }

  const legacy = jsonMsgs(from, until)
  found ||= legacy.files.length > 0
  if (legacy.invalid) warnings.push(`${legacy.invalid} invalid OpenCode JSON message${legacy.invalid === 1 ? '' : 's'}`)
  for (const msg of legacy.msgs) push(byId, msg, 0)

  const monthRows = new Map<string, Row>()
  const dayRows = new Map<string, Row>()
  let last: number | undefined
  for (const row of byId.values()) {
    if (row.fork && sessionIds.has(row.fork.parent) && row.at < row.fork.at) continue
    add(monthRows, row)
    if (row.at >= today) add(dayRows, row)
    if (row.at > (last ?? 0)) last = row.at
  }
  const sort = (rows: Row[]) =>
    rows.sort((a, b) => b.usd - a.usd || (a.provider ?? '').localeCompare(b.provider ?? '') || a.model.localeCompare(b.model))
  const rows = sort([...dayRows.values()])
  const totals = [...monthRows.values()].reduce<Total>(
    (a, row) => ({ calls: a.calls + row.calls, usd: a.usd + row.usd, credits: a.credits + row.credits }),
    { calls: 0, usd: 0, credits: 0 },
  )
  if (!totals.calls && errors.length) return { rows, month: totals, last, found, err: errors.join(' · '), warnings }
  if (errors.length) warnings.push(...errors)
  return { rows, month: totals, last, found, warnings: warnings.length ? warnings : undefined }
}
