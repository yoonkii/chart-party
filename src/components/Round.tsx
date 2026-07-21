import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartData, PlayerMeta, RoundResult, START_CAPITAL, TICKS_PER_WINDOW, WINDOWS, FEE_RATE } from '../engine/types'
import { RoundStepper, buyHoldPct, caughtBottom, contrarianProfits, perfectPct, rankAndPoints, tickReturns } from '../engine/sim'
import { BOTS } from '../engine/bots'
import { Rng, mulberry32 } from '../engine/prng'
import { Mode, Speed } from '../App'
import { GuestSession, HostSession, Session } from '../net/session'
import CandleChart from './CandleChart'
import RankBar from './RankBar'
import { useI18n } from '../i18n'
import {
  isMuted, sClutch, sCountdown, sLeadChange, sLiquidation, sLock, sReact, sRoundEnd, sStinger,
  sTick, sWindowStart, setMuted,
} from '../sound'

interface Props {
  chart: ChartData
  players: PlayerMeta[]
  roundIndex: number
  isFinal: boolean
  speed: Speed
  seed: number
  totals: number[]
  myId: number
  mode: Mode
  session: Session | null
  onDone: (rr: RoundResult) => void
}

type Phase = 'lock' | 'play'

const FLASH_THRESHOLD = 0.03
const STINGER_MS = 2400
const REACT_EMOJIS = ['😂', '🚀', '😱', '💎', '🤡', '🙏']

interface FloatingReact {
  key: number
  playerId: number
  emoji: string
}

export default function Round({ chart, players, roundIndex, isFinal, speed, seed, myId, mode, session, onDone }: Props) {
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
  const humanLockedRef = useRef(false)
  const windowDoneRef = useRef(-1) // 게스트: 애니메이션 완료된 창 (phase 대기용)
  const reactKeyRef = useRef(0)
  const posSendTimerRef = useRef(0)
  /** 게스트 캐치업: 아직 도달 못 한 창의 play 포지션 버퍼 (백그라운드 탭 rAF 정지 대비) */
  const playBufRef = useRef<Map<number, number[]>>(new Map())
  const phaseRef = useRef<Phase>('lock')

  const [stingerDone, setStingerDone] = useState(false)
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
  const [leadBanner, setLeadBanner] = useState<string | null>(null)
  const [liqMarks, setLiqMarks] = useState<number[]>([])
  const [liqSet, setLiqSet] = useState<Set<number>>(() => new Set())
  const [muted, setMutedState] = useState(isMuted())
  const [lastTickPct, setLastTickPct] = useState<number | null>(null)
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; id: number } | null>(null)
  const [deltas, setDeltas] = useState<number[]>(() => new Array(n).fill(0))
  const [deltaStamp, setDeltaStamp] = useState(0)
  const [showStamp, setShowStamp] = useState(false)
  const [reacts, setReacts] = useState<FloatingReact[]>([])

  const returns = useMemo(() => tickReturns(candles), [candles])
  const clutch = isFinal && windowIdx === WINDOWS - 1

  const setPendingPos = useCallback(
    (v: number) => {
      pendingRef.current = v
      setPendingPosState(v)
      // 게스트: 호스트에 스로틀 전송
      if (mode === 'guest' && session) {
        window.clearTimeout(posSendTimerRef.current)
        posSendTimerRef.current = window.setTimeout(() => {
          ;(session as GuestSession).setPos(windowIdxRef.current, pendingRef.current)
        }, 120)
      }
    },
    [mode, session]
  )

  const windowIdxRef = useRef(0)
  useEffect(() => {
    windowIdxRef.current = windowIdx
  }, [windowIdx])
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  // 초기화 (라운드당 1회 — App에서 key로 리마운트)
  if (steppersRef.current.length === 0) {
    steppersRef.current = players.map(() => new RoundStepper(candles))
    posHistRef.current = players.map(() => [])
    botRngsRef.current = players.map((p) => mulberry32((seed ^ (roundIndex * 7919) ^ (p.id * 104729)) >>> 0))
  }

  // ── 리액션 표출
  const showReact = useCallback((playerId: number, emoji: string) => {
    sReact()
    const key = ++reactKeyRef.current
    setReacts((r) => [...r.slice(-7), { key, playerId, emoji }])
    window.setTimeout(() => setReacts((r) => r.filter((x) => x.key !== key)), 2600)
  }, [])

  const sendReact = useCallback(
    (emoji: string) => {
      if (mode === 'solo') showReact(myId, emoji)
      else if (session) session.react(emoji) // 표출은 세션 이벤트에서 일괄 처리
    },
    [mode, session, myId, showReact]
  )

  /** 봇 리액션 (솔로/호스트만 생성, 호스트는 전파) */
  const botReact = useCallback(
    (playerId: number, emoji: string, delayMs: number) => {
      if (mode === 'guest') return
      window.setTimeout(() => {
        if (mode === 'host' && session) (session as HostSession).reactAs(playerId, emoji)
        else showReact(playerId, emoji)
      }, delayMs)
    },
    [mode, session, showReact]
  )

  // ── 세션 이벤트 구독 (마운트 1회)
  useEffect(() => {
    if (!session || mode === 'solo') return
    const offs = [
      session.on('locked', (pid) => {
        setLockedFlags((f) => {
          const nf = [...f]
          nf[pid as number] = true
          return nf
        })
        // 호스트: 본인 + 전 게스트 락인 → 조기 커밋
        if (mode === 'host' && humanLockedRef.current && (session as HostSession).allGuestsLocked()) {
          window.setTimeout(() => commitRef.current(), 400)
        }
      }),
      session.on('react', (d) => {
        const { playerId, emoji } = d as { playerId: number; emoji: string }
        showReact(playerId, emoji)
      }),
      session.on('play', (m) => {
        const msg = m as { chartIndex: number; w: number; positions: number[] }
        if (mode !== 'guest' || msg.chartIndex !== roundIndex) return
        if (msg.w === windowIdxRef.current && phaseRef.current === 'lock') {
          commitWithRef.current(msg.w, msg.positions)
        } else if (msg.w > windowIdxRef.current) {
          // 뒤처짐(백그라운드 탭 등) → 버퍼링, 애니메이션 완료 시 빠르게 따라잡는다
          playBufRef.current.set(msg.w, msg.positions)
        }
      }),
      session.on('phase', (m) => {
        const msg = m as { chartIndex: number; w: number; durationMs: number }
        if (mode === 'guest' && msg.chartIndex === roundIndex && msg.w > 0) {
          // 내 애니메이션이 끝났으면 즉시 다음 창으로, 아니면 완료 시 이동
          if (windowDoneRef.current >= msg.w - 1) setWindowIdx(msg.w)
          // (진행 중이면 재생 루프 종료부에서 session.phaseW를 확인해 이동)
        }
      }),
    ]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, mode, roundIndex])

  // ── 테마 인트로 스팅어
  useEffect(() => {
    sStinger()
    const tm = window.setTimeout(() => setStingerDone(true), STINGER_MS)
    return () => window.clearTimeout(tm)
  }, [])

  // ── 락인 페이즈
  useEffect(() => {
    if (doneRef.current || !stingerDone) return
    // 게스트 캐치업: 이 창의 play가 이미 도착해 있으면 락 페이즈 생략, 즉시 체결
    if (mode === 'guest' && playBufRef.current.has(windowIdx)) {
      const buf = playBufRef.current.get(windowIdx)!
      playBufRef.current.delete(windowIdx)
      setPhase('lock')
      const tm = window.setTimeout(() => commitWithRef.current(windowIdx, buf), 60)
      return () => window.clearTimeout(tm)
    }
    setPhase('lock')
    setHumanLocked(false)
    humanLockedRef.current = false
    setLockedFlags(new Array(n).fill(false))
    setLockLeft(speed.lockMs)
    if (clutch) sClutch()

    // 봇 의사결정 — 솔로/호스트만 (게스트는 포지션을 브로드캐스트로 받음)
    if (mode !== 'guest') {
      const visible = candles.slice(0, windowIdx * TICKS_PER_WINDOW)
      botPlanRef.current = players.map((p) => {
        if (!p.isBot) return 0
        const def = BOTS.find((b) => b.key === p.botKey)!
        return def.decide(visible, windowIdx, steppersRef.current[p.id].pos, botRngsRef.current[p.id])
      })
    }
    if (mode === 'host' && session) {
      ;(session as HostSession).beginLockWindow(roundIndex, windowIdx, speed.lockMs)
    }

    // 봇 락인 연출 (전 모드 로컬 코스메틱)
    const cosmetic: number[] = []
    players.forEach((p) => {
      if (!p.isBot) return
      const tm = window.setTimeout(() => {
        setLockedFlags((f) => {
          const nf = [...f]
          nf[p.id] = true
          return nf
        })
      }, 400 + Math.random() * speed.lockMs * 0.62)
      cosmetic.push(tm)
    })

    lockActiveRef.current = true
    const deadline =
      mode === 'guest' && session && (session as GuestSession).phaseW === windowIdx
        ? (session as GuestSession).lockDeadline
        : performance.now() + speed.lockMs
    let lastSec = Math.ceil((deadline - performance.now()) / 1000)
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
        if (mode !== 'guest') commit() // 게스트 커밋은 host의 play 메시지가 트리거
      }
    }, 100)

    return () => {
      window.clearInterval(iv)
      cosmetic.forEach((tm) => window.clearTimeout(tm))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowIdx, stingerDone])

  const lockActiveRef = useRef(true)

  /** 전 모드 공통 커밋: 포지션 배열로 스테퍼 리밸런스 + 재생 진입 */
  const commitWithRef = useRef<(w: number, positions: number[]) => void>(() => {})
  commitWithRef.current = (w: number, positions: number[]) => {
    if (doneRef.current || phase === 'play' || w !== windowIdx) return
    lockActiveRef.current = false
    players.forEach((p) => {
      steppersRef.current[p.id].lockWindow(positions[p.id])
      posHistRef.current[p.id].push(steppersRef.current[p.id].pos)
    })
    // 내 슬라이더를 실제 체결값과 동기화 (게스트 늦은 입력 유실 대비)
    setPendingPosState(steppersRef.current[myId].pos)
    pendingRef.current = steppersRef.current[myId].pos
    setPositionsNow(players.map((p) => steppersRef.current[p.id].pos))
    setEquities(steppersRef.current.map((s) => s.eq))
    setLockedFlags(new Array(n).fill(true))
    setShowStamp(true)
    window.setTimeout(() => setShowStamp(false), 1000)
    sWindowStart()
    setPhase('play')
  }

  /** 솔로/호스트 권위 커밋 — 포지션 확정 후 (호스트는 브로드캐스트) */
  const commitRef = useRef<() => void>(() => {})
  const commit = useCallback(() => commitRef.current(), [])
  commitRef.current = () => {
    if (doneRef.current || phase === 'play' || mode === 'guest') return
    const positions = players.map((p) => {
      if (!p.isBot && p.id === myId) return pendingRef.current
      if (p.isBot) return botPlanRef.current[p.id]
      // 호스트: 게스트 입력 (없으면 이전 포지션 유지)
      const gp = session ? (session as HostSession).guestPosOf(p.id) : null
      return gp ?? steppersRef.current[p.id].pos
    })
    if (mode === 'host' && session) (session as HostSession).sendPlay(roundIndex, windowIdx, positions)
    commitWithRef.current(windowIdx, positions)
  }

  // 조기 락인
  const humanLock = useCallback(() => {
    if (humanLockedRef.current || phase !== 'lock') return
    setHumanLocked(true)
    humanLockedRef.current = true
    sLock()
    setLockedFlags((f) => {
      const nf = [...f]
      nf[myId] = true
      return nf
    })
    if (mode === 'solo') {
      window.setTimeout(() => commit(), 450)
    } else if (mode === 'host' && session) {
      ;(session as HostSession).noteHostLocked()
      if ((session as HostSession).allGuestsLocked()) window.setTimeout(() => commit(), 450)
    } else if (mode === 'guest' && session) {
      ;(session as GuestSession).lockIn(windowIdx, pendingRef.current)
    }
  }, [phase, mode, session, myId, windowIdx, commit])

  // ── 재생 페이즈
  useEffect(() => {
    if (phase !== 'play' || doneRef.current) return
    // 뒤처진 게스트는 4배속으로 따라잡는다
    const catchingUp = mode === 'guest' && playBufRef.current.size > 0
    const tickDur = speed.playMs / TICKS_PER_WINDOW / (catchingUp ? 4 : 1)
    let tick = windowIdx * TICKS_PER_WINDOW
    let start = performance.now()
    let raf = 0
    let ended = false
    setAnimTick(tick)
    setAnimProgress(0)

    /** 틱 1개 확정 — rAF 루프와 워치독(백그라운드 탭) 양쪽에서 호출 */
    const finalizeTick = () => {
      const r = returns[tick]
      const prevEqs = steppersRef.current.map((s) => s.eq)
      const leaderBefore = argmaxEq(prevEqs)
      const liquidatedIds: number[] = []
      players.forEach((p) => {
        const step = steppersRef.current[p.id].advanceTick(tick)
        if (step.liquidated) liquidatedIds.push(p.id)
      })
      const newEqs = steppersRef.current.map((s) => s.eq)
      const leaderAfter = argmaxEq(newEqs)
      setEquities(newEqs)
      setPositionsNow(players.map((p) => steppersRef.current[p.id].pos))
      setDeltas(newEqs.map((e, i) => e - prevEqs[i]))
      setDeltaStamp(tick + 1)
      setLastTickPct(r * 100)
      if (Math.abs(r) >= FLASH_THRESHOLD) setFlash({ dir: r >= 0 ? 'up' : 'down', id: tick })
      sTick(r >= 0, r)
      // 리드 체인지
      if (leaderAfter !== leaderBefore && tick >= 2) {
        sLeadChange()
        setLeadBanner(t.leadChange(`${players[leaderAfter].emoji} ${pname(players[leaderAfter])}`))
        window.setTimeout(() => setLeadBanner(null), 2200)
        if (players[leaderAfter].isBot && Math.random() < 0.5) botReact(leaderAfter, '😎', 500)
      }
      // 강제 청산
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
        liquidatedIds.forEach((id) => {
          if (players[id].isBot) botReact(id, '😵', 600)
        })
        const mockers = players.filter((p) => p.isBot && !liquidatedIds.includes(p.id))
        if (mockers.length > 0 && Math.random() < 0.7) {
          botReact(mockers[Math.floor(Math.random() * mockers.length)].id, '😂', 1100)
        }
      }
      // 큰 등락 봇 리액션
      if (Math.abs(r) >= 0.04 && Math.random() < 0.4) {
        const bots = players.filter((p) => p.isBot)
        const b = bots[Math.floor(Math.random() * bots.length)]
        botReact(b.id, r >= 0 ? '🚀' : '😱', 400 + Math.random() * 600)
      }
      setRevealed(tick + 1)
      tick++
      start += tickDur
      if (tick % TICKS_PER_WINDOW === 0) {
        ended = true
        setAnimTick(-1)
        setAnimProgress(0)
        if (tick >= WINDOWS * TICKS_PER_WINDOW) {
          finishRef.current()
        } else if (mode === 'guest') {
          windowDoneRef.current = windowIdx
          // 호스트의 다음 phase 또는 버퍼된 play가 이미 있으면 바로 진행
          const gs = session as GuestSession
          const phaseArrived = gs && gs.phaseChart === roundIndex && gs.phaseW === windowIdx + 1
          if (phaseArrived || playBufRef.current.has(windowIdx + 1)) {
            window.setTimeout(() => setWindowIdx(windowIdx + 1), catchingUp ? 80 : 250)
          }
        } else {
          window.setTimeout(() => setWindowIdx((w) => w + 1), mode === 'host' ? 600 : 350)
        }
        return
      }
      setAnimTick(tick)
      setAnimProgress(0)
    }

    const loop = (now: number) => {
      if (ended) return
      const prog = (now - start) / tickDur
      if (prog < 1) {
        setAnimProgress(prog)
      } else {
        finalizeTick()
      }
      if (!ended) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    // 워치독: 백그라운드 탭에서 rAF가 멈춰도 게임은 계속 진행 (호스트 정지 = 전원 정지 방지)
    const wd = window.setInterval(() => {
      let guard = 0
      while (!ended && performance.now() - start >= tickDur && guard++ < TICKS_PER_WINDOW) {
        finalizeTick()
      }
    }, 700)

    return () => {
      cancelAnimationFrame(raf)
      window.clearInterval(wd)
    }
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
    const s = steppersRef.current[myId]
    if (!s) return 0
    return s.eq * FEE_RATE * Math.abs(pendingPos - s.pos)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPos, phase, windowIdx, equities, myId])

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
    <div className={`screen round${clutch ? ' clutch-on' : ''}`}>
      {clutch && <div className="clutch-vignette" />}
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
          {leadBanner && !liqBanner && <div className="liq-banner lead">{leadBanner}</div>}

          <div className="chart-area">
            <div className="corner-b" />
            {flash && <div key={flash.id} className={`chart-flash ${flash.dir}`} />}
            {showStamp && <div className="stamp">🔒 {t.allLocked}</div>}
            {!stingerDone && (
              <div className="stinger">
                <div className="stinger-label">{t.stingerLabel(roundIndex + 1)}</div>
                <div className="stinger-theme">{isFinal ? '🔥 ' : ''}{themeName(chart.theme)}</div>
                <div className="stinger-tag">{t.stingers[chart.theme]}</div>
              </div>
            )}
            {clutch && phase === 'lock' && (
              <div className="clutch-label">⚡ {t.clutchTime}</div>
            )}
            {stingerDone && revealed === 0 && phase === 'lock' && (
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

        <div className="rank-col">
          <RankBar
            players={players}
            equities={equities}
            positions={positionsNow}
            phase={phase}
            lockedFlags={lockedFlags}
            liqSet={liqSet}
            deltas={deltas}
            deltaStamp={deltaStamp}
            myId={myId}
          />
          <div className="react-overlay">
            {reacts.map((r) => (
              <span key={r.key} className="react-float" style={{ left: `${8 + ((r.key * 37) % 60)}%` }}>
                <span className="react-emoji">{r.emoji}</span>
                <span className="react-who">{pname(players[r.playerId])}</span>
              </span>
            ))}
          </div>
        </div>
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
          <div className="react-bar">
            {REACT_EMOJIS.map((e) => (
              <button key={e} className="react-btn" onClick={() => sendReact(e)}>
                {e}
              </button>
            ))}
          </div>
          {phase === 'lock' ? (
            <button
              className={`lock-btn${humanLocked ? ' locked' : ''}`}
              onClick={humanLock}
              disabled={humanLocked || !stingerDone}
            >
              {humanLocked ? `🔒 ${t.lockedBtn}` : `⚡ ${t.lockBtn}`}
            </button>
          ) : (
            <span className="play-hint">
              <b>{posLabel(steppersRef.current[myId]?.pos ?? 0)}</b> — {t.playPhase}
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

function argmaxEq(eqs: number[]): number {
  let best = 0
  for (let i = 1; i < eqs.length; i++) if (eqs[i] > eqs[best]) best = i
  return best
}
