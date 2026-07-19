import { useCallback, useMemo, useState } from 'react'
import chartsRaw from './data/charts.json'
import { ChartData, PlayerMeta, RoundResult } from './engine/types'
import { BOTS } from './engine/bots'
import { mulberry32, pick } from './engine/prng'
import Lobby, { LobbyConfig } from './components/Lobby'
import Round from './components/Round'
import Intermission from './components/Intermission'
import Final from './components/Final'
import { useI18n } from './i18n'

const ALL_CHARTS = chartsRaw as ChartData[]
export const NUM_ROUNDS = 6

type Screen = 'lobby' | 'round' | 'intermission' | 'final'

export interface Speed {
  lockMs: number
  playMs: number
}

interface MatchState {
  seed: number
  players: PlayerMeta[]
  lineup: ChartData[]
  speed: Speed
  chartIndex: number
  results: RoundResult[]
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

export default function App() {
  const { t } = useI18n()
  const [screen, setScreen] = useState<Screen>('lobby')
  const [match, setMatch] = useState<MatchState | null>(null)

  const startMatch = useCallback((cfg: LobbyConfig) => {
    const seed = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0
    const human: PlayerMeta = { id: 0, name: cfg.name || t.defaultName, emoji: cfg.emoji, isBot: false }
    const bots: PlayerMeta[] = BOTS.map((b, i) => ({
      id: i + 1,
      name: b.name,
      emoji: b.emoji,
      isBot: true,
      botKey: b.key,
      tagline: b.tagline,
    }))
    setMatch({
      seed,
      players: [human, ...bots],
      lineup: drawLineup(seed),
      speed: cfg.speed,
      chartIndex: 0,
      results: [],
    })
    setScreen('round')
  }, [t])

  const onRoundDone = useCallback((rr: RoundResult) => {
    setMatch((m) => (m ? { ...m, results: [...m.results, rr] } : m))
    setScreen('intermission')
  }, [])

  const onNext = useCallback(() => {
    setMatch((m) => {
      if (!m) return m
      if (m.chartIndex + 1 >= NUM_ROUNDS) return m
      return { ...m, chartIndex: m.chartIndex + 1 }
    })
    setScreen((s) => {
      const isLast = match !== null && match.chartIndex + 1 >= NUM_ROUNDS
      return isLast ? 'final' : 'round'
    })
  }, [match])

  const onRestart = useCallback(() => {
    setMatch(null)
    setScreen('lobby')
  }, [])

  const totals = useMemo(() => {
    if (!match) return []
    return match.players.map((p) =>
      match.results.reduce((acc, rr) => acc + rr.results[p.id].points, 0)
    )
  }, [match])

  if (screen === 'lobby' || !match) return <Lobby onStart={startMatch} />

  const chart = match.lineup[match.chartIndex]
  const isFinal = match.chartIndex === NUM_ROUNDS - 1

  if (screen === 'round')
    return (
      <Round
        key={`${match.seed}-${match.chartIndex}`}
        chart={chart}
        players={match.players}
        roundIndex={match.chartIndex}
        isFinal={isFinal}
        speed={match.speed}
        seed={match.seed}
        totals={totals}
        onDone={onRoundDone}
      />
    )

  if (screen === 'intermission') {
    const rr = match.results[match.results.length - 1]
    return (
      <Intermission
        chart={chart}
        players={match.players}
        result={rr}
        totals={totals}
        roundIndex={match.chartIndex}
        isFinal={isFinal}
        nextTheme={isFinal ? null : match.lineup[match.chartIndex + 1].theme}
        onNext={onNext}
      />
    )
  }

  return <Final players={match.players} results={match.results} lineup={match.lineup} totals={totals} onRestart={onRestart} />
}
