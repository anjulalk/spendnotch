export type Row = { model: string; calls: number; nano: number }

export type Snap = {
  rows: Row[]
  month: { calls: number; nano: number }
  last?: number
  at: number
  err?: string
}

export type Api = {
  snap: () => Promise<Snap | undefined>
  on: (cb: (s: Snap) => void) => () => void
  hover: (on: boolean) => void
}
