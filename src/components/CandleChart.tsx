import { useEffect, useRef } from 'react'
import { Candle } from '../engine/types'

interface Props {
  candles: Candle[]
  /** 완전히 공개된 틱 수 */
  revealed: number
  /** 현재 그려지는 중인 틱 인덱스 (없으면 -1) */
  animTick: number
  /** 그려지는 틱의 진행도 0~1 */
  animProgress: number
  /** 강제 청산 발생 틱들 */
  liqMarks: number[]
}

const UP = '#ff4d5e'
const DOWN = '#4d8dff'

/** y축은 항상 로그 공간 — 밈 주식(+4800%)과 횡보(±5%)를 같은 코드로 처리 */
export default function CandleChart({ candles, revealed, animTick, animProgress, liqMarks }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const domainRef = useRef<{ lo: number; hi: number }>({ lo: Math.log(88), hi: Math.log(113) })
  const rafRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
      const parent = canvas.parentElement!
      const dpr = window.devicePixelRatio || 1
      const W = parent.clientWidth
      const H = parent.clientHeight
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr
        canvas.height = H * dpr
        canvas.style.width = `${W}px`
        canvas.style.height = `${H}px`
      }
      const ctx = canvas.getContext('2d')!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const total = candles.length
      const padL = 8
      const padR = 58
      const padT = 16
      const padB = 12
      const plotW = W - padL - padR
      const plotH = H - padT - padB
      const slot = plotW / total

      // 현재 보이는 캔들 (부분 캔들 포함)로 목표 도메인 계산
      let lo = Infinity
      let hi = -Infinity
      const visCount = Math.max(revealed, animTick >= 0 ? animTick + 1 : 0)
      for (let t = 0; t < visCount; t++) {
        const k = interpCandle(candles, t, revealed, animTick, animProgress)
        lo = Math.min(lo, k.l)
        hi = Math.max(hi, k.h)
      }
      if (!isFinite(lo)) {
        lo = 88
        hi = 113
      }
      lo = Math.min(lo, 97)
      hi = Math.max(hi, 103)
      const pad = (Math.log(hi) - Math.log(lo)) * 0.09 + 0.005
      const target = { lo: Math.log(lo) - pad, hi: Math.log(hi) + pad }
      // 도메인 스무딩 (리스케일 튐 방지)
      const d = domainRef.current
      d.lo += (target.lo - d.lo) * 0.18
      d.hi += (target.hi - d.hi) * 0.18

      const y = (price: number) =>
        padT + plotH - ((Math.log(price) - d.lo) / (d.hi - d.lo)) * plotH
      const x = (t: number) => padL + t * slot + slot / 2

      // ── 그리드 + 가격 라벨
      ctx.font = '11px "IBM Plex Mono", monospace'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      const steps = 4
      for (let i = 0; i <= steps; i++) {
        const ly = padT + (plotH * i) / steps
        const price = Math.exp(d.hi - ((d.hi - d.lo) * i) / steps)
        ctx.strokeStyle = 'rgba(148,178,226,0.07)'
        ctx.beginPath()
        ctx.moveTo(padL, ly)
        ctx.lineTo(W - padR + 6, ly)
        ctx.stroke()
        ctx.fillStyle = 'rgba(139,149,168,0.75)'
        ctx.fillText(fmtPrice(price), W - padR + 10, ly)
      }

      // 시작가 100 기준선
      const y100 = y(100)
      if (y100 > padT - 4 && y100 < H - padB + 4) {
        ctx.strokeStyle = 'rgba(255,203,71,0.35)'
        ctx.setLineDash([5, 5])
        ctx.beginPath()
        ctx.moveTo(padL, y100)
        ctx.lineTo(W - padR + 6, y100)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = 'rgba(255,203,71,0.8)'
        ctx.fillText('100', W - padR + 10, y100 - 9)
      }

      // 의사결정 창 경계 (5틱마다 얇은 선)
      for (let wIdx = 1; wIdx < total / 5; wIdx++) {
        const lx = padL + wIdx * 5 * slot
        ctx.strokeStyle = 'rgba(148,178,226,0.05)'
        ctx.beginPath()
        ctx.moveTo(lx, padT)
        ctx.lineTo(lx, H - padB)
        ctx.stroke()
      }

      // ── 캔들
      const bodyW = Math.max(3, slot * 0.62)
      for (let t = 0; t < visCount; t++) {
        const k = interpCandle(candles, t, revealed, animTick, animProgress)
        const up = k.c >= k.o
        const col = up ? UP : DOWN
        const cx = x(t)
        ctx.strokeStyle = col
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(cx, y(k.h))
        ctx.lineTo(cx, y(k.l))
        ctx.stroke()
        const yO = y(k.o)
        const yC = y(k.c)
        const top = Math.min(yO, yC)
        const hgt = Math.max(1.6, Math.abs(yC - yO))
        ctx.fillStyle = col
        if (t === animTick) {
          ctx.shadowColor = col
          ctx.shadowBlur = 10
        }
        ctx.fillRect(cx - bodyW / 2, top, bodyW, hgt)
        ctx.shadowBlur = 0
      }

      // 청산 마커
      ctx.font = '13px sans-serif'
      ctx.textAlign = 'center'
      for (const t of liqMarks) {
        if (t < visCount) {
          const k = candles[t]
          ctx.fillText('💥', x(t), y(k.h) - 12)
        }
      }

      // 현재가 라인 + 칩
      if (visCount > 0) {
        const k = interpCandle(candles, visCount - 1, revealed, animTick, animProgress)
        const yc = y(k.c)
        const col = k.c >= 100 ? UP : DOWN
        ctx.strokeStyle = `${col}55`
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        ctx.moveTo(padL, yc)
        ctx.lineTo(W - padR + 6, yc)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = col
        const label = fmtPrice(k.c)
        ctx.font = 'bold 11px "IBM Plex Mono", monospace'
        const tw = ctx.measureText(label).width
        roundRect(ctx, W - padR + 4, yc - 9, tw + 12, 18, 5)
        ctx.fill()
        ctx.fillStyle = '#0a0e16'
        ctx.textAlign = 'left'
        ctx.fillText(label, W - padR + 10, yc + 0.5)
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)
  }, [candles, revealed, animTick, animProgress, liqMarks])

  return <canvas ref={canvasRef} className="chart-canvas" />
}

/** 애니메이션 중인 틱은 시가에서 최종 OHLC로 성장하는 중간값을 그린다 */
function interpCandle(
  candles: Candle[],
  t: number,
  revealed: number,
  animTick: number,
  p: number
): Candle {
  const k = candles[t]
  if (t < revealed || t !== animTick) return k
  const e = 1 - Math.pow(1 - Math.min(1, p), 2.2) // ease-out
  const wick = Math.min(1, e * 1.35)
  return {
    o: k.o,
    c: k.o + (k.c - k.o) * e,
    h: k.o + (k.h - k.o) * wick,
    l: k.o + (k.l - k.o) * wick,
  }
}

function fmtPrice(p: number): string {
  if (p >= 1000) return Math.round(p).toLocaleString()
  if (p >= 300) return p.toFixed(0)
  return p.toFixed(1)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
