/* Бот настольного баскетбола: смотрит, в какую лунку лёг мяч, и с задержкой (реакция по уровню) жмёт её клавишу.
 * Слабый иногда промахивается клавишей — и рука у него «залипает», как у человека. */
import type { Rng } from '../../core/types';
import { labelOf, type BbIn, type BbState, type Team } from './engine';

interface Level {
  /** Реакция: среднее и разброс, с; доля нажатий «не той» клавиши. */
  react: number;
  spread: number;
  wrong: number;
}

export const LEVELS: Level[] = [
  { react: 0.85, spread: 0.3, wrong: 0.14 },
  { react: 0.55, spread: 0.18, wrong: 0.06 },
  { react: 0.34, spread: 0.08, wrong: 0.02 },
];

/** Позиция клавиши (0…9 слева направо) для номера 1…9, 0. */
export const keyPos = (label: number) => (label === 0 ? 9 : label - 1);

export function botInput(st: BbState, seat: number, level: number, m: Record<string, any>, rng: Rng): BbIn {
  const mem = m as { t?: number; cap?: number; at?: number; n?: number; k?: number; wrong?: boolean };
  const lv = LEVELS[Math.max(0, Math.min(2, level))];
  const team = (seat === 0 ? 0 : 1) as Team;
  mem.t = (mem.t ?? 0) + 1 / 60;
  mem.n ??= 0;
  mem.k ??= -1;
  if (st.hole >= 0 && st.serve <= 0 && mem.cap !== st.cap) {
    mem.cap = st.cap;
    mem.at = mem.t + Math.max(0.15, lv.react + (rng.next() - 0.5) * 2 * lv.spread);
    mem.wrong = rng.next() < lv.wrong;
  }
  if (st.hole >= 0 && mem.at != null && mem.t >= mem.at && st.lock[team] <= 0) {
    const right = keyPos(labelOf(team, st.hole));
    mem.k = mem.wrong ? (right + 1 + rng.int(9)) % 10 : right;
    mem.n++;
    // промахнулся — попробует ещё раз, когда рука отлипнет
    mem.at = mem.wrong ? mem.t + 0.55 + rng.next() * 0.2 : undefined;
    mem.wrong = false;
  }
  return { k: mem.k, n: mem.n };
}
