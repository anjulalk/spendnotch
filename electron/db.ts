import { existsSync, statSync, watch as watchFs, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { credits, usd } from '../src/usage'
import type { Snap, Total } from '../src/types'
import { dbs as opencodeDbs, read as readOpencode, root as opencodeRoot, type Use } from './opencode'

export const file = process.env.SPEND_NOTCH_DB ?? join(homedir(), '.copilot', 'session-store.db')

const BY_MODEL = `
  SELECT model, COUNT(*) AS calls, COALESCE(SUM(total_nano_aiu), 0) AS nano
  FROM assistant_usage_events
  WHERE unixepoch(created_at) >= ? AND unixepoch(created_at) < ?
  GROUP BY model
  ORDER BY nano DESC`

const TOTAL = `
  SELECT COUNT(*) AS calls, COALESCE(SUM(total_nano_aiu), 0) AS nano, MAX(unixepoch(created_at)) AS last
  FROM assistant_usage_events
  WHERE unixepoch(created_at) >= ? AND unixepoch(created_at) < ?`

type Raw = { model: string; calls: number; nano: number }
type TotalRow = { calls: number; nano: number; last: number | null }

let q: { db: DatabaseSync; rows: StatementSync; total: StatementSync; id: string } | undefined

const id = () => {
  const stat = statSync(file, { bigint: true })
  return `${stat.dev}:${stat.ino}:${stat.birthtimeMs}`
}

const open = () => {
  if (!existsSync(file)) {
    q?.db.close()
    q = undefined
    return undefined
  }
  const current = id()
  if (q?.id === current) return q
  q?.db.close()
  q = undefined
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 2000')
    return (q = { db, rows: db.prepare(BY_MODEL), total: db.prepare(TOTAL), id: current })
  } catch (e) {
    db.close()
    throw e
  }
}

const sec = (d: Date) => Math.floor(d.getTime() / 1000)
const zero = (): Total => ({ calls: 0, usd: 0, credits: 0 })

const readCopilot = (day: Date, month: Date, now: Date): Use => {
  if (!existsSync(file)) return { rows: [], month: zero(), found: false }
  try {
    const query = open()
    if (!query) return { rows: [], month: zero(), found: false }
    const { rows, total } = query
    const m = total.get(sec(month), sec(now)) as TotalRow
    const nano = Math.max(0, Number(m.nano) || 0)
    return {
      rows: (rows.all(sec(day), sec(now)) as Raw[]).map(({ model, calls, nano }) => {
        const value = Math.max(0, Number(nano) || 0)
        return {
          source: 'copilot' as const,
          model: typeof model === 'string' && model ? model : 'unknown',
          calls: Math.max(0, Number(calls) || 0),
          usd: usd(value),
          credits: credits(value),
        }
      }),
      month: { calls: Math.max(0, Number(m.calls) || 0), usd: usd(nano), credits: credits(nano) },
      last: m.last && m.last * 1000 < now.getTime() ? m.last * 1000 : undefined,
      found: true,
    }
  } catch (e) {
    q?.db.close()
    q = undefined
    return { rows: [], month: zero(), found: true, err: (e as Error).message }
  }
}

const sum = (a: Total, b: Total): Total => ({
  calls: a.calls + b.calls,
  usd: a.usd + b.usd,
  credits: a.credits + b.credits,
})

export const read = (): Snap => {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const month = new Date(now.getFullYear(), now.getMonth(), 1)
  const copilot = readCopilot(day, month, now)
  const opencode = readOpencode(day, month, now.getTime())
  const rows = [...copilot.rows, ...opencode.rows].sort((a, b) => b.usd - a.usd || a.model.localeCompare(b.model))
  const last = [copilot.last, opencode.last].filter((value): value is number => value !== undefined)
  const active = rows.length > 0 || copilot.month.calls > 0 || opencode.month.calls > 0
  const failures = [copilot.err, opencode.err].filter((value): value is string => value !== undefined)
  const warningSet = new Set(opencode.warnings ?? [])
  if (active) {
    if (copilot.err) warningSet.add(`Copilot: ${copilot.err}`)
    if (opencode.err) warningSet.add(`OpenCode: ${opencode.err}`)
  }
  const errors = active ? [] : failures
  const missing = !copilot.found && !opencode.found
  return {
    rows,
    month: sum(copilot.month, opencode.month),
    last: last.length ? Math.max(...last) : undefined,
    at: now.getTime(),
    err: errors.length ? errors.join(' · ') : missing ? 'Usage stores not found' : undefined,
    warnings: warningSet.size ? [...warningSet] : undefined,
  }
}

export const watch = (cb: () => void) => {
  let t: NodeJS.Timeout | undefined
  const kick = () => {
    t ??= setTimeout(() => {
      t = undefined
      cb()
    }, 750)
  }
  const targets = new Map<string, (name: string) => boolean>()
  const add = (dir: string, match: (name: string) => boolean) => {
    const current = targets.get(dir)
    targets.set(dir, current ? (name) => current(name) || match(name) : match)
  }
  const fileMatch = (name: string) => (event: string) => event === name || event.startsWith(`${name}-`)
  add(dirname(file), fileMatch(basename(file)))
  for (const path of opencodeDbs()) add(dirname(path), fileMatch(basename(path)))
  add(opencodeRoot, (name) => {
    const path = name.replace(/\\/g, '/')
    return (
      path === 'storage' ||
      path.startsWith('storage/') ||
      path === 'project' ||
      path.startsWith('project/') ||
      /^opencode.*\.db(?:-|$)/i.test(path)
    )
  })

  const watchers: FSWatcher[] = []
  for (const [dir, match] of targets) {
    if (!existsSync(dir)) continue
    const onEvent = (_: string, name: string | null) => {
      if (name && match(name)) kick()
    }
    let w: FSWatcher
    try {
      w = dir === opencodeRoot ? watchFs(dir, { recursive: true }, onEvent) : watchFs(dir, onEvent)
    } catch {
      w = watchFs(dir, onEvent)
    }
    w.on('error', () => w.close())
    watchers.push(w)
  }
  const i = setInterval(cb, 15_000)
  return () => {
    watchers.forEach((w) => w.close())
    clearInterval(i)
    clearTimeout(t)
  }
}
