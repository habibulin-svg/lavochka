/* Шахматы — запись позиций и ходов для кружка и движка: FEN, UCI (язык Stockfish), чтение PGN (английская запись
 * «Nf3», «exd5», «O-O» и русская «Кf3», «e:d5», «0-0»), русская запись с шахом и матом. Без DOM. */
import { fileOf, fromFen, inCheck, legalMoves, play, rankOf, san, sqName, type Move, type Promo, type State } from './engine';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** FEN позиции (рокировка — буквами KQkq: для классики и задач этого хватает). */
export function toFen(s: State): string {
  const rows: string[] = [];
  for (let r = 7; r >= 0; r--) {
    let row = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = s.board[r * 8 + f];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    rows.push(row + (empty || ''));
  }
  const c = s.castle;
  const cast = (c.wK >= 0 ? 'K' : '') + (c.wQ >= 0 ? 'Q' : '') + (c.bK >= 0 ? 'k' : '') + (c.bQ >= 0 ? 'q' : '') || '-';
  return `${rows.join('/')} ${s.turn ? 'b' : 'w'} ${cast} ${s.ep >= 0 ? sqName(s.ep) : '-'} ${s.half} ${s.full}`;
}

/** Позиция для кружка: из FEN, со своим списком повторов. */
export const position = (fen: string = START_FEN) => fromFen(fen);

/** Ход в записи UCI: «e2e4», «e7e8q»; рокировка — ходом короля на две клетки. */
export const toUci = (m: Move) => sqName(m.from) + sqName(m.to) + (m.promo ? m.promo.toLowerCase() : '');

/** Законный ход по записи UCI (рокировка понимается и как «король берёт свою ладью»). */
export function fromUci(s: State, uci: string): Move | null {
  const u = uci.trim().toLowerCase();
  if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(u)) return null;
  const sq = (t: string) => 'abcdefgh'.indexOf(t[0]) + (Number(t[1]) - 1) * 8;
  const from = sq(u.slice(0, 2));
  const to = sq(u.slice(2, 4));
  const promo = (u[4]?.toUpperCase() as Promo | undefined) ?? undefined;
  return legalMoves(s).find((m) => m.from === from && (m.to === to || (m.castle && m.rook === to)) && (m.promo ?? undefined) === promo) ?? null;
}

/** Шах или мат после хода. */
export function checkMark(s: State, m: Move): '' | '+' | '#' {
  const n = play(s, m);
  if (!inCheck(n)) return '';
  return legalMoves(n).length ? '+' : '#';
}

/** Русская запись хода с шахом и матом: «Кf3», «e:d5», «Фh7#». */
export function ruSan(s: State, m: Move, all: Move[] = legalMoves(s)): string {
  return san(s, m, all).replace(' e.p.', '') + checkMark(s, m);
}

const EN: Record<string, string> = { K: 'K', Q: 'Q', R: 'R', B: 'B', N: 'N', P: '' };

/** Английская запись (как в PGN), без шаха. */
export function enSan(s: State, m: Move, all: Move[] = legalMoves(s)): string {
  if (m.castle) return m.castle === 'K' ? 'O-O' : 'O-O-O';
  const k = m.piece.toUpperCase();
  let t = EN[k];
  if (k === 'P') {
    if (m.captured) t += 'abcdefgh'[fileOf(m.from)];
  } else {
    const same = all.filter((x) => x !== m && x.piece === m.piece && x.to === m.to && x.from !== m.from && !x.castle);
    if (same.length) {
      if (!same.some((x) => fileOf(x.from) === fileOf(m.from))) t += 'abcdefgh'[fileOf(m.from)];
      else if (!same.some((x) => rankOf(x.from) === rankOf(m.from))) t += String(rankOf(m.from) + 1);
      else t += sqName(m.from);
    }
  }
  if (m.captured) t += 'x';
  t += sqName(m.to);
  if (m.promo) t += '=' + m.promo;
  return t;
}

/** Ход по записи — английской или русской; пометки «+», «#», «!», «?» не мешают. */
export function parseMove(s: State, text: string): Move | null {
  const clean = (t: string) =>
    t
      .replace(/[+#!?]/g, '')
      .replace(/e\.p\./g, '')
      .replace(/[×:x]/g, 'x')
      .replace(/^0-0-0$/, 'O-O-O')
      .replace(/^0-0$/, 'O-O')
      .replace(/=/g, '')
      .trim();
  const want = clean(text);
  if (!want) return null;
  const all = legalMoves(s);
  for (const m of all) {
    if (clean(enSan(s, m, all)) === want) return m;
    if (clean(san(s, m, all)) === want) return m;
  }
  // без указания, какой фигурой: «Nbd7» записано как «Nd7» или наоборот — берём единственный подходящий
  const loose = all.filter((m) => clean(enSan(s, m, all)).replace(/^([KQRBN])[a-h1-8](?=x?[a-h][1-8])/, '$1') === want.replace(/^([KQRBN])[a-h1-8](?=x?[a-h][1-8])/, '$1'));
  return loose.length === 1 ? loose[0] : fromUci(s, text);
}

export interface Line {
  /** Позиция до каждого хода и после последнего: fens.length = moves.length + 1. */
  fens: string[];
  moves: Move[];
  /** Русская запись ходов. */
  ru: string[];
  uci: string[];
}

/** Разобрать запись партии (PGN-ходы без заголовков: номера, комментарии в {} и варианты в () пропускаются). */
export function parseLine(text: string, fen: string = START_FEN): Line {
  const body = text
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/;[^\n]*/g, ' ')
    .replace(/\$\d+/g, ' ');
  // варианты в скобках (с вложением) — выбросить
  let flat = '';
  let depth = 0;
  for (const ch of body) {
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (!depth) flat += ch;
  }
  const tokens = flat
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.(\.\.)?/, ''))
    .filter((t) => t && !/^\d+\.+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));
  let s = position(fen);
  const out: Line = { fens: [toFen(s)], moves: [], ru: [], uci: [] };
  for (const t of tokens) {
    const m = parseMove(s, t);
    if (!m) throw new Error(`Ход «${t}» невозможен в позиции ${toFen(s)}`);
    out.ru.push(ruSan(s, m));
    out.uci.push(toUci(m));
    out.moves.push(m);
    s = play(s, m);
    out.fens.push(toFen(s));
  }
  return out;
}

/** Номер хода для записи: «12.» белым, «12...» чёрным. */
export function moveNo(fen: string): string {
  const [, turn, , , , full = '1'] = fen.split(' ');
  return turn === 'b' ? `${full}...` : `${full}.`;
}

/** Линия движка (ходы UCI) русской записью с номерами: «12. Кf3 Фd7 13. 0-0». Невозможный ход обрывает линию. */
export function lineRu(fen: string, uci: string[], max = 99): string {
  let s = position(fen);
  const out: string[] = [];
  for (const u of uci.slice(0, max)) {
    const m = fromUci(s, u);
    if (!m) break;
    if (s.turn === 0) out.push(`${s.full}.`);
    else if (!out.length) out.push(`${s.full}...`);
    out.push(ruSan(s, m));
    s = play(s, m);
  }
  return out.join(' ').replace(/(\d+\.(?:\.\.)?) /g, '$1 ');
}
