/* Покер: таблицы префлопа для ботов (запускать заранее, результат — src/games/poker/data/preflop.json).
 *   npx tsx tools/poker/preflop.ts [розыгрышей на пару классов, по умолчанию 400]
 * 1. Шансы каждого из 169 классов стартовых рук холдема против каждого (розыгрыш наугад) → порядок рук по силе:
 *    против двух случайных рук (так важнее одномастные и связанные) плюс половина шансов против одной, парам — надбавка за сет.
 * 2. Пуш/фолд по Нэшу без ICM и без анте (блайнды 0,5/1): игрок, перед которым все сбросили, с k соперниками позади
 *    идёт ва-банк или сбрасывает; позади — по очереди колл или пас (первый колл — дальше все пас, оверколлы не считаем).
 *    Равновесие — фиктивной игрой (лучшие ответы, усреднение). k = 1 — малый блайнд против большого (он же хедз-ап).
 *    В таблицу — для каждой руки самый большой стек (в ББ, до 20), при котором ва-банк/колл ещё верен. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Card, Suit } from '../../src/cards/deck';
import { CLASSES, classCombos, fastHigh } from '../../src/games/poker/eval';

const M = Number(process.argv[2] || 400);
const SUITS: Suit[] = ['S', 'C', 'D', 'H'];
const RV: Record<string, number> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
const rv = (ch: string) => RV[ch] ?? Number(ch);
const K = CLASSES.length;

let seed = 12345;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
};
const ri = (n: number) => Math.floor(rnd() * n);

const id = (c: Card) => c.r * 4 + SUITS.indexOf(c.s);
const DECK: Card[] = SUITS.flatMap((s) => Array.from({ length: 13 }, (_, i) => ({ s, r: i + 2 })));

/** Случайное сочетание класса, не задевающее занятые карты. */
function combo(label: string, used: Set<number>): Card[] | null {
  const a = rv(label[0]);
  const b = rv(label[1]);
  for (let t = 0; t < 30; t++) {
    const s1 = SUITS[ri(4)];
    let s2 = SUITS[ri(4)];
    if (label.length === 3 && label[2] === 's') s2 = s1;
    else if (s1 === s2) continue;
    const c1 = { s: s1, r: a };
    const c2 = { s: s2, r: b };
    if (used.has(id(c1)) || used.has(id(c2))) continue;
    return [c1, c2];
  }
  return null;
}

function board(used: Set<number>, n: number): Card[] {
  const out: Card[] = [];
  while (out.length < n) {
    const c = DECK[ri(52)];
    if (used.has(id(c))) continue;
    used.add(id(c));
    out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------- шансы класс против класса

const t0 = Date.now();
const EQ = new Float64Array(K * K);
for (let i = 0; i < K; i++)
  for (let j = i; j < K; j++) {
    let win = 0;
    let n = 0;
    for (let m = 0; m < M; m++) {
      const used = new Set<number>();
      const h1 = combo(CLASSES[i], used);
      if (!h1) continue;
      h1.forEach((c) => used.add(id(c)));
      const h2 = combo(CLASSES[j], used);
      if (!h2) continue;
      h2.forEach((c) => used.add(id(c)));
      const b = board(used, 5);
      const v1 = fastHigh([...h1, ...b]);
      const v2 = fastHigh([...h2, ...b]);
      win += v1 > v2 ? 1 : v1 === v2 ? 0.5 : 0;
      n++;
    }
    const e = n ? win / n : 0.5;
    EQ[i * K + j] = e;
    EQ[j * K + i] = i === j ? 0.5 : 1 - e;
  }
console.log(`шансы класс против класса: ${((Date.now() - t0) / 1000).toFixed(1)} с`);

// ---------------------------------------------------------------- порядок рук: против двух случайных

const eq2 = CLASSES.map((label) => {
  let s = 0;
  const T = 6000;
  for (let m = 0; m < T; m++) {
    const used = new Set<number>();
    const h = combo(label, used)!;
    h.forEach((c) => used.add(id(c)));
    const o1 = board(used, 2);
    const o2 = board(used, 2);
    const b = board(used, 5);
    const v = fastHigh([...h, ...b]);
    const a1 = fastHigh([...o1, ...b]);
    const a2 = fastHigh([...o2, ...b]);
    const top = Math.max(v, a1, a2);
    if (v === top) s += 1 / ((a1 === top ? 1 : 0) + (a2 === top ? 1 : 0) + 1);
  }
  return s / T;
});
const W = CLASSES.map(classCombos);
// против одной случайной (из таблицы) — чтобы не занизить пары и тузы против узкого поля
const eq1 = CLASSES.map((_, i) => CLASSES.reduce((s, __, j) => s + EQ[i * K + j] * W[j], 0) / 1326);
// пары ещё и ловят сет (выигрыш потом, которого розыгрыш до конца не видит)
const score = CLASSES.map((l, i) => eq2[i] + eq1[i] / 2 + (l.length === 2 ? 0.035 : 0));
const order = CLASSES.map((_, i) => i).sort((a, b) => score[b] - score[a]);
/** Доля сочетаний сильнее руки (плюс половина своих): 0 — лучшая, 1 — худшая. */
const pct = new Array<number>(K);
let acc = 0;
for (const i of order) {
  pct[i] = +((acc + W[i] / 2) / 1326).toFixed(4);
  acc += W[i];
}

// ---------------------------------------------------------------- пуш/фолд по Нэшу

const STACKS = Array.from({ length: 20 }, (_, i) => i + 1);
const ITER = 150;

/** Шансы каждой руки против диапазона r (доли каждого класса), с весами сочетаний. */
function vsRange(r: Float64Array, out: Float64Array) {
  let tot = 0;
  for (let j = 0; j < K; j++) tot += r[j] * W[j];
  for (let i = 0; i < K; i++) {
    let s = 0;
    for (let j = 0; j < K; j++) s += EQ[i * K + j] * r[j] * W[j];
    out[i] = tot > 0 ? s / tot : 0.5;
  }
}
const share = (r: Float64Array) => {
  let s = 0;
  for (let j = 0; j < K; j++) s += r[j] * W[j];
  return s / 1326;
};

/** Равновесие для игрока с k соперниками позади при стеке S: диапазон ва-банка и диапазоны колла по очереди. */
function solve(k: number, S: number): { push: Float64Array; call: Float64Array[] } {
  const postedP = k === 1 ? 0.5 : 0;
  const posted = Array.from({ length: k }, (_, i) => (i === k - 1 ? 1 : i === k - 2 ? 0.5 : 0));
  const D = 1.5;
  const push = new Float64Array(K).fill(0.5);
  const call = posted.map(() => new Float64Array(K).fill(0.3));
  const eqP = new Float64Array(K);
  const eqC = posted.map(() => new Float64Array(K));
  for (let t = 1; t <= ITER; t++) {
    vsRange(push, eqP);
    call.forEach((c, i) => vsRange(c, eqC[i]));
    const cs = call.map(share);
    // лучший ответ того, кто идёт ва-банк
    const brP = new Float64Array(K);
    for (let h = 0; h < K; h++) {
      let ev = 0;
      let reach = 1;
      for (let i = 0; i < k; i++) {
        const pot = 2 * S + (D - postedP - posted[i]);
        ev += reach * cs[i] * (eqC[i][h] * pot - S);
        reach *= 1 - cs[i];
      }
      ev += reach * (D - postedP);
      brP[h] = ev > -postedP ? 1 : 0;
    }
    // лучшие ответы коллирующих
    const brC = posted.map((b, i) => {
      const pot = 2 * S + (D - postedP - b);
      const r = new Float64Array(K);
      for (let h = 0; h < K; h++) r[h] = eqP[h] * pot - S > -b ? 1 : 0;
      return r;
    });
    const a = 1 / (t + 1);
    for (let h = 0; h < K; h++) push[h] += (brP[h] - push[h]) * a;
    call.forEach((c, i) => {
      for (let h = 0; h < K; h++) c[h] += (brC[i][h] - c[h]) * a;
    });
  }
  return { push, call };
}

const t1 = Date.now();
const pushT: Record<number, number[]> = {};
const callT: Record<number, number[][]> = {};
for (let k = 1; k <= 8; k++) {
  pushT[k] = new Array(K).fill(0);
  callT[k] = Array.from({ length: k }, () => new Array(K).fill(0));
  for (const S of STACKS) {
    const r = solve(k, S);
    for (let h = 0; h < K; h++) {
      if (r.push[h] > 0.5) pushT[k][h] = S;
      r.call.forEach((c, i) => {
        if (c[h] > 0.5) callT[k][i][h] = S;
      });
    }
  }
  const p10 = CLASSES.reduce((s, _, h) => s + (pushT[k][h] >= 10 ? W[h] : 0), 0) / 13.26;
  console.log(`k=${k}: ва-банк с 10 ББ — ${p10.toFixed(1)}% рук`);
}
console.log(`Нэш: ${((Date.now() - t1) / 1000).toFixed(1)} с`);

const out = join(dirname(fileURLToPath(import.meta.url)), '../../src/games/poker/data/preflop.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({
    about: 'tools/poker/preflop.ts: классы холдема (eval.CLASSES), pct — доля рук сильнее (0 — лучшая), push[k]/call[k][i] — до скольких ББ ва-банк/колл верен (k соперников позади, i — порядок коллирующего), Нэш без ICM и анте',
    classes: CLASSES,
    pct,
    push: pushT,
    call: callT,
  }),
);
console.log('записано', out);
