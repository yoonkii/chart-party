import { describe, expect, it } from 'vitest'
import {
  applyFee,
  applyTick,
  buyHoldPct,
  caughtBottom,
  contrarianProfits,
  perfectPct,
  rankAndPoints,
  simulate,
  skillScore,
  tickReturns,
} from './sim'
import { Candle, FEE_RATE, START_CAPITAL, TOTAL_TICKS, WINDOWS } from './types'
import charts from '../data/charts.json'

/** 매 틱 +1%씩 오르는 인공 차트 */
function steadyUp(): Candle[] {
  const out: Candle[] = []
  let p = 100
  for (let t = 0; t < TOTAL_TICKS; t++) {
    const c = p * 1.01
    out.push({ o: p, h: c, l: p, c })
    p = c
  }
  return out
}

describe('simulate', () => {
  it('전량 현금이면 수수료도 손익도 없다', () => {
    const r = simulate(new Array(WINDOWS).fill(0), steadyUp())
    expect(r.finalEquity).toBe(START_CAPITAL)
    expect(r.fees).toBe(0)
    expect(r.turnover).toBe(0)
  })

  it('풀 롱 존버: 진입 수수료 1회 + 복리 수익', () => {
    const r = simulate(new Array(WINDOWS).fill(1), steadyUp())
    const expected = START_CAPITAL * (1 - FEE_RATE) * Math.pow(1.01, TOTAL_TICKS)
    expect(r.finalEquity).toBeCloseTo(expected, 6)
    expect(r.turnover).toBe(1)
  })

  it('풀 숏은 상승장에서 손실', () => {
    const r = simulate(new Array(WINDOWS).fill(-1), steadyUp())
    expect(r.returnPct).toBeLessThan(-40)
  })

  it('매 윈도우 롱↔숏 뒤집기는 수수료 폭탄 (턴오버 23)', () => {
    const pos = Array.from({ length: WINDOWS }, (_, w) => (w % 2 === 0 ? 1 : -1))
    const r = simulate(pos, steadyUp())
    expect(r.turnover).toBe(1 + 11 * 2)
  })

  it('증분 계산(applyFee/applyTick)과 일괄 시뮬레이션이 일치한다', () => {
    const candles = (charts as any[])[0].candles as Candle[]
    const positions = [0.5, 1, -0.25, 0, 0.75, -1, 1, 0.5, 0, -0.5, 1, 0.25]
    const batch = simulate(positions, candles)
    const r = tickReturns(candles)
    let eq = START_CAPITAL
    let prev = 0
    for (let w = 0; w < WINDOWS; w++) {
      eq = applyFee(eq, positions[w] - prev)
      prev = positions[w]
      for (let i = 0; i < 5; i++) eq = applyTick(eq, positions[w], r[w * 5 + i])
    }
    expect(eq).toBeCloseTo(batch.finalEquity, 6)
  })

  it('평가액은 절대 0 이하가 되지 않는다 (전 차트 × 극단 포지션)', () => {
    for (const c of charts as any[]) {
      for (const p of [1, -1]) {
        const r = simulate(new Array(WINDOWS).fill(p), c.candles)
        expect(r.finalEquity).toBeGreaterThan(0)
      }
    }
  })

  it('밈 주식 풀숏은 강제 청산된다 (GME)', () => {
    const gme = (charts as any[]).find((c) => c.symbol === 'GME')!
    const r = simulate(new Array(WINDOWS).fill(-1), gme.candles)
    expect(r.liquidations.length).toBeGreaterThan(0)
    expect(r.finalEquity).toBeGreaterThan(0)
  })
})

describe('벤치마크', () => {
  it('perfect는 항상 존버와 전량현금(0%) 이상', () => {
    for (const c of charts as any[]) {
      const perfect = perfectPct(c.candles)
      expect(perfect).toBeGreaterThanOrEqual(0)
      expect(perfect).toBeGreaterThanOrEqual(buyHoldPct(c.candles) - 1e-9)
    }
  })

  it('skillScore 경계', () => {
    expect(skillScore(-5, 50)).toBe(0)
    expect(skillScore(25, 50)).toBe(50)
    expect(skillScore(60, 50)).toBe(100)
  })
})

describe('rankAndPoints', () => {
  it('수익률 순 정렬, 동률은 수수료 낮은 쪽 우선', () => {
    const m = rankAndPoints([
      { playerId: 0, returnPct: 10, fees: 100 },
      { playerId: 1, returnPct: 20, fees: 0 },
      { playerId: 2, returnPct: 10, fees: 50 },
    ])
    expect(m.get(1)).toEqual({ rank: 1, points: 10 })
    expect(m.get(2)!.rank).toBe(2)
    expect(m.get(0)!.rank).toBe(3)
  })

  it('파이널 ×1.5', () => {
    const m = rankAndPoints([{ playerId: 0, returnPct: 1, fees: 0 }], 1.5)
    expect(m.get(0)!.points).toBe(15)
  })
})

describe('칭호 재료', () => {
  it('caughtBottom: 바닥 근처 윈도우에서 매수 증가 감지', () => {
    const candles = steadyUp()
    candles[0].l = 1 // 최저점을 틱 0으로 강제
    const pos = new Array(WINDOWS).fill(0)
    pos[0] = 1
    expect(caughtBottom(pos, candles)).toBe(true)
    expect(caughtBottom(new Array(WINDOWS).fill(0), candles)).toBe(false)
  })

  it('contrarianProfits: 다수가 롱일 때 숏 플레이어만 집계', () => {
    const candles = steadyUp()
    const all = [
      new Array(WINDOWS).fill(1),
      new Array(WINDOWS).fill(1),
      new Array(WINDOWS).fill(-1),
    ]
    const out = contrarianProfits(all, candles)
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(0)
    expect(out[2]).toBeLessThan(0) // 상승장 역베는 손실
  })
})
