/* История партий: что записать про доигранную партию (без DOM — проверяет tests/player.test.ts). */
import type { Finished } from './table';

export interface Play {
  game: string;
  preset: string | null;
  result: 'win' | 'lose' | 'draw' | 'done';
  place: number | null;
  players: number;
  bots: number;
  network: boolean;
  score: string | null;
  seconds: number | null;
  endedAt: number;
}

/** Что записать про партию (без DOM — проверяется тестом). */
export function playOf(f: Finished): Omit<Play, 'endedAt'> {
  const mine = f.mySeats;
  const humans = f.seats.filter((s) => s.kind !== 'bot');
  const all = mine.length >= f.seats.length;
  const won = f.result.winners.some((w) => mine.includes(w));
  // все места за этим экраном (играли сами с собой или по очереди) — просто «доиграна»
  const result: Play['result'] = all && f.seats.length > 1 ? 'done' : !f.result.winners.length ? 'draw' : won ? 'win' : 'lose';
  const sc = f.result.scores;
  let place: number | null = null;
  let score: string | null = null;
  if (sc && mine.length === 1 && sc[mine[0]] != null) {
    const v = sc[mine[0]];
    score = String(v);
    if (f.seats.length > 1) place = 1 + Object.values(sc).filter((x) => x > v).length;
  }
  const opts = f.options;
  // подходят несколько — самый подробный («2 на 2», а не «Подкидной», который молчит про команды)
  const preset = opts ? ([...f.presets].sort((a, b) => Object.keys(b.options).length - Object.keys(a.options).length).find((p) => Object.entries(p.options).every(([k, v]) => opts[k] === v))?.id ?? null) : null;
  return { game: f.game, preset, result, place, players: f.seats.length, bots: f.seats.length - humans.length, network: f.network, score, seconds: f.seconds };
}

