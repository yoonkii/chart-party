import { useEffect, useMemo, useState } from 'react'
import { ChartData, PlayerMeta, RoundResult } from '../engine/types'
import { computeAwards } from '../engine/titles'
import { sFanfare } from '../sound'

interface Props {
  players: PlayerMeta[]
  results: RoundResult[]
  lineup: ChartData[]
  totals: number[]
  onRestart: () => void
}

const CONFETTI_COLORS = ['#ff4d5e', '#4d8dff', '#ffcb47', '#35e8ac', '#ffffff']

export default function Final({ players, results, lineup, totals, onRestart }: Props) {
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    sFanfare()
  }, [])

  // 종합 순위: 누적 포인트 → 동점 시 파이널 차트 수익률 (§2.1)
  const order = useMemo(() => {
    const finalReturns = results[results.length - 1]
    return players
      .map((p) => p.id)
      .sort(
        (a, b) =>
          totals[b] - totals[a] ||
          finalReturns.results[b].returnPct - finalReturns.results[a].returnPct
      )
  }, [players, totals, results])

  const awards = useMemo(() => computeAwards(players, results), [players, results])
  const champion = players[order[0]]
  const podiumIds = [order[1], order[0], order[2]] // 2등-1등-3등 배치

  const share = async () => {
    const me = order.indexOf(0) + 1
    const lines = [
      '📈 차트 파티 — 6차트 리그전 결과',
      `🏆 우승: ${champion.emoji} ${champion.name} (${fmtP(totals[champion.id])}P)`,
      `🎖️ 내 순위: ${me}위 / ${players.length}명 (${fmtP(totals[0])}P)`,
      '',
      ...lineup.map((c, i) => {
        const r = results[i].results[0]
        return `${i + 1}. [${c.themeName}] ${c.symbol} → ${r.returnPct >= 0 ? '+' : ''}${r.returnPct.toFixed(1)}% (${r.rank}위)`
      }),
      '',
      '같은 차트, 다른 운명. #차트파티',
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setToast('결과가 클립보드에 복사됐습니다 — 붙여넣어 자랑하세요!')
    } catch {
      setToast('클립보드 복사 실패 😢')
    }
    window.setTimeout(() => setToast(null), 2600)
  }

  return (
    <div className="screen final">
      {Array.from({ length: 60 }, (_, i) => (
        <span
          key={i}
          className="confetti"
          style={{
            left: `${(i * 61) % 100}%`,
            background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
            animationDuration: `${2.6 + ((i * 37) % 100) / 40}s`,
            animationDelay: `${((i * 53) % 100) / 45}s`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}

      <h1 className="final-title">🏆 {champion.name} 우승!</h1>

      <div className="podium">
        {podiumIds.map((id, col) =>
          id === undefined ? null : (
            <div className="podium-col" key={id}>
              <span className="podium-face">{players[id].emoji}</span>
              <span className="podium-name">{players[id].name}</span>
              <span className="podium-pts">{fmtP(totals[id])}P</span>
              <div className="podium-block">{col === 1 ? 1 : col === 0 ? 2 : 3}</div>
            </div>
          )
        )}
      </div>

      <div className="awards-grid">
        {awards.map((a, i) => (
          <div className="award-card" key={a.key} style={{ animationDelay: `${0.8 + i * 0.25}s` }}>
            <div className="award-emoji">{a.emoji}</div>
            <div className="award-title">{a.title}</div>
            <div className="award-who">
              {players[a.playerId].emoji} {players[a.playerId].name}
            </div>
            <div className="award-desc">{a.desc}</div>
            <div className="award-detail">{a.detail}</div>
          </div>
        ))}
      </div>

      <div className="final-table-wrap">
        <table className="result-table">
          <thead>
            <tr>
              <th>#</th><th>트레이더</th>
              {lineup.map((c, i) => (
                <th key={i} className="num" title={c.themeName}>{c.symbol}</th>
              ))}
              <th className="num">합계 P</th>
            </tr>
          </thead>
          <tbody>
            {order.map((id, i) => (
              <tr key={id} className={id === 0 ? 'me' : ''}>
                <td className="mono">{i + 1}</td>
                <td>{players[id].emoji} {players[id].name}</td>
                {results.map((rr, ri) => (
                  <td key={ri} className={`num ${rr.results[id].rank === 1 ? 'gold-c' : 'dim'}`}>
                    {fmtP(rr.results[id].points)}
                  </td>
                ))}
                <td className="num" style={{ fontWeight: 700 }}>{fmtP(totals[id])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="final-actions">
        <button className="share-btn" onClick={share}>📋 결과 카드 복사</button>
        <button className="again-btn" onClick={onRestart}>한 판 더</button>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function fmtP(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1)
}
