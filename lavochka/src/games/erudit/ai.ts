/* Эрудит — боты. Поиск ходов по строкам и столбцам: для каждой стартовой клетки слово растёт вправо (вниз),
 * беря стоящие буквы и кладя свои; отсечение — по префиксам словаря и по «поперечным» проверкам
 * (какие буквы можно положить в клетку, чтобы поперёк тоже вышло слово). Очки считает движок (evaluate).
 *   Лёгкий — берёт ход поскромнее; Средний — из лучших, но не всегда лучший;
 *   Сложный — лучший с поправкой на то, что остаётся на руке (звёздочку бережёт, гласные с согласными — вперемешку). */
import type { Rng } from '../../core/types';
import { ALPHABET, hasPrefix, hasWord } from '../../words/dict';
import { CENTER, evaluate, JOKER, N, tileSet, valueOf, type Action, type Place, type View } from './engine';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
export const tuning = { fast: !!env?.VITEST && !env?.SIM_GAMES };

export interface Found {
  tiles: Place[];
  points: number;
  words: string[];
}

const VOWELS = new Set('аеиоуыэюя');

export function findMoves(s: View, rack: string[], limit = Infinity): Found[] {
  const b = s.board;
  const empty = b.every((x) => !x);
  const out: Found[] = [];
  const seen = new Set<string>();
  const jokerLetters = tuning.fast ? 'аоеинтрск' : ALPHABET;
  const filled = (c: number) => !!b[c];
  const isAnchor = (c: number) => {
    if (empty) return c === CENTER;
    const r = Math.floor(c / N);
    const f = c % N;
    return (r > 0 && filled(c - N)) || (r < N - 1 && filled(c + N)) || (f > 0 && filled(c - 1)) || (f < N - 1 && filled(c + 1));
  };

  for (const dir of [1, N]) {
    const perp = dir === 1 ? N : 1;
    for (let L = 0; L < N; L++) {
      const line = [...Array(N).keys()].map((k) => (dir === 1 ? L * N + k : k * N + L));
      // поперечные проверки: null — поперёк ничего, можно любую букву
      const cross: (Set<string> | null)[] = line.map((c) => {
        if (filled(c)) return null;
        const r = Math.floor(c / N);
        const f = c % N;
        const [dr, df] = perp === 1 ? [0, 1] : [1, 0];
        let pre = '';
        for (let rr = r - dr, ff = f - df; rr >= 0 && ff >= 0 && filled(rr * N + ff); rr -= dr, ff -= df) pre = b[rr * N + ff]!.ch + pre;
        let suf = '';
        for (let rr = r + dr, ff = f + df; rr < N && ff < N && filled(rr * N + ff); rr += dr, ff += df) suf += b[rr * N + ff]!.ch;
        if (!pre && !suf) return null;
        const ok = new Set<string>();
        for (const ch of ALPHABET) if (hasWord(pre + ch + suf)) ok.add(ch);
        return ok;
      });
      const anchor = line.map((c) => !filled(c) && isAnchor(c));
      // ближайшая «зацепка» (якорь или стоящая буква) справа от k
      const reach = Array(N + 1).fill(Infinity);
      for (let k = N - 1; k >= 0; k--) reach[k] = anchor[k] || filled(line[k]) ? 0 : reach[k + 1] + 1;

      const left = rack.slice();
      const placed: Place[] = [];
      const extend = (pos: number, word: string, touched: boolean) => {
        if (out.length >= limit) return;
        if (pos < N && filled(line[pos])) {
          const w = word + b[line[pos]]!.ch;
          if (!hasPrefix(w)) return;
          extend(pos + 1, w, true);
          return;
        }
        if (placed.length && touched && word.length >= 2 && hasWord(word)) {
          const key = placed.map((p) => `${p.cell}${p.letter}${p.as ?? ''}`).sort().join(',');
          if (!seen.has(key)) {
            seen.add(key);
            const v = evaluate(s, placed, rack);
            if (v.ok) out.push({ tiles: placed.map((p) => ({ ...p })), points: v.score.points, words: v.score.words.map((w) => w.word) });
          }
        }
        if (pos >= N || !left.length) return;
        const cell = line[pos];
        const allowed = cross[pos];
        const tried = new Set<string>();
        for (let i = 0; i < left.length; i++) {
          const t = left[i];
          if (tried.has(t)) continue;
          tried.add(t);
          const opts = t === JOKER ? jokerLetters : t;
          for (const ch of opts) {
            if (allowed && !allowed.has(ch)) continue;
            const w = word + ch;
            if (!hasPrefix(w)) continue;
            left.splice(i, 1);
            placed.push(t === JOKER ? { cell, letter: JOKER, as: ch } : { cell, letter: t });
            extend(pos + 1, w, touched || anchor[pos]);
            placed.pop();
            left.splice(i, 0, t);
          }
        }
      };
      for (let k = 0; k < N; k++) {
        if (k > 0 && filled(line[k - 1])) continue;
        if (reach[k] >= rack.length && !filled(line[k])) continue;
        extend(k, '', false);
      }
    }
  }
  return out;
}

/** Что остаётся на руке: звёздочку жалко, гласные и согласные — лучше поровну, дорогие одиночки — обуза. */
function leave(s: View, rack: string[], used: Place[]): number {
  const rest = rack.slice();
  for (const p of used) rest.splice(rest.indexOf(p.letter), 1);
  let v = 0;
  const jokers = rest.filter((x) => x === JOKER).length;
  v += jokers * 7;
  const letters = rest.filter((x) => x !== JOKER);
  const vow = letters.filter((x) => VOWELS.has(x)).length;
  v -= Math.abs(vow - (letters.length - vow)) * 1.5;
  for (const ch of letters) if (valueOf(s.cfg, ch) >= 8) v -= 2;
  const dup = letters.length - new Set(letters).size;
  v -= dup * 1.5;
  return v;
}

/** Какие фишки сменить: дорогие, повторы, перекос гласных. */
function swapPick(s: View, rack: string[]): string[] {
  const out: string[] = [];
  const keep = new Set<string>();
  for (const ch of rack) {
    if (ch === JOKER) continue;
    if (valueOf(s.cfg, ch) >= 5 || keep.has(ch)) out.push(ch);
    else keep.add(ch);
  }
  return out.length ? out : rack.filter((x) => x !== JOKER).slice(0, 3);
}

export function choose(s: View, seat: number, level: number, rng: Rng): Action {
  const i = s.seats.indexOf(seat);
  const rack = s.racks[i] ?? [];
  const moves = findMoves(s, rack, tuning.fast ? 400 : Infinity);
  const canSwap = s.bagCount >= tileSet(s.cfg).rack;
  if (!moves.length) {
    if (canSwap && rack.length) return { type: 'swap', letters: swapPick(s, rack) };
    return { type: 'pass' };
  }
  moves.sort((a, b) => b.points - a.points);
  const play = (m: Found): Action => ({ type: 'play', tiles: m.tiles });
  if (level <= 0) {
    const low = moves.filter((m) => m.points <= Math.max(8, moves[0].points / 3));
    return play(low[rng.int(low.length)] ?? moves[moves.length - 1]);
  }
  if (level === 1) {
    const top = moves.slice(0, Math.max(1, Math.ceil(moves.length * 0.25)));
    return play(top[rng.int(Math.min(top.length, 5))]);
  }
  let best = moves[0];
  let bestV = -Infinity;
  for (const m of moves.slice(0, 60)) {
    const v = m.points + (s.bagCount > 0 ? leave(s, rack, m.tiles) : 0);
    if (v > bestV) {
      bestV = v;
      best = m;
    }
  }
  if (best.points < 6 && canSwap && s.bagCount > 20) return { type: 'swap', letters: swapPick(s, rack) };
  return play(best);
}
