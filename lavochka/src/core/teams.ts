/* Команды за столом: общие раскладки для GameDef.teams. */

/** Через одного: первое, третье, пятое место — одна команда, второе, четвёртое… — другая. */
export const alternate = (seats: number[]): number[][] => [seats.filter((_, i) => i % 2 === 0), seats.filter((_, i) => i % 2 === 1)];

/** Номер команды места (−1 — без команды). */
export function teamIndex(teams: number[][] | null | undefined, seat: number): number {
  return teams ? teams.findIndex((t) => t.includes(seat)) : -1;
}
