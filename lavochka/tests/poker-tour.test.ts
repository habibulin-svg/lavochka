/* Покер: турниры с ботами (poker/tour.ts). Турнир доигрывается до конца на всех форматах и видах, фишки не появляются
 * и не пропадают, выплаты = призовому фонду, ребай/аддон/ре-энтри/баунти считаются верно, столы MTT сбалансированы,
 * решения человека (ребай, аддон, выход) работают, после вылета человека турнир досчитывается сам. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { SeatSpec } from '../src/core/types';
import { def } from '../src/games/poker/def';
import type { State } from '../src/games/poker/engine';
import { bigAt, FMTS, payout, type TourFmt, type TourKind, type TourState } from '../src/games/poker/tour';

const seatsOf = (n: number, human = -1): SeatSpec[] => Array.from({ length: n }, (_, i) => ({ seat: i, kind: i === human ? 'human' : 'bot', name: `Игрок ${i}`, level: 0 }));

/** Фишки в игре: свой стол — стек и вложенное в банк текущей раздачи, остальные — по списку игроков. */
function chipsInPlay(s: State): number {
  const T = s.tour!;
  if (s.over) return T.players.reduce((a, p) => a + p.chips, 0);
  const hero = new Set(T.tables[0].ids.filter((x) => x >= 0));
  let sum = 0;
  for (const p of T.players) if (p.joined && !p.out && !(hero.has(p.id) && !s.decide)) sum += p.chips;
  if (!s.decide) T.tables[0].ids.forEach((id, k) => id >= 0 && (sum += s.chips[k] + (s.inHand.includes(k) ? s.total[k] : 0)));
  return sum;
}

function checkTables(T: TourState) {
  const at = new Map<number, number>();
  T.tables.forEach((tb) => tb.ids.forEach((id) => id >= 0 && at.set(id, (at.get(id) ?? 0) + 1)));
  for (const p of T.players) {
    // в конце оставшиеся получают места, но сидят за столом
    if (p.joined && (!p.out || (T.done && p.chips > 0))) expect(at.get(p.id), `${p.name} должен сидеть ровно за одним столом`).toBe(1);
    else expect(at.has(p.id)).toBe(false);
  }
  const counts = T.tables.map((tb) => tb.ids.filter((x) => x >= 0).length);
  for (const c of counts) expect(c).toBeLessThanOrEqual(T.seatMax);
  if (T.tables.length > 1) expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
}

interface Run {
  s: State;
  hands: number;
  maxTables: number;
}

/** Сыграть турнир ботами (человек, если есть, решает decide(…) и ходит как бот). */
function play(n: number, opts: Record<string, string | number | boolean>, seed: number, human = -1, decide?: (s: State) => 'yes' | 'no'): Run {
  const rng = new SeededRng(seed);
  let s = def.setup(seatsOf(n, human), { mode: 'holdem', buyin: 100, ...opts }, rng) as State;
  let maxTables = s.tour!.tables.length;
  const T0 = s.tour!;
  expect(chipsInPlay(s)).toBe(T0.chipsIn);
  for (let guard = 0; guard < 300000 && !s.over; guard++) {
    const who = def.toAct(s)[0];
    expect(who).toBeGreaterThanOrEqual(0);
    const a = s.decide ? { type: 'tour', what: decide ? decide(s) : 'no' } : def.bot.choose(def.view(s, [who]), who, 0, rng);
    const r = def.apply(s, who, a as never, rng);
    if (!r) throw new Error(`ход отклонён: ${JSON.stringify(a)}`);
    s = r.state as State;
    const T = s.tour!;
    if (s.between) throw new Error('раздача сыграна, а турнир не сдал следующую');
    expect(chipsInPlay(s)).toBe(T.chipsIn);
    checkTables(T);
    maxTables = Math.max(maxTables, T.tables.length);
  }
  expect(s.over).toBe(true);
  return { s, hands: s.hand, maxTables };
}

/** Итог: места разные, выплаты = фонду, деньги на месте. */
function checkEnd(T: TourState) {
  expect(T.done).toBe(true);
  const joined = T.players.filter((p) => p.joined);
  const places = joined.map((p) => p.out).sort((a, b) => a - b);
  expect(places).toEqual(joined.map((_, i) => i + 1));
  const prizes = T.players.reduce((a, p) => a + p.prize, 0);
  if (T.don) {
    expect(T.players.filter((p) => p.prize > 0).length).toBe(T.paid);
    expect(prizes).toBeLessThanOrEqual(T.pool);
    expect(T.pool - prizes).toBeLessThan(T.paid);
  } else expect(prizes).toBe(T.pool);
  expect(T.players.filter((p) => p.prize > 0).every((p) => p.out <= T.paid)).toBe(true);
  // все фишки — у победителя (в «Удвоении» — у оставшихся)
  const left = T.players.filter((p) => p.chips > 0);
  expect(left.reduce((a, p) => a + p.chips, 0)).toBe(T.chipsIn);
  if (!T.don) expect(left.map((p) => p.out)).toEqual([1]);
}

describe('турниры', () => {
  const SNG: [TourFmt, number, string, TourKind][] = [
    ['hu', 2, 'turbo', 'freeze'],
    ['sng6', 6, 'turbo', 'freeze'],
    ['sng9', 9, 'normal', 'freeze'],
    ['sng9', 9, 'hyper', 'pko'],
    ['don', 6, 'turbo', 'freeze'],
  ];
  for (const [fmt, n, speed, tkind] of SNG)
    it(`Sit&Go ${fmt} ${speed} ${tkind} доигрывается`, () => {
      const { s } = play(n, { tour: fmt, speed, tkind }, 11 + n);
      const T = s.tour!;
      checkEnd(T);
      expect(T.prizes).toEqual(payout(fmt, T.paid).map((p, i) => (FMTS[fmt].don ? Math.floor(T.pool * p) : i ? Math.floor(T.pool * p) : T.pool - payout(fmt, T.paid).slice(1).reduce((a, x) => a + Math.floor(T.pool * x), 0))));
      if (fmt === 'sng6') expect(T.prizes).toEqual([390, 210]);
      if (fmt === 'don') expect(T.prizes).toEqual([200, 200, 200]);
    });

  for (const [fmt, speed, tkind, late] of [
    ['mtt18', 'turbo', 'freeze', false],
    ['mtt45', 'turbo', 'freeze', true],
    ['mtt90', 'hyper', 'pko', false],
    ['mtt180', 'hyper', 'freeze', false],
    ['mtt45', 'hyper', 'rebuy', false],
    ['mtt45', 'hyper', 'reentry', false],
  ] as [TourFmt, string, TourKind, boolean][])
    it(`MTT ${fmt} ${speed} ${tkind}${late ? ' + поздняя регистрация' : ''} доигрывается, столы сбалансированы`, () => {
      const { s, maxTables } = play(9, { tour: fmt, speed, tkind, late }, 5);
      const T = s.tour!;
      checkEnd(T);
      // с поздней регистрацией часть поля садится позже — столов бывает меньше
      if (late) expect(maxTables).toBeLessThanOrEqual(Math.ceil(FMTS[fmt].n / 9));
      else expect(maxTables).toBe(Math.ceil(FMTS[fmt].n / 9));
      expect(T.tables.length).toBe(1);
      const entries = T.players.reduce((a, p) => a + p.entries, 0);
      const rebuys = T.players.reduce((a, p) => a + p.rebuys, 0);
      const addons = T.players.filter((p) => p.addon).length;
      expect(T.players.every((p) => p.joined)).toBe(true);
      expect(T.chipsIn).toBe(T.start * (entries + rebuys) + T.addonChips * addons);
      if (tkind === 'pko') {
        // половина бай-ина — в баунти: всё выплачено (у победителя — и своя голова)
        expect(T.pool).toBe(entries * 50);
        expect(T.players.reduce((a, p) => a + p.won + p.bounty, 0)).toBe(entries * 50);
        expect(T.players.every((p) => p.bounty === 0)).toBe(true);
      } else expect(T.pool).toBe(100 * (entries + rebuys + addons));
      if (tkind === 'rebuy') {
        expect(rebuys).toBeGreaterThan(0);
        expect(addons).toBeGreaterThan(0);
      }
      if (tkind === 'reentry') expect(entries).toBeGreaterThan(45);
      if (late) expect(T.paid).toBe(Math.ceil(entries * 0.15));
    });

  it('другие виды покера: стад (7 за столом), дро, HORSE — турнир идёт', () => {
    for (const [mode, n, fmt] of [
      ['stud7', 7, 'sng9'],
      ['td27', 6, 'sng6'],
      ['horse', 6, 'mtt18'],
      ['plo', 9, 'sng9'],
    ] as [string, number, TourFmt][]) {
      const { s } = play(n, { tour: fmt, speed: 'hyper', mode: mode === 'plo' ? 'omaha4' : mode }, 3);
      checkEnd(s.tour!);
      expect(s.tour!.seatMax).toBeLessThanOrEqual(n);
    }
  });

  it('уровни растут по часам турнира, анте — с середины', () => {
    const rng = new SeededRng(2);
    let s = def.setup(seatsOf(6), { mode: 'holdem', tour: 'sng6', speed: 'turbo' }, rng) as State;
    const seen: number[] = [];
    while (!s.over) {
      const who = def.toAct(s)[0];
      s = def.apply(s, who, def.bot.choose(def.view(s, [who]), who, 0, rng) as never, rng)!.state as State;
      const T = s.tour!;
      expect(T.level).toBe(Math.floor(T.t / T.levelSec));
      if (!s.over) {
        expect(s.big).toBe(bigAt(false, T.level));
        expect(s.cfg.ante).toBe(T.level >= 4 ? 'all' : 'none');
        expect(s.cfg.prizes?.length).toBeGreaterThan(0);
      }
      if (!seen.includes(T.level)) seen.push(T.level);
    }
    expect(seen.length).toBeGreaterThan(3);
  });

  it('человек: ребай и аддон по решению, после вылета турнир досчитывается сам', () => {
    let rebuys = 0;
    let addons = 0;
    const { s } = play(9, { tour: 'mtt45', speed: 'hyper', tkind: 'rebuy' }, 9, 0, (st) => {
      if (st.decide!.what === 'addon') {
        addons++;
        return 'yes';
      }
      return rebuys++ < 2 ? 'yes' : 'no';
    });
    const T = s.tour!;
    const me = T.players[0];
    expect(me.human).toBe(true);
    expect(me.rebuys).toBe(Math.min(rebuys, 2));
    expect(me.addon).toBe(addons > 0);
    checkEnd(T);
    const r = def.result(s)!;
    expect(r.text).toMatch(/-е место из/);
    if (me.out !== 1) expect(r.winners).toEqual([]);
  });

  it('ребай по желанию — когда фишек не больше стартовых; чужое место не может', () => {
    const rng = new SeededRng(4);
    let s = def.setup(seatsOf(9, 0), { mode: 'holdem', tour: 'mtt18', speed: 'turbo', tkind: 'rebuy' }, rng) as State;
    expect(def.free!(s, 0, { type: 'tour', what: 'rebuy' })).toBe(true);
    const r = def.apply(s, 0, { type: 'tour', what: 'rebuy' }, rng)!;
    expect(r).not.toBeNull();
    s = r.state as State;
    expect(s.tour!.pending).toEqual([0]);
    expect(def.apply(s, 0, { type: 'tour', what: 'rebuy' }, rng)).toBeNull();
    expect(def.apply(s, 1, { type: 'tour', what: 'rebuy' }, rng)).toBeNull();
    // фишки приходят к следующей раздаче
    while (s.hand === 1) {
      const who = def.toAct(s)[0];
      const a = s.decide ? { type: 'tour', what: 'no' } : who === 0 ? { type: 'fold' } : def.bot.choose(def.view(s, [who]), who, 0, rng);
      s = def.apply(s, who, a as never, rng)!.state as State;
    }
    expect(s.tour!.players[0].rebuys).toBe(1);
    expect(s.tour!.pending).toEqual([]);
  });

  it('боты среднего и сложного уровня играют турнир (ICM на пузыре)', () => {
    const rng = new SeededRng(8);
    const seats = seatsOf(6).map((x, i) => ({ ...x, level: 1 + (i % 2) }));
    let s = def.setup(seats, { mode: 'holdem', tour: 'sng6', speed: 'hyper' }, rng) as State;
    while (!s.over) {
      const who = def.toAct(s)[0];
      s = def.apply(s, who, def.bot.choose(def.view(s, [who]), who, seats[who].level, rng) as never, rng)!.state as State;
    }
    checkEnd(s.tour!);
  });
});
