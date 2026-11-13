/* Глубокое ревью «Короны» и «Детективов»: скрытое не уходит чужим. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { classicView } from '../src/games/korona/classic/glue';
import { newState as cNew } from '../src/games/korona/classic/engine';
import { apply, cfgOf, keyOf, newState, redact, view, SHARED, type Action, type Event, type State } from '../src/games/detektiv/engine';
import { def as dkDef } from '../src/games/detektiv/def';

describe('Корона, классика: чужие вопросы не показывают колоду', () => {
  it('верхняя карта и карты на выбор видит только тот, кто смотрит', () => {
    const s = cNew([{ seat: 0, kind: 'human', name: 'А' }, { seat: 1, kind: 'human', name: 'Б' }], new SeededRng(3));
    s.prompt = { seat: 0, q: 'Верхняя карта: №5 «Секрет» — текст', kind: 'c2_pick', opts: [{ label: 'Понятно', key: 'ok' }], data: { tag: 'ack' } };
    s.pending = [{ seat: 0, q: 'Дракон', kind: 'dragon', opts: [{ label: '№7 Тайна', key: '7' }], data: { two: [7] } }];
    const mine = classicView(s, [0]);
    expect(mine.prompt!.q).toContain('Секрет');
    const other = classicView(s, [1]);
    expect(JSON.stringify(other.prompt)).not.toContain('Секрет');
    expect(JSON.stringify(other.pending)).not.toContain('Тайна');
    expect(other.pending![0].data).toBeUndefined();
    expect(JSON.stringify(classicView(s, []))).not.toContain('Секрет');
  });
});

describe('Детективы: чужие версии не утекают', () => {
  const rng = () => new SeededRng(5);
  const go = (s: State, seat: number, a: Action) => apply(s, seat, a, rng(), 1000)!.state;

  it('сыщик: зачёркнутые версии и событие «wrong» видит только сам игрок', () => {
    let s = newState(cfgOf({ mode: 'solo', count: 3, lvl: 0 }), [0, 1], rng(), 0);
    const k = keyOf(s.list[0]);
    const r = apply(s, 0, { t: 'pick', k: (k.ok + 1) % 4 }, rng(), 1000)!;
    s = r.state;
    expect(view(s, [1]).boards[0].wrongs).toEqual([]);
    expect(view(s, [0]).boards[0].wrongs).toEqual([(k.ok + 1) % 4]);
    const ev = r.events[0] as Extract<Event, { type: 'wrong' }>;
    expect(redact(ev, [1])).toMatchObject({ k: -1 });
    expect(redact(ev, [0])).toMatchObject({ k: (k.ok + 1) % 4 });
    expect(redact(ev, [])).toMatchObject({ k: -1 });
  });

  it('свободный ответ в «Сыщике» скрыт от других, в бригаде открыт', () => {
    const s = newState(cfgOf({ mode: 'solo', answer: 'free', count: 3, lvl: 0 }), [0, 1], rng(), 0);
    const ev = apply(s, 0, { t: 'free', text: 'мой ответ' }, rng(), 10)!.events[0];
    expect(redact(ev, [1])).toMatchObject({ text: '' });
    const t = newState(cfgOf({ mode: 'team', answer: 'free', count: 3, lvl: 0 }), [0, 1], rng(), 0);
    const ev2 = apply(t, 0, { t: 'free', text: 'мой ответ' }, rng(), 10)!.events[0];
    expect(redact(ev2, [1])).toMatchObject({ text: 'мой ответ' });
    expect(dkDef.describe!(redact(ev, [1])!, (n) => `#${n}`)).toBe('#0 записал версию');
  });

  it('до закрытия дела разгадки в виде нет ни у кого', () => {
    const s = newState(cfgOf({ mode: 'team', count: 3, lvl: 0 }), [0, 1], rng(), 0);
    const j = JSON.stringify(view(s, []));
    const k = keyOf(s.list[0]);
    expect(j).not.toContain(k.answer.slice(0, 30));
    expect(view(s, []).boards[SHARED].cur!.sol).toBeUndefined();
  });

  it('бот в бригаде не листает дело сразу после закрытия', () => {
    let s = newState(cfgOf({ mode: 'team', count: 3, lvl: 0 }), [0, 1], rng(), 0);
    s = go(s, 0, { t: 'pick', k: keyOf(s.list[0]).ok });
    const v = view(s, 'all');
    const a = dkDef.bot!.choose(v, 1, 1, new SeededRng(1));
    // t1 выставлен «в прошлом» (now=1000), поэтому проверяем свежим закрытием
    const fresh = { ...v, boards: { ...v.boards, [SHARED]: { ...v.boards[SHARED], t1: Date.now() } } };
    expect(dkDef.bot!.choose(fresh, 1, 1, new SeededRng(1))).toEqual({ t: 'think' });
    expect(a).toEqual({ t: 'next' });
  });
});
