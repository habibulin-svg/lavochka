import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { play } from '../src/games/chess/engine';
import { checkMark, fromUci, lineRu, parseLine, position, START_FEN, toFen, toUci } from '../src/games/chess/notation';
import { THEMES } from '../src/games/kruzhok/data';
import { rankOf, START, update } from '../src/games/kruzhok/rating';

const pub = (f: string) => JSON.parse(readFileSync(join(__dirname, '..', 'public', 'kruzhok', f), 'utf8'));

describe('шахматная запись', () => {
  it('FEN туда и обратно', () => {
    expect(toFen(position())).toBe(START_FEN);
    const f = 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4';
    expect(toFen(position(f))).toBe(f);
  });

  it('PGN по-английски и по-русски, рокировка, превращение, взятие на проходе', () => {
    const l = parseLine('1. e4 e5 2. Nf3 Nc6 3. Bc4 Bc5 4. O-O Nf6 5. d4 exd4');
    expect(l.ru.join(' ')).toBe('e4 e5 Кf3 Кc6 Сc4 Сc5 0-0 Кf6 d4 e:d4');
    expect(parseLine('1. e4 e5 2. Кf3 Кc6 3. Сc4 Сc5 4. 0-0').uci.at(-1)).toBe('e1g1');
    const ep = parseLine('1. e4 a6 2. e5 d5 3. exd6');
    expect(ep.uci.at(-1)).toBe('e5d6');
    expect(toFen(position(ep.fens.at(-1)!)).split(' ')[0]).toBe('rnbqkbnr/1pp1pppp/p2P4/8/8/8/PPPP1PPP/RNBQKBNR');
    const pr = parseLine('1. a8=Q+', '1k6/P7/8/8/8/8/8/K7 w - - 0 1');
    expect(pr.uci[0]).toBe('a7a8q');
    expect(() => parseLine('1. e5')).toThrow();
  });

  it('линия движка русской записью с номерами', () => {
    expect(lineRu(START_FEN, ['e2e4', 'e7e5', 'g1f3'])).toBe('1. e4 e5 2. Кf3');
    const black = toFen(play(position(), fromUci(position(), 'e2e4')!));
    expect(lineRu(black, ['c7c5', 'g1f3'])).toBe('1... c5 2. Кf3');
  });
});

describe('задачи кружка', () => {
  const { p } = pub('puzzles.json') as { p: [string, string, string, number, string][] };

  it('их тысячи, по возрастанию рейтинга, у каждой — темы из нашего списка', () => {
    expect(p.length).toBeGreaterThan(5000);
    const ours = new Set(THEMES.map((t) => t.id));
    for (let i = 1; i < p.length; i++) expect(p[i][3]).toBeGreaterThanOrEqual(p[i - 1][3]);
    for (const x of p) expect(x[4].split(' ').some((t) => ours.has(t)), x[0]).toBe(true);
  });

  it('все ходы всех задач законны, «мат в N» кончается матом', () => {
    for (const [id, fen, moves, , themes] of p) {
      let s = position(fen);
      const list = moves.split(' ');
      let last = '';
      for (const u of list) {
        const m = fromUci(s, u);
        expect(m, `${id}: ${u}`).toBeTruthy();
        last = checkMark(s, m!);
        expect(toUci(m!)).toBe(u);
        s = play(s, m!);
      }
      if (/mateIn\d/.test(themes)) expect(last, id).toBe('#');
    }
  });
});

describe('дебюты', () => {
  it('у каждой линии есть ECO, название и конечная позиция', () => {
    const { o } = pub('openings.json') as { o: [string, string, string, string][] };
    expect(o.length).toBeGreaterThan(3000);
    for (const [eco, name, uci, fen] of o.slice(0, 300)) {
      expect(eco).toMatch(/^[A-E]\d\d$/);
      expect(name).toBeTruthy();
      expect(parseLine(uci.split(' ').join(' ')).fens.at(-1)).toBe(fen);
    }
  });
});

describe('рейтинг кружка', () => {
  it('решил — растёт, ошибся — падает, сложнее задача — больше прибавка', () => {
    const win = update(START, 1200, true, 1);
    const lose = update(START, 1200, false, 1);
    expect(win.r).toBeGreaterThan(1200);
    expect(lose.r).toBeLessThan(1200);
    expect(update(START, 1600, true, 1).r).toBeGreaterThan(win.r);
    expect(win.rd).toBeLessThan(START.rd);
  });

  it('разряды по лесенке', () => {
    expect(rankOf({ r: 500, rd: 50, at: 0 }).short).toBe('б/р');
    expect(rankOf({ r: 1450, rd: 50, at: 0 }).short).toBe('III');
    expect(rankOf({ r: 2050, rd: 50, at: 0 }).short).toBe('КМС');
    expect(rankOf({ r: 2050, rd: 200, at: 0 }).provisional).toBe(true);
    // стартовый рейтинг — не разряд: до 10 задач «Новичок»
    expect(rankOf({ r: 1200, rd: 300, at: 0 }, 0).short).toBe('б/р');
    expect(rankOf({ r: 1200, rd: 300, at: 0 }, 10).short).toBe('I юн.');
  });
});
