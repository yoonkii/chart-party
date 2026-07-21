import { memo, useMemo } from 'react'
import { PlayerMeta, START_CAPITAL } from '../engine/types'
import { useI18n } from '../i18n'

interface Props {
  players: PlayerMeta[]
  equities: number[]
  positions: number[]
  phase: 'lock' | 'play'
  lockedFlags: boolean[]
  liqSet: Set<number>
  /** 직전 틱의 플레이어별 평가액 변화 (원) */
  deltas: number[]
  /** 델타 애니메이션 재발동 키 (틱 번호) */
  deltaStamp: number
  myId: number
}

const ROW_H = 47

/** 실시간 순위 바 — 재생 중 전원의 평가손익이 출렁이는 관전 텐션의 핵심 */
export default memo(function RankBar({
  players,
  equities,
  positions,
  phase,
  lockedFlags,
  liqSet,
  deltas,
  deltaStamp,
  myId,
}: Props) {
  const { t, lang, pname, ptagline } = useI18n()

  const order = useMemo(() => {
    const idx = players.map((p) => p.id)
    idx.sort((a, b) => equities[b] - equities[a] || a - b)
    const rankOf = new Map<number, number>()
    idx.forEach((id, i) => rankOf.set(id, i))
    return rankOf
  }, [players, equities])

  // 손익 바 스케일: 현재 판에서 가장 크게 벌거나 잃은 플레이어 기준
  const maxAbsPnl = useMemo(() => {
    let m = 0
    for (const eq of equities) m = Math.max(m, Math.abs(eq / START_CAPITAL - 1))
    return Math.max(m, 0.02)
  }, [equities])

  return (
    <div className="rank-panel">
      <div className="rank-title">{t.ranking}</div>
      <div className="rank-list" style={{ height: players.length * ROW_H }}>
        {players.map((p) => {
          const rank = order.get(p.id)!
          const eq = equities[p.id]
          const pnl = (eq / START_CAPITAL - 1) * 100
          const pos = positions[p.id]
          const delta = deltas[p.id]
          const showDelta = phase === 'play' && deltaStamp > 0 && Math.abs(delta) >= START_CAPITAL * 0.001
          const barW = Math.min(100, (Math.abs(pnl / 100) / maxAbsPnl) * 100)
          return (
            <div
              key={p.id}
              className={`rank-row${p.id === myId ? ' me' : ''}${rank === 0 ? ' r1' : ''}${p.connected === false ? ' offline' : ''}`}
              style={{ top: rank * ROW_H }}
            >
              {Math.abs(pnl) > 0.01 && (
                <div
                  className={`pnl-bar ${pnl >= 0 ? 'up' : 'down'}`}
                  style={{ width: `${Math.max(barW, 1.5)}%` }}
                />
              )}
              <span className="rk">{rank + 1}</span>
              <span className="av">
                {p.emoji}
                {rank === 0 && <span className="crown">👑</span>}
              </span>
              <span className="nm">
                {pname(p)} {p.connected === false && '📵'}
                {ptagline(p) && <small>{ptagline(p)}</small>}
              </span>
              {showDelta && (
                <span
                  key={deltaStamp}
                  className={`delta-float ${delta >= 0 ? 'up-c' : 'down-c'}`}
                >
                  {delta >= 0 ? '+' : '-'}{fmtWon(Math.abs(delta), lang)}
                </span>
              )}
              <span className="eq">
                <b className={pnl > 0.005 ? 'up-c' : pnl < -0.005 ? 'down-c' : 'dim'}>
                  {pnl >= 0 ? '+' : ''}
                  {pnl.toFixed(1)}%
                </b>
                <span>{fmtWon(eq, lang)}</span>
              </span>
              {liqSet.has(p.id) && <span className="liq-mark">💥</span>}
              {phase === 'play' ? (
                <span className={`pos-sil ${pos > 0.01 ? 'long' : pos < -0.01 ? 'short' : 'cash'}`}>
                  {pos > 0.01 ? `▲${Math.round(pos * 100)}` : pos < -0.01 ? `▼${Math.round(-pos * 100)}` : t.bank}
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

function fmtWon(x: number, lang: string): string {
  if (lang === 'en') {
    if (x >= 1_000_000) return `₩${(x / 1_000_000).toFixed(2)}M`
    return `₩${Math.round(x / 1000).toLocaleString()}K`
  }
  if (x >= 100_000_000) return `${(x / 100_000_000).toFixed(2)}억`
  return `${Math.round(x / 10_000).toLocaleString()}만`
}
