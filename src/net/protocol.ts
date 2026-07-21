import { Speed } from '../App'

/** 로스터 항목 — PlayerMeta의 네트워크 표현 */
export interface NetPlayer {
  name: string
  emoji: string
  isBot: boolean
  botKey?: string
  /** 인간 플레이어의 접속 상태 (끊기면 마지막 포지션 유지) */
  connected: boolean
}

/** 호스트 → 게스트 */
export type HostMsg =
  | { t: 'joined'; yourIndex: number; roster: NetPlayer[]; inMatch: boolean }
  | { t: 'roster'; roster: NetPlayer[] }
  | { t: 'start'; seed: number; chartIds: string[]; speed: Speed; roster: NetPlayer[] }
  | { t: 'phase'; chartIndex: number; w: number; durationMs: number }
  | { t: 'locked'; playerId: number }
  | { t: 'play'; chartIndex: number; w: number; positions: number[] }
  | { t: 'nextChart'; index: number } // index === 6 → 최종 시상식
  | { t: 'rematch' }
  | { t: 'react'; playerId: number; emoji: string }
  | { t: 'full' }

/** 게스트 → 호스트 */
export type GuestMsg =
  | { t: 'hello'; name: string; emoji: string }
  | { t: 'setPos'; w: number; pos: number }
  | { t: 'lockIn'; w: number; pos: number }
  | { t: 'react'; emoji: string }

export const ROOM_PREFIX = 'chart-party-v1-'

/** 방 코드: 헷갈리는 글자(0/O, 1/I) 제외 4자 */
export function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)]
  return code
}

export function normalizeRoomCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
}
