import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartData, PlayerMeta, RoundResult, START_CAPITAL, TICKS_PER_WINDOW, WINDOWS, FEE_RATE } from '../engine/types'
import { RoundStepper, buyHoldPct, caughtBottom, contrarianProfits, perfectPct, rankAndPoints, tickReturns } from '../engine/sim'
import { BOTS } from '../engine/bots'
import { Rng, mulberry32 } from '../engine/prng'
import { Speed } from '../App'
import CandleChart from './CandleChart'
import RankBar from './RankBar'
import { useI18n } from '../i18n'
import { isMuted, sCountdown, sLiquidation, sLock, sRoundEnd, sTick, sWindowStart, setMuted } from '../sound'

interface Props {
  chart: ChartData
  players: PlayerMeta[]
  roundIndex: number
  isFinal: boolean
  speed: Speed
  seed: number
  totals: number[]
  onDone: (rr: RoundResult) => void
}

type Phase = 'lock' | 'play'

/** 화면 플래시가 발동하는 한 틱 등락 임계값 */
const FLASH_THRESHOLD = 0.03

export default function Round({ chart, players, roundIndex, isFinal, speed, seed, onDone }: Props) {
  const { t, pname, themeName } = useI18n()
  const n = players.length
  const candles = chart.candles

  // ── 게임 상태 (명령형 코어는 ref, 표시용은 state)
  const steppersRef = useRef<RoundStepper[]>([])
  const posHistRef = useRef<number[][]>([])
  const botRngsRef = useRef<Rng[]>([])
  const botPlanRef = useRef<number[]>([])
  const pendingRef = useRef(0)
  const doneRef = useRef(false)

  const [phase, setPhase] = useState<Phase>('lock')
  const [windowIdx, setWindowIdx] = useState(0)
  const [revealed, setRevealed] = useState(0)
  const [animTick, setAnimTick] = useState(-1)
  const [animProgress, setAnimProgress] = useState(0)
  const [lockLeft, setLockLeft] = useState(speed.lockMs)
  const [pendingPos, setPendingPosState] = useState(0)
  const [humanLocked, setHumanLocked] = useState(false)
  const [lockedFlags, setLockedFlags] = useState<boolean[]>(() => new Array(n).fill(false))
  const [equities, setEquities] = useState<number[]>(() => new Array(n).fill(START_CAPITAL))
  const [positionsNow, setPositionsNow] = useState<number[]>(() => new Array(n).fill(0))
  const [liqBanner, setLiqBanner] = useState<string | null>(null)
  const [liqMarks, setLiqMarks] = useState<number[]>([])
  const [liqSet, setLiqSet] = useState<Set<number>>(() => new Set())
  const [muted, setMutedState] = useState(isMuted())
  // 드라마 요소
  const [lastTickPct, setLastTickPct] = useState<number | null>(null)
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; id: number } | null>(null)
  const [deltas, setDeltas] = useState<number[]>(() => new Array(n).fill(0))
  const [deltaStamp, setDeltaStamp] = useState(0)
  const [showStamp, setShowStamp] = useState(false)

  const returns = useMemo(() => tickReturns(candles), [candles])

  const setPendingPos = useCallback((v: number) => {
    pendingRef.current = v
    setPendingPosState(v)
  }, [])

  // 초기화 (라운드당 1회 — App에서 key로 리마운트)
  if (steppersRef.current.length === 0) {
    steppersRef.current = players.map(() => new RoundStepper(candles))
    posHistRef.current = players.map(() => [])
    botRngsRef.current = players.map((p) => mulberry32((seed ^ (roundIndex * 7919) ^ (p.id * 104729)) >>> 0))
  }

  // ── 락인 페이즈
  useEffect(() => {
    if (doneRef.current) return
    setPhase('lock')
    setHumanLocked(false)
    setLockedFlags(new Array(n).fill(false))
    setLockLeft(speed.lockMs)

    // 봇 의사결정 (현재까지 공개된 캔들만 사용)
    const visible = candles.slice(0, windowIdx * TICKS_PER_WINDOW)
    botPlanRef.current = players.map((p) => {
      if (!p.isBot) return 0
      const def = BOTS.find((b) => b.key === p.botKey)!
      return def.decide(visible, windowIdx, steppersRef.current[p.id].pos, botRngsRef.current[p.id])
    })

    // 봇 락인 연출 (랜덤 타이밍)
    const cosmetic: number[] = []
    players.forEach((p) => {
      if (!p.isBot) return
      const tm = window.setTimeout(() => {
        setLockedFlags((f) => {
          const nf = [...f]
          nf[p.id] = true
          return nf
        })
      }, 400 + botRngsRef.current[p.id]() * speed.lockMs * 0.62)
      cosmetic.push(tm)
    })

    lockActiveRef.current = true
    const deadline = performance.now() + speed.lockMs
    let lastSec = Math.ceil(speed.lockMs / 1000)
    const iv = window.setInterval(() => {
      if (!lockActiveRef.current) {
        window.clearInterval(iv)
        return
      }
      const left = deadline - performance.now()
      setLockLeft(Math.max(0, left))
      const sec = Math.ceil(left / 1000)
      if (sec !== lastSec && sec <= 3 && sec >= 1) sCountdown()
      lastSec = sec
      if (left <= 0) {
        window.clearInterval(iv)
        commit()
      }
    }, 100)

    return () => {
      window.clearInterval(iv)
      cosmetic.forEach((tm) => window.clearTimeout(tm))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowIdx])

  const lockActiveRef = useRef(true)
  const commitRef = useRef<() => void>(() => {})
  const commit = useCallback(() => commitRef.current(), [])
  commitRef.current = () => {
    if (doneRef.current || phase === 'play') return
    lockActiveRef.current = false
    const targets = players.map((p) => (p.isBot ? botPlanRef.current[p.id] : pendingRef.current))
    players.forEach((p) => {
      steppersRef.current[p.id].lockWindow(targets[p.id])
      posHistRef.current[p.id].push(steppersRef.current[p.id].pos)
    })
    setPositionsNow(players.map((p) => steppersRef.current[p.id].pos))
    setEquities(steppersRef.current.map((s) => s.eq))
    setLockedFlags(new Array(n).fill(true))
    setShowStamp(true)
    window.setTimeout(() => setShowStamp(false), 1000)
    sWindowStart()
    setPhase('play')
  }

  // 인간 조기 락인 → 짧은 딜레이 후 바로 재생 (파티 템포)
  const humanLock = useCallback(() => {
    if (humanLocked || phase !== 'lock') return
    setHumanLocked(true)
    sLock()
    window.setTimeout(() => commit(), 450)
  }, [humanLocked, phase, commit])

  // ── 재생 페이즈
  useEffect(() => {
    if (phase !== 'play' || doneRef.current) return
    const tickDur = speed.playMs / TICKS_PER_WINDOW
    let tick = windowIdx * TICKS_PER_WINDOW
    let start = performance.now()
    let raf = 0
    setAnimTick(tick)
    setAnimProgress(0)

    const loop = (now: number) => {
      const prog = (now - start) / tickDur
      if (prog < 1) {
        setAnimProgress(prog)
        raf = requestAnimationFrame(loop)
        return
      }
      // ── 틱 확정
      const r = returns[tick]
      const prevEqs = steppersRef.current.map((s) => s.eq)
      const liquidatedIds: number[] = []
      players.forEach((p) => {
        const step = steppersRef.current[p.id].advanceTick(tick)
        if (step.liquidated) liquidatedIds.push(p.id)
      })
      setEquities(steppersRef.current.map((s) => s.eq))
      setPositionsNow(players.map((p) => steppersRef.current[p.id].pos))
      setDeltas(steppersRef.current.map((s, i) => s.eq - prevEqs[i]))
      setDeltaStamp(tick + 1)
      setLastTickPct(r * 100)
      if (Math.abs(r) >= FLASH_THRESHOLD) setFlash({ dir: r >= 0 ? 'up' : 'down', id: tick })
      sTick(r >= 0, r)
      if (liquidatedIds.length > 0) {
        sLiquidation()
        const names = liquidatedIds.map((id) => `${players[id].emoji} ${pname(players[id])}`)
        setLiqBanner(`💥 ${t.liqBanner(names.join(', '))}`)
        setLiqMarks((m) => [...m, tick])
        setLiqSet((s) => {
          const ns = new Set(s)
          liquidatedIds.forEach((id) => ns.add(id))
          return ns
        })
        window.setTimeout(() => setLiqBanner(null), 2200)
      }
      setRevealed(tick + 1)
      tick++
      if (tick % TICKS_PER_WINDOW === 0) {
        setAnimTick(-1)
        setAnimProgress(0)
        if (tick >= WINDOWS * TICKS_PER_WINDOW) finishRef.current()
        else {
          // 다음 창 — 슬라이더는 현재 실포지션에서 시작 (청산 반영)
          setPendingPos(steppersRef.current[0].pos)
          window.setTimeout(() => setWindowIdx((w) => w + 1), 350)
        }
        return
      }
      setAnimTick(tick)
      setAnimProgress(0)
      start = now
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const finishRef = useRef<() => void>(() => {})
  finishRef.current = () => {
    if (doneRef.current) return
    doneRef.current = true
    sRoundEnd()
    const allPositions = posHistRef.current
    const contrarian = contrarianProfits(allPositions, candles)
    const rankInput = players.map((p) => ({
      playerId: p.id,
      returnPct: steppersRef.current[p.id].returnPct,
      fees: steppersRef.current[p.id].fees,
    }))
    const rp = rankAndPoints(rankInput, isFinal ? 1.5 : 1)
    const rr: RoundResult = {
      chartId: chart.id,
      buyHoldPct: buyHoldPct(candles),
      perfectPct: perfectPct(candles),
      results: players.map((p) => {
        const s = steppersRef.current[p.id]
        const r = rp.get(p.id)!
        return {
          playerId: p.id,
          finalEquity: s.eq,
          returnPct: s.returnPct,
          fees: s.fees,
          turnover: s.turnover,
          rank: r.rank,
          points: r.points,
          positions: allPositions[p.id],
          bottomCatch: caughtBottom(allPositions[p.id], candles),
          contrarianProfit: contrarian[p.id],
        }
      }),
    }
    window.setTimeout(() => onDone(rr), 900)
  }

  // ── 파생 표시값
  const feePreview = useMemo(() => {
    const dx = Math.abs(pendingPos - steppersRef.current[0].pos)
    return steppersRef.current[0].eq * FEE_RATE * dx
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPos, phase, windowIdx, equities])

  const lockSec = Math.ceil(lockLeft / 1000)
  const ringPct = phase === 'lock' ? (lockLeft / speed.lockMs) * 100 : 100
  const vsStartPct = revealed > 0 ? (candles[revealed - 1].c / 100 - 1) * 100 : null

  const toggleMute = () => {
    const m = !muted
    setMuted(m)
    setMutedState(m)
  }

  const posLabel = (x: number) =>
    x > 0.01 ? `${t.long} ${Math.round(x * 100)}%` : x < -0.01 ? `${t.short} ${Math.round(-x * 100)}%` : t.cash100

  const pct = (x: number | null, digits = 1) =>
    x === null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(digits)}%`

  const colorOf = (x: number | null) =>
    x === null ? 'dim' : x > 0.005 ? 'up-c' : x < -0.005 ? 'down-c' : 'dim'

  return (
    <div className="screen round">
      <div className="round-head">
        <span className="head-chip">
          {t.chart} <b>{roundIndex + 1}</b>/6
        </span>
        <span className={`head-chip theme${isFinal ? ' final' : ''}`}>
          {isFinal ? `🔥 ${t.finalTag} — ` : ''}{themeName(chart.theme)}
        </span>
        <span className="head-chip">
          {t.decision} <b>{String(Math.min(windowIdx + 1, WINDOWS)).padStart(2, '0')}</b>/{WINDOWS}
        </span>
        <div className="spacer" />
        <div className={`phase-pill ${phase === 'lock' ? 'phase-lock' : 'phase-play'}`}>
          <div
            className="ring"
            style={{
              background: `conic-gradient(${phase === 'lock' ? 'var(--amber)' : 'var(--up)'} ${ringPct}%, rgba(163,183,219,0.12) 0)`,
            }}
          >
            <span>{phase === 'lock' ? lockSec : '▶'}</span>
          </div>
          {phase === 'lock' ? t.orderPhase : t.playPhase}
        </div>
        <button className="mute-btn" onClick={toggleMute} title="sound">
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div className="round-body">
        <div className="chart-panel">
          <div className="delta-strip">
            <div className="delta-cell">
              <label>{t.tick}</label>
              <b className="dim">{revealed}<span style={{ color: 'var(--text-faint)', fontSize: 12 }}>/60</span></b>
            </div>
            <div className="divider" />
            <div className="delta-cell big">
              <label>{t.lastTick}</label>
              <b
                key={deltaStamp}
                className={`${colorOf(lastTickPct)} ${
                  lastTickPct !== null ? (lastTickPct >= 0 ? 'delta-flash-up' : 'delta-flash-down') : ''
                }`}
              >
                {pct(lastTickPct)}
                {lastTickPct !== null && (
                  <span style={{ fontSize: 15 }}> {lastTickPct >= 0 ? '▲' : '▼'}</span>
                )}
              </b>
            </div>
            <div className="divider" />
            <div className="delta-cell">
              <label>{t.vsStart}</label>
              <b className={colorOf(vsStartPct)}>{pct(vsStartPct)}</b>
            </div>
            <div className="spacer" />
            {phase === 'play' ? (
              <div className="live-badge">
                <span className="dot" />
                {t.live}
              </div>
            ) : (
              <div className="live-badge amber">
                <span className="dot" />
                {t.orderPhase}
              </div>
            )}
          </div>

          {liqBanner && <div className="liq-banner">{liqBanner}</div>}

          <div className="chart-area">
            <div className="corner-b" />
            {flash && <div key={flash.id} className={`chart-flash ${flash.dir}`} />}
            {showStamp && <div className="stamp">🔒 {t.allLocked}</div>}
            {revealed === 0 && phase === 'lock' && (
              <div className="blind-overlay">
                <div>
                  <span className="q">???</span>
                  {t.blind1}
                  <br />
                  <b>{t.blind2}</b>
                </div>
              </div>
            )}
            <CandleChart
              candles={candles}
              revealed={revealed}
              animTick={animTick}
              animProgress={animProgress}
              liqMarks={liqMarks}
            />
          </div>
          <div className="tick-dots">
            {Array.from({ length: WINDOWS * TICKS_PER_WINDOW }, (_, tk) => (
              <div
                key={tk}
                className={`tick-dot${tk < revealed ? ' done' : ''}${tk === revealed && phase === 'play' ? ' now' : ''}${tk % 5 === 0 && tk >= revealed ? ' win-edge' : ''}`}
              />
            ))}
          </div>
        </div>

        <RankBar
          players={players}
          equities={equities}
          positions={positionsNow}
          phase={phase}
          lockedFlags={lockedFlags}
          liqSet={liqSet}
          deltas={deltas}
          deltaStamp={deltaStamp}
        />
      </div>

      <div className="order-panel">
        <div className="order-top">
          <span className={`pos-readout ${pendingPos > 0.01 ? 'up-c' : pendingPos < -0.01 ? 'down-c' : 'dim'}`}>
            {pendingPos > 0.01 && <span className="arr">▲ </span>}
            {pendingPos < -0.01 && <span className="arr">▼ </span>}
            {posLabel(pendingPos)}
          </span>
          <span className="fee-preview">
            {t.feePreview(Math.round(feePreview).toLocaleString())}
            <br />
            {t.feeNote}
          </span>
          <div className="spacer" />
          {phase === 'lock' ? (
            <button className={`lock-btn${humanLocked ? ' locked' : ''}`} onClick={humanLock} disabled={humanLocked}>
              {humanLocked ? `🔒 ${t.lockedBtn}` : `⚡ ${t.lockBtn}`}
            </button>
          ) : (
            <span className="play-hint">
              <b>{posLabel(steppersRef.current[0]?.pos ?? 0)}</b> — {t.playPhase}
            </span>
          )}
        </div>

        <div className="slider-zone">
          <span className="slider-side down-c">{t.short} 100%</span>
          <input
            className="pos-slider"
            type="range"
            min={-100}
            max={100}
            step={5}
            value={Math.round(pendingPos * 100)}
            disabled={phase !== 'lock' || humanLocked}
            onChange={(e) => setPendingPos(Number(e.target.value) / 100)}
          />
          <span className="slider-side up-c">{t.long} 100%</span>
        </div>

        <div className="quick-row">
          {[-1, -0.5, 0, 0.5, 1].map((v, i) => (
            <button
              key={v}
              className={`quick-btn ${v < 0 ? 'q-short' : v > 0 ? 'q-long' : ''}`}
              disabled={phase !== 'lock' || humanLocked}
              onClick={() => setPendingPos(v)}
            >
              {t.quick[i]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
