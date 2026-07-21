/** 초경량 WebAudio 신스 — 외부 에셋 없이 게임 사운드 전부 합성 */
let ctx: AudioContext | null = null
let muted = false

function ac(): AudioContext | null {
  if (muted) return null
  try {
    if (!ctx) ctx = new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

export function setMuted(m: boolean) {
  muted = m
}
export function isMuted() {
  return muted
}

function tone(
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; gain?: number; slide?: number; delay?: number } = {}
) {
  const a = ac()
  if (!a) return
  const t0 = a.currentTime + (opts.delay ?? 0)
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = opts.type ?? 'sine'
  osc.frequency.setValueAtTime(freq, t0)
  if (opts.slide) osc.frequency.exponentialRampToValueAtTime(opts.slide, t0 + dur)
  const vol = opts.gain ?? 0.08
  g.gain.setValueAtTime(0, t0)
  g.gain.linearRampToValueAtTime(vol, t0 + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(a.destination)
  osc.start(t0)
  osc.stop(t0 + dur + 0.05)
}

/** 틱 재생: 상승/하락 블립 (변동폭에 따라 살짝 피치 변화) */
export function sTick(up: boolean, magnitude = 0) {
  const m = Math.min(1, Math.abs(magnitude) * 8)
  if (up) tone(620 + m * 240, 0.09, { type: 'triangle', slide: 880 + m * 300, gain: 0.05 })
  else tone(420 - m * 120, 0.11, { type: 'triangle', slide: 240 - m * 60, gain: 0.05 })
}

export function sLock() {
  tone(1250, 0.05, { type: 'square', gain: 0.04 })
  tone(1650, 0.06, { type: 'square', gain: 0.035, delay: 0.055 })
}

export function sWindowStart() {
  tone(520, 0.12, { type: 'sine', gain: 0.05 })
  tone(780, 0.14, { type: 'sine', gain: 0.05, delay: 0.09 })
}

export function sLiquidation() {
  tone(300, 0.4, { type: 'sawtooth', slide: 60, gain: 0.09 })
  tone(150, 0.5, { type: 'square', slide: 40, gain: 0.06, delay: 0.05 })
}

export function sRoundEnd() {
  ;[523, 659, 784].forEach((f, i) => tone(f, 0.22, { type: 'triangle', gain: 0.07, delay: i * 0.11 }))
}

export function sCountdown() {
  tone(980, 0.07, { type: 'square', gain: 0.03 })
}

/** 리드 체인지 — 왕관이 넘어가는 순간 */
export function sLeadChange() {
  tone(660, 0.12, { type: 'triangle', gain: 0.07 })
  tone(880, 0.12, { type: 'triangle', gain: 0.07, delay: 0.1 })
  tone(1320, 0.2, { type: 'triangle', gain: 0.08, delay: 0.2 })
}

/** 클러치(파이널 종반) — 심장박동 더블 썸프 */
export function sClutch() {
  tone(70, 0.16, { type: 'sine', gain: 0.16, slide: 45 })
  tone(65, 0.2, { type: 'sine', gain: 0.13, slide: 40, delay: 0.24 })
}

/** 테마 인트로 스팅어 */
export function sStinger() {
  tone(180, 0.5, { type: 'sawtooth', slide: 420, gain: 0.05 })
  tone(523, 0.3, { type: 'triangle', gain: 0.08, delay: 0.42 })
  tone(784, 0.4, { type: 'triangle', gain: 0.08, delay: 0.55 })
}

/** 이모지 리액션 팝 */
export function sReact() {
  tone(900 + Math.random() * 500, 0.08, { type: 'triangle', gain: 0.045, slide: 1500 })
}

export function sFanfare() {
  ;[523, 659, 784, 1047, 784, 1047].forEach((f, i) =>
    tone(f, 0.3, { type: 'triangle', gain: 0.08, delay: i * 0.14 })
  )
}
