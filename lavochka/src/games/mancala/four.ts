/* Четырёхрядная манкала (без DOM): простое бао (4×8) и катра Мадагаскара (паика, 4×6).
 * По сборнику «Настольные игры мира. Игры семейства Манкала, часть I» (tesera.ru).
 *
 * У каждого два своих ряда: внешний (ближний) и внутренний; сеют только по своей половине, по кругу из 2N лунок,
 * направление — по выбору игрока в начале каждого хода (по часовой или против), в ходе не меняется.
 * Посев «реле»: последний камень упал в непустую лунку — берёшь всё оттуда и сеешь дальше; в пустую — ход окончен.
 * Взятие: последний камень упал в непустую лунку своего внутреннего ряда, а в лунке соперника напротив (его внутренний ряд)
 * есть камни — забираешь их и вместе с камнями своей лунки сеешь дальше в том же направлении.
 *   бао — из лунки с одним камнем ходить нельзя; кому нечем ходить — проиграл;
 *   катра (паика) — с одного камня ходить можно; напротив пусто, а весь свой внутренний ряд занят — берёшь из внешнего ряда соперника.
 * Катру горобака (берут сразу обе лунки напротив) пробовали: первый ход сметает почти всё, партия в 3–7 ходов — не берём.
 * Цель — взять все камни соперника (в бао — оставить его без хода).
 * Решения без источника: в катре непустая лунка внутреннего ряда без взятия продолжает «реле», как и внешняя;
 * посев длиннее 4000 камней обрывается (бесконечный круг); через 300 ходов побеждает тот, у кого больше камней на стороне.
 */
import type { State } from './engine';

export type FourVariant = 'bao' | 'katra';
export const FOUR: FourVariant[] = ['bao', 'katra'];
export const isFour = (v: string): v is FourVariant => (FOUR as string[]).includes(v);
export const fourCols = (v: FourVariant) => (v === 'katra' ? 6 : 8);
export const FOUR_SEEDS = 2;
const MAX_DROPS = 4000;
const MAX_MOVES = 300;

/* Лунки: у места s — 2N подряд, начиная с s·2N, по кругу против часовой стрелки (если смотреть со своей стороны):
 * сначала внешний ряд слева направо, затем внутренний справа налево. Столбец c считается от левого края у хозяина. */
export const fPit = (n: number, seat: number, inner: boolean, c: number) => seat * 2 * n + (inner ? 2 * n - 1 - c : c);
export const fOwner = (n: number, pit: number) => (pit < 2 * n ? 0 : 1);
export const fInner = (n: number, pit: number) => pit % (2 * n) >= n;
/** Столбец лунки от левого края её хозяина. */
export const fCol = (n: number, pit: number) => {
  const k = pit % (2 * n);
  return k < n ? k : 2 * n - 1 - k;
};
/** Лунка соперника напротив (тот же столбец на доске, его ряд). */
export const fFace = (n: number, pit: number, inner: boolean) => fPit(n, 1 - fOwner(n, pit), inner, n - 1 - fCol(n, pit));
export const fSide = (n: number, seat: number) => Array.from({ length: 2 * n }, (_, k) => seat * 2 * n + k);
const step = (n: number, pit: number, dir: number) => {
  const base = pit - (pit % (2 * n));
  return base + (((pit - base + dir) % (2 * n)) + 2 * n) % (2 * n);
};

export function fLegal(s: State, seat: number): number[] {
  const v = s.cfg.variant as FourVariant;
  const n = fourCols(v);
  return fSide(n, seat).filter((p) => s.pits[p] >= (v === 'bao' ? 2 : 1));
}

export function fTotal(s: State, seat: number) {
  return fSide(fourCols(s.cfg.variant as FourVariant), seat).reduce((x, p) => x + s.pits[p], 0);
}

/** Ход (s уже скопирован вызывающим): путь — по камню; lifts — какие лунки пустели перед каким по счёту камнем. */
export function fApply(s: State, seat: number, pit: number, dir: 1 | -1) {
  const v = s.cfg.variant as FourVariant;
  const n = fourCols(v);
  const pits = s.pits.slice();
  const path: number[] = [];
  const lifts: { at: number; pits: number[] }[] = [];
  const captured: number[] = [];
  let hand = pits[pit];
  pits[pit] = 0;
  let q = pit;
  while (hand > 0 && path.length < MAX_DROPS) {
    q = step(n, q, dir);
    pits[q]++;
    path.push(q);
    if (--hand > 0) continue;
    if (pits[q] === 1) break; // в пустую — конец
    const take: number[] = [];
    if (fInner(n, q)) {
      const fi = fFace(n, q, true);
      const fo = fFace(n, q, false);
      if (pits[fi] > 0) take.push(fi);
      else if (pits[fo] > 0 && v === 'katra' && fSide(n, seat).filter((p) => fInner(n, p)).every((p) => pits[p] > 0)) take.push(fo);
    }
    hand = pits[q];
    pits[q] = 0;
    for (const t of take) {
      hand += pits[t];
      pits[t] = 0;
    }
    captured.push(...take);
    lifts.push({ at: path.length, pits: [q, ...take] });
  }
  s.pits = pits;
  s.store = [fTotal(s, 0), fTotal(s, 1)];
  s.last = { seat, pit, path, captured, again: false };
  return { path, lifts, captured };
}

/** Конец партии: true — кончилась. Победитель — у кого остались ходы (или больше камней к потолку ходов). */
export function fFinish(s: State): number | null | false {
  if (!fLegal(s, s.turn).length) return 1 - s.turn;
  if (s.moves >= MAX_MOVES) return s.store[0] > s.store[1] ? 0 : s.store[1] > s.store[0] ? 1 : null;
  return false;
}
