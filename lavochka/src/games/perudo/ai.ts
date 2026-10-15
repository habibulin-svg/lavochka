/* Перудо — боты. Видят свои кости и все заявки. Считают вероятность, что на столе не меньше N граней (биномиально по чужим костям).
 *   Лёгкий — повышает на самую малую ставку своей частой гранью, «не верит» наугад, когда заявка кажется большой;
 *   Средний — выбирает самое вероятное повышение, не верит, если заявка правдива меньше чем на 40 %;
 *   Сложный — то же точнее, учитывает, на что заявлял предыдущий (его грань вероятнее), иногда блефует и говорит «точно!». */
import type { Rng } from '../../core/types';
import { calzaAllowed, minBid, totalDice, validBid, wild, type Action, type State } from './engine';

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** P(X >= need), X ~ Bin(n, p). */
function tail(n: number, p: number, need: number): number {
  if (need <= 0) return 1;
  if (need > n) return 0;
  let s = 0;
  for (let k = need; k <= n; k++) s += binom(n, k) * p ** k * (1 - p) ** (n - k);
  return s;
}

function exact(n: number, p: number, k: number): number {
  if (k < 0 || k > n) return 0;
  return binom(n, k) * p ** k * (1 - p) ** (n - k);
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const mine = s.dice[seat];
  const unknown = totalDice(s) - mine.length;
  const w = wild(s);
  const pFace = (face: number) => (w && face !== 1 ? 1 / 3 : 1 / 6);
  const own = (face: number) => mine.filter((x) => x === face || (w && face !== 1 && x === 1)).length;
  // сложный: предыдущий, скорее всего, заявлял то, что у него есть
  const hint = (face: number) => (level === 2 && s.bid && s.bid.face === face && s.bid.seat !== seat ? 0.6 : 0);
  const prob = (n: number, face: number) => tail(unknown, pFace(face), Math.ceil(n - own(face) - hint(face)));

  const cur = s.bid;
  const pCur = cur ? prob(cur.n, cur.face) : 1;
  // кандидаты на повышение: для каждой грани — наименьшее и на одну больше
  const cands: { n: number; face: number; p: number }[] = [];
  for (let face = 1; face <= 6; face++) {
    const n0 = minBid(s, face);
    if (!n0) continue;
    for (const n of [n0, n0 + 1]) if (validBid(s, n, face)) cands.push({ n, face, p: prob(n, face) });
  }
  cands.sort((a, b) => b.p - a.p || a.n - b.n);
  const best = cands[0];

  if (level === 0) {
    if (cur && (pCur < 0.3 || (pCur < 0.6 && rng.next() < 0.3))) return { type: 'dudo' };
    if (!best) return { type: 'dudo' };
    // своя частая грань, наименьшим числом
    const fav = [2, 3, 4, 5, 6].sort((a, b) => own(b) - own(a))[0];
    const n = minBid(s, fav);
    return n ? { type: 'bid', n, face: fav } : { type: 'bid', n: best.n, face: best.face };
  }
  if (cur) {
    if (level === 2 && calzaAllowed(s)) {
      const pe = exact(unknown, pFace(cur.face), cur.n - own(cur.face));
      if (pe > 0.32) return { type: 'calza' };
    }
    const doubt = level === 2 ? 0.42 : 0.4;
    if (pCur < doubt && (!best || best.p < pCur + 0.25)) return { type: 'dudo' };
  }
  if (!best || best.p < 0.2) return cur ? { type: 'dudo' } : { type: 'bid', n: 1, face: 2 };
  // сложный изредка блефует: заявляет грань, которой у него мало, если вероятность приемлемая
  if (level === 2 && rng.next() < 0.12) {
    const alt = cands.find((c) => c.p > 0.45 && own(c.face) === 0);
    if (alt) return { type: 'bid', n: alt.n, face: alt.face };
  }
  return { type: 'bid', n: best.n, face: best.face };
}
