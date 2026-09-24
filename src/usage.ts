import type { Row } from './types'

export const CREDIT_USD = 0.01

export const credits = (nano: number) => nano / 1e9
export const usd = (nano: number) => credits(nano) * CREDIT_USD

const cur = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

export const cash = (n: number) => cur.format(n)
export const money = (nano: number) => cash(usd(nano))
export const num = (n: number) => int.format(n)

export const sum = (rows: Row[], k: 'calls' | 'nano') => rows.reduce((a, r) => a + r[k], 0)

export const top = (rows: Row[], n = 5): Row[] => {
  if (rows.length <= n) return rows
  const rest = rows.slice(n - 1)
  return [...rows.slice(0, n - 1), { model: '', calls: sum(rest, 'calls'), nano: sum(rest, 'nano') }]
}
