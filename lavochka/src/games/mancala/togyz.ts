/* Тогыз кумалак (тогуз коргоол) — правила (без DOM). По ru.wikipedia «Тогуз коргоол» / «Тогыз кумалак».
 *
 * Два ряда по 9 лунок, в каждой по 9 камней (162), у каждого казан. Лунки 0–8 — место 0, 9–17 — место 1;
 * у каждого нумерация 1–9 слева направо от него, посев — против часовой стрелки (по возрастанию номера, по кругу).
 * Ход: взять все камни из своей лунки и раскладывать по одному, ПЕРВЫЙ — в ту же лунку; если в лунке один камень —
 * он переходит в следующую. Камень, попавший в туздык, уходит в казан его хозяина.
 * Последний камень в лунке соперника и там стало чётное число — всё оттуда в свой казан.
 * Стало ровно 3 — лунка становится твоим туздыком (камни — в казан), если: туздыка у тебя ещё нет, это не 9-я лунка
 * соперника и не лунка с тем же номером, что туздык соперника. Туздык — до конца партии.
 * 82 и больше в казане — победа, 81:81 — ничья. Нечем ходить (ат сыроо) — камни на доске идут хозяевам рядов, считают казаны.
 * Решение без источника: судьбу камней в туздыке берём по ru-статьям — сразу в казан хозяина (en: «копятся в туздыке»).
 */
import type { State } from './engine';

export const TN = 9;
export const TOGYZ_SEEDS = 9;
export const TOGYZ_WIN = 82;
/** Потолок длины партии: дальше каждый берёт свои (повтор позиции в правилах — ничья). */
const MAX_MOVES = 400;

export const tRow = (seat: number) => Array.from({ length: TN }, (_, i) => seat * TN + i);
export const tOwn = (seat: number, pit: number) => (seat === 0 ? pit < TN : pit >= TN);
/** Номер лунки у её хозяина: 1–9. */
export const tNum = (pit: number) => (pit % TN) + 1;

export function tLegal(s: State, seat: number): number[] {
  return tRow(seat).filter((p) => s.pits[p] > 0 && s.tuz[1 - seat] !== p);
}

export function tSow(s: State, seat: number, pit: number) {
  const pits = s.pits.slice();
  const store = [...s.store] as [number, number];
  let n = pits[pit];
  pits[pit] = 0;
  const path: number[] = [];
  let q = n === 1 ? (pit + 1) % (2 * TN) : pit;
  while (n > 0) {
    const owner = s.tuz[0] === q ? 0 : s.tuz[1] === q ? 1 : null;
    if (owner != null) {
      store[owner]++;
      path.push(owner === 0 ? -1 : -2);
    } else {
      pits[q]++;
      path.push(q);
    }
    n--;
    if (n > 0) q = (q + 1) % (2 * TN);
  }
  return { pits, store, path, end: q };
}

/** Ход: новое состояние (s уже скопирован вызывающим) и что взято. */
export function tApply(s: State, seat: number, pit: number): { captured: number[]; tuz: boolean } {
  const r = tSow(s, seat, pit);
  s.pits = r.pits;
  s.store = r.store;
  s.tuz = [...s.tuz] as [number, number];
  const captured: number[] = [];
  let tuz = false;
  const q = r.end;
  const isTuz = s.tuz[0] === q || s.tuz[1] === q;
  if (!tOwn(seat, q) && !isTuz) {
    if (s.pits[q] % 2 === 0) {
      s.store[seat] += s.pits[q];
      s.pits[q] = 0;
      captured.push(q);
    } else if (s.pits[q] === 3 && s.tuz[seat] < 0 && tNum(q) !== 9 && !(s.tuz[1 - seat] >= 0 && tNum(s.tuz[1 - seat]) === tNum(q))) {
      s.tuz[seat] = q;
      s.store[seat] += 3;
      s.pits[q] = 0;
      captured.push(q);
      tuz = true;
    }
  }
  s.last = { seat, pit, path: r.path, captured, again: false };
  return { captured, tuz };
}

/** Конец партии: true — кончилась (счёт уже сведён). */
export function tFinish(s: State): boolean {
  if (s.store[0] >= TOGYZ_WIN || s.store[1] >= TOGYZ_WIN) return true;
  if (!tLegal(s, s.turn).length || s.moves >= MAX_MOVES) {
    // ат сыроо: камни на доске — хозяевам рядов
    for (const seat of [0, 1]) {
      for (const p of tRow(seat)) {
        s.store[seat] += s.pits[p];
        s.pits[p] = 0;
      }
    }
    return true;
  }
  return false;
}
