/* Шахматный кружок — рейтинг в задачах (Глико: рейтинг и его «разброс» RD) и разряды кружка. Без DOM. */

export interface Rating {
  r: number;
  rd: number;
  /** Когда обновлялся (мс): за простой разброс понемногу растёт. */
  at: number;
}

export const START: Rating = { r: 1200, rd: 300, at: 0 };

const Q = Math.LN10 / 400;
const g = (rd: number) => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));
/** Разброс задачи: у задач Lichess рейтинг устоявшийся. */
const PUZZLE_RD = 80;
/** Рост разброса за день без задач (до 350 примерно за полгода). */
const C2 = 30 * 30;
const DAY = 86400_000;

/** Ожидаемый успех игрока с рейтингом r против задачи с рейтингом pr. */
export const expected = (r: number, pr: number) => 1 / (1 + 10 ** ((-g(PUZZLE_RD) * (r - pr)) / 400));

/** Рейтинг после задачи: win — решена с первого раза без подсказки. */
export function update(cur: Rating, puzzle: number, win: boolean, now = Date.now()): Rating {
  const days = cur.at ? Math.max(0, (now - cur.at) / DAY) : 0;
  const rd0 = Math.min(350, Math.sqrt(cur.rd * cur.rd + C2 * days));
  const gj = g(PUZZLE_RD);
  const e = expected(cur.r, puzzle);
  const d2 = 1 / (Q * Q * gj * gj * e * (1 - e));
  const k = 1 / (1 / (rd0 * rd0) + 1 / d2);
  const r = cur.r + Q * k * gj * ((win ? 1 : 0) - e);
  // разброс не опускаем ниже 60: рейтинг должен двигаться и у постоянных учеников
  return { r: Math.round(Math.max(400, Math.min(3000, r))), rd: Math.max(60, Math.sqrt(k)), at: now };
}

/** Разряды кружка — советская лесенка: юношеские, взрослые, КМС, мастер. */
export const RANKS: { from: number; name: string; short: string }[] = [
  { from: 0, name: 'Новичок', short: 'б/р' },
  { from: 900, name: 'III юношеский разряд', short: 'III юн.' },
  { from: 1050, name: 'II юношеский разряд', short: 'II юн.' },
  { from: 1200, name: 'I юношеский разряд', short: 'I юн.' },
  { from: 1400, name: 'III разряд', short: 'III' },
  { from: 1600, name: 'II разряд', short: 'II' },
  { from: 1800, name: 'I разряд', short: 'I' },
  { from: 2000, name: 'Кандидат в мастера спорта', short: 'КМС' },
  { from: 2200, name: 'Мастер спорта', short: 'МС' },
  { from: 2400, name: 'Гроссмейстер двора', short: 'ГМ' },
];

/** Сколько задач решить, прежде чем дать разряд: до этого — «Новичок» (стартовый рейтинг 1200 — не заслуга). */
export const FIRST_RANK_AFTER = 10;

/** Разряд по рейтингу; пока рейтинг не устоялся (мало задач), разряд «предварительный».
 * solved — сколько задач уже решал ученик: меньше FIRST_RANK_AFTER — «Новичок», что бы ни показывал рейтинг. */
export function rankOf(r: Rating, solved = Infinity) {
  if (solved < FIRST_RANK_AFTER) return { ...RANKS[0], index: 0, next: null, provisional: false, toFirst: FIRST_RANK_AFTER - solved };
  let i = 0;
  while (i + 1 < RANKS.length && r.r >= RANKS[i + 1].from) i++;
  return { ...RANKS[i], index: i, next: RANKS[i + 1] ?? null, provisional: r.rd > 110, toFirst: 0 };
}
