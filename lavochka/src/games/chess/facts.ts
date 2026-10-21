/* Шахматы — позиция словами для Михалыча: языковая модель плохо читает FEN и путает фигуры, поэтому сервер
 * сам расписывает доску (где какая фигура), что под боем без защиты, какие взятия есть, и каждый ход движка —
 * словами («чёрный слон с b4 берёт белого слона на d2, шах»). Без DOM. */
import { colorOf, inCheck, legalMoves, play, sqName, type Move, type State } from './engine';
import { checkMark, parseMove, position } from './notation';

const NAME: Record<string, [string, string, string]> = {
  // именительный, винительный, мн. число
  K: ['король', 'короля', 'король'],
  Q: ['ферзь', 'ферзя', 'ферзи'],
  R: ['ладья', 'ладью', 'ладьи'],
  B: ['слон', 'слона', 'слоны'],
  N: ['конь', 'коня', 'кони'],
  P: ['пешка', 'пешку', 'пешки'],
};
const ORDER = 'KQRBNP';
const COLOR = (c: number, acc = false, fem = false) => (c === 0 ? (acc ? (fem ? 'белую' : 'белого') : fem ? 'белая' : 'белый') : acc ? (fem ? 'чёрную' : 'чёрного') : fem ? 'чёрная' : 'чёрный');
const fem = (k: string) => k === 'R' || k === 'P';
const kind = (p: string) => p.toUpperCase();

/** Фигуры одной стороны: «король e1, ферзь g3, ладьи a1 и h1, пешки a2, b2, c2». */
function pieces(s: State, c: number): string {
  const by: Record<string, string[]> = {};
  s.board.forEach((p, i) => {
    if (p && colorOf(p) === c) (by[kind(p)] ??= []).push(sqName(i));
  });
  return ORDER.split('')
    .filter((k) => by[k])
    .map((k) => {
      const sq = by[k].sort();
      const list = sq.length === 1 ? sq[0] : sq.slice(0, -1).join(', ') + ' и ' + sq[sq.length - 1];
      return `${NAME[k][sq.length > 1 ? 2 : 0]} ${list}`;
    })
    .join(', ');
}

/** Ход словами: «чёрный слон с b4 берёт белого слона на d2, шах». */
export function moveWords(s: State, m: Move): string {
  const c = s.turn;
  const k = kind(m.piece);
  if (m.castle) return `${c === 0 ? 'белые' : 'чёрные'} делают ${m.castle === 'K' ? 'короткую' : 'длинную'} рокировку`;
  let t = `${COLOR(c, false, fem(k))} ${NAME[k][0]} с ${sqName(m.from)}`;
  t += m.captured ? ` берёт ${COLOR(1 - c, true, fem(kind(m.captured)))} ${NAME[kind(m.captured)][1]} на ${sqName(m.to)}${m.ep ? ' (взятие на проходе)' : ''}` : ` идёт на ${sqName(m.to)}`;
  if (m.promo) t += ` и превращается в ${NAME[m.promo][1]}`;
  const mark = checkMark(s, m);
  return t + (mark === '#' ? ', мат' : mark === '+' ? ', шах' : '');
}

/** Ход из русской или английской записи — словами; не разобрался — пусто. */
export function sanWords(fen: string, text: string): string {
  try {
    const s = position(fen);
    const m = parseMove(s, text.replace(/^\d+\.(\.\.)?\s*/, ''));
    return m ? moveWords(s, m) : '';
  } catch {
    return '';
  }
}

/** Первые ходы линии («12. Кf3 Фd7 13. 0-0») словами, по очереди. */
export function lineWords(fen: string, line: string, max = 3): string {
  try {
    let s = position(fen);
    const out: string[] = [];
    for (const tok of line.split(/\s+/)) {
      if (out.length >= max) break;
      const t = tok.replace(/^\d+\.(\.\.)?/, '');
      if (!t) continue;
      const m = parseMove(s, t);
      if (!m) break;
      out.push(moveWords(s, m));
      s = play(s, m);
    }
    return out.join('; затем ');
  } catch {
    return '';
  }
}

/** Доска словами: фигуры, шах, что висит, какие взятия есть у ходящей стороны. */
export function boardFacts(fen: string): string[] {
  let s: State;
  try {
    s = position(fen);
  } catch {
    return [];
  }
  if (!s.board.includes('K') || !s.board.includes('k')) return [];
  const out = [`Белые фигуры: ${pieces(s, 0)}.`, `Чёрные фигуры: ${pieces(s, 1)}.`, `Ход ${s.turn === 0 ? 'белых' : 'чёрных'}.`];
  if (inCheck(s)) out.push(`${s.turn === 0 ? 'Белому' : 'Чёрному'} королю шах.`);
  // всё, что под боем: кто нападает и кто защищает
  const hang: string[] = [];
  s.board.forEach((p, i) => {
    if (!p || kind(p) === 'K') return;
    const c = colorOf(p);
    const by = legalAttackers(s, i, 1 - c);
    if (!by.length) return;
    const guards = recaptures(s, i, 1 - c);
    const who = (list: string[]) => [...new Set(list.map((x) => NAME[kind(x)][0]))].join(' и ');
    hang.push(
      `${COLOR(c, false, fem(kind(p)))} ${NAME[kind(p)][0]} ${sqName(i)} — нападает ${who(by)}, ${guards.length ? 'защищает ' + who(guards) : 'без защиты'}`,
    );
  });
  if (hang.length) out.push(`Под боем: ${hang.join('; ')}.`);
  const caps = legalMoves(s).filter((m) => m.captured);
  if (caps.length) out.push(`${s.turn === 0 ? 'Белые' : 'Чёрные'} могут взять: ${caps.slice(0, 8).map((m) => moveWords(s, m)).join('; ')}.`);
  return out;
}

/** Какие фигуры стороны by могут сейчас побить клетку sq (по правилам, со связками). */
function legalAttackers(s: State, sq: number, by: number): string[] {
  const t = { ...s, turn: by as 0 | 1, ep: -1 };
  return legalMoves(t)
    .filter((m) => m.to === sq && m.captured)
    .map((m) => m.piece);
}

/** Кто может отыграть клетку sq, если сторона by на ней возьмёт (по правилам, после каждого возможного взятия). */
function recaptures(s: State, sq: number, by: number): string[] {
  const t = { ...s, turn: by as 0 | 1, ep: -1 };
  const out: string[] = [];
  for (const m of legalMoves(t).filter((x) => x.to === sq && x.captured)) {
    const n = play(t, m);
    for (const r of legalMoves(n)) if (r.to === sq && r.captured) out.push(r.piece);
  }
  return out;
}
