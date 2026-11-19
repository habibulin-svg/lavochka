/* Симулятор дирижёра — ядро: отметки из партитуры, судейство, фермата, провал концерта. */
import { describe, expect, it } from 'vitest';
import { buildChart, DIFFS } from '../src/dirizher/core/chart';
import { Performance, type PerfEvent } from '../src/dirizher/core/perform';
import { barsOf, excerpt, LANE_SETS, PPQ, TempoMap, type ScoreJson } from '../src/dirizher/core/score';

const Q = PPQ;
const BAR = Q * 4;

/** 16 тактов 4/4, 120: струнные играют 1–8 и 11–16, духовые 5–12, литавры — удар в 9 и 16; фермата в конце 12-го. */
function toy(): ScoreJson {
  const notes = (from: number, to: number, pitch: number, vel = 90) => {
    const out: number[] = [];
    for (let b = from; b < to; b++) for (let k = 0; k < 4; k++) out.push(b * BAR + k * Q, Q, pitch + (k % 3), vel);
    return out;
  };
  return {
    id: 'toy',
    title: 'Проба',
    composer: 'тест',
    source: 'тест',
    time: [[0, 4, 4]],
    tempo: [[0, 120]],
    end: BAR * 16,
    parts: [
      { name: 'Violin I', instr: 'vn1', notes: [...notes(0, 8, 72), ...notes(10, 16, 72)] },
      { name: 'Flute', instr: 'fl', notes: notes(4, 12, 79) },
      { name: 'Timpani', instr: 'timp', notes: [8 * BAR, Q, 45, 110, 15 * BAR, Q, 45, 120] },
    ],
    specials: [{ kind: 'fermata', tick: BAR * 12 - Q, len: Q * 2 }],
  };
}

function play(s: ScoreJson, diff: keyof typeof DIFFS, concert: boolean, perfect: boolean) {
  const chart = buildChart(s, DIFFS[diff]);
  const p = new Performance(s, chart, { concert, speed: 1 });
  const evs: PerfEvent[] = [];
  const dt = 1 / 120;
  let holding = false;
  for (let i = 0; i < 20000 && !p.ended && !p.failed; i++) {
    if (perfect) {
      for (const m of chart.marks) {
        const ds = p.secTo(m.tick);
        if (ds > -0.001 && ds <= dt + 1e-9) {
          if (m.kind === 'hold') {
            evs.push(...p.input({ kind: 'baton', down: true }));
            holding = true;
          } else if (m.lane >= 0) evs.push(...p.input({ kind: 'lane', lane: m.lane }));
          else if (m.kind === 'beat') evs.push(...p.input({ kind: 'baton', down: true }), ...p.input({ kind: 'baton', down: false }));
          else if (m.kind === 'up' || m.kind === 'down') evs.push(...p.input({ kind: 'dyn', dir: m.kind }));
        }
      }
      if (holding && p.frozen) {
        holding = false;
        // подержать около длины по партитуре
        for (let k = 0; k < 60; k++) evs.push(...p.step(dt));
        evs.push(...p.input({ kind: 'baton', down: false }));
      }
    }
    evs.push(...p.step(dt));
  }
  return { p, chart, evs };
}

describe('dirizher: партитура и время', () => {
  it('карта темпа обратима', () => {
    const tm = new TempoMap([[0, 120], [BAR * 2, 60]]);
    expect(tm.sec(BAR * 2)).toBeCloseTo(4);
    expect(tm.sec(BAR * 3)).toBeCloseTo(8);
    expect(tm.tick(6)).toBeCloseTo(BAR * 2 + BAR / 2);
  });
  it('такты и отрывок', () => {
    const s = toy();
    expect(barsOf(s)).toHaveLength(16);
    const e = excerpt(s, 4, 12);
    expect(e.end).toBe(BAR * 8);
    expect(e.parts[1].notes[0]).toBe(0);
  });
  it('раскладки строк: каждый инструмент ровно в одной строке', () => {
    for (const set of Object.values(LANE_SETS)) {
      const all = set.flatMap((l) => l.instr);
      expect(new Set(all).size).toBe(all.length);
      expect(all).toHaveLength(21);
    }
  });
});

describe('dirizher: отметки', () => {
  it('вступления по фразам групп', () => {
    const c = buildChart(toy(), DIFFS.easy);
    const cues = c.marks.filter((m) => m.kind === 'cue');
    // струнные: такт 1 и 11 (пауза 2 такта); духовые: такт 5 (в строке «Духовые»); литавры: 9 и 16
    // (короткая пьеса реже желаемого — длинные фразы режутся на «мысли», поэтому вступлений может быть больше)
    expect(cues.filter((m) => m.lane === 0).map((m) => m.tick / BAR)).toEqual(expect.arrayContaining([0, 10]));
    expect(cues.filter((m) => m.lane === 1)[0].tick / BAR).toBe(4);
    expect(cues.filter((m) => m.lane === 2).map((m) => m.tick / BAR)).toEqual([8, 15]);
    expect(c.marks.some((m) => m.kind === 'hold')).toBe(true);
    expect(buildChart(toy(), DIFFS.learn).marks.some((m) => m.kind === 'hold')).toBe(false);
  });
  it('снятия только со сложности «normal»', () => {
    expect(buildChart(toy(), DIFFS.easy).marks.some((m) => m.kind === 'cut')).toBe(false);
    expect(buildChart(toy(), DIFFS.normal).marks.some((m) => m.kind === 'cut')).toBe(true);
  });
});

describe('dirizher: исполнение', () => {
  it('идеальный дирижёр: всё «браво», концерт пройден', () => {
    const { p, chart } = play(toy(), 'normal', true, true);
    expect(p.ended).toBe(true);
    expect(p.failed).toBe(false);
    expect(p.tally.miss).toBe(0);
    expect(p.tally.bravo).toBe(chart.marks.length);
    expect(p.result().stars).toBe(5);
  });
  it('фермата останавливает часы', () => {
    const { evs } = play(toy(), 'normal', true, true);
    expect(evs.filter((e) => e.kind === 'fermata').map((e) => (e as { on: boolean }).on)).toEqual([true, false]);
  });
  it('без ввода: репетиция доигрывается, отметки — промахи', () => {
    const { p, chart } = play(toy(), 'normal', false, false);
    expect(p.ended).toBe(true);
    expect(p.failed).toBe(false);
    expect(p.tally.miss).toBe(chart.marks.length);
  });
  it('без ввода на длинном концерте — провал', () => {
    const s = toy();
    // склеим 6 раз — промахов хватит, чтобы опустошить зал
    const long: ScoreJson = { ...s, end: s.end * 6, specials: [], parts: s.parts.map((pt) => ({ ...pt, notes: [0, 1, 2, 3, 4, 5].flatMap((k) => pt.notes.map((v, i) => (i % 4 === 0 ? v + k * s.end : v))) })) };
    const { p } = play(long, 'normal', true, false);
    expect(p.failed).toBe(true);
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { buy, newCareer, nextConcert, openPieces, review, settleConcert, unlocked, widenFor } from '../src/dirizher/core/career';
import { CONCERTS, PIECES } from '../src/dirizher/core/pieces';
import { applyArrangement, canPlay } from '../src/dirizher/core/arrange';
import { INSTR } from '../src/dirizher/core/score';

describe('dirizher: репертуар', () => {
  const load = (id: string) => JSON.parse(readFileSync(`public/dirizher/scores/${id}.json`, 'utf8')) as ScoreJson;
  it('у каждой пьесы есть партитура, на каждой сложности — отметки и прохождение без промахов', () => {
    for (const p of PIECES) {
      expect(existsSync(`public/dirizher/scores/${p.id}.json`), p.id).toBe(true);
      const s = load(p.id);
      expect(s.parts.length, p.id).toBeGreaterThan(3);
      for (const d of ['learn', 'normal', 'master'] as const) {
        const c = buildChart(s, DIFFS[d]);
        expect(c.marks.filter((m) => m.kind === 'cue').length, `${p.id} ${d}`).toBeGreaterThan(3);
        // густота: на строке не чаще minGap
        const tm = new TempoMap(s.tempo);
        for (let li = 0; li < c.lanes.length; li++) {
          const t = c.marks.filter((m) => m.lane === li).map((m) => tm.sec(m.tick));
          for (let k = 1; k < t.length; k++) expect(t[k] - t[k - 1], `${p.id} ${d} строка ${li}`).toBeGreaterThanOrEqual(DIFFS[d].minGap - 1e-6);
        }
      }
    }
  });
  it('концерты ссылаются на существующие пьесы', () => {
    for (const c of CONCERTS) for (const p of c.pieces) expect(PIECES.some((x) => x.id === p), `${c.id}: ${p}`).toBe(true);
  });
  it('идеальный дирижёр проходит пьесу целиком', () => {
    const s = load('b5-1');
    const { p } = play(s, 'normal', true, true);
    expect(p.failed).toBe(false);
    expect(p.result().stars).toBe(5);
  });
});

describe('dirizher: карьера', () => {
  it('открытие концертов, гонорар, улучшения', () => {
    const c = newCareer();
    expect(unlocked(c, CONCERTS[0].id)).toBe(true);
    expect(unlocked(c, CONCERTS[1].id)).toBe(false);
    const r = settleConcert(c, CONCERTS[0].id, [{ piece: 'ode', stars: 4, score: 1000, failed: false, mood: [80, 60, 70], laneInstr: [['vn1'], ['fl'], ['timp']] }]);
    expect(r.first).toBe(true);
    expect(c.money).toBeGreaterThan(0);
    expect(unlocked(c, CONCERTS[1].id)).toBe(true);
    expect(nextConcert(c)).toBe(CONCERTS[1].id);
    expect(openPieces(c)).toContain('b7-2');
    c.money = 1000;
    expect(buy(c, 'hire-str')).toBe(true);
    expect(widenFor(c, [['vn1', 'vc'], ['fl']])).toEqual([1.1, 1]);
    // повтор с теми же звёздами — только понемногу
    const again = settleConcert(c, CONCERTS[0].id, [{ piece: 'ode', stars: 4, score: 1000, failed: false, mood: [70, 70, 70], laneInstr: [['vn1'], ['fl'], ['timp']] }]);
    expect(again.fee).toBeLessThan(r.fee);
  });
  it('отзыв критика называет группы', () => {
    const t = review({ hall: 'ДК', piece: 'Ода', stars: 3, failed: false, lanes: ['Струнные', 'Духовые', 'Ударные'], miss: [0, 5, 0], total: [10, 10, 4] });
    expect(t).toContain('духовые');
  });
});

describe('dirizher: переложение', () => {
  it('партия первых скрипок у труб — в диапазоне труб', () => {
    const s = toy();
    const a = applyArrangement(s, { id: 'x', name: 'медь', piece: 'toy', map: { 0: ['tp'] } });
    const tp = a.parts.find((p) => p.instr === 'tp')!;
    for (let i = 2; i < tp.notes.length; i += 4) {
      expect(tp.notes[i]).toBeGreaterThanOrEqual(INSTR.tp.lo - 12);
      expect(tp.notes[i]).toBeLessThanOrEqual(INSTR.tp.hi);
    }
    expect(canPlay('timp', 'vn1')).toBe(false);
    expect(canPlay('vn1', 'hn')).toBe(true);
  });
});
