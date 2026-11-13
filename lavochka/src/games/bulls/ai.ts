/* Быки и коровы — боты. Загадывает бот случайный код. Разгадывает — отбором: из всех возможных кодов оставляет те,
 * что дали бы такие же ответы на все его прошлые попытки, и называет один из них.
 *   Лёгкий — часто называет просто случайный код, не сверяясь с ответами;
 *   Средний — случайный из подходящих;
 *   Сложный — из подходящих тот, что в среднем сильнее всего сужает круг (оценка по выборке). */
import type { Rng } from '../../core/types';
import { randomCode, score, toAct, type Action, type Cfg, type State, type Try } from './engine';

/** Все коды по настройкам (перебор kinds^len с отсевом повторов). */
function allCodes(c: Cfg): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = () => {
    if (cur.length === c.len) {
      out.push(cur.slice());
      return;
    }
    for (let k = 0; k < c.kinds; k++) {
      if (!c.repeats && cur.includes(k)) continue;
      cur.push(k);
      rec();
      cur.pop();
    }
  };
  rec();
  return out;
}

const cache = new Map<string, number[][]>();
function codesFor(c: Cfg): number[][] {
  const key = `${c.len}/${c.kinds}/${c.repeats}`;
  let v = cache.get(key);
  if (!v) cache.set(key, (v = allCodes(c)));
  return v;
}

/** Пространство больше этого не материализуем (10^6 кодов — сотни МБ и долгий отбор на каждый ход). */
const BIG = 100000;
const LEFT_CAP = 3000;

function consistent(c: Cfg, tries: Try[], rng: Rng): number[][] {
  const ok = (code: number[]) =>
    tries.every((t) => {
      const [b, w] = score(code, t.code, c.kinds);
      return b === t.bulls && w === t.cows;
    });
  if (c.kinds ** c.len <= BIG) return codesFor(c).filter(ok);
  // большое пространство: идём по кодам по кругу со случайного места и берём первые подходящие
  const total = c.kinds ** c.len;
  const start = rng.int(total);
  const out: number[][] = [];
  const code = new Array<number>(c.len);
  for (let i = 0; i < total && out.length < LEFT_CAP; i++) {
    let x = (start + i) % total;
    for (let j = c.len - 1; j >= 0; j--) {
      code[j] = x % c.kinds;
      x = Math.floor(x / c.kinds);
    }
    if (!c.repeats && new Set(code).size !== c.len) continue;
    if (ok(code)) out.push(code.slice());
  }
  return out;
}

function pick<T>(a: T[], rng: Rng): T {
  return a[rng.int(a.length)];
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (!toAct(s).includes(seat)) return null;
  const c = s.cfg;
  if (s.phase === 'secret') return { type: 'secret', code: randomCode(c, rng) };
  const tries = s.tries[seat];
  if (!tries.length || (level === 0 && rng.next() < 0.45)) return { type: 'guess', code: randomCode(c, rng) };
  const left = consistent(c, tries, rng);
  if (!left.length) return { type: 'guess', code: randomCode(c, rng) };
  if (level < 2 || left.length <= 2) return { type: 'guess', code: pick(left, rng) };
  // сложный: какая из подходящих попыток дробит выборку возможных кодов на самые мелкие кучки
  const sample = (k: number) => (left.length <= k ? left : Array.from({ length: k }, () => pick(left, rng)));
  const guesses = sample(50);
  const secrets = sample(250);
  let best = guesses[0];
  let bv = Infinity;
  for (const g of guesses) {
    const buckets = new Map<number, number>();
    for (const t of secrets) {
      const [b, w] = score(t, g, c.kinds);
      const k = b * 16 + w;
      buckets.set(k, (buckets.get(k) ?? 0) + 1);
    }
    let e = 0;
    for (const v of buckets.values()) e += v * v;
    if (e < bv) {
      bv = e;
      best = g;
    }
  }
  return { type: 'guess', code: best };
}
