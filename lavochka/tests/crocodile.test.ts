/* Крокодил: слово видит только показывающий (и загадавший), угадал — очки и переход хода, другая форма — с подтверждения,
 * пропуск и время, загадывает предыдущий / соперник, своё — только без ботов, команды, боты карточками и эмодзи. */
import { beforeAll, describe, expect, it } from 'vitest';
import { Authority } from '../src/core/authority';
import { SeededRng } from '../src/core/rng';
import type { Options } from '../src/core/types';
import { loadClues } from '../src/words/clues';
import { botSeats, defaults, simulate } from './harness';
import { def } from '../src/games/crocodile/def';
import { apply, makeView, redact, setup, toAct, type Action, type State } from '../src/games/crocodile/engine';
import { candidates, deckFor, EMOJI, isEmoji, itemText, judge, poolOf, type Item } from '../src/games/crocodile/words';
import { WORDS } from '../src/games/hat/words';
import { PROVERBS } from '../src/games/crocodile/phrases';

const rng = () => new SeededRng(5);
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, `${seat}: ${JSON.stringify(a)}`).not.toBeNull();
  return r!.state;
};
const W = (w: string): Item => ({ k: 'w', i: WORDS.findIndex((e) => e.w === w) });
const all = (n: number) => Array.from({ length: n }, (_, i) => i);
const people = (n: number, opts: Record<string, unknown> = {}) => setup(all(n), { time: 120, rounds: 2, ...opts } as Options, rng(), all(n));
const started = (s: State, it?: Item) => {
  if (it) s.item = it;
  return go(s, s.shower, { type: 'start' });
};

beforeAll(() => loadClues());

describe('крокодил', () => {
  it('данные: эмодзи без букв, колода бота от общего к точному, по колоде находится слово', () => {
    expect(EMOJI.length).toBeGreaterThan(1500);
    expect(isEmoji('🐝') && isEmoji('🍯') && isEmoji('🐊')).toBe(true);
    expect(isEmoji('🅰')).toBe(false);
    const it = W('самолёт');
    expect(it.i).toBeGreaterThanOrEqual(0);
    const deck = deckFor(it, 'gesture');
    expect(deck[0]).toEqual({ k: 'syl', n: 3 });
    expect(deck.some((c) => c.k === 'clue')).toBe(true);
    const found = candidates('w', deck).map(itemText);
    expect(found).toContain('самолёт');
    // эмодзи-крокодил: только слова с картинками
    const pool = poolOf('words', 'easy', 'emoji').w;
    expect(pool.length).toBeGreaterThan(500);
    for (const x of pool.slice(0, 50)) expect(deckFor(x, 'emoji').length).toBeGreaterThanOrEqual(1);
    // пословица — по словам
    const p: Item = { k: 'p', i: 0 };
    const pd = deckFor(p, 'gesture');
    expect(pd[0]).toEqual({ k: 'words', n: 8 });
    expect(candidates('p', pd.slice(0, 3)).map(itemText)).toEqual([PROVERBS[0]]);
  });

  it('сверка догадки: регистр и ё — верно, другая форма и опечатка — почти, остальное — нет', () => {
    const it = W('самолёт');
    expect(judge('САМОЛЕТ', it)).toBe('right');
    expect(judge('самолёты', it)).toBe('near');
    expect(judge('самалёт', it)).toBe('near');
    expect(judge('автобус', it)).toBe('no');
    const p: Item = { k: 'p', i: 0 };
    expect(judge('без труда не выловишь и рыбку из пруда!', p)).toBe('right');
    expect(judge('без труда не вытащишь и рыбку из пруда', p)).toBe('near');
    const f: Item = { k: 'f', i: 0 };
    expect(judge('ирония судьбы', f)).toBe('right');
  });

  it('слово видит только показывающий — и в view, и в событии', () => {
    const s = people(3);
    const r = apply(s, 0, { type: 'start' }, rng())!;
    expect(makeView(r.state, [0]).word).toBeTruthy();
    expect(makeView(r.state, [1]).word).toBeNull();
    const draw = r.events.find((e) => e.type === 'draw')!;
    expect(redact(draw, [1])).toMatchObject({ w: null });
    expect(redact(draw, [0])).toMatchObject({ w: makeView(r.state, [0]).word });
    // колода — тоже только показывающему
    expect(makeView(r.state, [0]).deck?.length).toBeGreaterThan(0);
    expect(makeView(r.state, [1]).deck).toBeNull();
  });

  it('угадали вслух: очки угадавшему и показывающему, угадавший показывает следующим', () => {
    let s = started(people(4), W('самовар'));
    expect(apply(s, 1, { type: 'got', by: 2 }, rng())).toBeNull();
    s = go(s, 0, { type: 'got', by: 2 });
    expect(s.phase).toBe('reveal');
    expect(s.pts[2]).toBe(1);
    expect(s.shown[0]).toBe(1);
    expect(makeView(s, [3]).last?.w).toBe('самовар');
    s = go(s, 3, { type: 'next' });
    expect(s.shower).toBe(2);
    // по кругу и «только угадавшему»
    let c = started(people(4, { order: 'circle', score: 'guesser' }), W('самовар'));
    c = go(go(c, 0, { type: 'got', by: 2 }), 0, { type: 'next' });
    expect(c.shower).toBe(1);
    expect(def.result!({ ...c, phase: 'over' })!.scores![0]).toBe(0);
  });

  it('написал: верно — само, почти — подтверждает показывающий; кивки', () => {
    let s = started(people(3), W('кошка'));
    s = go(s, 1, { type: 'guess', text: 'собака' });
    s = go(s, 0, { type: 'nod', id: 1, val: 'close' });
    expect(s.tries[0].nod).toBe('close');
    expect(apply(s, 0, { type: 'nod', id: 1, val: 'no' }, rng())).toBeNull();
    s = go(s, 2, { type: 'guess', text: 'кошки' });
    expect(s.phase).toBe('show');
    expect(s.tries[1].res).toBe('near');
    s = go(s, 0, { type: 'accept', id: 2 });
    expect(s.pts[2]).toBe(1);
    s = started(people(3), W('кошка'));
    s = go(s, 1, { type: 'guess', text: 'Кошка' });
    expect(s.phase).toBe('reveal');
    expect(s.pts[1]).toBe(1);
    // без кивков — нельзя
    const q = go(started(people(3, { nod: false }), W('кошка')), 1, { type: 'guess', text: 'собака' });
    expect(apply(q, 0, { type: 'nod', id: 1, val: 'no' }, rng())).toBeNull();
  });

  it('бот-показывающий сам засчитывает другую форму', () => {
    let s = setup([0, 1, 2], { time: 120 } as Options, rng(), [1, 2]);
    s = started(s, W('кошка'));
    expect(toAct(s)).toEqual([1, 2, 0]);
    s = go(s, 1, { type: 'guess', text: 'кошки' });
    expect(s.phase).toBe('reveal');
    expect(s.pts[1]).toBe(1);
  });

  it('пропуск: один за ход; нельзя; время и «сдаюсь»', () => {
    let s = started(people(3, { skip: 'one' }));
    const w0 = itemText(s.item!);
    s = go(s, 0, { type: 'skip' });
    expect(itemText(s.item!)).not.toBe(w0);
    expect(s.skipped).toEqual([w0]);
    expect(apply(s, 0, { type: 'skip' }, rng())).toBeNull();
    s = go(s, 2, { type: 'timeup' });
    expect(s.last?.res).toBe('timeup');
    const off = started(people(3, { skip: 'off' }));
    expect(apply(off, 0, { type: 'skip' }, rng())).toBeNull();
    const g = go(off, 0, { type: 'giveup' });
    expect(g.last?.res).toBe('giveup');
    // без времени «время вышло» не бывает
    expect(apply(started(people(3, { time: 0 })), 1, { type: 'timeup' }, rng())).toBeNull();
  });

  it('загадывает предыдущий показывающий; сам не угадывает; своё — только когда угадывают люди', () => {
    let s = people(4, { source: 'pick' });
    expect(s.phase).toBe('pick');
    expect(s.picker).toBe(3);
    expect(makeView(s, [3]).offers).toHaveLength(3);
    expect(makeView(s, [0]).offers).toBeNull();
    expect(makeView(s, [3]).canOwn).toBe(true);
    s = go(s, 3, { type: 'own', text: 'Чебурашка' });
    expect(makeView(s, [3]).word).toBe('Чебурашка');
    s = go(s, 0, { type: 'start' });
    expect(makeView(s, [0]).eligible).toEqual([1, 2]);
    expect(apply(s, 3, { type: 'guess', text: 'чебурашка' }, rng())).toBeNull();
    s = go(go(s, 1, { type: 'guess', text: 'чебурашка' }), 1, { type: 'next' });
    // следующему загадывает тот, кто показывал
    expect(s.shower).toBe(1);
    expect(s.picker).toBe(0);
    // с ботами — только из словаря
    const b = setup(all(4), { source: 'pick', time: 120 } as Options, rng(), [3]);
    expect(makeView(b, [3]).canOwn).toBe(false);
    expect(apply(b, 3, { type: 'own', text: 'слово' }, rng())).toBeNull();
  });

  it('командами: показывают своей команде, загадывает соперник, счёт у команды', () => {
    let s = people(4, { mode: 'teams', source: 'pick' });
    expect(s.teams).toEqual([[0, 2], [1, 3]]);
    expect(s.picker).toBe(1);
    s = go(go(s, 1, { type: 'offer', k: 0 }), 0, { type: 'start' });
    expect(makeView(s, [0]).eligible).toEqual([2]);
    expect(apply(s, 1, { type: 'guess', text: 'x' }, rng())).toBeNull();
    s = go(s, 0, { type: 'got', by: 2 });
    s = go(s, 1, { type: 'next' });
    expect(s.shower).toBe(1);
    expect(s.picker).toBe(0);
    const r = def.result!({ ...s, phase: 'over' })!;
    expect(r.winners.sort()).toEqual([0, 2]);
  });

  it('эмодзи-крокодил: человек выкладывает эмодзи, бот угадывает по ним', () => {
    let s = setup([0, 1, 2], { style: 'emoji', time: 120 } as Options, rng(), [0]);
    s = started(s, W('мёд'));
    expect(apply(s, 0, { type: 'emo', list: ['A'] }, rng())).toBeNull();
    s = go(s, 0, { type: 'emo', list: ['🐝', '🍯'] });
    expect(toAct(s)).toEqual([0, 1, 2]);
    const cands = candidates('w', s.cards).map(itemText);
    expect(cands).toContain('мёд');
  });

  it('боты доигрывают все пресеты на всех уровнях', async () => {
    for (const p of def.presets!) {
      for (const lv of [[0], [2]]) {
        const opts = { ...defaults(def), ...p.options } as Options;
        const n = opts.mode === 'teams' ? 4 : 3;
        const res = await simulate(def, botSeats(def, n, lv), opts, 21);
        expect(res.error, p.id).toBeUndefined();
        expect(res.finished, p.id).toBe(true);
      }
    }
  });

  it('сильные боты угадывают больше', async () => {
    // считаем по самим партиям: доля угаданных слов
    const rate = async (lv: number) => {
      let words = 0;
      let hit = 0;
      for (let k = 0; k < 8; k++) {
        const seats = botSeats(def, 4, [lv]);
        const opts = { ...defaults(def), rounds: 3, time: 60, skip: 'off' } as Options;
        const a = new Authority(def, seats, opts);
        a.rng = new SeededRng(400 + k);
        a.state = def.setup(seats, opts, a.rng);
        const brng = new SeededRng(k);
        for (let step = 0; step < 5000 && !a.result; step++) {
          const seat = a.toAct()[0];
          const act = await def.bot.choose(a.viewFor([seat]), seat, lv, brng);
          expect(a.act(seat, act)).toBeTruthy();
        }
        const st = a.state as State;
        words += st.log.length;
        hit += st.log.filter((x) => x.by != null).length;
      }
      return hit / words;
    };
    expect(await rate(2)).toBeGreaterThan(await rate(0));
  });
});
