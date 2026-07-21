import { useEffect, useMemo, useState } from 'react'
import { ChartData, PlayerMeta, RoundResult } from '../engine/types'
import { Award, computeAwards } from '../engine/titles'
import { useI18n } from '../i18n'
import { sFanfare } from '../sound'

interface Props {
  players: PlayerMeta[]
  results: RoundResult[]
  lineup: ChartData[]
  totals: number[]
  myId: number
  isDirector: boolean
  onRestart: () => void
}

const CONFETTI_COLORS = ['#ff3d54', '#3d7bff', '#ffb020', '#ffffff']

export default function Final({ players, results, lineup, totals, myId, isDirector, onRestart }: Props) {
  const { t, pname } = useI18n()
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

  const fmtRet = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}%`

  const awardText = (a: Award): { title: string; desc: string; detail: string } => {
    const d = t.awards[a.key]
    switch (a.key) {
      case 'hodlKing':
      case 'scalperGhost':
        return { title: d.title, desc: d.desc, detail: (d as typeof t.awards.hodlKing).detail(a.turnover.toFixed(1), fmtRet(a.totalReturn)) }
      case 'brokerVip':
        return { title: d.title, desc: d.desc, detail: t.awards.brokerVip.detail(Math.round(a.fees).toLocaleString()) }
      case 'contrarianGenius':
        return { title: d.title, desc: d.desc, detail: t.awards.contrarianGenius.detail(fmtRet(a.contrarian)) }
      case 'bottomCatcher':
        return { title: d.title, desc: d.desc, detail: t.awards.bottomCatcher.detail(a.catches) }
    }
  }

  const share = async () => {
    const me = order.indexOf(myId) + 1
    const lines = [
      t.shareTitle,
      t.shareWin(`${champion.emoji} ${pname(champion)}`, fmtP(totals[champion.id])),
      t.shareMe(me, players.length, fmtP(totals[myId])),
      '',
      ...lineup.map((c, i) => {
        const r = results[i].results[myId]
        return `${i + 1}. [${c.symbol}] ${fmtRet(r.returnPct)} (${t.rankSuffix(r.rank)})`
      }),
      '',
      t.shareTail,
    ]
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setToast(t.copied)
    } catch {
      setToast(t.copyFail)
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

      <div className="final-kicker">CHART PARTY — FINAL RESULT</div>
      <h1 className="final-title">🏆 {t.champion(pname(champion))}</h1>

      <div className="podium">
        {podiumIds.map((id, col) =>
          id === undefined ? null : (
            <div className="podium-col" key={id}>
              <span className="podium-face">{players[id].emoji}</span>
              <span className="podium-name">{pname(players[id])}</span>
              <span className="podium-pts">{fmtP(totals[id])}P</span>
              <div className="podium-block">{col === 1 ? 1 : col === 0 ? 2 : 3}</div>
            </div>
          )
        )}
      </div>

      <div className="awards-grid">
        {awards.map((a, i) => {
          const txt = awardText(a)
          return (
            <div className="award-card" key={a.key} style={{ animationDelay: `${0.8 + i * 0.25}s` }}>
              <div className="award-emoji">{a.emoji}</div>
              <div className="award-title">{txt.title}</div>
              <div className="award-who">
                {players[a.playerId].emoji} {pname(players[a.playerId])}
              </div>
              <div className="award-desc">{txt.desc}</div>
              <div className="award-detail">{txt.detail}</div>
            </div>
          )
        })}
      </div>

      <div className="final-table-wrap">
        <table className="result-table">
          <thead>
            <tr>
              <th>#</th><th>{t.thTrader}</th>
              {lineup.map((c, i) => (
                <th key={i} className="num">{c.symbol}</th>
              ))}
              <th className="num">{t.sumPts}</th>
            </tr>
          </thead>
          <tbody>
            {order.map((id, i) => (
              <tr key={id} className={id === myId ? 'me' : ''}>
                <td className="mono">{i + 1}</td>
                <td>{players[id].emoji} {pname(players[id])}</td>
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
        <button className="share-btn" onClick={share}>{t.copyBtn}</button>
        {isDirector ? (
          <button className="again-btn" onClick={onRestart}>{t.againBtn}</button>
        ) : (
          <span className="auto-note" style={{ opacity: 1, animation: 'none', alignSelf: 'center' }}>
            <span className="waiting-dot" /> {t.hostAdvances}
          </span>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function fmtP(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(1)
}
