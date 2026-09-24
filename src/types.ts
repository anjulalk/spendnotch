export type Source = 'copilot' | 'opencode'

export type Row = {
  source?: Source
  provider?: string
  model: string
  calls: number
  usd: number
  credits: number
}

export type Total = {
  calls: number
  usd: number
  credits: number
}

export type Snap = {
  rows: Row[]
  month: Total
  last?: number
  at: number
  err?: string
  warnings?: string[]
}

export type Api = {
  snap: () => Promise<Snap | undefined>
  on: (cb: (s: Snap) => void) => () => void
  hover: (on: boolean) => void
}
