/* Рейтинг Арены — Глико-1 (DESIGN.md §2): число и его неточность; новичок двигается быстро, завсегдатай — медленно.
 * Только сервер: в логику боя не входит, поэтому обычная математика здесь разрешена. */
export interface Rating {
  r: number;
  rd: number;
  wins: number;
  losses: number;
}

export const START_RATING: Rating = { r: 1500, rd: 350, wins: 0, losses: 0 };
const Q = Math.log(10) / 400;
const MIN_RD = 40;

const g = (rd: number): number => 1 / Math.sqrt(1 + (3 * Q * Q * rd * rd) / (Math.PI * Math.PI));

function update(me: Rating, foe: Rating, score: number): { r: number; rd: number } {
  const gf = g(foe.rd);
  const e = 1 / (1 + 10 ** ((-gf * (me.r - foe.r)) / 400));
  const d2 = 1 / (Q * Q * gf * gf * e * (1 - e));
  const k = 1 / (1 / (me.rd * me.rd) + 1 / d2);
  return { r: me.r + Q * k * gf * (score - e), rd: Math.max(MIN_RD, Math.sqrt(k)) };
}

/** Новые рейтинги после партии; a победил b. */
export function afterGame(a: Rating, b: Rating): [Rating, Rating] {
  return [
    { ...update(a, b, 1), wins: a.wins + 1, losses: a.losses },
    { ...update(b, a, 0), wins: b.wins, losses: b.losses + 1 },
  ];
}
