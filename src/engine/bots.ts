import { Candle, TICKS_PER_WINDOW } from './types'
import { Rng } from './prng'
import { clampPos } from './sim'

/**
 * 봇은 현재까지 공개된 캔들만 본다 (미래 열람 금지).
 * decide(visible, windowIndex, prevPos, rng) → 목표 포지션 [-1, 1]
 */
export interface BotDef {
  key: string
  name: string
  emoji: string
  tagline: string
  decide: (visible: Candle[], w: number, prevPos: number, rng: Rng) => number
}

/** 최근 n틱 수익률 (%). 공개 캔들이 부족하면 가능한 만큼만. */
function recentMove(visible: Candle[], n: number): number {
  if (visible.length === 0) return 0
  const from = Math.max(0, visible.length - n)
  const start = from === 0 ? visible[0].o : visible[from - 1].c
  const end = visible[visible.length - 1].c
  return (end / start - 1) * 100
}

function snap(x: number): number {
  return clampPos(Math.round(x * 20) / 20)
}

export const BOTS: BotDef[] = [
  {
    key: 'hodl',
    name: '존버영수',
    emoji: '🗿',
    tagline: '사는 건 한 번, 파는 건 없다',
    decide: (_v, w, prev) => (w === 0 ? 1 : prev),
  },
  {
    key: 'momentum',
    name: '추세미녀',
    emoji: '🏄',
    tagline: '달리는 말에 올라탄다',
    decide: (v, w, _prev, rng) => {
      if (w === 0) return snap(0.5 + rng() * 0.3)
      const m = recentMove(v, TICKS_PER_WINDOW)
      const base = Math.tanh(m / 6) // ±6% 움직임에 크게 반응
      return snap(base + (rng() - 0.5) * 0.2)
    },
  },
  {
    key: 'contrarian',
    name: '청개구리',
    emoji: '🐸',
    tagline: '남들이 사면 판다',
    decide: (v, w, _prev, rng) => {
      if (w === 0) return snap(-0.25 + rng() * 0.5)
      const m = recentMove(v, TICKS_PER_WINDOW)
      const base = -Math.tanh(m / 5) * 0.8
      return snap(base + (rng() - 0.5) * 0.2)
    },
  },
  {
    key: 'bear',
    name: '나스닥곰',
    emoji: '🐻',
    tagline: '세상은 결국 무너진다',
    decide: (v, w, prev, rng) => {
      if (w === 0) return snap(-0.5 - rng() * 0.3)
      const m = recentMove(v, TICKS_PER_WINDOW * 2)
      if (m > 8) return snap(prev * 0.3) // 강한 상승엔 마지못해 후퇴
      return snap(-0.6 - rng() * 0.4)
    },
  },
  {
    key: 'scalper',
    name: '단타치타',
    emoji: '🐆',
    tagline: '1틱이라도 먹으면 익절',
    decide: (v, w, prev, rng) => {
      if (w === 0) return snap(rng() > 0.5 ? 0.75 : -0.75)
      const last = v.length >= 2 ? (v[v.length - 1].c / v[v.length - 2].c - 1) * 100 : 0
      const dir = last >= 0 ? 1 : -1
      // 거의 매 윈도우 방향을 뒤집는다 → 수수료 지옥행
      const size = 0.75 + rng() * 0.25
      return snap(dir * size * (rng() > 0.15 ? 1 : -1))
    },
  },
  {
    key: 'cautious',
    name: '신중부장',
    emoji: '🧐',
    tagline: '몰빵은 인생을 망친다',
    decide: (v, w, prev, rng) => {
      if (w === 0) return 0.25
      const m = recentMove(v, TICKS_PER_WINDOW * 2)
      const target = Math.tanh(m / 10) * 0.5
      // 한 윈도우에 0.25 이상 움직이지 않는다
      const step = Math.max(-0.25, Math.min(0.25, target - prev))
      return snap(prev + step + (rng() - 0.5) * 0.05)
    },
  },
  {
    key: 'degen',
    name: '풀매수광인',
    emoji: '🤪',
    tagline: '인생은 한 방',
    decide: (v, w, prev, rng) => {
      if (w === 0) return rng() > 0.3 ? 1 : -1
      const m = recentMove(v, TICKS_PER_WINDOW)
      const dir = m >= 0 ? 1 : -1
      // 가끔 아무 이유 없이 반대로 몰빵
      if (rng() < 0.25) return -dir
      if (rng() < 0.2) return prev
      return dir
    },
  },
]
