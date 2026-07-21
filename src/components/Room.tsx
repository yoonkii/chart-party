import { useState } from 'react'
import { NetPlayer } from '../net/protocol'
import { MAX_PLAYERS } from '../net/session'
import { Speed } from '../App'
import { SPEED_VALUES } from './Home'
import { useI18n } from '../i18n'

interface Props {
  code: string
  roster: NetPlayer[]
  isHost: boolean
  myIndex: number
  onStart: (speed: Speed) => void
  onLeave: () => void
}

/** 멀티플레이 대기실 — 방 코드 공유 + 로스터 + 호스트 출발 */
export default function Room({ code, roster, isHost, myIndex, onStart, onLeave }: Props) {
  const { t } = useI18n()
  const [speedIdx, setSpeedIdx] = useState(() => Number(localStorage.getItem('cp_speed_idx') ?? 0))
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  const emptySeats = MAX_PLAYERS - roster.length

  return (
    <div className="screen room">
      <div className="room-box">
        <div className="panel-cap">{t.roomKicker}</div>
        <button className="room-code" onClick={copy} title="copy">
          {code.split('').map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </button>
        {copied && <div className="copied-note">{t.codeCopied}</div>}

        <div className="panel-cap" style={{ marginTop: 18 }}>
          {t.players} — {roster.length}/{MAX_PLAYERS}
        </div>
        <div className="seat-grid">
          {roster.map((p, i) => (
            <div key={i} className={`seat${i === myIndex ? ' me' : ''}${p.connected ? '' : ' off'}`}>
              <span className="seat-emoji">{p.emoji}</span>
              <span className="seat-name">
                {p.name}
                {i === 0 && ' ★'}
              </span>
              {!p.connected && <span className="seat-off">{t.disconnected}</span>}
            </div>
          ))}
          {Array.from({ length: emptySeats }, (_, i) => (
            <div key={`e${i}`} className="seat empty">
              <span className="seat-emoji">🤖</span>
              <span className="seat-name dim">BOT</span>
            </div>
          ))}
        </div>
        {emptySeats > 0 && <div className="botfill-note">{t.botFillNote(emptySeats)}</div>}

        {isHost ? (
          <>
            <div className="panel-cap" style={{ marginTop: 18 }}>{t.tempo}</div>
            <div className="speed-row">
              {t.speeds.map((s, i) => (
                <button
                  key={i}
                  className={`speed-btn${i === speedIdx ? ' sel' : ''}`}
                  onClick={() => {
                    setSpeedIdx(i)
                    localStorage.setItem('cp_speed_idx', String(i))
                  }}
                >
                  {s.label}
                  <small>{s.sub}</small>
                </button>
              ))}
            </div>
            <button className="start-btn" style={{ marginTop: 16 }} onClick={() => onStart(SPEED_VALUES[speedIdx])}>
              {t.startMp}
              <small>{t.startSub}</small>
            </button>
          </>
        ) : (
          <div className="waiting-host">
            <span className="waiting-dot" />
            {t.waitingHost}
          </div>
        )}

        <button className="leave-btn" onClick={onLeave}>{t.leaveRoom}</button>
      </div>
    </div>
  )
}
