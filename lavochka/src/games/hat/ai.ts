/* Шляпа — боты. Голосом бот не объясняет и не слышит, поэтому честно играет подсказками из словаря:
 * объясняющий даёт их по очереди (подробно → коротко → одним словом), угадывающий перебирает в уме слова, подходящие к подсказке.
 * Знает ли бот слово — дело случая: чем проще слово и подробнее подсказка, тем вернее; в следующих кругах слова уже знакомые.
 * Уровень — скорость, точность и сколько слов успевает. Пара ботов играет в условном времени (dt), бот в паре с человеком — по настоящим часам.
 * Видит только свой view. */
import type { Rng } from '../../core/types';
import { LAST_MS, LAST_TYPE_MS, type Action, type View } from './engine';
import { byHint, norm, WORDS, type HintKind } from './words';

/** Вероятность узнать слово по одной подсказке: [уровень][вид подсказки]. */
const KNOW: Record<HintKind, number[]> = { long: [0.55, 0.75, 0.9], short: [0.4, 0.62, 0.82], one: [0.3, 0.5, 0.7] };
const DIFF = [1, 1, 0.8, 0.6];
/** Сколько думает над подсказкой (мс): [уровень] → [от, до]. */
const EXPLAIN_MS = [
  [3500, 6500],
  [2500, 4500],
  [1600, 3200],
];
const GUESS_MS = [
  [1800, 4200],
  [1200, 3000],
  [700, 2000],
];

const between = ([a, b]: number[], rng: Rng) => Math.round(a + (b - a) * rng.next());
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)));

/** Когда бот впервые увидел ход / подсказку (по своим часам — без расхождения часов разных устройств). */
const firstSeen = new Map<string, number>();
const seenAt = (key: string) => {
  if (!firstSeen.has(key)) {
    if (firstSeen.size > 2000) firstSeen.clear();
    firstSeen.set(key, Date.now());
  }
  return firstSeen.get(key)!;
};

/** Догадка по последней подсказке: верное слово (если узнал), промах или ничего. */
function guessFor(v: View, seat: number, level: number, rng: Rng): string | null {
  const h = v.hints[v.hints.length - 1];
  if (!h) return null;
  const tried = new Set(v.tries.filter((t) => t.seat === seat).map((t) => norm(t.text)));
  let cands = byHint(h.kind, h.text).map((i) => WORDS[i]);
  // в следующих кругах слова знакомые: ищем среди угаданных в прошлых кругах
  if (v.round > 0 && v.seenI.length) {
    const known = new Set(v.seenI);
    const inSeen = byHint(h.kind, h.text).filter((i) => known.has(i));
    if (inSeen.length) cands = inSeen.map((i) => WORDS[i]);
  }
  cands = cands.filter((e) => !tried.has(e.n));
  const d = cands.length ? Math.max(...cands.map((e) => e.d)) : 2;
  let p = KNOW[h.kind][level] * DIFF[d];
  if (v.round > 0) p = Math.min(0.97, p + 0.25);
  // несколько подсказок вместе — понятнее
  p = Math.min(0.97, p + 0.08 * (v.hints.length - 1));
  if (cands.length && rng.next() < p) return cands[rng.int(cands.length)].w;
  // не узнал: иногда называет что-то не то
  if (rng.next() < 0.45 - 0.1 * level) {
    const pool = v.round > 0 && v.seenW.length ? v.seenW : WORDS.filter((e) => e.d <= d).map((e) => e.w);
    for (let k = 0; k < 10; k++) {
      const w = pool[rng.int(pool.length)];
      if (!tried.has(norm(w))) return w;
    }
  }
  return null;
}

/** Пара ботов: ход за тем, кого ждёт движок; каждое действие говорит, сколько заняло. */
function virtual(v: View, seat: number, level: number, rng: Rng): Action {
  if (v.phase === 'last') {
    const g = guessFor(v, seat, level, rng);
    return g ? { type: 'guess', text: g } : { type: 'pass' };
  }
  if (seat === v.exp) {
    if (v.hintsLeft > 0) return { type: 'hint', dt: between(EXPLAIN_MS[level], rng) };
    // подсказки кончились: пропустить (если можно) или дотянуть время
    if (v.skip !== 'off' && (v.skip === 'free' || level < 2 || v.time - v.used > 8000)) return { type: 'skip', dt: between([800, 2000], rng) };
    return { type: 'stall' };
  }
  const g = guessFor(v, seat, level, rng);
  const dt = between(GUESS_MS[level], rng);
  return g ? { type: 'guess', text: g, dt } : { type: 'pass', dt };
}

/** Бот в паре с человеком: ждёт по настоящим часам своего следующего дела (подсказка, догадка, конец времени). */
async function real(v: View, seat: number, level: number, rng: Rng): Promise<Action | null> {
  const turn = `${v.gid}:${v.t}`;
  const start = seenAt(turn + ':start');
  const deadline = start + v.time + 1500;
  if (v.phase === 'last') {
    const at = seenAt(`${turn}:last`);
    if (seat === v.gue) {
      const g = guessFor(v, seat, level, rng);
      await sleep(Math.min(LAST_MS - 500, between(GUESS_MS[level], rng) / 2));
      return g ? { type: 'guess', text: g } : { type: 'nope' };
    }
    await sleep(at + LAST_TYPE_MS + 1500 - Date.now());
    return { type: 'nope' };
  }
  const word = `${turn}:${v.seq}`;
  if (seat === v.exp) {
    // объясняет человеку: подсказки с паузами, потом пропуск или ждёт конца времени
    const shown = seenAt(`${word}:${v.hints.length}`);
    const gap = v.hints.length ? between(EXPLAIN_MS[level], rng) + 4000 : 900;
    let next: Action | null = null;
    let at = deadline;
    if (v.hintsLeft > 0) {
      next = { type: 'hint' };
      at = shown + gap;
    } else if (v.skip !== 'off') {
      next = { type: 'skip' };
      at = shown + gap + 3000;
    }
    if (!next || at >= deadline) {
      await sleep(deadline - Date.now());
      return { type: 'timeup' };
    }
    await sleep(at - Date.now());
    return next;
  }
  // угадывает за человеком: отвечает на свежую подсказку, иначе ждёт конца времени
  const key = `${word}:${v.hints.length}`;
  if (v.hints.length && !answered.has(key)) {
    const shown = seenAt(key);
    const g = guessFor(v, seat, level, rng);
    await sleep(shown + between(GUESS_MS[level], rng) + 600 - Date.now());
    answered.add(key);
    if (g) return { type: 'guess', text: g };
  }
  await sleep(deadline - Date.now());
  return { type: 'timeup' };
}
const answered = new Set<string>();

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null | Promise<Action | null> {
  switch (v.phase) {
    case 'ready':
      return { type: 'start' };
    case 'review':
      return { type: 'next' };
    case 'explain':
    case 'last':
      if (seat !== v.exp && seat !== v.gue) return null;
      return v.virt ? virtual(v, seat, level, rng) : real(v, seat, level, rng);
    default:
      return null;
  }
}
