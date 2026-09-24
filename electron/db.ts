import { existsSync, watch as watchFs, type FSWatcher } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Row, Snap } from '../src/types'

export const file = process.env.SPEND_NOTCH_DB ?? join(homedir(), '.copilot', 'session-store.db')

const BY_MODEL = `
  SELECT model, COUNT(*) AS calls, COALESCE(SUM(total_nano_aiu), 0) AS nano
  FROM assistant_usage_events
  WHERE unixepoch(created_at) >= ?
  GROUP BY model
  ORDER BY nano DESC`

const TOTAL = `
  SELECT COUNT(*) AS calls, COALESCE(SUM(total_nano_aiu), 0) AS nano, MAX(unixepoch(created_at)) AS last
  FROM assistant_usage_events
  WHERE unixepoch(created_at) >= ?`

type Total = { calls: number; nano: number; last: number | null }

let q: { db: DatabaseSync; rows: StatementSync; total: StatementSync } | undefined

const open = () => {
  if (q) return q
  const db = new DatabaseSync(file, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 2000')
    return (q = { db, rows: db.prepare(BY_MODEL), total: db.prepare(TOTAL) })
  } catch (e) {
    db.close()
    throw e
  }
}

const sec = (d: Date) => Math.floor(d.getTime() / 1000)

export const read = (): Snap => {
  const now = new Date()
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const month = new Date(now.getFullYear(), now.getMonth(), 1)
  try {
    const { rows, total } = open()
    const m = total.get(sec(month)) as Total
    return {
      rows: (rows.all(sec(day)) as Row[]).map(({ model, calls, nano }) => ({ model, calls, nano })),
      month: { calls: m.calls, nano: m.nano },
      last: m.last ? m.last * 1000 : undefined,
      at: now.getTime(),
    }
  } catch (e) {
    q?.db.close()
    q = undefined
    const err = existsSync(file) ? (e as Error).message : 'Copilot session store not found'
    return { rows: [], month: { calls: 0, nano: 0 }, at: now.getTime(), err }
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
  const name = basename(file)
  let w: FSWatcher | undefined
  if (existsSync(dirname(file))) {
    w = watchFs(dirname(file), (_, f) => {
      if (f?.startsWith(name)) kick()
    })
    w.on('error', () => w?.close())
  }
  const i = setInterval(cb, 15_000)
  return () => {
    w?.close()
    clearInterval(i)
    clearTimeout(t)
  }
}
