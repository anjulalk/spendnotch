import NumberFlow from '@number-flow/react'
import { CopilotIcon } from '@primer/octicons-react'
import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { label, tint } from './models'
import { cash, CREDIT_USD, num, sum, top } from './usage'
import type { Row, Snap } from './types'

const spring: Transition = { type: 'spring', stiffness: 420, damping: 36, mass: 0.9 }
const cur = { style: 'currency', currency: 'USD' } as const
const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

const size = (open: boolean, h: number) =>
  open ? { w: 420, h, r: 26, ear: 14 } : { w: 232, h: 34, r: 17, ear: 10 }

const fade = {
  initial: { opacity: 0, filter: 'blur(6px)', scale: 0.96 },
  animate: { opacity: 1, filter: 'blur(0px)', scale: 1, transition: { duration: 0.22, delay: 0.06 } },
  exit: { opacity: 0, filter: 'blur(6px)', scale: 0.96, transition: { duration: 0.12 } },
}

function useSnap() {
  const [s, set] = useState<Snap>()
  useEffect(() => {
    window.api.snap().then((v) => set((p) => p ?? v))
    return window.api.on(set)
  }, [])
  return s
}

export function App() {
  const s = useSnap()
  const [open, setOpen] = useState(false)
  const [h, setH] = useState(0)
  const t = useRef<number>(undefined)
  const rows = top(s?.rows ?? [])
  const z = size(open, h || 200)

  const enter = () => {
    clearTimeout(t.current)
    window.api.hover(true)
    setOpen(true)
  }
  const leave = () => {
    window.api.hover(false)
    t.current = window.setTimeout(() => setOpen(false), 140)
  }

  return (
    <div className="flex justify-center">
      <motion.div
        className="notch relative bg-black"
        onPointerEnter={enter}
        onPointerLeave={leave}
        initial={false}
        animate={{
          width: z.w,
          height: z.h,
          borderBottomLeftRadius: z.r,
          borderBottomRightRadius: z.r,
          '--ear': `${z.ear}px`,
          boxShadow: open ? '0 14px 36px rgba(0,0,0,0.45)' : '0 0px 0px rgba(0,0,0,0)',
        }}
        transition={spring}
      >
        <i className="ear l" />
        <i className="ear r" />
        <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
          <AnimatePresence initial={false}>
            {open ? <Full key="full" s={s} rows={rows} onH={setH} /> : <Mini key="mini" s={s} />}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  )
}

function Mini({ s }: { s?: Snap }) {
  return (
    <motion.div {...fade} className="absolute inset-x-0 top-0 flex h-[34px] items-center justify-between px-3.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/55">
        <span className="flex items-center">
          <span className="size-2 rounded-full border border-[#8b949e] bg-black" />
          <span className="-ml-1 size-2 rounded-full border border-white/60 bg-black" />
        </span>
        Today
        <Live s={s} />
      </span>
      <Amount s={s} className="text-[13px] font-semibold" />
    </motion.div>
  )
}

function Full({ s, rows, onH }: { s?: Snap; rows: Row[]; onH: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const day = sum(s?.rows ?? [], 'usd')
  const calls = sum(s?.rows ?? [], 'calls')
  const dayCredits = sum(s?.rows ?? [], 'credits')
  const month = s?.month.usd ?? 0
  const monthCredits = s?.month.credits ?? 0

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => onH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [onH])

  return (
    <motion.div
      ref={ref}
      {...fade}
      className="absolute top-0 left-1/2 w-[420px] -translate-x-1/2 px-5 pt-3.5 pb-3"
    >
      <div className="flex items-start justify-between">
        <div>
          <Label>
            <span className="size-1.5 rounded-full bg-white/60" />
            Today
            <Live s={s} />
          </Label>
          <Amount s={s} className="font-display text-[32px] leading-none font-semibold tracking-tight" />
          <p className="mt-1.5 text-[11px] text-white/45">
            {num(dayCredits)} Copilot AI credits · {num(calls)} calls
          </p>
        </div>
        <div className="text-right">
          <Label className="justify-end">Month to date</Label>
          <NumberFlow
            value={month}
            format={cur}
            locales="en-US"
            className="font-display text-[18px] leading-none font-semibold"
          />
          <p className="mt-1.5 text-[11px] text-white/45">{num(monthCredits)} Copilot AI credits</p>
        </div>
      </div>
      <ul className="mt-3 border-t border-white/10 pt-2">
        {s?.err ? (
          <li className="flex h-[26px] items-center truncate text-[12px] text-amber-300/90">{s.err}</li>
        ) : rows.length ? (
          rows.map((r) => <Model key={`${r.source ?? ''}:${r.provider ?? ''}:${r.model}`} r={r} total={day} />)
        ) : (
          <li className="flex h-[26px] items-center text-[12px] text-white/45">No AI usage yet today</li>
        )}
        {!s?.err && s?.warnings?.length ? (
          <li
            className="flex h-[24px] items-center truncate text-[11px] text-amber-300/80"
            title={s.warnings.join(' · ')}
          >
            Partial data: {s.warnings[0]}
            {s.warnings.length > 1 ? ` (+${s.warnings.length - 1})` : ''}
          </li>
        ) : null}
      </ul>
      <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-[10.5px] text-white/35">
        <span>1 Copilot AI credit = {cash(CREDIT_USD)}</span>
        <span>Copilot + OpenCode · {s ? clock.format(s.at) : '…'}</span>
      </div>
    </motion.div>
  )
}

function Model({ r, total }: { r: Row; total: number }) {
  const name = r.source === 'opencode' && r.provider ? `${r.provider}/${r.model}` : r.model
  const c = tint(name)
  const source = r.source === 'copilot' ? 'Copilot' : r.source === 'opencode' ? 'OpenCode' : 'Other'
  return (
    <li className="grid h-[26px] grid-cols-[142px_1fr_76px] items-center gap-3 text-[12px]">
      <span className="flex min-w-0 items-center gap-1.5 text-white/80" title={`${source} · ${name}`}>
        {r.source === 'copilot' ? (
          <CopilotIcon size={11} className="shrink-0 text-white/70" />
        ) : r.source === 'opencode' ? (
          <span className="flex size-3 shrink-0 items-center justify-center rounded bg-white/10 text-[6px] font-semibold text-white/70">OC</span>
        ) : (
          <span className="size-2 shrink-0 rounded-full" style={{ background: c }} />
        )}
        <span className="truncate">
          {r.source === 'opencode' && r.provider ? `${r.provider} · ${label(r.model)}` : label(r.model)}
        </span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <motion.span
          className="block h-full rounded-full"
          style={{ background: c }}
          initial={{ width: 0 }}
          animate={{ width: `${total ? (r.usd / total) * 100 : 0}%` }}
          transition={spring}
        />
      </span>
      <span className="text-right text-white/90 tabular-nums">{cash(r.usd)}</span>
    </li>
  )
}

function Amount({ s, className }: { s?: Snap; className: string }) {
  if (s?.err) return <span className={className}>—</span>
  return <NumberFlow value={sum(s?.rows ?? [], 'usd')} format={cur} locales="en-US" className={className} />
}

function Live({ s }: { s?: Snap }) {
  const on = !!s?.last && s.at >= s.last && s.at - s.last < 90_000
  return (
    <motion.span
      className={`size-1.5 rounded-full ${on ? 'bg-[#3fb950]' : 'bg-white/20'}`}
      animate={{ opacity: on ? [1, 0.3, 1] : 1 }}
      transition={on ? { duration: 1.6, repeat: Infinity } : { duration: 0.2 }}
    />
  )
}

function Label({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <p
      className={`mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium tracking-[0.08em] text-white/45 uppercase ${className}`}
    >
      {children}
    </p>
  )
}
