/* Контент шахматного кружка: уроки, классические партии, термины — законные позиции и ходы, оглавление совпадает
 * с файлами, у вопросов партий есть комментарии, ссылки терминов ведут на уроки. (Проверка Stockfish — отдельно:
 * tools/kruzhok/lessons-check.ts --sf.) */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inCheck, play } from '../src/games/chess/engine';
import { fromUci, position, toFen } from '../src/games/chess/notation';
import type { ClassicGame, Lesson } from '../src/games/kruzhok/data';
import { starsBest, stepPositions } from '../src/games/kruzhok/lesson-steps';
import { themeIndex } from '../src/games/kruzhok/themes';
import { THEMES } from '../src/games/kruzhok/themes';

const LESSONS = 'src/games/kruzhok/lessons';
const files = readdirSync(LESSONS).filter((f) => /^\d\d-.*\.json$/.test(f));
const lessons = files.map((f) => ({ f, l: JSON.parse(readFileSync(join(LESSONS, f), 'utf8')) as Lesson }));

/** Позиция законна: по одному королю, у не ходящей стороны нет шаха, пешки не на крайних горизонталях. */
function legal(fen: string): string | null {
  const s = position(fen);
  if (s.board.filter((p) => p === 'K').length !== 1 || s.board.filter((p) => p === 'k').length !== 1) return 'короли';
  if (inCheck({ board: s.board, turn: (1 - s.turn) as 0 | 1 })) return 'шах не ходящей стороне';
  if (s.board.some((p, i) => (p === 'P' || p === 'p') && (i < 8 || i >= 56))) return 'пешка на краю';
  return null;
}

describe('учебник кружка', () => {
  it('оглавление совпадает с файлами уроков', () => {
    const idx = JSON.parse(readFileSync(join(LESSONS, 'index.json'), 'utf8')) as { id: string; n: number }[];
    expect(idx.map((x) => `${String(x.n).padStart(2, '0')}-${x.id}.json`).sort()).toEqual([...files].sort());
  });

  it('позиции, показ ходов и «Твой ход» законны', () => {
    const themes = new Set(THEMES.map((t) => t.id));
    for (const { f, l } of lessons) {
      expect(l.steps.length, f).toBeGreaterThan(2);
      for (const t of l.drill?.themes ?? []) expect(themes.has(t), `${f}: тема ${t}`).toBe(true);
      const starts = stepPositions(l);
      l.steps.forEach((st, i) => {
        const w = `${f} шаг ${i + 1}`;
        if (st.stars) {
          // «собери звёздочки»: без королей, ходят одни белые — главное, чтобы собиралось
          const pos = position(starts[i]);
          expect(pos.turn, w).toBe(0);
          expect(pos.board.includes('k'), `${w}: чёрный король тут ни к чему`).toBe(false);
          expect(starsBest(starts[i], st.stars.at), `${w}: не собрать`).toBeGreaterThan(0);
          return;
        }
        expect(legal(starts[i]), w).toBeNull();
        let s = position(starts[i]);
        for (const u of st.play ?? []) {
          const m = fromUci(s, u);
          expect(m, `${w}: play ${u}`).not.toBeNull();
          s = play(s, m!);
        }
        if (st.try) {
          for (const u of st.try.good) expect(fromUci(s, u), `${w}: try ${u} в ${toFen(s)}`).not.toBeNull();
          if (st.try.reply) expect(fromUci(play(s, fromUci(s, st.try.good[0])!), st.try.reply), `${w}: reply`).not.toBeNull();
        }
      });
    }
  });
});

describe('классические партии кружка', () => {
  const index = JSON.parse(readFileSync('public/kruzhok/games.json', 'utf8')) as { g: { id: string }[] };

  it('у каждой партии законные ходы, а у каждого вопроса — комментарий', () => {
    expect(index.g.length).toBeGreaterThan(30);
    for (const { id } of index.g) {
      const g = JSON.parse(readFileSync(`public/kruzhok/games/${id}.json`, 'utf8')) as ClassicGame;
      let s = position();
      for (const u of g.uci) {
        const m = fromUci(s, u);
        expect(m, `${id}: ${u}`).not.toBeNull();
        s = play(s, m!);
      }
      expect(g.intro, `${id}: вступление`).toBeTruthy();
      for (const st of g.stops) {
        expect(g.notes[st.ply], `${id}: нет комментария к вопросу ${st.ply}`).toBeTruthy();
        expect(st.good, `${id}: ${st.ply}`).toContain(g.uci[st.ply]);
      }
    }
  });
});

describe('термины кружка', () => {
  it('ссылки на уроки настоящие, иллюстрации законны', () => {
    const ids = new Set(lessons.map(({ l }) => l.id));
    const terms = JSON.parse(readFileSync('src/games/kruzhok/terms.json', 'utf8')) as { term: string; text: string; lesson?: string; fen?: string }[];
    expect(terms.length).toBeGreaterThan(50);
    for (const t of terms) {
      expect(t.text, t.term).toBeTruthy();
      if (t.lesson) expect(ids.has(t.lesson), `${t.term}: урок ${t.lesson}`).toBe(true);
      if (t.fen) expect(legal(t.fen), t.term).toBeNull();
    }
  });
});

describe('указатель тем для журнала', () => {
  it('совпадает с базой задач (иначе — npx tsx tools/kruzhok/puzzle-themes.ts)', () => {
    const db = JSON.parse(readFileSync('public/kruzhok/puzzles.json', 'utf8')) as { p: [string, string, string, number, string][] };
    const idx = JSON.parse(readFileSync('public/kruzhok/themes-index.json', 'utf8'));
    expect(idx).toEqual(themeIndex(db.p.map(([id, , , , th]) => [id, th.split(' ')])));
  });
});
