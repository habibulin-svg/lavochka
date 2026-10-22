/* Покер — ICM (модель Малмута–Харвилла): сколько призовых «стоит» стек. Вероятность занять первое место — доля фишек;
 * следующее место — так же среди оставшихся, рекурсивно. Точно до ~9 стеков (перебор с запоминанием по маске),
 * для большего числа — только верхние призовые места (остальные стеки участвуют в долях, но глубже не раскрываются).
 * Нужна турнирам (этап 3) и подсказкам: на пузыре фишка, которую можно проиграть, дороже той, что можно выиграть. */

/** Доля призовых каждого стека. prizes — выплаты по местам (1-е, 2-е, …), не обязательно на всех. */
export function icm(stacks: number[], prizes: number[]): number[] {
  const n = stacks.length;
  const out = new Array<number>(n).fill(0);
  const places = Math.min(prizes.length, n);
  if (!places) return out;
  const memo = new Map<number, number[]>();
  // eq(mask, place) — доля призов с места place и ниже для игроков вне mask (mask — уже занявшие места выше)
  const rec = (mask: number, place: number): number[] => {
    if (place >= places) return new Array<number>(n).fill(0);
    const hit = memo.get(mask);
    if (hit) return hit;
    let tot = 0;
    for (let i = 0; i < n; i++) if (!(mask & (1 << i))) tot += stacks[i];
    const res = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i) || stacks[i] <= 0) continue;
      const p = tot > 0 ? stacks[i] / tot : 0;
      if (!p) continue;
      res[i] += p * prizes[place];
      const sub = rec(mask | (1 << i), place + 1);
      for (let j = 0; j < n; j++) res[j] += p * sub[j];
    }
    memo.set(mask, res);
    return res;
  };
  // вылетевшие (0 фишек) занимают последние места — им достаются призы с конца, если хватает мест
  const alive = stacks.filter((s) => s > 0).length;
  const dead = stacks.map((s, i) => (s > 0 ? -1 : i)).filter((i) => i >= 0);
  const r = rec(dead.reduce((m, i) => m | (1 << i), 0), 0);
  for (let i = 0; i < n; i++) out[i] = r[i];
  dead.forEach((i, k) => {
    const place = alive + k;
    if (place < prizes.length) out[i] = prizes[place];
  });
  return out;
}

/** Нужные шансы, чтобы коллировать ва-банк при ICM: (ICM(пас) − ICM(проиграл)) / (ICM(выиграл) − ICM(проиграл)).
 * risk — сколько фишек колл ставит под удар (меньший из двух стеков), pot — что лежит в банке без колла,
 * hero/villain — места в stacks (stacks — до колла, без фишек в банке). */
export function icmCallEquity(stacks: number[], prizes: number[], hero: number, villain: number, risk: number, pot: number): number {
  const fold = icm(stacks, prizes)[hero];
  const win = stacks.slice();
  win[hero] += pot + risk;
  win[villain] -= Math.min(win[villain], risk);
  const lose = stacks.slice();
  lose[hero] -= risk;
  lose[villain] += pot + risk;
  const w = icm(win, prizes)[hero];
  const l = icm(lose, prizes)[hero];
  return w - l > 0 ? Math.max(0, Math.min(1, (fold - l) / (w - l))) : 1;
}

/** Нужные шансы для колла по ICM, когда ставки уже в банке: stacks — фишки за столом (без банка), pot — весь банк до
 * колла (со ставкой соперника), call — сколько доплатить герою. Пас — банк уходит villain, выиграл — герой забирает банк,
 * проиграл — villain забирает банк и колл. */
export function icmCallNeed(stacks: number[], prizes: number[], hero: number, villain: number, call: number, pot: number): number {
  const fold = stacks.slice();
  fold[villain] += pot;
  const win = stacks.slice();
  win[hero] += pot;
  const lose = stacks.slice();
  lose[hero] -= call;
  lose[villain] += pot + call;
  const f = icm(fold, prizes)[hero];
  const w = icm(win, prizes)[hero];
  const l = icm(lose, prizes)[hero];
  return w - l > 0 ? Math.max(0, Math.min(1, (f - l) / (w - l))) : 1;
}

/** Фактор пузыря: во сколько раз проигранная фишка дороже выигранной в споре hero и villain на risk фишек (1 — как в кэше). */
export function bubbleFactor(stacks: number[], prizes: number[], hero: number, villain: number, risk: number): number {
  const now = icm(stacks, prizes)[hero];
  const win = stacks.slice();
  win[hero] += risk;
  win[villain] -= risk;
  const lose = stacks.slice();
  lose[hero] -= risk;
  lose[villain] += risk;
  const gain = icm(win, prizes)[hero] - now;
  const loss = now - icm(lose, prizes)[hero];
  return gain > 0 ? loss / gain : 1;
}
