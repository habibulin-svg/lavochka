/* Сеть ГОПС: лок-степ через ретранслятор (docs/gops/CODE.md). Сервер физику не считает — он ведёт часы кадров,
 * ставит на ввод мест номер кадра и рассылает всем; каждый браузер считает мир сам от общего сида.
 * Боты считаются в каждом браузере одинаково (их rng — от сида), по сети от них ничего не идёт. */
import type { Input } from '../sim/world';

/** Кто ведёт бригаду: хозяин (за его экраном), сетевой игрок, бот. */
export type NetWho = 'host' | 'net' | 'easy' | 'medium' | 'hard';

export interface NetSide {
  brigade: string;
  who: NetWho;
  count: number;
}

/** Настройка партии — та же, что у быстрого боя, плюс уровень (конкретный, не «случайная»). */
export interface NetSetup {
  level: string;
  sides: NetSide[];
  arsenal: 'full' | 'core';
  hp: number;
  turn: number;
  wind: number;
  sudden: boolean;
  crates: boolean;
}

export interface NetPeer {
  id: number;
  name: string;
  /** Бригада, которую он ведёт (у хозяина — все 'host'); null — смотрит. */
  side: number | null;
  host: boolean;
}

/** Удерживаемое (что зажато сейчас) и разовое (прыжок, оружие, таймер, точка) — по отдельности. */
export type Held = Pick<Input, 'move' | 'aim' | 'fire'>;
export type Once = Omit<Input, 'move' | 'aim' | 'fire'>;

export type NetClientMsg =
  | { t: 'create'; game: 'gops'; name: string; setup: NetSetup }
  | { t: 'join'; game: 'gops'; code: string; name: string }
  /** Хозяин меняет настройку в лобби. */
  | { t: 'setup'; setup: NetSetup }
  /** Гость садится за бригаду 'net' (или встаёт: null). */
  | { t: 'claim'; side: number | null }
  | { t: 'start' }
  /** Ввод бригады: held — когда изменилось, once — разовое (уйдёт в ближайший кадр, по одному на кадр). */
  | { t: 'in'; side: number; held?: Held; once?: Once }
  /** Хеш мира в начале хода номер turn — для сверки. */
  | { t: 'hash'; turn: number; h: number }
  | { t: 'ping' };

/** Кадр: [номер кадра, бригада, ввод] — только непустые. */
export type FrameIn = [number, number, Input];

export type NetServerMsg =
  | { t: 'created'; code: string }
  | { t: 'joined'; code: string }
  | { t: 'error'; text: string }
  | { t: 'lobby'; setup: NetSetup; peers: NetPeer[]; you: number }
  | { t: 'start'; setup: NetSetup; seed: number }
  /** Кадры до upto (не включая) готовы; ins — ввод в них. */
  | { t: 'f'; upto: number; ins: FrameIn[] }
  | { t: 'desync'; turn: number }
  | { t: 'left'; name: string }
  | { t: 'pong' };

export const FRAME_MS = 1000 / 60;
/** Рассылать кадры пачкой не чаще, чем раз в столько мс. */
export const BATCH_MS = 50;

/** Пустой ли ввод (такие кадры не шлём). */
export function emptyInput(i: Input): boolean {
  return !i.move && !i.aim && !i.fire && !i.jump && !i.weapon && !i.fuse && !i.target;
}

/** Проверка ввода из сети: только известные поля и разумные значения. */
export function cleanInput(raw: unknown): Input {
  const r = (raw ?? {}) as Record<string, unknown>;
  const tri = (v: unknown) => (v === 1 || v === -1 ? v : 0) as -1 | 0 | 1;
  const out: Input = {};
  if (tri(r.move)) out.move = tri(r.move);
  if (tri(r.aim)) out.aim = tri(r.aim);
  if (r.fire === true) out.fire = true;
  if (r.jump === 1 || r.jump === 2) out.jump = r.jump;
  if (typeof r.weapon === 'string' && /^[a-z-]{2,20}$/.test(r.weapon)) out.weapon = r.weapon;
  if (typeof r.fuse === 'number' && r.fuse >= 1 && r.fuse <= 5) out.fuse = Math.floor(r.fuse);
  if (Array.isArray(r.target) && r.target.length === 2 && r.target.every((v) => typeof v === 'number' && Math.abs(v) < 10000))
    out.target = [Math.round(r.target[0] as number), Math.round(r.target[1] as number)];
  return out;
}

export function cleanSetup(raw: unknown): NetSetup | null {
  const r = raw as NetSetup;
  if (!r || typeof r.level !== 'string' || !/^[a-z0-9]{2,6}$/.test(r.level) || !Array.isArray(r.sides)) return null;
  if (r.sides.length < 2 || r.sides.length > 4) return null;
  const who: NetWho[] = ['host', 'net', 'easy', 'medium', 'hard'];
  const sides = r.sides.map((s) => ({
    brigade: String(s?.brigade ?? '').slice(0, 20),
    who: who.includes(s?.who) ? s.who : 'net',
    count: Math.max(1, Math.min(8, Math.floor(Number(s?.count) || 4))),
  }));
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && v >= lo && v <= hi ? v : d);
  return {
    level: r.level, sides, arsenal: r.arsenal === 'core' ? 'core' : 'full', hp: num(r.hp, 10, 300, 100), turn: num(r.turn, 10, 120, 45),
    wind: num(r.wind, 0, 1, 1), sudden: r.sudden !== false, crates: r.crates !== false,
  };
}
