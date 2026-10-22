/* Покер — раздача по истории (HandRecord) шаг за шагом: стеки, ставки круга, банк, доска и подпись каждого шага.
 * На этом — реплеер «Моей статистики», разбор «лучший ход» и выгрузка для трекеров. Без DOM. */
import { SUIT_SYM, type Card } from '../../cards/deck';
import { GAMES, type HandAct, type HandRecord } from './engine';

export interface Frame {
  /** Шаг истории (null — начало раздачи, -1 — итог). */
  i: number | null;
  street: number;
  board: Card[];
  /** Сколько каждый положил в этом круге и всего. */
  bets: Record<number, number>;
  total: Record<number, number>;
  stacks: Record<number, number>;
  folded: number[];
  /** Чей шаг. */
  seat?: number;
  act?: HandAct;
  /** Для хода: сколько нужно было доставить до хода и сколько лежало в банке (всё, со ставками круга). */
  toCall?: number;
  potBefore?: number;
  text: string;
}

const RN: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
export const cardRu = (c: Card | null) => (c ? `${RN[c.r] ?? c.r}${SUIT_SYM[c.s]}` : '🂠');
const FLOP_STREET = ['Префлоп', 'Флоп', 'Тёрн', 'Ривер'];

/** Название улицы для вида. */
export function streetName(r: HandRecord, st: number): string {
  const g = GAMES[r.game];
  if (g.family === 'flop') return FLOP_STREET[st] ?? `Улица ${st + 1}`;
  if (g.family === 'stud') return `${st + 3}-я улица`;
  return st === 0 ? 'До обмена' : `После ${st}-го обмена`;
}

/** Доска до первого хода (у Куршевеля — открытая карта). */
export function startBoard(r: HandRecord): Card[] {
  const later = r.acts.reduce((a, x) => a + (x.k === 'board' ? x.cards.length : 0), 0);
  return r.board.slice(0, Math.max(0, r.board.length - later));
}

export const potOf = (f: Pick<Frame, 'total'>) => Object.values(f.total).reduce((a, b) => a + b, 0);

export function frames(r: HandRecord, name: (seat: number) => string): Frame[] {
  const stacks: Record<number, number> = {};
  const bets: Record<number, number> = {};
  const total: Record<number, number> = {};
  for (const x of r.seats) {
    stacks[x.seat] = x.stack;
    bets[x.seat] = 0;
    total[x.seat] = 0;
  }
  const folded: number[] = [];
  let board = startBoard(r);
  let street = 0;
  const snap = (extra: Partial<Frame> & { text: string; i: number | null }): Frame => ({ street, board: board.slice(), bets: { ...bets }, total: { ...total }, stacks: { ...stacks }, folded: folded.slice(), ...extra });
  const out: Frame[] = [snap({ i: null, text: `Раздача ${r.no}: блайнды ${r.small}/${r.big}${r.ante ? `, анте ${r.ante}` : ''}. Баттон — ${name(r.button)}.` })];
  const newStreet = (st: number) => {
    if (st === street) return;
    street = st;
    for (const k of Object.keys(bets)) bets[Number(k)] = 0;
  };
  r.acts.forEach((a, i) => {
    if (a.k === 'post') {
      stacks[a.seat] -= a.amount;
      total[a.seat] += a.amount;
      if (a.what !== 'ante') bets[a.seat] += a.amount;
      const w = { sb: 'малый блайнд', bb: 'большой блайнд', ante: 'анте', bring: 'принос' }[a.what];
      out.push(snap({ i, seat: a.seat, act: a, text: `${name(a.seat)} — ${w} ${a.amount}` }));
      return;
    }
    if (a.k === 'board') {
      newStreet(a.street);
      board = [...board, ...a.cards];
      out.push(snap({ i, act: a, text: `${streetName(r, a.street)}: ${board.map(cardRu).join(' ')}` }));
      return;
    }
    if (a.k === 'card') {
      newStreet(a.street);
      out.push(snap({ i, seat: a.seat, act: a, text: `${name(a.seat)} получает ${a.up ? cardRu(a.card) : 'закрытую'}` }));
      return;
    }
    if (a.k === 'draw') {
      out.push(snap({ i, seat: a.seat, act: a, text: a.out.length ? `${name(a.seat)} меняет ${a.out.length}${a.got[0] ? `: ${a.out.map(cardRu).join(' ')} → ${a.got.map(cardRu).join(' ')}` : ''}` : `${name(a.seat)} стоит — не меняет` }));
      return;
    }
    if (a.k === 'discard') {
      out.push(snap({ i, seat: a.seat, act: a, text: `${name(a.seat)} сбрасывает ${a.card ? cardRu(a.card) : 'карту'}` }));
      return;
    }
    newStreet(a.street);
    const top = Math.max(0, ...Object.values(bets));
    const toCall = Math.max(0, Math.min(stacks[a.seat], top - bets[a.seat]));
    const potBefore = potOf({ total });
    stacks[a.seat] -= a.amount;
    bets[a.seat] += a.amount;
    total[a.seat] += a.amount;
    if (a.a === 'fold') folded.push(a.seat);
    const t =
      a.a === 'fold' ? 'пас' : a.a === 'check' ? 'чек' : a.a === 'call' ? `колл ${a.amount}` : a.a === 'bet' ? `ставка ${a.to}` : `рейз до ${a.to}`;
    out.push(snap({ i, seat: a.seat, act: a, toCall, potBefore, text: `${name(a.seat)}: ${t}${a.allin ? ' (ва-банк)' : ''}` }));
  });
  const shown = Object.entries(r.shown).map(([p, cs]) => `${name(Number(p))}: ${cs.map(cardRu).join(' ')}`);
  const won = r.winners.map((w) => `${name(w.seat)} +${w.amount}${w.hand ? ` (${w.lo ? 'лоу' : w.hand})` : ''}`);
  for (const x of r.seats) stacks[x.seat] = x.stack + (r.net[x.seat] ?? 0);
  out.push(snap({ i: -1, text: `${shown.length ? `Вскрытие — ${shown.join('; ')}. ` : ''}${won.join(', ')}.` }));
  return out;
}
