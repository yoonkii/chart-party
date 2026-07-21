import Peer, { DataConnection } from 'peerjs'
import { GuestMsg, HostMsg, NetPlayer, ROOM_PREFIX, makeRoomCode } from './protocol'
import { Speed } from '../App'
import { BOTS } from '../engine/bots'
import { mulberry32, shuffle } from '../engine/prng'

export type SessionEvent =
  | 'open' // 방 준비 완료 (host: 코드 발급 / guest: 입장 완료)
  | 'roster'
  | 'start'
  | 'phase'
  | 'locked'
  | 'play'
  | 'nextChart'
  | 'rematch'
  | 'react'
  | 'hostLeft'
  | 'error'

type Handler = (data?: unknown) => void

class Emitter {
  private handlers = new Map<SessionEvent, Set<Handler>>()

  on(ev: SessionEvent, cb: Handler): () => void {
    if (!this.handlers.has(ev)) this.handlers.set(ev, new Set())
    this.handlers.get(ev)!.add(cb)
    return () => this.handlers.get(ev)?.delete(cb)
  }

  emit(ev: SessionEvent, data?: unknown) {
    this.handlers.get(ev)?.forEach((cb) => cb(data))
  }
}

export const MAX_PLAYERS = 8

/** 스타 토폴로지의 중심 — 방 코드 발급, 로스터 관리, 페이즈 브로드캐스트, 릴레이 */
export class HostSession extends Emitter {
  readonly mode = 'host' as const
  readonly myIndex = 0
  code = ''
  roster: NetPlayer[] = [] // 인간만 (0 = 호스트). 봇은 startMatch에서 채움
  private peer: Peer | null = null
  private conns: (DataConnection | null)[] = [null] // roster index → conn (호스트 본인은 null)
  private inMatch = false
  // 현재 락 창의 게스트 입력 상태
  private curW = -1
  private guestPos: (number | null)[] = []
  private guestLocked: boolean[] = []

  constructor(name: string, emoji: string) {
    super()
    this.roster = [{ name, emoji, isBot: false, connected: true }]
    this.tryOpen(0)
  }

  private tryOpen(attempt: number) {
    if (attempt >= 4) {
      this.emit('error', 'room-create-failed')
      return
    }
    const code = makeRoomCode()
    const peer = new Peer(ROOM_PREFIX + code)
    peer.on('open', () => {
      this.peer = peer
      this.code = code
      this.emit('open', code)
    })
    peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'unavailable-id') {
        peer.destroy()
        this.tryOpen(attempt + 1) // 코드 충돌 → 재발급
      } else if (!this.peer) {
        this.emit('error', err.type ?? 'network')
      }
    })
    peer.on('connection', (conn) => this.onConnection(conn))
  }

  private onConnection(conn: DataConnection) {
    conn.on('open', () => {
      if (this.inMatch || this.roster.length >= MAX_PLAYERS) {
        conn.send({ t: 'full' } satisfies HostMsg)
        setTimeout(() => conn.close(), 200)
        return
      }
    })
    conn.on('data', (raw) => this.onGuestMsg(conn, raw as GuestMsg))
    conn.on('close', () => {
      const idx = this.conns.indexOf(conn)
      if (idx > 0) {
        if (this.inMatch) {
          this.roster[idx].connected = false
        } else {
          this.roster.splice(idx, 1)
          this.conns.splice(idx, 1)
        }
        this.broadcastRoster()
      }
    })
  }

  private onGuestMsg(conn: DataConnection, msg: GuestMsg) {
    const idx = this.conns.indexOf(conn)
    switch (msg.t) {
      case 'hello': {
        if (idx > 0) return // 중복 hello
        if (this.inMatch || this.roster.length >= MAX_PLAYERS) return
        // 닉네임 중복 시 번호 부여 (Me, Me·2, Me·3 …)
        let name = msg.name.slice(0, 12) || '???'
        let suffix = 2
        while (this.roster.some((p) => p.name === name)) name = `${msg.name.slice(0, 9) || '???'}·${suffix++}`
        this.roster.push({ name, emoji: msg.emoji, isBot: false, connected: true })
        this.conns.push(conn)
        conn.send({
          t: 'joined',
          yourIndex: this.roster.length - 1,
          roster: this.roster,
          inMatch: this.inMatch,
        } satisfies HostMsg)
        this.broadcastRoster()
        break
      }
      case 'setPos':
        if (idx > 0 && msg.w === this.curW) this.guestPos[idx] = msg.pos
        break
      case 'lockIn':
        if (idx > 0 && msg.w === this.curW && !this.guestLocked[idx]) {
          this.guestPos[idx] = msg.pos
          this.guestLocked[idx] = true
          this.broadcast({ t: 'locked', playerId: idx })
          this.emit('locked', idx)
        }
        break
      case 'react':
        if (idx > 0) {
          this.broadcast({ t: 'react', playerId: idx, emoji: msg.emoji })
          this.emit('react', { playerId: idx, emoji: msg.emoji })
        }
        break
    }
  }

  broadcast(msg: HostMsg) {
    for (const c of this.conns) {
      if (c?.open) c.send(msg)
    }
  }

  private broadcastRoster() {
    this.broadcast({ t: 'roster', roster: this.roster })
    this.emit('roster', this.roster)
  }

  /** 매치 시작: 8인까지 봇 충원, 시드/차트 추첨은 App에서 받아 브로드캐스트 */
  startMatch(seed: number, chartIds: string[], speed: Speed): NetPlayer[] {
    const rng = mulberry32(seed ^ 0x51ed)
    const botsNeeded = Math.max(0, MAX_PLAYERS - this.roster.length)
    const botPool = shuffle(rng, BOTS).slice(0, botsNeeded)
    const full: NetPlayer[] = [
      ...this.roster,
      ...botPool.map((b) => ({ name: b.name, emoji: b.emoji, isBot: true, botKey: b.key, connected: true })),
    ]
    this.inMatch = true
    this.broadcast({ t: 'start', seed, chartIds, speed, roster: full })
    return full
  }

  /** 락 창 시작 — 게스트 입력 수집 초기화 + 페이즈 브로드캐스트 */
  beginLockWindow(chartIndex: number, w: number, durationMs: number) {
    this.curW = w
    this.guestPos = this.roster.map(() => null)
    this.guestLocked = this.roster.map((_, i) => i === 0 || !this.roster[i].connected)
    this.broadcast({ t: 'phase', chartIndex, w, durationMs })
  }

  /** 게스트 i의 이번 창 최종 포지션 (입력 없으면 null → 이전 포지션 유지) */
  guestPosOf(i: number): number | null {
    return this.guestPos[i] ?? null
  }

  /** 접속 중인 인간 전원이 조기 락인했는가 (호스트 본인 제외) */
  allGuestsLocked(): boolean {
    return this.guestLocked.every(Boolean)
  }

  noteHostLocked() {
    this.broadcast({ t: 'locked', playerId: 0 })
  }

  sendPlay(chartIndex: number, w: number, positions: number[]) {
    this.curW = -1
    this.broadcast({ t: 'play', chartIndex, w, positions })
  }

  sendNextChart(index: number) {
    this.broadcast({ t: 'nextChart', index })
  }

  sendRematch() {
    this.inMatch = false
    this.roster = this.roster.filter((p) => p.connected)
    this.conns = this.conns.filter((c, i) => i === 0 || c?.open)
    this.broadcast({ t: 'rematch' })
    this.broadcastRoster()
  }

  react(emoji: string) {
    this.reactAs(0, emoji)
  }

  /** 봇 리액션 등 임의 플레이어 명의의 리액션 (호스트 권위) */
  reactAs(playerId: number, emoji: string) {
    this.broadcast({ t: 'react', playerId, emoji })
    this.emit('react', { playerId, emoji })
  }

  dispose() {
    this.peer?.destroy()
  }
}

/** 게스트 — 호스트에 단일 연결, 수신 메시지를 이벤트로 노출 */
export class GuestSession extends Emitter {
  readonly mode = 'guest' as const
  myIndex = -1
  roster: NetPlayer[] = []
  /** phase 수신 시점 기준 락 마감 (performance.now() 기준) */
  lockDeadline = 0
  lockDurationMs = 0
  phaseChart = -1
  phaseW = -1
  private peer: Peer
  private conn: DataConnection | null = null

  constructor(code: string, name: string, emoji: string) {
    super()
    this.peer = new Peer()
    this.peer.on('open', () => {
      const conn = this.peer.connect(ROOM_PREFIX + code, { reliable: true })
      this.conn = conn
      const failTimer = setTimeout(() => {
        if (this.myIndex < 0) this.emit('error', 'join-timeout')
      }, 8000)
      conn.on('open', () => conn.send({ t: 'hello', name, emoji } satisfies GuestMsg))
      conn.on('data', (raw) => {
        clearTimeout(failTimer)
        this.onMsg(raw as HostMsg)
      })
      conn.on('close', () => {
        if (this.myIndex >= 0) this.emit('hostLeft')
      })
    })
    this.peer.on('error', (err: Error & { type?: string }) => {
      if (err.type === 'peer-unavailable') this.emit('error', 'room-not-found')
      else if (this.myIndex < 0) this.emit('error', err.type ?? 'network')
    })
  }

  private onMsg(msg: HostMsg) {
    switch (msg.t) {
      case 'joined':
        this.myIndex = msg.yourIndex
        this.roster = msg.roster
        this.emit('open')
        this.emit('roster', this.roster)
        break
      case 'full':
        this.emit('error', 'room-full')
        break
      case 'roster':
        this.roster = msg.roster
        this.emit('roster', this.roster)
        break
      case 'start':
        this.roster = msg.roster
        this.emit('start', msg)
        break
      case 'phase':
        this.phaseChart = msg.chartIndex
        this.phaseW = msg.w
        this.lockDurationMs = msg.durationMs
        this.lockDeadline = performance.now() + msg.durationMs
        this.emit('phase', msg)
        break
      case 'locked':
        this.emit('locked', msg.playerId)
        break
      case 'play':
        this.emit('play', msg)
        break
      case 'nextChart':
        this.emit('nextChart', msg.index)
        break
      case 'rematch':
        this.emit('rematch')
        break
      case 'react':
        this.emit('react', { playerId: msg.playerId, emoji: msg.emoji })
        break
    }
  }

  setPos(w: number, pos: number) {
    if (this.conn?.open) this.conn.send({ t: 'setPos', w, pos } satisfies GuestMsg)
  }

  lockIn(w: number, pos: number) {
    if (this.conn?.open) this.conn.send({ t: 'lockIn', w, pos } satisfies GuestMsg)
  }

  react(emoji: string) {
    if (this.conn?.open) this.conn.send({ t: 'react', emoji } satisfies GuestMsg)
  }

  dispose() {
    this.peer.destroy()
  }
}

export type Session = HostSession | GuestSession
