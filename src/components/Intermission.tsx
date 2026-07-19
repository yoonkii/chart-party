import { useEffect, useState } from 'react'
import { ChartData, PlayerMeta, RoundResult } from '../engine/types'
import { skillScore } from '../engine/sim'
import { useI18n } from '../i18n'

interface Props {
  chart: ChartData
  players: PlayerMeta[]
  result: RoundResult
  totals: number[]
  roundIndex: number
  isFinal: boolean
  nextTheme: number | null
  onNext: () => void
}

const AUTO_MS = 30000

/** 정산 쇼 — 매 차트의 클라이맥스 (§4) */
export default function Intermission({ chart, players, result, totals, roundIndex, isFinal, nextTheme, onNext }: Props) {
  const { t, lang, pname, themeName, chartName, chartBlurb } = useI18n()
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
  const mySkill = skillScore(result.results[0].returnPct, result.perfectPct)

  const fmtFee = (x: number) =>
    lang === 'en' ? `₩${Math.round(x / 1000).toLocaleString()}K` : `${Math.round(x / 10000).toLocaleString()}만`

  return (
    <div className="screen inter">
      <div className="reveal-stage">
        <div className="reveal-card" style={{ animationDelay: '0.05s' }}>
          <div className="reveal-kicker">{t.revealKicker}</div>
          <div className="reveal-identity">
            <span className="reveal-symbol">{chart.symbol}</span>
            <span className="reveal-name">{chartName(chart.id, chart.name)}</span>
            <span className="reveal-period">{chart.period}</span>
          </div>
          <p className="reveal-blurb">{chartBlurb(chart.id, chart.blurb)}</p>
        </div>

        <div className="reveal-card" style={{ animationDelay: '0.65s' }}>
          <div className="reveal-kicker">{t.benchKicker}</div>
          <div className="bench-row">
            <span className={`bench-big ${bh >= 0 ? 'up-c' : 'down-c'}`}>
              {bh >= 0 ? '+' : ''}{bh.toFixed(1)}%
            </span>
            <span className="bench-label">
              {t.benchLine1a}<b>{t.benchLine1b}</b>{t.benchLine1c}
              <br />
              {t.benchLine2}<span className="gold-c">+{result.perfectPct.toFixed(1)}%</span>
            </span>
          </div>
          {losers.length > 0 ? (
            <div className="shame-list">
              <span className="shame-label">{t.shameLabel}</span>
              {losers.map((r, i) => (
                <span key={r.playerId} className="shame-chip" style={{ animationDelay: `${1.1 + i * 0.12}s` }}>
                  {players[r.playerId].emoji} {pname(players[r.playerId])}{' '}
                  {r.returnPct >= 0 ? '+' : ''}{r.returnPct.toFixed(1)}%
                </span>
              ))}
            </div>
          ) : (
            <div className="shame-list">
              <span className="shame-chip praise-chip" style={{ animationDelay: '1.1s' }}>{t.praiseAll}</span>
            </div>
          )}
          <div className="skill-wrap">
            <span className="skill-label">{t.mySkill}</span>
            <div className="skill-bar">
              <div className="skill-fill" style={{ width: `${mySkill}%` }} />
            </div>
            <span className="skill-num">{mySkill}%</span>
          </div>
        </div>

        <div className="reveal-card" style={{ animationDelay: '1.15s' }}>
          <div className="reveal-kicker">
            {t.settleKicker(roundIndex + 1)} {isFinal ? t.settleFinal : ''}
          </div>
          <table className="result-table">
            <thead>
              <tr>
                <th>#</th><th>{t.thTrader}</th><th className="num">{t.thReturn}</th><th className="num">{t.thFees}</th>
                <th className="num">{t.thSkill}</th><th className="num">{t.thPts}</th><th className="num">{t.thTotal}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const p = players[r.playerId]
                return (
                  <tr key={r.playerId} className={r.playerId === 0 ? 'me' : ''}>
                    <td className="mono">{medal(r.rank)}</td>
                    <td>{p.emoji} {pname(p)}</td>
                    <td className={`num ${r.returnPct > 0.005 ? 'up-c' : r.returnPct < -0.005 ? 'down-c' : 'dim'}`}>
                      {r.returnPct >= 0 ? '+' : ''}{r.returnPct.toFixed(1)}%
                    </td>
                    <td className="num dim">{fmtFee(r.fees)}</td>
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
          {isFinal ? t.toAwards : `${t.nextChart(nextTheme !== null ? themeName(nextTheme) : '')} ▶`}
        </button>
        <div className="auto-note">{t.autoNote(Math.ceil(autoLeft / 1000))}</div>
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
