import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import chartsRaw from './data/charts.json'
import { ChartData, PlayerMeta, RoundResult } from './engine/types'
import { BOTS } from './engine/bots'
import { mulberry32, pick } from './engine/prng'
import { GuestSession, HostSession, Session } from './net/session'
import { NetPlayer } from './net/protocol'
import Home, { HomeConfig } from './components/Home'
import Room from './components/Room'
import Round from './components/Round'
import Intermission from './components/Intermission'
import Final from './components/Final'
import { useI18n } from './i18n'

const ALL_CHARTS = chartsRaw as ChartData[]
export const NUM_ROUNDS = 6

type Screen = 'home' | 'room' | 'round' | 'intermission' | 'final'
export type Mode = 'solo' | 'host' | 'guest'

export interface Speed {
  lockMs: number
  playMs: number
}

interface MatchState {
  mode: Mode
  seed: number
  players: PlayerMeta[]
  lineup: ChartData[]
  speed: Speed
  chartIndex: number
  results: RoundResult[]
  myId: number
}

/** 시드로 테마 1~6에서 각각 1개씩 차트 추첨 */
function drawLineup(seed: number): ChartData[] {
  const rng = mulberry32(seed ^ 0x9e3779b9)
  const lineup: ChartData[] = []
  for (let theme = 1; theme <= NUM_ROUNDS; theme++) {
    const pool = ALL_CHARTS.filter((c) => c.theme === theme)
    lineup.push(pick(rng, pool))
  }
  return lineup
}

function rosterToPlayers(roster: NetPlayer[]): PlayerMeta[] {
  return roster.map((p, i) => ({
    id: i,
    name: p.name,
    emoji: p.emoji,
    isBot: p.isBot,
    botKey: p.botKey,
    connected: p.connected,
  }))
}

export default function App() {
  const { t } = useI18n()
  const [screen, setScreen] = useState<Screen>('home')
  const [match, setMatch] = useState<MatchState | null>(null)
  const [netError, setNetError] = useState<string | null>(null)
  const [netBusy, setNetBusy] = useState(false)
  const [roomRoster, setRoomRoster] = useState<NetPlayer[]>([])
  const [roomCode, setRoomCode] = useState('')
  const sessionRef = useRef<Session | null>(null)
  const pendingNextRef = useRef<number | null>(null)
  const screenRef = useRef<Screen>('home')
  useEffect(() => {
    screenRef.current = screen
  }, [screen])

  const showError = useCallback((key: unknown) => {
    setNetError(String(key))
    setNetBusy(false)
    window.setTimeout(() => setNetError(null), 3500)
  }, [])

  const teardownSession = useCallback(() => {
    sessionRef.current?.dispose()
    sessionRef.current = null
    setRoomRoster([])
    setRoomCode('')
  }, [])

  // ── 솔로
  const startSolo = useCallback(
    (cfg: HomeConfig) => {
      const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
      const human: PlayerMeta = { id: 0, name: cfg.name || t.defaultName, emoji: cfg.emoji, isBot: false }
      const bots: PlayerMeta[] = BOTS.map((b, i) => ({
        id: i + 1,
        name: b.name,
        emoji: b.emoji,
        isBot: true,
        botKey: b.key,
      }))
      setMatch({
        mode: 'solo',
        seed,
        players: [human, ...bots],
        lineup: drawLineup(seed),
        speed: cfg.speed,
        chartIndex: 0,
        results: [],
        myId: 0,
      })
      setScreen('round')
    },
    [t]
  )

  // ── 공통 네트워크 이벤트 배선
  const wireCommon = useCallback(
    (s: Session) => {
      s.on('roster', (roster) => {
        setRoomRoster([...(roster as NetPlayer[])])
        // 매치 중 접속 상태 변화 반영
        setMatch((m) =>
          m && m.mode !== 'solo'
            ? {
                ...m,
                players: m.players.map((p, i) => ({
                  ...p,
                  connected: (roster as NetPlayer[])[i]?.connected ?? p.connected,
                })),
              }
            : m
        )
      })
      s.on('error', (key) => showError(key))
    },
    [showError]
  )

  // ── 방 만들기 (호스트)
  const createRoom = useCallback(
    (cfg: HomeConfig) => {
      teardownSession()
      setNetBusy(true)
      const s = new HostSession(cfg.name || t.defaultName, cfg.emoji)
      sessionRef.current = s
      wireCommon(s)
      s.on('open', (code) => {
        setNetBusy(false)
        setRoomCode(code as string)
        setRoomRoster([...s.roster])
        setScreen('room')
      })
      s.on('error', () => setScreen((sc) => (sc === 'room' ? 'home' : sc)))
    },
    [t, teardownSession, wireCommon, showError]
  )

  // ── 참가 (게스트)
  const joinRoom = useCallback(
    (cfg: HomeConfig, code: string) => {
      teardownSession()
      setNetBusy(true)
      const s = new GuestSession(code, cfg.name || t.defaultName, cfg.emoji)
      sessionRef.current = s
      wireCommon(s)
      s.on('open', () => {
        setNetBusy(false)
        setRoomCode(code)
        setScreen('room')
      })
      s.on('start', (msg) => {
        const m = msg as { seed: number; chartIds: string[]; speed: Speed; roster: NetPlayer[] }
        pendingNextRef.current = null
        setMatch({
          mode: 'guest',
          seed: m.seed,
          players: rosterToPlayers(m.roster),
          lineup: m.chartIds.map((id) => ALL_CHARTS.find((c) => c.id === id)!),
          speed: m.speed,
          chartIndex: 0,
          results: [],
          myId: s.myIndex,
        })
        setScreen('round')
      })
      s.on('nextChart', (index) => {
        // 아직 라운드 정산 계산 전이면 보류했다가 onRoundDone에서 적용
        const idx = index as number
        if (screenRef.current === 'intermission') {
          applyNext(idx)
          setScreen(idx >= NUM_ROUNDS ? 'final' : 'round')
        } else {
          pendingNextRef.current = idx
        }
      })
      s.on('rematch', () => {
        setMatch(null)
        setScreen('room')
      })
      s.on('hostLeft', () => {
        showError('hostLeft')
        teardownSession()
        setMatch(null)
        setScreen('home')
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, teardownSession, wireCommon, showError]
  )

  // ── 호스트 매치 시작
  const hostStart = useCallback((speed: Speed) => {
    const s = sessionRef.current
    if (!s || s.mode !== 'host') return
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
    const lineup = drawLineup(seed)
    const roster = s.startMatch(seed, lineup.map((c) => c.id), speed)
    setMatch({
      mode: 'host',
      seed,
      players: rosterToPlayers(roster),
      lineup,
      speed,
      chartIndex: 0,
      results: [],
      myId: 0,
    })
    setScreen('round')
  }, [])

  const applyNext = useCallback((index: number) => {
    setMatch((m) => (m ? { ...m, chartIndex: Math.min(index, NUM_ROUNDS - 1) } : m))
  }, [])

  const onRoundDone = useCallback((rr: RoundResult) => {
    setMatch((m) => (m ? { ...m, results: [...m.results, rr] } : m))
    const pending = pendingNextRef.current
    if (pending !== null) {
      pendingNextRef.current = null
      applyNext(pending)
      setScreen(pending >= NUM_ROUNDS ? 'final' : 'round')
    } else {
      setScreen('intermission')
    }
  }, [applyNext])

  // ── 다음 차트 (솔로/호스트만 호출)
  const onNext = useCallback(() => {
    setMatch((m) => {
      if (!m) return m
      const next = m.chartIndex + 1
      if (m.mode === 'host') (sessionRef.current as HostSession | null)?.sendNextChart(next)
      if (next >= NUM_ROUNDS) {
        setScreen('final')
        return m
      }
      setScreen('round')
      return { ...m, chartIndex: next }
    })
  }, [])

  const onRestart = useCallback(() => {
    const s = sessionRef.current
    if (s && s.mode === 'host') {
      s.sendRematch()
      setMatch(null)
      setRoomRoster([...s.roster])
      setScreen('room')
    } else {
      teardownSession()
      setMatch(null)
      setScreen('home')
    }
  }, [teardownSession])

  const leaveRoom = useCallback(() => {
    teardownSession()
    setMatch(null)
    setScreen('home')
  }, [teardownSession])

  // 탭 종료 시 정리
  useEffect(() => {
    const bye = () => sessionRef.current?.dispose()
    window.addEventListener('beforeunload', bye)
    return () => window.removeEventListener('beforeunload', bye)
  }, [])

  const totals = useMemo(() => {
    if (!match) return []
    return match.players.map((p) =>
      match.results.reduce((acc, rr) => acc + rr.results[p.id].points, 0)
    )
  }, [match])

  const errToast = netError && (
    <div className="toast err">{t.netErrors[netError] ?? (netError === 'hostLeft' ? t.hostLeft : netError)}</div>
  )

  if (screen === 'home' || (!match && screen !== 'room'))
    return (
      <>
        <Home onSolo={startSolo} onCreate={createRoom} onJoin={joinRoom} busy={netBusy} />
        {errToast}
      </>
    )

  if (screen === 'room')
    return (
      <>
        <Room
          code={roomCode}
          roster={roomRoster}
          isHost={sessionRef.current?.mode === 'host'}
          myIndex={sessionRef.current?.mode === 'guest' ? (sessionRef.current as GuestSession).myIndex : 0}
          onStart={hostStart}
          onLeave={leaveRoom}
        />
        {errToast}
      </>
    )

  if (!match) return null
  const chart = match.lineup[match.chartIndex]
  const isFinal = match.chartIndex === NUM_ROUNDS - 1

  if (screen === 'round')
    return (
      <>
        <Round
          key={`${match.seed}-${match.chartIndex}`}
          chart={chart}
          players={match.players}
          roundIndex={match.chartIndex}
          isFinal={isFinal}
          speed={match.speed}
          seed={match.seed}
          totals={totals}
          myId={match.myId}
          mode={match.mode}
          session={sessionRef.current}
          onDone={onRoundDone}
        />
        {errToast}
      </>
    )

  if (screen === 'intermission') {
    const rr = match.results[match.results.length - 1]
    return (
      <>
        <Intermission
          chart={chart}
          players={match.players}
          result={rr}
          totals={totals}
          roundIndex={match.chartIndex}
          isFinal={isFinal}
          nextTheme={isFinal ? null : match.lineup[match.chartIndex + 1].theme}
          myId={match.myId}
          isDirector={match.mode !== 'guest'}
          onNext={onNext}
        />
        {errToast}
      </>
    )
  }

  return (
    <>
      <Final
        players={match.players}
        results={match.results}
        lineup={match.lineup}
        totals={totals}
        myId={match.myId}
        isDirector={match.mode !== 'guest'}
        onRestart={onRestart}
      />
      {errToast}
    </>
  )
}
