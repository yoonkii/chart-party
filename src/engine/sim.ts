import {
  Candle,
  FEE_RATE,
  RANK_POINTS,
  START_CAPITAL,
  TICKS_PER_WINDOW,
  TOTAL_TICKS,
  WINDOWS,
} from './types'

/**
 * 가격 포인트: p[0] = 첫 틱 시가(=100), p[t+1] = 틱 t의 종가.
 * 틱 t의 수익률 r[t] = p[t+1]/p[t] - 1.
 */
export function pricePoints(candles: Candle[]): number[] {
  const p = [candles[0].o]
  for (const k of candles) p.push(k.c)
  return p
}

export function tickReturns(candles: Candle[]): number[] {
  const p = pricePoints(candles)
  const r: number[] = []
  for (let t = 0; t < candles.length; t++) r.push(p[t + 1] / p[t] - 1)
  return r
}

/** 윈도우 시작 시 포지션 변경 수수료: 변경분 |Δx| × 평가액 × 0.5% */
export function applyFee(equity: number, dPos: number): number {
  return equity * (1 - FEE_RATE * Math.abs(dPos))
}

/**
 * 강제 청산 바닥: 한 틱에서 평가액이 5% 미만으로 떨어질 손실이면
 * (예: 숏 상태에서 밈 주식이 한 틱에 +100% 이상 폭등) 5%만 남기고 포지션 강제 종료.
 */
export const LIQ_FLOOR = 0.05

export interface TickStep {
  factor: number
  liquidated: boolean
}

/** 틱 1개 경과 배수: 기본 (1 + x·r), 바닥 뚫으면 청산 */
export function tickStep(pos: number, r: number): TickStep {
  const f = 1 + pos * r
  if (f <= LIQ_FLOOR) return { factor: LIQ_FLOOR, liquidated: true }
  return { factor: f, liquidated: false }
}

/** @deprecated tickStep 사용 (청산 미반영 단순 버전, 테스트 전용) */
export function applyTick(equity: number, pos: number, r: number): number {
  return equity * tickStep(pos, r).factor
}

export interface SimResult {
  /** equitySeries[0] = 시작 자본, equitySeries[t+1] = 틱 t 종료 후 (수수료 반영) */
  equitySeries: number[]
  finalEquity: number
  returnPct: number
  fees: number
  turnover: number
  /** 강제 청산이 발생한 틱 인덱스들 */
  liquidations: number[]
}

/**
 * 한 플레이어의 라운드 진행 상태 머신.
 * UI(라이브 재생)와 일괄 시뮬레이션이 반드시 같은 결과를 내도록, 둘 다 이 클래스를 쓴다.
 */
export class RoundStepper {
  eq = START_CAPITAL
  pos = 0
  fees = 0
  turnover = 0
  liquidations: number[] = []
  private returns: number[]

  constructor(candles: Candle[]) {
    this.returns = tickReturns(candles)
  }

  /** 윈도우 시작: 목표 포지션으로 리밸런스 (수수료 발생) */
  lockWindow(target: number): void {
    const x = clampPos(target)
    const dx = Math.abs(x - this.pos)
    this.fees += this.eq * FEE_RATE * dx
    this.turnover += dx
    this.eq = applyFee(this.eq, x - this.pos)
    this.pos = x
  }

  /** 틱 1개 진행. 청산 시 포지션은 0이 되어 윈도우 잔여 틱을 현금으로 보낸다. */
  advanceTick(t: number): TickStep {
    const step = tickStep(this.pos, this.returns[t])
    this.eq *= step.factor
    if (step.liquidated) {
      this.pos = 0
      this.liquidations.push(t)
    }
    return step
  }

  get returnPct(): number {
    return (this.eq / START_CAPITAL - 1) * 100
  }
}

/** 12개 윈도우 포지션으로 차트 전체를 시뮬레이션 */
export function simulate(positions: number[], candles: Candle[]): SimResult {
  if (positions.length !== WINDOWS) throw new Error(`positions must have ${WINDOWS} entries`)
  const s = new RoundStepper(candles)
  const series = [s.eq]
  for (let w = 0; w < WINDOWS; w++) {
    s.lockWindow(positions[w])
    for (let i = 0; i < TICKS_PER_WINDOW; i++) {
      s.advanceTick(w * TICKS_PER_WINDOW + i)
      series.push(s.eq)
    }
  }
  return {
    equitySeries: series,
    finalEquity: s.eq,
    returnPct: s.returnPct,
    fees: s.fees,
    turnover: s.turnover,
    liquidations: s.liquidations,
  }
}

export function clampPos(x: number): number {
  return Math.max(-1, Math.min(1, x))
}

/** 존버 벤치마크: 첫 윈도우에 100% 매수 후 방치 (진입 수수료 포함) */
export function buyHoldPct(candles: Candle[]): number {
  return simulate(new Array(WINDOWS).fill(1), candles).returnPct
}

/**
 * 이론상 최대 수익률: 윈도우별 포지션을 그리드(0.25 간격)에서 고르는 DP.
 * V[w][x] = max over x_prev of V[w-1][x_prev] × 수수료 × 윈도우 수익 배수
 */
export function perfectPct(candles: Candle[]): number {
  const r = tickReturns(candles)
  const grid: number[] = []
  for (let g = -4; g <= 4; g++) grid.push(g / 4)
  // 윈도우별, 그리드 포지션별 수익 배수
  const winFactor: number[][] = []
  for (let w = 0; w < WINDOWS; w++) {
    winFactor.push(
      grid.map((x) => {
        let f = 1
        let pos = x
        for (let i = 0; i < TICKS_PER_WINDOW; i++) {
          const step = tickStep(pos, r[w * TICKS_PER_WINDOW + i])
          f *= step.factor
          if (step.liquidated) pos = 0
        }
        return f
      })
    )
  }
  let best = grid.map((x, xi) => (1 - FEE_RATE * Math.abs(x - 0)) * winFactor[0][xi])
  for (let w = 1; w < WINDOWS; w++) {
    const next = grid.map((x, xi) => {
      let m = -Infinity
      for (let pi = 0; pi < grid.length; pi++) {
        const v = best[pi] * (1 - FEE_RATE * Math.abs(x - grid[pi])) * winFactor[w][xi]
        if (v > m) m = v
      }
      return m
    })
    best = next
  }
  return (Math.max(...best) - 1) * 100
}

/** 스킬 점수: 이론상 최대 대비 획득률 (0~100) */
export function skillScore(playerPct: number, perfect: number): number {
  if (playerPct <= 0) return 0
  if (perfect <= 0) return playerPct > 0 ? 100 : 0
  return Math.max(0, Math.min(100, Math.round((playerPct / perfect) * 100)))
}

/**
 * 수익률 → 순위/포인트. 동률은 수수료 적게 낸 쪽 우선, 그다음 참가 순서.
 * finalMult: 파이널 차트 ×1.5
 */
export function rankAndPoints(
  returns: { playerId: number; returnPct: number; fees: number }[],
  finalMult = 1
): Map<number, { rank: number; points: number }> {
  const sorted = [...returns].sort(
    (a, b) => b.returnPct - a.returnPct || a.fees - b.fees || a.playerId - b.playerId
  )
  const out = new Map<number, { rank: number; points: number }>()
  sorted.forEach((r, i) => {
    const base = RANK_POINTS[Math.min(i, RANK_POINTS.length - 1)] ?? 0
    out.set(r.playerId, { rank: i + 1, points: Math.round(base * finalMult * 10) / 10 })
  })
  return out
}

/** 차트 최저점(low 기준) 틱 인덱스 */
export function bottomTick(candles: Candle[]): number {
  let idx = 0
  for (let t = 1; t < candles.length; t++) if (candles[t].l < candles[idx].l) idx = t
  return idx
}

/**
 * 바닥캐치: 어떤 윈도우 시작 틱이 최저점 ±2틱 안이고, 그 윈도우에 포지션을 늘렸는가
 */
export function caughtBottom(positions: number[], candles: Candle[]): boolean {
  const bt = bottomTick(candles)
  let prev = 0
  for (let w = 0; w < WINDOWS; w++) {
    const startTick = w * TICKS_PER_WINDOW
    if (Math.abs(startTick - bt) <= 2 && positions[w] > prev + 0.2) return true
    prev = positions[w]
  }
  return false
}

/**
 * 역베 수익: 각 윈도우에서 다수(포지션 부호 합) 반대로 간 플레이어가 그 윈도우에서 얻은
 * 수익률(%p, 단리 합산). 전원의 포지션 행렬 필요.
 */
export function contrarianProfits(allPositions: number[][], candles: Candle[]): number[] {
  const r = tickReturns(candles)
  const n = allPositions.length
  const out = new Array(n).fill(0)
  for (let w = 0; w < WINDOWS; w++) {
    let majority = 0
    for (let p = 0; p < n; p++) majority += Math.sign(allPositions[p][w])
    if (majority === 0) continue
    const majSign = Math.sign(majority)
    let winRet = 1
    for (let i = 0; i < TICKS_PER_WINDOW; i++) winRet *= 1 + r[w * TICKS_PER_WINDOW + i]
    const segPct = (winRet - 1) * 100
    for (let p = 0; p < n; p++) {
      const x = allPositions[p][w]
      if (Math.sign(x) !== 0 && Math.sign(x) !== majSign) {
        out[p] += x * segPct
      }
    }
  }
  return out
}
