/* Шпион: раздача, цепочка вопросов, обвинение (единогласно), догадка, конец времени, очки, тайна карточек, темы и подборки. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botSeats, simulate } from './harness';
import { def } from '../src/games/spy/def';
import { apply, makeView, remaining, setup, toAct, type Action, type State } from '../src/games/spy/engine';
import { pool, THEMES, WORDS_OF } from '../src/games/spy/themes';

const rng = () => new SeededRng(3);
const opts = (extra: Record<string, unknown> = {}) => ({ th_locations: true, time: 10, rounds: 3, ...extra }) as never;
function talk(n = 4, extra: Record<string, unknown> = {}): State {
  let s = setup(Array.from({ length: n }, (_, i) => i), opts(extra), rng());
  for (const x of s.seats) s = go(s, x, { type: 'ready', at: 1000 });
  return s;
}
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, `${seat}: ${JSON.stringify(a)}`).not.toBeNull();
  return r!.state;
};
const civ = (s: State) => s.seats.filter((x) => x !== s.spy);

describe('шпион', () => {
  it('базы: в каждой теме не меньше 60 слов, id уникальны, признаки в пределах вариантов', () => {
    for (const t of THEMES) {
      const ws = WORDS_OF[t.id];
      expect(ws.length, t.id).toBeGreaterThanOrEqual(60);
      expect(new Set(ws.map((w) => w.id)).size).toBe(ws.length);
      for (const w of ws) {
        expect(w.f.length, `${t.id}/${w.id}`).toBe(t.facets.length);
        w.f.forEach((v, i) => expect(v < t.facets[i].a.length, `${t.id}/${w.id}`).toBe(true));
      }
      for (const [sub] of t.subs ?? []) expect(pool(t.id, sub).length, `${t.id}/${sub}`).toBeGreaterThanOrEqual(15);
    }
  });

  it('раздача: шпион один, мирные видят слово и роль, чужие карточки скрыты', () => {
    const s = setup([0, 1, 2, 3], opts(), rng());
    expect(s.phase).toBe('deal');
    const v = makeView(s, [civ(s)[0]]);
    expect(Object.keys(v.cards)).toEqual([String(civ(s)[0])]);
    const c = v.cards[civ(s)[0]];
    expect(c.spy).toBe(false);
    if (!c.spy) {
      expect(c.word).toBe(s.word);
      expect(c.role).toBeTruthy();
    }
    expect(makeView(s, [s.spy]).cards[s.spy]).toEqual({ spy: true });
    expect(JSON.stringify(makeView(s, [s.spy]))).not.toContain(`"${s.word}"`);
  });

  it('цепочка: кого спросили — отвечает и спрашивает дальше, но не того, кто спросил его', () => {
    let s = talk();
    expect(s.phase).toBe('ask');
    expect(s.clock.start).toBe(1000);
    const a = s.asker;
    const b = s.seats.find((x) => x !== a)!;
    s = go(s, a, { type: 'ask', target: b, facet: 0 });
    expect(toAct(s)[0]).toBe(b);
    expect(apply(s, b, { type: 'answer', val: 99 }, rng())).toBeNull();
    s = go(s, b, { type: 'answer', val: 0 });
    expect(s.asker).toBe(b);
    expect(apply(s, b, { type: 'ask', target: a, facet: 1 }, rng())).toBeNull();
  });

  it('обвинение: единогласно — шпион пойман, обвинителю 2, остальным мирным по 1', () => {
    let s = talk();
    const [c1, c2, c3] = civ(s);
    s = go(s, c1, { type: 'accuse', target: s.spy, at: 61000 });
    expect(s.phase).toBe('vote');
    expect(s.clock).toEqual({ spent: 60000, start: null });
    s = go(s, c2, { type: 'vote', yes: true });
    s = go(s, c3, { type: 'vote', yes: true });
    expect(s.end?.outcome).toBe('caught');
    expect(s.scores[c1]).toBe(2);
    expect(s.scores[c2]).toBe(1);
    expect(s.scores[s.spy]).toBe(0);
  });

  it('обвинение: один против — снято, часы дальше; обвинить второй раз нельзя', () => {
    let s = talk();
    const [c1, c2] = civ(s);
    s = go(s, c1, { type: 'accuse', target: c2, at: 2000 });
    s = go(s, s.spy, { type: 'vote', yes: true });
    s = go(s, s.seats.find((x) => x !== c1 && x !== c2 && x !== s.spy)!, { type: 'vote', yes: false, at: 5000 });
    expect(s.phase).toBe('ask');
    expect(s.clock).toEqual({ spent: 1000, start: 5000 });
    expect(apply(s, c1, { type: 'accuse', target: s.spy }, rng())).toBeNull();
  });

  it('обвинили мирного — шпиону 4', () => {
    let s = talk();
    const [c1, c2, c3] = civ(s);
    s = go(s, c1, { type: 'accuse', target: c2 });
    s = go(s, c3, { type: 'vote', yes: true });
    s = go(s, s.spy, { type: 'vote', yes: true });
    expect(s.end?.outcome).toBe('innocent');
    expect(s.scores[s.spy]).toBe(4);
  });

  it('догадка: угадал — 4 шпиону, ошибся — по очку мирным', () => {
    let s = talk();
    const right = go(s, s.spy, { type: 'guess', word: s.word });
    expect(right.end?.outcome).toBe('guessed');
    expect(right.scores[s.spy]).toBe(4);
    const other = pool(s.theme, 'all').find((w) => w.id !== s.word)!;
    s = go(s, s.spy, { type: 'guess', word: other.id });
    expect(s.end?.outcome).toBe('wrongGuess');
    for (const x of civ(s)) expect(s.scores[x]).toBe(1);
    expect(apply(talk(), civ(talk())[0], { type: 'guess', word: 'banya' }, rng())).toBeNull();
  });

  it('время вышло: единогласно на шпиона — пойман; иначе шпиону 2', () => {
    let s = talk();
    s = go(s, s.asker, { type: 'timeup' });
    expect(s.phase).toBe('final');
    const [c1, c2, c3] = civ(s);
    let a = go(s, c1, { type: 'point', target: s.spy });
    a = go(a, c2, { type: 'point', target: s.spy });
    a = go(a, c3, { type: 'point', target: s.spy });
    a = go(a, s.spy, { type: 'point', target: c1 });
    expect(a.end?.outcome).toBe('caught');
    expect(a.scores[c1]).toBe(1);
    let b = go(s, c1, { type: 'point', target: s.spy });
    b = go(b, c2, { type: 'point', target: c3 });
    b = go(b, c3, { type: 'point', target: s.spy });
    b = go(b, s.spy, { type: 'point', target: c1 });
    expect(b.end?.outcome).toBe('timeout');
    expect(b.scores[b.spy]).toBe(2);
    // без ограничения времени конца времени нет
    const u = talk(4, { time: 0 });
    expect(apply(u, u.asker, { type: 'timeup' }, rng())).toBeNull();
    expect(remaining(makeView(u, 'all'), 99e9)).toBeNull();
  });

  it('раунды и смесь тем: тема меняется, слова не повторяются, после последнего — итог', async () => {
    const mix = Object.fromEntries(THEMES.map((t) => [`th_${t.id}`, true]));
    let s = setup([0, 1, 2], { ...mix, rounds: 4, time: 5 } as never, rng());
    const themes: string[] = [];
    const words = new Set<string>();
    for (let r = 0; r < 4; r++) {
      themes.push(s.theme);
      words.add(`${s.theme}/${s.word}`);
      for (const x of s.seats) s = go(s, x, { type: 'ready' });
      s = go(s, s.spy, { type: 'guess', word: s.word });
      s = go(s, 0, { type: 'next' });
    }
    expect(s.phase).toBe('over');
    expect(def.result(s)?.winners.length).toBeGreaterThan(0);
    for (let i = 1; i < themes.length; i++) expect(themes[i]).not.toBe(themes[i - 1]);
    expect(words.size).toBe(4);
  });

  it('подборка «мультфильмы» — только мультфильмы', () => {
    const s = setup([0, 1, 2], { th_movies: true, sub_movies: 'cartoons' } as never, rng());
    expect(s.theme).toBe('movies');
    expect(pool('movies', 'cartoons').map((w) => w.id)).toContain(s.word);
    expect(pool('movies', 'cartoons').every((w) => w.f[1] === 0)).toBe(true);
  });

  it('боты доигрывают партию на каждом уровне и в каждой теме', async () => {
    for (const t of THEMES)
      for (const lv of [0, 1, 2]) {
        const r = await simulate(def, botSeats(def, 5, [lv, lv, lv, lv, lv]), { [`th_${t.id}`]: true, th_locations: t.id === 'locations', rounds: 3, time: 0 }, 7 + lv);
        expect(r.error, `${t.id} ${lv}`).toBeUndefined();
        expect(r.finished, `${t.id} ${lv}`).toBe(true);
      }
  });
});
