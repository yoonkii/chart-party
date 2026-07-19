import { useEffect, useState } from 'react'
import { ChartData, PlayerMeta, RoundResult } from '../engine/types'
import { skillScore } from '../engine/sim'

interface Props {
  chart: ChartData
  players: PlayerMeta[]
  result: RoundResult
  totals: number[]
  roundIndex: number
  isFinal: boolean
  nextTheme: string | null
  onNext: () => void
}

const AUTO_MS = 30000

/** 정산 쇼 — 매 차트의 클라이맥스 (§4) */
export default function Intermission({ chart, players, result, totals, roundIndex, isFinal, nextTheme, onNext }: Props) {
  const [autoLeft, setAutoLeft] = useState(AUTO_MS)

  useEffect(() => {
    const start = performance.now()
    const iv = window.setInterval(() => {
      const left = AUTO_MS - (performance.now() - start)
      setAutoLeft(Math.max(0, left))
      if (left <= 0) {
        window.clearInterval(iv)
        onNext()
      }
    }, 250)
    return () => window.clearInterval(iv)
  }, [onNext])

  const sorted = [...result.results].sort((a, b) => a.rank - b.rank)
  const bh = result.buyHoldPct
  const losers = sorted.filter((r) => r.returnPct < bh)
  const winners = sorted.filter((r) => r.returnPct >= bh)
  const mySkill = skillScore(result.results[0].returnPct, result.perfectPct)

  return (
    <div className="screen inter">
      <div className="reveal-stage">
        <div className="reveal-card" style={{ animationDelay: '0.05s' }}>
          <div className="reveal-kicker">차트 정체 공개</div>
          <div className="reveal-identity">
            <span className="reveal-symbol">{chart.symbol}</span>
            <span className="reveal-name">{chart.name}</span>
            <span className="reveal-period">{chart.period}</span>
          </div>
          <p className="reveal-blurb">{chart.blurb}</p>
        </div>

        <div className="reveal-card" style={{ animationDelay: '0.65s' }}>
          <div className="reveal-kicker">존버 벤치마크</div>
          <div className="bench-row">
            <span className={`bench-big ${bh >= 0 ? 'up-c' : 'down-c'}`}>
              {bh >= 0 ? '+' : ''}{bh.toFixed(1)}%
            </span>
            <span className="bench-label">
              첫 틱에 풀매수하고 <b>가만히만 있었다면</b> 이만큼이었습니다.<br />
              이론상 완벽한 매매는 <b className="gold-c">+{result.perfectPct.toFixed(1)}%</b>
            </span>
          </div>
          {losers.length > 0 && (
            <div className="shame-list">
              <span className="dim" style={{ fontSize: 12, alignSelf: 'center' }}>📉 존버보다 못 벌었다:</span>
              {losers.map((r, i) => (
                <span key={r.playerId} className="shame-chip" style={{ animationDelay: `${1.1 + i * 0.12}s` }}>
                  {players[r.playerId].emoji} {players[r.playerId].name}{' '}
                  {r.returnPct >= 0 ? '+' : ''}{r.returnPct.toFixed(1)}%
                </span>
              ))}
            </div>
          )}
          {losers.length === 0 && (
            <div className="shame-list">
              <span className="shame-chip praise-chip" style={{ animationDelay: '1.1s' }}>
                🎉 전원이 존버를 이겼다! 이런 판은 흔치 않습니다
              </span>
            </div>
          )}
          <div className="skill-wrap">
            <span className="dim" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>내 스킬 점수</span>
            <div className="skill-bar">
              <div className="skill-fill" style={{ width: `${mySkill}%` }} />
            </div>
            <span className="skill-num">{mySkill}%</span>
          </div>
        </div>

        <div className="reveal-card" style={{ animationDelay: '1.15s' }}>
          <div className="reveal-kicker">
            차트 {roundIndex + 1} 정산 {isFinal ? '— 🔥 파이널 ×1.5 적용' : ''}
          </div>
          <table className="result-table">
            <thead>
              <tr>
                <th>#</th><th>트레이더</th><th className="num">수익률</th><th className="num">수수료</th>
                <th className="num">스킬</th><th className="num">획득 P</th><th className="num">누적 P</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const p = players[r.playerId]
                return (
                  <tr key={r.playerId} className={r.playerId === 0 ? 'me' : ''}>
                    <td className="mono">{medal(r.rank)}</td>
                    <td>{p.emoji} {p.name}</td>
                    <td className={`num ${r.returnPct > 0.005 ? 'up-c' : r.returnPct < -0.005 ? 'down-c' : 'dim'}`}>
                      {r.returnPct >= 0 ? '+' : ''}{r.returnPct.toFixed(1)}%
                    </td>
                    <td className="num dim">{Math.round(r.fees / 10000).toLocaleString()}만</td>
                    <td className="num dim">{skillScore(r.returnPct, result.perfectPct)}%</td>
                    <td className="num pts-gain">+{r.points}</td>
                    <td className="num">{fmtP(totals[r.playerId])}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <button className="next-btn" onClick={onNext}>
          {isFinal ? '🏆 최종 시상식' : `다음 차트: ${nextTheme} ▶`}
        </button>
        <div className="auto-note">{Math.ceil(autoLeft / 1000)}초 후 자동 진행</div>
      </div>
    </div>
  )
}

function medal(rank: number): string {
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : String(rank)
}

function fmtP(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1)
}
