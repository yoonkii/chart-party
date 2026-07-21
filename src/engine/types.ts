export interface Candle {
  o: number
  h: number
  l: number
  c: number
}

export interface ChartData {
  id: string
  theme: number
  themeName: string
  symbol: string
  name: string
  period: string
  blurb: string
  days: number
  candles: Candle[]
}

export interface PlayerMeta {
  id: number
  name: string
  emoji: string
  isBot: boolean
  botKey?: string
  tagline?: string
  /** 멀티플레이 접속 상태 (끊기면 마지막 포지션 유지, false일 때만 표시) */
  connected?: boolean
}

/** 한 플레이어의 라운드(차트 1개) 결과 */
export interface PlayerRoundResult {
  playerId: number
  finalEquity: number
  returnPct: number
  fees: number
  turnover: number // Σ|Δpos|
  rank: number // 1-based
  points: number
  positions: number[] // 12개 윈도우 포지션
  bottomCatch: boolean // 최저점 ±2틱 내 매수(포지션 증가) 성공
  contrarianProfit: number // 다수와 반대 포지션 윈도우에서 얻은 수익률 합(%p)
}

export interface RoundResult {
  chartId: string
  buyHoldPct: number
  perfectPct: number
  results: PlayerRoundResult[] // playerId 순서
}

export const START_CAPITAL = 10_000_000
export const FEE_RATE = 0.005
export const WINDOWS = 12
export const TICKS_PER_WINDOW = 5
export const TOTAL_TICKS = WINDOWS * TICKS_PER_WINDOW

/** 8인 기준 순위 포인트, 파이널은 ×1.5 */
export const RANK_POINTS = [10, 7, 5, 4, 3, 2, 1, 0]
export const FINAL_MULTIPLIER = 1.5
