import { memo, useMemo } from 'react'
import { PlayerMeta, START_CAPITAL } from '../engine/types'

interface Props {
  players: PlayerMeta[]
  equities: number[]
  positions: number[]
  phase: 'lock' | 'play'
  lockedFlags: boolean[]
  liqSet: Set<number>
}

const ROW_H = 46

/** 실시간 순위 바 — 재생 중 전원의 평가손익이 출렁이는 관전 텐션의 핵심 */
export default memo(function RankBar({ players, equities, positions, phase, lockedFlags, liqSet }: Props) {
  const order = useMemo(() => {
    const idx = players.map((p) => p.id)
    idx.sort((a, b) => equities[b] - equities[a] || a - b)
    const rankOf = new Map<number, number>()
    idx.forEach((id, i) => rankOf.set(id, i))
    return rankOf
  }, [players, equities])

  return (
    <div className="rank-panel">
      <div className="rank-title">실시간 랭킹</div>
      <div className="rank-list" style={{ height: players.length * ROW_H }}>
        {players.map((p) => {
          const rank = order.get(p.id)!
          const eq = equities[p.id]
          const pnl = (eq / START_CAPITAL - 1) * 100
          const pos = positions[p.id]
          return (
            <div
              key={p.id}
              className={`rank-row${p.id === 0 ? ' me' : ''}${rank === 0 ? ' r1' : ''}`}
              style={{ top: rank * ROW_H }}
            >
              <span className="rk">{rank + 1}</span>
              <span className="av">{p.emoji}</span>
              <span className="nm">
                {p.name}
                {p.tagline && <small>{p.tagline}</small>}
              </span>
              <span className="eq">
                <b className={pnl > 0.005 ? 'up-c' : pnl < -0.005 ? 'down-c' : 'dim'}>
                  {pnl >= 0 ? '+' : ''}
                  {pnl.toFixed(1)}%
                </b>
                <span className="dim">{fmtWon(eq)}</span>
              </span>
              {liqSet.has(p.id) && <span className="liq-mark" title="이 차트에서 강제청산 당함">💥</span>}
              {phase === 'play' ? (
                <span className={`pos-sil ${pos > 0.01 ? 'long' : pos < -0.01 ? 'short' : 'cash'}`}>
                  {pos > 0.01 ? `▲${Math.round(pos * 100)}` : pos < -0.01 ? `▼${Math.round(-pos * 100)}` : '뱅크'}
                </span>
              ) : (
                <span className="pos-sil hidden-pos">{lockedFlags[p.id] ? '🔒' : '⏳'}</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})

function fmtWon(x: number): string {
  if (x >= 100_000_000) return `${(x / 100_000_000).toFixed(2)}억`
  return `${Math.round(x / 10_000).toLocaleString()}만`
}
