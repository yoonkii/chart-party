import { PlayerMeta, RoundResult } from './types'

export type AwardKey = 'hodlKing' | 'scalperGhost' | 'brokerVip' | 'contrarianGenius' | 'bottomCatcher'

/** 칭호 산정 결과 — 표시 문자열은 i18n에서 조립 */
export interface Award {
  key: AwardKey
  emoji: string
  playerId: number
  turnover: number
  totalReturn: number
  fees: number
  contrarian: number
  catches: number
}

/** 매치 종료 후 재미 칭호 산정 (§5) */
export function computeAwards(players: PlayerMeta[], rounds: RoundResult[]): Award[] {
  const n = players.length
  const sum = (f: (r: import('./types').PlayerRoundResult) => number) =>
    players.map((p) => rounds.reduce((acc, rr) => acc + f(rr.results[p.id]), 0))

  const totalPoints = sum((r) => r.points)
  const totalFees = sum((r) => r.fees)
  const totalTurnover = sum((r) => r.turnover)
  const totalReturn = sum((r) => r.returnPct)
  const totalContrarian = sum((r) => r.contrarianProfit)
  const bottomCatches = sum((r) => (r.bottomCatch ? 1 : 0))

  const mk = (key: AwardKey, emoji: string, id: number): Award => ({
    key,
    emoji,
    playerId: id,
    turnover: totalTurnover[id],
    totalReturn: totalReturn[id],
    fees: totalFees[id],
    contrarian: totalContrarian[id],
    catches: bottomCatches[id],
  })

  const awards: Award[] = []
  const rankOfTotal = [...Array(n).keys()].sort((a, b) => totalPoints[b] - totalPoints[a])

  // 존버왕: 포지션 변경(턴오버) 최소이면서 종합 상위 절반
  {
    const topHalf = rankOfTotal.slice(0, Math.ceil(n / 2))
    const id = [...topHalf].sort((a, b) => totalTurnover[a] - totalTurnover[b])[0]
    awards.push(mk('hodlKing', '🗿', id))
  }

  // 단타귀신: 턴오버 최다 & 누적 수익 플러스 (없으면 턴오버 최다)
  {
    const byTurnover = [...Array(n).keys()].sort((a, b) => totalTurnover[b] - totalTurnover[a])
    const id = byTurnover.find((i) => totalReturn[i] > 0) ?? byTurnover[0]
    awards.push(mk('scalperGhost', '👻', id))
  }

  // 증권사 VIP: 수수료 최다
  {
    const id = [...Array(n).keys()].sort((a, b) => totalFees[b] - totalFees[a])[0]
    awards.push(mk('brokerVip', '💸', id))
  }

  // 역베천재: 다수 반대 포지션 수익 최다 (의미 있는 플러스일 때만)
  {
    const id = [...Array(n).keys()].sort((a, b) => totalContrarian[b] - totalContrarian[a])[0]
    if (totalContrarian[id] > 1) awards.push(mk('contrarianGenius', '🔮', id))
  }

  // 바닥캐치: 최저점 ±2틱 매수 성공 횟수 최다 (1회 이상)
  {
    const id = [...Array(n).keys()].sort((a, b) => bottomCatches[b] - bottomCatches[a])[0]
    if (bottomCatches[id] >= 1) awards.push(mk('bottomCatcher', '🎣', id))
  }

  return awards
}
