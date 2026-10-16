/* Данетки: бот-ведущий отвечает по сценарию, круги и подсказки, очки 3+уровень минус подсказки, время вышло, живой ведущий, без правил, тайна разгадки. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { botSeats, simulate } from './harness';
import { def } from '../src/games/danetki/def';
import { DANETKI, danetka } from '../src/games/danetki/data';
import { apply, makeView, setup, toAct, type Action, type State } from '../src/games/danetki/engine';

const rng = () => new SeededRng(9);
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, `${seat}: ${JSON.stringify(a)}`).not.toBeNull();
  return r!.state;
};
const d0 = () => danetka(DANETKI[0].id)!;
function at(opts: Record<string, unknown>, humans: number[] = [], n = 3): State {
  const s = setup(Array.from({ length: n }, (_, i) => i), { mode: 'rules', host: 'bot', count: 3, ...opts } as never, rng(), humans);
  s.id = DANETKI[0].id;
  return s;
}

describe('данетки', () => {
  it('база: у каждой данетки сценарий — вопросы, подсказки, четыре варианта', () => {
    expect(DANETKI.length).toBeGreaterThan(0);
    for (const d of DANETKI) {
      expect(d.questions.length, String(d.id)).toBeGreaterThanOrEqual(8);
      expect(d.options.length).toBe(4);
      expect(d.hints.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('бот-ведущий: ответ по сценарию, круг — подсказка, после последнего круга время вышло', () => {
    let s = at({}, [], 4);
    expect(s.players).toEqual([0, 1, 2, 3]);
    expect(s.circles).toBe(4);
    const d = d0();
    for (let c = 0; c < 4; c++)
      for (const x of [0, 1, 2, 3]) {
        if (s.phase !== 'play') break;
        s = go(s, x, { type: 'ask', q: (c * 4 + x) % d.questions.length });
        if (c === 0 && x === 0) expect(s.log[0].a).toBe(d.questions[0].a);
      }
    expect(s.hints).toBe(Math.min(3, d.hints.length));
    expect(s.phase).toBe('reveal');
    expect(s.last?.solver).toBeNull();
    // свободный вопрос боту-ведущему нельзя
    expect(apply(at({}), 0, { type: 'ask', text: 'Он умер?' }, rng())).toBeNull();
  });

  it('разгадка: верный вариант — 3+уровень минус подсказки; неверный — ход дальше', () => {
    let s = at({});
    const correct = s.optOrder.indexOf(0);
    const wrong = [0, 1, 2, 3].find((i) => i !== correct)!;
    s = go(s, 0, { type: 'guess', opt: wrong });
    expect(s.turn).toBe(1);
    expect(apply(s, 1, { type: 'guess', opt: wrong }, rng())).toBeNull();
    s.hints = 1;
    s = go(s, 1, { type: 'guess', opt: correct });
    expect(s.phase).toBe('reveal');
    expect(s.scores[1]).toBe(3 + d0().level - 1);
  });

  it('разгадку видит только ведущий (и все — после раскрытия)', () => {
    const s = at({ host: 'players' }, [0, 1, 2]);
    expect(s.host).toBe(0);
    expect(s.players).toEqual([1, 2]);
    expect(makeView(s, [1]).secret).toBeUndefined();
    expect(makeView(s, [0]).secret?.answer).toBe(d0().answer);
  });

  it('живой ведущий: свободный вопрос ждёт его ответа; разгадку своими словами он судит', () => {
    let s = at({ host: 'players' }, [0, 1, 2]);
    s = go(s, 1, { type: 'ask', text: 'Он умер от холода?' });
    expect(toAct(s)).toEqual([0]);
    s = go(s, 0, { type: 'answer', a: 'n' });
    expect(s.turn).toBe(2);
    s = go(s, 2, { type: 'guess', text: 'Он прыгнул с воздушного шара' });
    s = go(s, 0, { type: 'judge', right: true });
    expect(s.last?.solver).toBe(2);
    expect(s.scores[2]).toBe(3 + d0().level);
  });

  it('без правил: подсказка по просьбе, можно сдаться, очков нет', () => {
    let s = at({ mode: 'free' });
    s = go(s, 0, { type: 'hint' });
    expect(s.hints).toBe(1);
    s = go(s, 0, { type: 'giveup' });
    expect(s.phase).toBe('reveal');
    expect(apply(at({}), 0, { type: 'hint' }, rng())).toBeNull();
  });

  it('боты доигрывают: бот-ведущий и ведущий-бот за столом, по правилам и без, все уровни', async () => {
    for (const host of ['bot', 'players'])
      for (const mode of ['rules', 'free'])
        for (const lv of [0, 1, 2]) {
          const r = await simulate(def, botSeats(def, 4, [lv]), { host, mode, count: 3, level: 'any' }, 3 + lv);
          expect(r.error, `${host} ${mode} ${lv}`).toBeUndefined();
          expect(r.finished, `${host} ${mode} ${lv}`).toBe(true);
        }
    const solo = await simulate(def, botSeats(def, 1, [2]), { host: 'bot', mode: 'rules', count: 3 }, 1);
    expect(solo.finished).toBe(true);
  });
});
