import NumberFlow from '@number-flow/react'
import { CopilotIcon } from '@primer/octicons-react'
import { AnimatePresence, motion, type Transition } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { label, tint } from './models'
import { cash, credits, CREDIT_USD, money, num, sum, top, usd } from './usage'
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
        <CopilotIcon size={14} className="text-white/85" />
        Today
        <Live s={s} />
      </span>
      <Amount s={s} className="text-[13px] font-semibold" />
    </motion.div>
  )
}

function Full({ s, rows, onH }: { s?: Snap; rows: Row[]; onH: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const day = sum(s?.rows ?? [], 'nano')
  const calls = sum(s?.rows ?? [], 'calls')
  const month = s?.month.nano ?? 0

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
            <CopilotIcon size={12} className="text-white/80" />
            Today
            <Live s={s} />
          </Label>
          <Amount s={s} className="font-display text-[32px] leading-none font-semibold tracking-tight" />
          <p className="mt-1.5 text-[11px] text-white/45">
            {num(credits(day))} credits · {num(calls)} calls
          </p>
        </div>
        <div className="text-right">
          <Label className="justify-end">Month to date</Label>
          <NumberFlow
            value={usd(month)}
            format={cur}
            locales="en-US"
            className="font-display text-[18px] leading-none font-semibold"
          />
          <p className="mt-1.5 text-[11px] text-white/45">{num(credits(month))} credits</p>
        </div>
      </div>
      <ul className="mt-3 border-t border-white/10 pt-2">
        {s?.err ? (
          <li className="flex h-[26px] items-center truncate text-[12px] text-amber-300/90">{s.err}</li>
        ) : rows.length ? (
          rows.map((r) => <Model key={r.model} r={r} total={day} />)
        ) : (
          <li className="flex h-[26px] items-center text-[12px] text-white/45">No Copilot usage yet today</li>
        )}
      </ul>
      <div className="mt-2 flex justify-between border-t border-white/10 pt-2 text-[10.5px] text-white/35">
        <span>1 credit = {cash(CREDIT_USD)}</span>
        <span>Copilot app + CLI · {s ? clock.format(s.at) : '…'}</span>
      </div>
    </motion.div>
  )
}

function Model({ r, total }: { r: Row; total: number }) {
  const c = tint(r.model)
  return (
    <li className="grid h-[26px] grid-cols-[128px_1fr_76px] items-center gap-3 text-[12px]">
      <span className="flex min-w-0 items-center gap-2 text-white/80">
        <span className="size-2 shrink-0 rounded-full" style={{ background: c }} />
        <span className="truncate">{label(r.model)}</span>
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]">
        <motion.span
          className="block h-full rounded-full"
          style={{ background: c }}
          initial={{ width: 0 }}
          animate={{ width: `${total ? (r.nano / total) * 100 : 0}%` }}
          transition={spring}
        />
      </span>
      <span className="text-right text-white/90 tabular-nums">{money(r.nano)}</span>
    </li>
  )
}

function Amount({ s, className }: { s?: Snap; className: string }) {
  if (s?.err) return <span className={className}>—</span>
  return <NumberFlow value={usd(sum(s?.rows ?? [], 'nano'))} format={cur} locales="en-US" className={className} />
}

function Live({ s }: { s?: Snap }) {
  const on = !!s?.last && s.at - s.last < 90_000
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
