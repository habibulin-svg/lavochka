/* Маджонг вчетвером: разбор руки, подсчёт по стилям, партии ботов по всем правилам со статистикой. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { counts, isComplete, shanten, waits } from '../src/games/mahjong4/hand';
import { riichiBase, scoreWin, type WinInfo } from '../src/games/mahjong4/score';
import { def } from '../src/games/mahjong4/def';
import { apply, toAct, type State } from '../src/games/mahjong4/engine';
import { makeView } from '../src/games/mahjong4/view-model';
import { choose } from '../src/games/mahjong4/ai';

/** 123m → виды. */
function K(s: string): number[] {
  const r: number[] = [];
  for (const m of s.matchAll(/(\d+)([mpsz])/g))
    for (const d of m[1]) {
      const n = Number(d) - 1;
      r.push(m[2] === 'm' ? 18 + n : m[2] === 'p' ? n : m[2] === 's' ? 9 + n : 27 + n);
    }
  return r;
}
const R = { sets: 4, seven: true, thirteen: true };

function win(hand: string, w: string, o: Partial<WinInfo> = {}): WinInfo {
  return {
    style: 'riichi',
    closed: counts(K(hand)),
    melds: [],
    win: K(w)[0],
    tsumo: false,
    seatWind: 1,
    roundWind: 0,
    dealer: false,
    flowers: [],
    sets: 4,
    riichi: 0,
    ippatsu: false,
    lastTile: false,
    rinshan: false,
    chankan: false,
    heaven: false,
    earth: false,
    dora: [],
    ura: [],
    aka: 0,
    repeat: 0,
    limit: 13,
    kuitan: true,
    ...o,
  };
}

describe('разбор руки', () => {
  it('шантен и ожидания', () => {
    expect(shanten(counts(K('123m456p789s1122z')), 0, R)).toBe(0);
    expect(waits(counts(K('123m456p789s1122z')), 0, R)).toEqual([27, 28]);
    expect(shanten(counts(K('123m456p789s11z22z3z')), 0, R)).toBe(0);
    expect(isComplete(counts(K('123m456p789s11222z')), 0, R)).toBe(true);
    expect(shanten(counts(K('19m19p19s1234567z')), 0, R)).toBe(0);
    expect(waits(counts(K('19m19p19s1234567z')), 0, R).length).toBe(13);
    expect(shanten(counts(K('1357m2468p13579s')), 0, R)).toBeGreaterThan(2);
  });

  it('риичи: пинфу, танъяо, фу и очки', () => {
    // 234m 567m 345p 678s 22s, ждал 2-5m, взял 5m на сбросе
    const sc = scoreWin(win('234567m345p67822s', '7m', { riichi: 1 }))!;
    expect(sc.items.map((x) => x.name)).toEqual(expect.arrayContaining(['Риичи', 'Танъяо — только простые', 'Пинфу']));
    expect(sc.fu).toBe(30);
    expect(sc.value).toBe(3);
    expect(riichiBase(3, 30, 0) * 4).toBe(3840);
    // без яку
    const no = scoreWin(win('123m456p789s11z222z'.replace('11z222z', '11z'), '1z'));
    expect(no).toBeNull();
    // якухай
    const y = scoreWin(win('123m456p789s55z777z', '7z'))!;
    expect(y.yaku).toBe(true);
    expect(y.items.some((x) => x.name.includes('дракон'))).toBe(true);
  });

  it('гонконг: чистая масть и поны', () => {
    const sc = scoreWin(win('111222333m45677m', '7m', { style: 'hk', limit: 13, flowers: [] }))!;
    expect(sc.items.map((x) => x.name)).toEqual(expect.arrayContaining(['Чистая масть', 'Закрытая рука', 'Без цветов']));
    expect(sc.value).toBeGreaterThanOrEqual(9);
  });
});

/** Партия ботов со счётчиками: сколько раздач, ничьих, выигрышей. */
function run(style: string, seed: number, level = 2) {
  const rng = new SeededRng(seed);
  let s: State = def.setup([], { style }, rng);
  const st = { hands: 0, draws: 0, wins: 0, steps: 0 };
  for (; st.steps < 30000 && s.phase !== 'over'; st.steps++) {
    const seat = toAct(s)[0];
    const a = choose(makeView(s, [seat]), seat, level, rng);
    expect(a, `${style}: бот ${seat} молчит, фаза ${s.phase}`).not.toBeNull();
    const r = apply(s, seat, a!, rng);
    expect(r, `${style}: отклонён ${JSON.stringify(a)} в фазе ${s.phase}`).not.toBeNull();
    for (const e of r!.events) {
      if (e.type === 'end') {
        st.hands++;
        if (e.result.kind === 'draw') st.draws++;
        else st.wins += e.result.wins.length;
      }
    }
    s = r!.state;
  }
  return { ...st, over: s.phase === 'over', scores: s.scores };
}

describe('партии ботов', () => {
  it.each(['hk', 'riichi', 'classic', 'tw', 'sc', 'easy'])('%s', (style) => {
    const t0 = Date.now();
    const r = run(style, 11);
    console.log(style, JSON.stringify(r), `${Date.now() - t0} мс`);
    expect(r.over).toBe(true);
  }, 120_000);
});

describe('показ правил', () => {
  it('все шаги показов собираются (ни один не отброшен)', () => {
    const want: Record<string, number> = { 'Ход и заявки': 6, 'Японский риичи': 5 };
    for (const sec of def.rules.sections) {
      if (!sec.demo) continue;
      expect(sec.demo.steps.length, sec.title).toBe(want[sec.title]);
    }
  });
});
