/* Запись сетевой партии карты: мир на старте и после каждого шага — разница с прошлым (JSON-заплатки).
 * Пишет сервер (`MapRoom`), по ней же смотрят зрители (с задержкой в день) и проигрыватель записей.
 * Мир — чистый JSON, так что разница считается по полям; массивы — по элементам и длине. */
import type { GenOptions } from '../sim/adv/gen';
import type { AdvEvent, World } from '../sim/adv/world';
import type { MapSeatView } from './mapproto';

/** Заплатка: путь и новое значение; `undefined` (нет поля в JSON) — удалить; путь кончается на 'length' у массива — обрезать. */
export type Op = [path: (string | number)[], value?: unknown];

export interface RecStep {
  /** Кто сходил (−1 — никто: смена дня, часы). */
  actor: number;
  /** День мира после шага. */
  day: number;
  ev: AdvEvent[];
  d: Op[];
}

export interface MapRecord {
  v: 1;
  gen: GenOptions;
  seats: MapSeatView[];
  /** Когда началась (мс от эпохи). */
  at: number;
  world: World;
  steps: RecStep[];
}

const clone = <T>(x: T): T => (x === undefined ? x : (JSON.parse(JSON.stringify(x)) as T));

/** Что поменялось от `a` к `b`. */
export function diffJson(a: unknown, b: unknown, path: (string | number)[] = [], out: Op[] = []): Op[] {
  if (a === b) return out;
  const oa = typeof a === 'object' && a !== null;
  const ob = typeof b === 'object' && b !== null;
  if (!oa || !ob || Array.isArray(a) !== Array.isArray(b)) {
    out.push(b === undefined ? [path] : [path, clone(b)]);
    return out;
  }
  if (Array.isArray(a)) {
    const y = b as unknown[];
    const n = Math.min(a.length, y.length);
    for (let i = 0; i < n; i++) diffJson(a[i], y[i], [...path, i], out);
    if (y.length < a.length) out.push([[...path, 'length'], y.length]);
    for (let i = n; i < y.length; i++) out.push([[...path, i], clone(y[i])]);
    return out;
  }
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const k of Object.keys(x)) if (!(k in y) || y[k] === undefined) {
    if (x[k] !== undefined) out.push([[...path, k]]);
  }
  for (const k of Object.keys(y)) if (y[k] !== undefined) diffJson(x[k], y[k], [...path, k], out);
  return out;
}

/** Наложить заплатки на `root` (меняет его); возвращает корень (мог смениться целиком). */
export function patchJson<T>(root: T, ops: Op[]): T {
  let r: unknown = root;
  for (const [path, value] of ops) {
    if (!path.length) {
      r = clone(value);
      continue;
    }
    let o = r as Record<string | number, unknown>;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]] as Record<string | number, unknown>;
    const k = path[path.length - 1];
    if (k === 'length' && Array.isArray(o)) o.length = value as number;
    else if (value === undefined) {
      if (Array.isArray(o)) o[k as number] = undefined;
      else delete o[k];
    } else o[k] = clone(value);
  }
  return r as T;
}
