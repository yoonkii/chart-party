import { useEffect, useRef, useState } from 'react'
import { BOTS } from '../engine/bots'
import { Speed } from '../App'
import { normalizeRoomCode } from '../net/protocol'
import { useI18n } from '../i18n'

export interface HomeConfig {
  name: string
  emoji: string
  speed: Speed
}

const EMOJIS = ['🦁', '🐯', '🦊', '🐼', '🐵', '🦄', '🐙', '🐳']

export const SPEED_VALUES: Speed[] = [
  { lockMs: 15000, playMs: 10000 },
  { lockMs: 8000, playMs: 6000 },
  { lockMs: 5000, playMs: 4000 },
]

const TICKER_KO = [
  ['차트파티', '+128.4%', true], ['존버지수', '+34.2%', true], ['단타위험', '-45.1%', false],
  ['수수료주의보', '-0.5%', false], ['깜깜이배팅', '+7.7%', true], ['풀숏경보', '-88.0%', false],
  ['바닥캐치', '+61.3%', true], ['역베천재', '+15.9%', true], ['마진콜', '-95.0%', false],
] as const

const TICKER_EN = [
  ['CHARTPARTY', '+128.4%', true], ['HODLINDEX', '+34.2%', true], ['SCALPRISK', '-45.1%', false],
  ['FEEALERT', '-0.5%', false], ['BLINDBET', '+7.7%', true], ['MAXSHORT', '-88.0%', false],
  ['BOTTOMCATCH', '+61.3%', true], ['FADEGENIUS', '+15.9%', true], ['MARGINCALL', '-95.0%', false],
] as const

interface Props {
  onSolo: (cfg: HomeConfig) => void
  onCreate: (cfg: HomeConfig) => void
  onJoin: (cfg: HomeConfig, code: string) => void
  busy: boolean
}

export default function Home({ onSolo, onCreate, onJoin, busy }: Props) {
  const { lang, setLang, t } = useI18n()
  const [name, setName] = useState(() => localStorage.getItem('cp_name') ?? '')
  const [emoji, setEmoji] = useState(() => localStorage.getItem('cp_emoji') ?? '🦁')
  const [speedIdx, setSpeedIdx] = useState(() => Number(localStorage.getItem('cp_speed_idx') ?? 0))
  const [joinCode, setJoinCode] = useState('')

  const cfg = (): HomeConfig => {
    localStorage.setItem('cp_name', name)
    localStorage.setItem('cp_emoji', emoji)
    localStorage.setItem('cp_speed_idx', String(speedIdx))
    return { name: name.trim(), emoji, speed: SPEED_VALUES[speedIdx] }
  }

  return (
    <div className="screen lobby">
      <BgChart />

      <div className="lang-toggle">
        <button className={lang === 'ko' ? 'sel' : ''} onClick={() => setLang('ko')}>한국어</button>
        <button className={lang === 'en' ? 'sel' : ''} onClick={() => setLang('en')}>EN</button>
      </div>

      <div className="lobby-grid">
        <div className="lobby-hero">
          <div className="hero-kicker">{t.kicker}</div>
          <h1 className="lobby-title">
            {lang === 'ko' ? <>차트<br />파티</> : <>CHART<br />PARTY</>}
          </h1>
          <p className="lobby-tag">
            {t.tag1}
            <br />
            <strong>{t.tag2}</strong>
          </p>
          <div className="hero-rules">
            <div className="rule-line"><span className="rule-no">01</span>{t.rule1}</div>
            <div className="rule-line"><span className="rule-no">02</span>{t.rule2}</div>
          </div>
        </div>

        <div className="lobby-panel">
          <div>
            <div className="panel-cap">{t.nickname}</div>
            <div className="setup-row" style={{ flexDirection: 'column', gap: 8 }}>
              <input
                className="name-input"
                placeholder={t.namePlaceholder}
                maxLength={12}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="emoji-pick">
                {EMOJIS.map((e) => (
                  <button key={e} className={`emoji-btn${e === emoji ? ' sel' : ''}`} onClick={() => setEmoji(e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <div className="panel-cap">{t.tempo}</div>
            <div className="speed-row">
              {t.speeds.map((s, i) => (
                <button key={i} className={`speed-btn${i === speedIdx ? ' sel' : ''}`} onClick={() => setSpeedIdx(i)}>
                  {s.label}
                  <small>{s.sub}</small>
                </button>
              ))}
            </div>
          </div>

          <button className="start-btn" onClick={() => onSolo(cfg())} disabled={busy}>
            {t.soloBtn}
            <small>{t.soloSub}</small>
          </button>

          <div className="mp-zone">
            <button className="create-btn" onClick={() => onCreate(cfg())} disabled={busy}>
              {busy ? t.connecting : t.createBtn}
              <small>{t.createSub}</small>
            </button>
            <div className="join-row">
              <input
                className="name-input code-input"
                placeholder={t.joinPlaceholder}
                maxLength={4}
                value={joinCode}
                onChange={(e) => setJoinCode(normalizeRoomCode(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && joinCode.length === 4 && onJoin(cfg(), joinCode)}
              />
              <button
                className="join-btn"
                disabled={busy || joinCode.length !== 4}
                onClick={() => onJoin(cfg(), joinCode)}
              >
                {busy ? '…' : t.joinBtn}
              </button>
            </div>
          </div>
        </div>
      </div>

      <Ticker lang={lang} />
    </div>
  )
}

/** 로비 배경 — 은은하게 흐르는 가짜 캔들 */
function BgChart() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    let raf = 0
    let t = 0
    const candles: { o: number; c: number; h: number; l: number }[] = []
    let price = 0.5
    const step = () => {
      const drift = (Math.random() - 0.48) * 0.06
      const c = Math.max(0.08, Math.min(0.92, price + drift))
      candles.push({ o: price, c, h: Math.max(price, c) + Math.random() * 0.02, l: Math.min(price, c) - Math.random() * 0.02 })
      price = c
      if (candles.length > 90) candles.shift()
    }
    for (let i = 0; i < 90; i++) step()
    const draw = () => {
      const W = (canvas.width = window.innerWidth)
      const H = (canvas.height = window.innerHeight)
      ctx.clearRect(0, 0, W, H)
      t++
      if (t % 38 === 0) step()
      const slot = W / 88
      candles.forEach((k, i) => {
        const up = k.c >= k.o
        ctx.fillStyle = up ? 'rgba(255,61,84,0.09)' : 'rgba(61,123,255,0.09)'
        ctx.strokeStyle = ctx.fillStyle
        const x = i * slot + slot / 2
        const y = (v: number) => H * (1 - v * 0.7 - 0.15)
        ctx.beginPath()
        ctx.moveTo(x, y(k.h))
        ctx.lineTo(x, y(k.l))
        ctx.stroke()
        ctx.fillRect(x - slot * 0.3, Math.min(y(k.o), y(k.c)), slot * 0.6, Math.max(2, Math.abs(y(k.c) - y(k.o))))
      })
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} className="lobby-bg-chart" />
}

function Ticker({ lang }: { lang: string }) {
  const base = lang === 'ko' ? TICKER_KO : TICKER_EN
  const items = [...base, ...base]
  return (
    <div className="ticker-wrap">
      <div className="ticker">
        {items.map(([label, pct, up], i) => (
          <span key={i}>
            <span className="dim">{label}</span>{' '}
            <span className={up ? 'up-c' : 'down-c'}>{up ? '▲' : '▼'} {pct}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
