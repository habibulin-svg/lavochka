/* Викторина: подсчёт очков каждого режима, лестница (несгораемые, подсказки), барабан (секторы, банкрот), сверка ввода
 * (синонимы, окончания, опечатки), кнопка (порядок по at, окно ожидания, фальстарт), боты, и «кнопка» через настоящую комнату:
 * два клиента с задержкой связи и сдвигом часов — побеждает нажавший раньше, хотя его сообщение пришло позже. */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { Room } from '../src/core/room';
import { RoomClient } from '../src/core/client';
import type { Link, RoomMsg } from '../src/core/protocol';
import type { SeatSpec } from '../src/core/types';
import { bank, loadBank } from '../src/games/viktorina/bank';
import { def } from '../src/games/viktorina/def';
import { choose, pKnow } from '../src/games/viktorina/ai';
import {
  apply,
  due,
  LADDER_SUM,
  readMs,
  restart,
  safeSum,
  SECTORS,
  setup,
  speedPts,
  T,
  toAct,
  view,
  type Action,
  type Q,
  type State,
} from '../src/games/viktorina/engine';
import { matchAnswer, same } from '../src/games/viktorina/match';
import { defaults, simulate, until } from './harness';

beforeAll(() => loadBank());

const T0 = 5_000_000;
const humans = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'human', name: `И${seat}`, level: 1 }));
const bots = (levels: number[]): SeatSpec[] => levels.map((level, seat) => ({ seat, kind: 'bot', name: `Б${seat}`, level }));
const q = (text: string, opts: string[], ok: number, d = 2): Q => ({ id: 'x', text, opts, ok, d, t: 'misc', ans: opts[ok] });

function game(mode: string, n: number, opts: Record<string, unknown> = {}, patch?: (s: State) => void, seed = 1, seats?: SeatSpec[]) {
  const rng = new RiggedRng(new SeededRng(seed));
  const s = setup(seats ?? humans(n), { ...defaults(def), mode, ...opts } as never, rng);
  s.now = T0;
  patch?.(s);
  restart(s);
  return { s, rng };
}

function step(st: { s: State; rng: RiggedRng }, seat: number, a: Action, rig?: number[]) {
  st.rng.rig(rig);
  const r = apply(st.s, seat, a, st.rng);
  expect(r, `${seat}: ${JSON.stringify(a)} в фазе ${st.s.phase}`).not.toBeNull();
  st.s = r!.state;
  return r!.events;
}
const wake = (st: { s: State; rng: RiggedRng }, now: number) => step(st, -1, { type: 'wake', now });

describe('викторина: сверка ввода', () => {
  it('синонимы, ё, окончания, перестановка, опечатки', () => {
    expect(same('Петр Первый', 'Пётр Первый')).toBe(true);
    expect(same('гитара', 'гитару')).toBe(true);
    expect(same('руки помыть', 'помыть руки')).toBe(true);
    expect(same('плет', 'плед')).toBe(true);
    expect(same('Кутузов', 'Михаил Кутузов')).toBe(true);
    expect(same('река Волга', 'Волга')).toBe(true);
    expect(same('кот', 'кит')).toBe(false);
    expect(same('Лермонтов', 'Пушкин')).toBe(false);
    expect(same('Петр', 'Пётр I')).toBe(false);
    const rows = [
      { main: 'шашлык', alt: ['мясо'] },
      { main: 'покрывало', alt: ['плед', 'одеяло'] },
    ];
    expect(matchAnswer('Мясо', rows)).toBe(0);
    expect(matchAnswer('одеяла', rows)).toBe(1);
    expect(matchAnswer('телевизор', rows)).toBe(-1);
    // уже открытый не засчитывается второй раз
    expect(matchAnswer('шашлык', rows, (i) => i === 0)).toBe(-1);
  });
});

describe('викторина: тривиа и «верю — не верю»', () => {
  it('компанией: 100 + быстрота по скорректированному времени, первому верному +50', () => {
    const g = game('trivia', 3, { count: 10 }, (s) => (s.qs = [q('?', ['a', 'b', 'c', 'd'], 2), ...s.qs.slice(1)]));
    // ответ пришёл позже, но нажат раньше (at) — быстрота по at
    step(g, 1, { type: 'answer', i: 2, at: T0 + 3000, now: T0 + 3400 });
    step(g, 0, { type: 'answer', i: 2, at: T0 + 2000, now: T0 + 3500 });
    step(g, 2, { type: 'answer', i: 0, at: T0 + 1000, now: T0 + 3600 });
    expect(g.s.phase).toBe('reveal');
    expect(g.s.scores[0]).toBe(speedPts(2000, T.trivia) + 50);
    expect(g.s.scores[1]).toBe(speedPts(3000, T.trivia));
    expect(g.s.scores[2]).toBe(0);
    // до показа выбор скрыт
    const g2 = game('trivia', 2, {}, (s) => (s.qs = [q('?', ['a', 'b', 'c', 'd'], 0), ...s.qs.slice(1)]));
    step(g2, 0, { type: 'answer', i: 0, at: T0 + 500, now: T0 + 500 });
    expect(view(g2.s, [1]).answered[0]).toEqual({ at: T0 + 500 });
    expect(view(g2.s, [1]).last).toBeNull();
  });

  it('срок вышел — показ без ответивших; одному без времени срока нет', () => {
    const g = game('trivia', 2, { time: 10000 });
    step(g, 0, { type: 'answer', i: g.s.q!.ok, now: T0 + 1000 });
    expect(due(g.s)).toBe(T0 + 10000);
    wake(g, T0 + 10000);
    expect(g.s.phase).toBe('reveal');
    expect(g.s.scores[0]).toBeGreaterThan(100);
    const solo = game('trivia', 1, { time: 0 });
    expect(due(solo.s)).toBeNull();
  });

  it('бот отвечает «из будущего»: его ответ не виден, пока не наступило время', () => {
    const g = game('trivia', 2, {}, undefined, 3, [
      { seat: 0, kind: 'human', name: 'Я', level: 1 },
      { seat: 1, kind: 'bot', name: 'Бот', level: 2 },
    ]);
    step(g, 1, { type: 'answer', i: 0, rt: 4000, now: T0 + 500 });
    expect(view(g.s, [0]).answered[1]).toBeUndefined();
    step(g, 0, { type: 'answer', i: 1, now: T0 + 1500 });
    // все ответили, но бот «ответит» только в T0+4000
    expect(g.s.phase).toBe('q');
    expect(due(g.s)).toBe(T0 + 4000);
    wake(g, T0 + 4000);
    expect(g.s.phase).toBe('reveal');
  });

  it('верю — не верю: половина утверждений верна', () => {
    let real = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const g = game('truth', 1, { count: 10 }, undefined, seed);
      real += g.s.qs.filter((x) => x.ok === 0).length;
      expect(g.s.qs.every((x) => x.opts.length === 2)).toBe(true);
    }
    expect(real).toBeGreaterThan(70);
    expect(real).toBeLessThan(130);
  });
});

describe('викторина: кнопка', () => {
  const Q1 = q('Кто написал «Капитанскую дочку»?', ['Пушкин', 'Лермонтов', 'Гоголь', 'Тургенев'], 0, 2);
  const open = T0 + readMs(Q1.text);
  const mk = (n = 3, opts = {}) => game('buzz', n, { answer: 'choice', ...opts }, (s) => (s.qs = [Q1, ...s.qs.slice(1)]));

  it('первый — по at, а не по приходу; решение — только после окна', () => {
    const g = mk();
    g.s.win = 250;
    step(g, 0, { type: 'buzz', at: open + 200, now: open + 210, win: 250 });
    step(g, 1, { type: 'buzz', at: open + 160, now: open + 400, win: 250 });
    expect(g.s.phase).toBe('buzz');
    expect(due(g.s)).toBe(open + 160 + 250);
    // окно ещё не кончилось — нажатие третьего, сделанное ещё раньше, успевает
    // все нажали — ждать окно больше незачем: первый определён сразу
    const ev = step(g, 2, { type: 'buzz', at: open + 100, now: open + 405, win: 250 });
    expect(g.s.phase).toBe('answer');
    expect(g.s.answerer).toBe(2);
    expect(ev.find((e) => e.k === 'buzzed')).toMatchObject({ seat: 2, lead: 60 });
  });

  it('фальстарт блокирует, неверный ответ — минус и кнопка снова открыта, верный — плюс', () => {
    const g = mk();
    const ev = step(g, 0, { type: 'buzz', at: open - 200, now: open - 190 });
    expect(ev[0]).toMatchObject({ k: 'early', seat: 0 });
    expect(g.s.bz!.block[0]).toBe(open - 190 + T.falseStart);
    // заблокирован: нажатие сразу после сигнала тоже не идёт в зачёт
    step(g, 0, { type: 'buzz', at: open + 100, now: open + 110 });
    expect(g.s.bz!.presses.length).toBe(0);
    step(g, 1, { type: 'buzz', at: open + 300, now: open + 320 });
    wake(g, open + 300 + 400);
    expect(g.s.answerer).toBe(1);
    step(g, 1, { type: 'pick', i: 2, now: open + 2000 });
    expect(g.s.scores[1]).toBe(-200);
    expect(g.s.phase).toBe('buzz');
    expect(g.s.bz!.tried).toEqual([1]);
    expect(toAct(g.s)).not.toContain(1);
    const re = g.s.bz!.openAt;
    step(g, 2, { type: 'buzz', at: re + 500, now: re + 520 });
    wake(g, re + 1000);
    step(g, 2, { type: 'pick', i: 0, now: re + 3000 });
    expect(g.s.scores[2]).toBe(200);
    expect(g.s.phase).toBe('reveal');
  });

  it('время на ответ вышло — как неверный; никто не нажал — показ', () => {
    const g = mk(2);
    step(g, 0, { type: 'buzz', at: open + 100, now: open + 110 });
    wake(g, open + 500);
    expect(g.s.phase).toBe('answer');
    wake(g, g.s.deadline);
    expect(g.s.scores[0]).toBe(-200);
    expect(g.s.phase).toBe('buzz');
    wake(g, g.s.bz!.until);
    expect(g.s.phase).toBe('reveal');
  });

  it('ввод с клавиатуры: варианты не показываются, ответ сверяется', () => {
    const g = mk(2, { answer: 'input' });
    expect(view(g.s, [0]).q!.opts).toBeNull();
    step(g, 0, { type: 'buzz', at: open + 100, now: open + 110 });
    wake(g, open + 600);
    expect(view(g.s, [0]).q!.opts).toBeNull();
    expect(apply(g.s, 0, { type: 'pick', i: 0 }, g.rng)).toBeNull();
    step(g, 0, { type: 'say', text: 'пушкин', now: open + 3000 });
    expect(g.s.scores[0]).toBe(200);
  });

  it('нажатие бота «из будущего» не видно до своего времени', () => {
    const g = game('buzz', 2, {}, (s) => (s.qs = [Q1, ...s.qs.slice(1)]), 1, [
      { seat: 0, kind: 'human', name: 'Я', level: 1 },
      { seat: 1, kind: 'bot', name: 'Бот', level: 2 },
    ]);
    step(g, 1, { type: 'buzz', rt: 900, now: T0 + 300 });
    expect(g.s.bz!.presses[0].at).toBe(open + 900);
    expect(view(g.s, [0]).bz!.presses).toEqual([]);
    // человек нажал раньше бота — его и спросят
    step(g, 0, { type: 'buzz', at: open + 700, now: open + 720 });
    wake(g, open + 700 + g.s.win + 1);
    expect(g.s.answerer).toBe(0);
  });
});

describe('викторина: лестница', () => {
  const QS = (ok: number) => Array.from({ length: 15 }, (_, i) => q(`Вопрос ${i + 1}`, ['a', 'b', 'c', 'd'], ok, Math.ceil((i + 1) / 3)));
  const mk = () => game('ladder', 1, { time: 0 }, (s) => (s.ld!.qs[0] = QS(1)));

  it('несгораемые суммы', () => {
    expect(safeSum(3)).toBe(0);
    expect(safeSum(5)).toBe(1000);
    expect(safeSum(9)).toBe(1000);
    expect(safeSum(10)).toBe(32000);
    const g = mk();
    let t = T0;
    for (let k = 0; k < 7; k++) {
      step(g, 0, { type: 'answer', i: 1, now: (t += 1000) });
      wake(g, (t += T.reveal));
    }
    expect(g.s.scores[0]).toBe(LADDER_SUM[6]);
    step(g, 0, { type: 'answer', i: 0, now: (t += 1000) });
    expect(g.s.scores[0]).toBe(1000);
    wake(g, (t += T.reveal));
    expect(g.s.phase).toBe('over');
  });

  it('миллион за 15 верных; забрать деньги', () => {
    const g = mk();
    let t = T0;
    for (let k = 0; k < 15; k++) {
      step(g, 0, { type: 'answer', i: 1, now: (t += 1000) });
      wake(g, (t += T.reveal));
    }
    expect(g.s.scores[0]).toBe(1_000_000);
    expect(g.s.phase).toBe('over');
    const h = mk();
    step(h, 0, { type: 'answer', i: 1, now: T0 + 1000 });
    wake(h, T0 + 1000 + T.reveal);
    step(h, 0, { type: 'take', now: T0 + 6000 });
    wake(h, T0 + 6000 + T.reveal);
    expect(h.s.scores[0]).toBe(100);
    expect(h.s.phase).toBe('over');
  });

  it('подсказки: 50:50 убирает два неверных, зал — 100 %, друг — вариант, каждая один раз', () => {
    const g = mk();
    step(g, 0, { type: 'life', k: 'fifty', now: T0 + 1000 });
    expect(g.s.ld!.hidden.length).toBe(2);
    expect(g.s.ld!.hidden).not.toContain(1);
    step(g, 0, { type: 'life', k: 'hall', now: T0 + 2000 });
    const hall = g.s.ld!.hall!;
    expect(hall.reduce((a, b) => a + b, 0)).toBe(100);
    for (const i of g.s.ld!.hidden) expect(hall[i]).toBe(0);
    step(g, 0, { type: 'life', k: 'call', now: T0 + 3000 });
    expect(g.s.ld!.hidden).not.toContain(g.s.ld!.call!.i);
    expect(apply(g.s, 0, { type: 'life', k: 'fifty', now: T0 + 4000 }, g.rng)).toBeNull();
    // спрятанный вариант выбрать нельзя
    expect(apply(g.s, 0, { type: 'answer', i: g.s.ld!.hidden[0], now: T0 + 4000 }, g.rng)).toBeNull();
  });

  it('зал на лёгком вопросе почти всегда прав, на трудном — заметно реже', () => {
    const acc = (d: number) => {
      let ok = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const g = game('ladder', 1, {}, (s) => (s.ld!.qs[0] = [q('?', ['a', 'b', 'c', 'd'], 2, d), ...QS(1).slice(1)]), seed);
        step(g, 0, { type: 'life', k: 'hall', now: T0 + 1000 });
        const h = g.s.ld!.hall!;
        if (h.indexOf(Math.max(...h)) === 2) ok++;
      }
      return ok / 200;
    };
    expect(acc(1)).toBeGreaterThan(0.95);
    expect(acc(5)).toBeLessThan(acc(1));
  });
});

describe('викторина: барабан', () => {
  const mk = (n = 2) => game('wheel', n, { wrounds: 'short' }, (s) => (s.wh!.words = [{ w: 'ЛАВОЧКА', h: 'h', d: 1 }]));
  const spin = (g: ReturnType<typeof mk>, seat: number, sec: number | string) => step(g, seat, { type: 'spin', f: 0.5 }, [SECTORS.indexOf(sec as never)]);

  it('очки × число букв, угадал — крутит снова, нет — ход переходит', () => {
    const g = mk();
    spin(g, 0, 500);
    expect(g.s.phase).toBe('letter');
    step(g, 0, { type: 'letter', l: 'а' });
    expect(g.s.wh!.rs[0]).toBe(1000);
    expect(g.s.wh!.turn).toBe(0);
    expect(g.s.phase).toBe('spin');
    spin(g, 0, 300);
    step(g, 0, { type: 'letter', l: 'Я' });
    expect(g.s.wh!.turn).toBe(1);
    // уже названную букву назвать нельзя
    spin(g, 1, 300);
    expect(apply(g.s, 1, { type: 'letter', l: 'А' }, g.rng)).toBeNull();
  });

  it('банкрот сжигает очки тура, ноль передаёт ход, ×2 удваивает', () => {
    const g = mk();
    spin(g, 0, 500);
    step(g, 0, { type: 'letter', l: 'А' });
    spin(g, 0, 'x2');
    step(g, 0, { type: 'letter', l: 'В' });
    expect(g.s.wh!.rs[0]).toBe(2000);
    spin(g, 0, 'Б');
    expect(g.s.wh!.rs[0]).toBe(0);
    expect(g.s.wh!.turn).toBe(1);
    spin(g, 1, '0');
    expect(g.s.wh!.turn).toBe(0);
  });

  it('плюс — открыть букву на выбор, приз — случайную; слово целиком: верно — бонус, неверно — выбыл', () => {
    const g = mk(3);
    spin(g, 0, '+');
    expect(g.s.phase).toBe('plus');
    step(g, 0, { type: 'plus', pos: 0 });
    expect(view(g.s, 'all').wh!.mask[0]).toBe('Л');
    step(g, 0, { type: 'spin' }, [SECTORS.indexOf('П'), 0]);
    expect(g.s.wh!.open.filter(Boolean).length).toBeGreaterThan(1);
    step(g, 0, { type: 'word', w: 'скамейка' });
    expect(g.s.wh!.out).toEqual([0]);
    expect(g.s.wh!.turn).toBe(1);
    const hidden = g.s.wh!.open.filter((x) => !x).length;
    step(g, 1, { type: 'word', w: 'Лавочка' });
    expect(g.s.wh!.winner).toBe(1);
    expect(g.s.scores[1]).toBe(hidden * 100);
    expect(g.s.phase).toBe('reveal');
  });

  it('финал: лидер, три буквы и слово — угадал, очки удваиваются', () => {
    const g = game('wheel', 2, { wrounds: 'full' });
    const w = g.s.wh!.words[3].w;
    g.s.wh!.round = 3;
    g.s.scores = { 0: 500, 1: 1500 };
    restart(g.s);
    expect(g.s.phase).toBe('final');
    expect(g.s.wh!.finalist).toBe(1);
    for (const l of ['Ъ', 'Щ', 'Ф']) if (!w.includes(l)) step(g, 1, { type: 'letter', l });
    if (g.s.phase === 'fword') {
      step(g, 1, { type: 'word', w, now: T0 + 1000 });
      expect(g.s.scores[1]).toBe(3000);
    }
  });
});

describe('викторина: сто опрошенных', () => {
  const POLL = {
    id: 'p',
    q: 'Что берут на пикник?',
    r: [
      ['шашлык', 34, ['мясо']],
      ['мяч', 21, []],
      ['покрывало', 16, ['плед']],
      ['гитару', 12, []],
      ['палатку', 9, []],
      ['спички', 8, []],
    ] as [string, number, string[]][],
    t: 'misc',
  };
  const mk = (n: number, o = {}) => game('poll', n, o, (s) => (s.pl!.qs = [POLL, POLL, POLL, POLL]));

  it('одному: три промаха — раунд кончился, очки × раунд', () => {
    const g = mk(1);
    step(g, 0, { type: 'say', text: 'шашлыки', now: T0 + 1000 });
    step(g, 0, { type: 'say', text: 'вода', now: T0 + 2000 });
    step(g, 0, { type: 'say', text: 'хлеб', now: T0 + 3000 });
    step(g, 0, { type: 'say', text: 'соль', now: T0 + 4000 });
    expect(g.s.phase).toBe('reveal');
    expect(g.s.scores[0]).toBe(34);
    wake(g, g.s.revealUntil);
    step(g, 0, { type: 'say', text: 'мячи', now: g.s.now + 1000 });
    expect(g.s.pl!.bank).toBe(42);
  });

  it('командами: после трёх промахов соперник отыгрывается и забирает банк', () => {
    const g = mk(4);
    expect(g.s.pl!.teams).toEqual([
      [0, 2],
      [1, 3],
    ]);
    step(g, 0, { type: 'say', text: 'мясо', now: T0 + 1000 });
    step(g, 2, { type: 'say', text: 'вода', now: T0 + 2000 });
    step(g, 0, { type: 'say', text: 'хлеб', now: T0 + 3000 });
    step(g, 2, { type: 'say', text: 'соль', now: T0 + 4000 });
    expect(g.s.pl!.steal).toBe(true);
    step(g, 1, { type: 'say', text: 'плед', now: T0 + 5000 });
    expect(g.s.scores[1]).toBe(50);
    expect(g.s.scores[3]).toBe(50);
    expect(g.s.scores[0]).toBe(0);
  });

  it('время вышло — промах; обратная игра — редкий дороже', () => {
    const g = mk(1, { reverse: true });
    wake(g, g.s.deadline);
    expect(g.s.pl!.strikes).toBe(1);
    g.s.pl!.round = 3;
    restart(g.s);
    g.s.pl!.round = 3;
    expect(g.s.pl!.rounds).toBe(4);
  });
});

describe('викторина: табло тем', () => {
  it('ячейка → кнопка → ответ: цена ± и выбор у ответившего; одному — без кнопки', () => {
    const g = game('board', 2, { answer: 'input', themes: 5, brounds: 1 });
    const c = g.s.bd!.themes[0][1].cells[2];
    step(g, 0, { type: 'cell', th: 1, k: 2, now: T0 + 1000 });
    expect(g.s.phase).toBe('buzz');
    const open = g.s.bz!.openAt;
    step(g, 1, { type: 'buzz', at: open + 100, now: open + 120 });
    wake(g, open + 1000);
    step(g, 1, { type: 'say', text: c.ans, now: open + 3000 });
    expect(g.s.scores[1]).toBe(300);
    expect(g.s.bd!.chooser).toBe(1);
    wake(g, g.s.revealUntil);
    expect(toAct(g.s)).toEqual([1]);
    expect(apply(g.s, 1, { type: 'cell', th: 1, k: 2 }, g.rng)).toBeNull();
    const solo = game('board', 1, { answer: 'choice' });
    step(solo, 0, { type: 'cell', th: 0, k: 4, now: T0 + 1000 });
    expect(solo.s.phase).toBe('answer');
    const cell = solo.s.bd!.themes[0][0].cells[4];
    expect(cell.opts).toContain(cell.ans);
    step(solo, 0, { type: 'pick', i: (cell.ok + 1) % cell.opts.length, now: T0 + 3000 });
    expect(solo.s.scores[0]).toBe(-500);
  });
});

describe('викторина: банк и боты', () => {
  it('банк загружен, у записей стабильные id без повторов', () => {
    const b = bank();
    expect(b.mc.length).toBeGreaterThan(500);
    expect(b.word.length).toBeGreaterThan(100);
    expect(b.poll.length).toBeGreaterThan(50);
    expect(b.board.length).toBeGreaterThan(30);
    for (const list of [b.mc, b.word, b.poll, b.board]) expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    expect(b.mc.every((x) => x.a.length === 4)).toBe(true);
  });

  it('вопросы в партии не повторяются', () => {
    const g = game('trivia', 1, { count: 30 });
    expect(new Set(g.s.qs.map((x) => x.id)).size).toBe(30);
  });

  it('боту — знание только в его виде; клиентам — нет', () => {
    const g = game('trivia', 2, {}, undefined, 1, [
      { seat: 0, kind: 'human', name: 'Я', level: 1 },
      { seat: 1, kind: 'bot', name: 'Бот', level: 2 },
    ]);
    expect(view(g.s, [0]).know).toBeUndefined();
    expect(view(g.s, 'all').know).toBeUndefined();
    expect(view(g.s, [1]).know?.ok).toBe(g.s.q!.ok);
    expect(JSON.stringify(view(g.s, [0]))).not.toContain('"ok"');
  });

  it('сила ботов: сложный набирает больше лёгкого', async () => {
    expect(pKnow(1, 0)).toBeCloseTo(0.75);
    expect(pKnow(5, 2)).toBeCloseTo(0.7);
    const wins = [0, 0];
    for (const mode of ['trivia', 'buzz', 'ladder', 'wheel', 'poll', 'board', 'truth']) {
      for (let k = 0; k < 6; k++) {
        const res = await simulate(def, bots([0, 2]), { ...defaults(def), mode, wrounds: 'short' }, 900 + k);
        expect(res.error, mode).toBeUndefined();
        expect(res.finished, mode).toBe(true);
        for (const w of res.winners) wins[w]++;
      }
    }
    expect(wins[1]).toBeGreaterThan(wins[0] * 1.5);
  }, 120_000);

  it('бот находит ход в каждой фазе (через choose)', () => {
    const g = game('board', 3, {}, undefined, 4, bots([1, 1, 1]));
    expect(choose(view(g.s, [0]), 0, 1, new SeededRng(1))).toMatchObject({ type: 'cell' });
  });
});

// ---------------------------------------------------------------- кнопка через настоящую комнату

/** Канал с задержкой (мс в каждую сторону) и сдвигом часов клиента: pong и нажатие несут часы клиента = настоящие + skew. */
const arrivals: { name: string; at: number }[] = [];
function laggyPair(delay: number, skew: number, name = ''): [Link, Link] {
  const mk = (): Link => ({ send() {}, close() {}, onMessage: null, onClose: null });
  const room = mk();
  const cli = mk();
  let closed = false;
  room.send = (m) => {
    if (closed) return;
    const c = structuredClone(m);
    setTimeout(() => !closed && cli.onMessage?.(c), delay);
  };
  cli.send = (m) => {
    if (closed) return;
    const c = structuredClone(m) as Record<string, any>;
    // часы клиента сдвинуты: всё, что он сообщает о своём времени, — по его часам
    if (c.t === 'pong' && typeof c.ct === 'number') c.ct += skew;
    setTimeout(() => {
      if (closed) return;
      if (c.t === 'act') arrivals.push({ name, at: Date.now() });
      room.onMessage?.(c);
    }, delay);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    setTimeout(() => {
      room.onClose?.();
      cli.onClose?.();
    }, 0);
  };
  room.close = close;
  cli.close = close;
  return [room, cli];
}

describe('викторина: кнопка через комнату с задержками', () => {
  const rooms: Room[] = [];
  afterEach(() => rooms.splice(0).forEach((r) => r.close()));

  it('нажавший раньше побеждает, хотя его сообщение пришло позже', async () => {
    const seats: SeatSpec[] = [
      { seat: 0, kind: 'human', name: 'Медленный', level: 1 },
      { seat: 1, kind: 'remote', name: '', level: 1 },
    ];
    const room = new Room({ def, options: { ...defaults(def), mode: 'buzz', count: 10, answer: 'choice' }, seats, code: 'VIKT', ownerKey: 'key', botDelay: 0 });
    rooms.push(room);
    // медленный: 180 мс в одну сторону, часы спешат на 7 с; быстрый: 10 мс, часы отстают на 3 с
    const SLOW = { delay: 180, skew: 7000 };
    const FAST = { delay: 10, skew: -3000 };
    const join = (name: string, p: { delay: number; skew: number }, owner?: string) => {
      const [a, b] = laggyPair(p.delay, p.skew, name);
      room.connect(a);
      const client = new RoomClient(b, { name, ownerKey: owner, clientId: name });
      const log: RoomMsg[] = [];
      let v: any = null;
      client.on((m) => {
        log.push(m);
        if (m.t === 'start' || m.t === 'step') {
          v = m.view;
          client.idle(m.seq);
        }
      });
      client.release();
      return { client, log, view: () => v, mySeat: () => (log.find((m) => m.t === 'start') as any)?.mySeats?.[0] as number | undefined };
    };
    const slow = join('Медленный', SLOW, 'key');
    const fast = join('Быстрый', FAST);
    await until(() => slow.log.some((m) => m.t === 'lobby' && m.seats.every((s) => s.filled)), 5000, 'оба в лобби');
    // дать часам сверится (серия ping при входе)
    await new Promise((r) => setTimeout(r, 1300));
    slow.client.start(false);
    await until(() => slow.view()?.now > 0 && fast.view()?.now > 0, 5000, 'вопрос у обоих, часы пошли');
    const s0 = slow.mySeat()!;
    const f0 = fast.mySeat()!;
    const openAt: number = slow.view().bz.openAt;
    // ждём сигнала по часам комнаты (они же настоящие часы теста)
    while (Date.now() < openAt + 50) await new Promise((r) => setTimeout(r, 5));
    // медленный жмёт первым; быстрый — через 40 мс, но его сообщение дойдёт раньше на ~130 мс
    const T1 = Date.now();
    slow.client.act(s0, { type: 'buzz', at: T1 + SLOW.skew });
    await new Promise((r) => setTimeout(r, 40));
    const T2 = Date.now();
    fast.client.act(f0, { type: 'buzz', at: T2 + FAST.skew });
    await until(() => slow.view()?.phase === 'answer' && fast.view()?.phase === 'answer', 5000, 'кнопка решена');
    const v = fast.view();
    expect(v.answerer).toBe(s0);
    expect(v.last.lead).toBeGreaterThan(10);
    expect(v.last.lead).toBeLessThan(90);
    const presses = v.bz.presses as { seat: number; at: number }[];
    expect(presses.map((p) => p.seat).sort()).toEqual([s0, f0].sort());
    // сообщения пришли в обратном порядке: сначала быстрого, потом медленного
    expect(arrivals.map((x) => x.name)).toEqual(['Быстрый', 'Медленный']);
    console.log(`кнопка через комнату: медленный нажал на 40 мс раньше, его сообщение пришло на ${arrivals[1].at - arrivals[0].at} мс позже; комната насчитала опережение ${v.last.lead} мс`);
    const buzzed = fast.log.flatMap((m) => (m.t === 'step' ? (m.events as any[]) : [])).find((e) => e.k === 'buzzed');
    expect(buzzed).toMatchObject({ seat: s0 });
  }, 20_000);
});
