import { useEffect, useRef, useState } from 'react'
import { BOTS } from '../engine/bots'
import { Speed } from '../App'

export interface LobbyConfig {
  name: string
  emoji: string
  speed: Speed
}

const EMOJIS = ['🦁', '🐯', '🦊', '🐼', '🐵', '🦄', '🐙', '🐳']

const SPEEDS: { key: string; label: string; sub: string; speed: Speed }[] = [
  { key: 'normal', label: '보통', sub: '락인 15초 · 재생 10초', speed: { lockMs: 15000, playMs: 10000 } },
  { key: 'fast', label: '빠름', sub: '락인 8초 · 재생 6초', speed: { lockMs: 8000, playMs: 6000 } },
  { key: 'blitz', label: '초스피드', sub: '락인 5초 · 재생 4초', speed: { lockMs: 5000, playMs: 4000 } },
]

const TICKER_ITEMS = [
  ['차트파티', '+128.4%', true], ['존버지수', '+34.2%', true], ['단타위험', '-45.1%', false],
  ['수수료주의보', '-0.5%', false], ['깜깜이배팅', '+7.7%', true], ['풀숏경보', '-88.0%', false],
  ['바닥캐치', '+61.3%', true], ['역베천재', '+15.9%', true], ['마진콜', '-95.0%', false],
] as const

export default function Lobby({ onStart }: { onStart: (cfg: LobbyConfig) => void }) {
  const [name, setName] = useState(() => localStorage.getItem('cp_name') ?? '')
  const [emoji, setEmoji] = useState(() => localStorage.getItem('cp_emoji') ?? '🦁')
  const [speedKey, setSpeedKey] = useState(() => localStorage.getItem('cp_speed') ?? 'normal')

  const start = () => {
    localStorage.setItem('cp_name', name)
    localStorage.setItem('cp_emoji', emoji)
    localStorage.setItem('cp_speed', speedKey)
    onStart({ name: name.trim(), emoji, speed: SPEEDS.find((s) => s.key === speedKey)!.speed })
  }

  return (
    <div className="screen lobby">
      <BgChart />
      <div>
        <h1 className="lobby-title">차트 파티</h1>
        <p className="lobby-tag">
          전원이 <strong>똑같은 실제 주식 차트</strong>를 받는다. <strong>1년치가 5분</strong>에 재생된다.<br />
          운 논란 원천 차단 — <strong>판단력만으로</strong> 갈린다.
        </p>
      </div>

      <div className="lobby-card">
        <div className="lobby-row">
          <span className="lobby-label">닉네임</span>
          <input
            className="name-input"
            placeholder="트레이더명 입력"
            maxLength={10}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && start()}
          />
          <div className="emoji-pick">
            {EMOJIS.map((e) => (
              <button key={e} className={`emoji-btn${e === emoji ? ' sel' : ''}`} onClick={() => setEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="lobby-row">
          <span className="lobby-label">템포</span>
          {SPEEDS.map((s) => (
            <button key={s.key} className={`speed-btn${s.key === speedKey ? ' sel' : ''}`} onClick={() => setSpeedKey(s.key)}>
              {s.label}
              <small>{s.sub}</small>
            </button>
          ))}
        </div>

        <div>
          <div className="lobby-label" style={{ marginBottom: 8 }}>오늘의 상대 — 7인의 봇 트레이더</div>
          <div className="bot-roster">
            {BOTS.map((b) => (
              <div key={b.key} className="bot-chip">
                <span className="e">{b.emoji}</span>
                <span>
                  {b.name}
                  <span className="t">{b.tagline}</span>
                </span>
              </div>
            ))}
          </div>
        </div>

        <button className="start-btn" onClick={start}>매치 시작 — 6차트 리그전</button>

        <p className="rules-line">
          매 차트 시작 자본 1,000만 · 수익률 순위로 포인트 (10·7·5·4·3·2·1·0) · 파이널 ×1.5<br />
          롱/숏 슬라이더 하나 · 포지션 변경분 수수료 0.5% · 한 틱 -95% 손실 시 강제청산 💥
        </p>
      </div>

      <Ticker />
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
        ctx.fillStyle = up ? 'rgba(255,77,94,0.10)' : 'rgba(77,141,255,0.10)'
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

function Ticker() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS]
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
