import { PlayerMeta, RoundResult } from './types'

export interface Award {
  key: string
  title: string
  emoji: string
  desc: string
  playerId: number
  detail: string
}

const fmtPct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`

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

  const awards: Award[] = []
  const rankOfTotal = [...Array(n).keys()].sort((a, b) => totalPoints[b] - totalPoints[a])

  // 존버왕: 포지션 변경(턴오버) 최소이면서 종합 상위 절반
  {
    const topHalf = new Set(rankOfTotal.slice(0, Math.ceil(n / 2)))
    const cands = [...topHalf].sort((a, b) => totalTurnover[a] - totalTurnover[b])
    const id = cands[0]
    awards.push({
      key: 'hodlKing', title: '존버왕', emoji: '🗿',
      desc: '거의 움직이지 않고 상위권',
      playerId: id,
      detail: `총 포지션 변경량 ${totalTurnover[id].toFixed(1)} / 누적 ${fmtPct(totalReturn[id])}`,
    })
  }

  // 단타귀신: 턴오버 최다 & 누적 수익 플러스 (없으면 턴오버 최다)
  {
    const byTurnover = [...Array(n).keys()].sort((a, b) => totalTurnover[b] - totalTurnover[a])
    const id = byTurnover.find((i) => totalReturn[i] > 0) ?? byTurnover[0]
    awards.push({
      key: 'scalperGhost', title: '단타귀신', emoji: '👻',
      desc: '가장 부지런히 사고팔았다',
      playerId: id,
      detail: `총 포지션 변경량 ${totalTurnover[id].toFixed(1)} / 누적 ${fmtPct(totalReturn[id])}`,
    })
  }

  // 증권사 VIP: 수수료 최다
  {
    const id = [...Array(n).keys()].sort((a, b) => totalFees[b] - totalFees[a])[0]
    awards.push({
      key: 'brokerVip', title: '증권사 VIP', emoji: '💸',
      desc: '수수료 최다 납부 — 증권사가 사랑합니다',
      playerId: id,
      detail: `수수료 총 ${Math.round(totalFees[id]).toLocaleString()}원`,
    })
  }

  // 역베천재: 다수 반대 포지션 수익 최다 (플러스인 경우만)
  {
    const id = [...Array(n).keys()].sort((a, b) => totalContrarian[b] - totalContrarian[a])[0]
    if (totalContrarian[id] > 1) {
      awards.push({
        key: 'contrarianGenius', title: '역베천재', emoji: '🔮',
        desc: '남들과 반대로 가서 벌었다',
        playerId: id,
        detail: `역방향 수익 ${fmtPct(totalContrarian[id])}`,
      })
    }
  }

  // 바닥캐치: 최저점 ±2틱 매수 성공 횟수 최다 (1회 이상)
  {
    const id = [...Array(n).keys()].sort((a, b) => bottomCatches[b] - bottomCatches[a])[0]
    if (bottomCatches[id] >= 1) {
      awards.push({
        key: 'bottomCatcher', title: '바닥캐치', emoji: '🎣',
        desc: '진짜 바닥에서 샀다',
        playerId: id,
        detail: `바닥 매수 ${bottomCatches[id]}회 성공`,
      })
    }
  }

  return awards
}
