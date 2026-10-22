/* Покер, тренажёр (этап 4): счётчики HUD на сконструированных раздачах (каждая цифра), хранилище по именам, выгрузка
 * истории в формате для трекеров, «лучший ход» в пуш/фолд-спотах (Нэш + ICM), подсказки и разбор не видят чужих
 * закрытых карт, подпись первой ставки в журнале. */
import { describe, expect, it } from 'vitest';
import type { Card, Suit } from '../src/cards/deck';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/poker/ai';
import { bestMove, findPF, hitChance, outs, solvePF, tipsFor, zoneOf } from '../src/games/poker/calc';
import { def } from '../src/games/poker/def';
import { apply, cfgFrom, deal, makeView, newState, recFor, type Event, type HandAct, type HandRecord, type State } from '../src/games/poker/engine';
import { exportHistory, handText } from '../src/games/poker/hh';
import { emptyHud, normHud, recordHand, statVal, summaryOf } from '../src/games/poker/hud';
import { frames } from '../src/games/poker/replay';
import { addHand, summary, type Counts } from '../src/games/poker/stats';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14, T: 10 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const NAMES = ['Вовка', 'Ленка', 'Серёга', 'Танька', 'Димон', 'Колян'];

type Step = [number, 'fold' | 'check' | 'call' | 'bet' | 'raise', number?, number?] | ['board', string];

/** Раздача холдема 6-max: баттон 5, блайнды 10/20 у мест 0 и 1. Ходы: [место, ход, сколько положил, ставка после]. */
function hand(steps: Step[], o: { hole?: Record<number, string>; shown?: Record<number, string>; winners?: { seat: number; amount: number }[]; stacks?: number[]; button?: number; big?: number; seats?: number[] } = {}): HandRecord {
  const seats = o.seats ?? [0, 1, 2, 3, 4, 5];
  const big = o.big ?? 20;
  const button = o.button ?? 5;
  const ring = seats.slice().sort((a, b) => a - b);
  const nx = (p: number) => ring.find((x) => x > p) ?? ring[0];
  const sb = ring.length === 2 ? button : nx(button);
  const bb = nx(sb);
  const acts: HandAct[] = [
    { k: 'post', seat: sb, amount: big / 2, what: 'sb' },
    { k: 'post', seat: bb, amount: big, what: 'bb' },
  ];
  const board: Card[] = [];
  let street = 0;
  const put: Record<number, number> = { [sb]: big / 2, [bb]: big };
  for (const s of steps) {
    if (s[0] === 'board') {
      street++;
      const cs = L(s[1] as string);
      board.push(...cs);
      acts.push({ k: 'board', street, cards: cs });
      continue;
    }
    const [seat, a, amount = 0, to = 0] = s as [number, 'fold' | 'check' | 'call' | 'bet' | 'raise', number?, number?];
    put[seat] = (put[seat] ?? 0) + amount;
    acts.push({ k: 'act', street, seat, a, amount, to });
  }
  const stacks = o.stacks ?? seats.map(() => 1000);
  const winners = (o.winners ?? []).map((w) => ({ ...w, hand: '' }));
  const net: Record<number, number> = {};
  seats.forEach((p) => (net[p] = -(put[p] ?? 0) + winners.filter((w) => w.seat === p).reduce((a, w) => a + w.amount, 0)));
  const hole: Record<number, (Card | null)[]> = {};
  for (const p of seats) hole[p] = o.hole?.[p] ? L(o.hole[p]) : [C('2C'), C('3D')];
  const shown: Record<number, Card[]> = {};
  for (const [p, t] of Object.entries(o.shown ?? {})) shown[Number(p)] = L(t);
  return {
    v: 1,
    no: 1,
    game: 'holdem',
    hilo: false,
    struct: 'nl',
    small: big / 2,
    big,
    ante: 0,
    anteKind: 'none',
    button,
    seats: seats.map((p, i) => ({ seat: p, stack: stacks[i] })),
    hole,
    board,
    acts,
    shown,
    winners,
    net,
    showdown: Object.keys(shown).length > 1,
  };
}

// А: открытие с места 3, колл, колл большого блайнда; продолженная, пас и колл на неё; вскрытие
const HAND_A = () =>
  hand(
    [
      [2, 'fold'],
      [3, 'raise', 60, 60],
      [4, 'call', 60, 60],
      [5, 'fold'],
      [0, 'fold'],
      [1, 'call', 40, 60],
      ['board', 'KS 9H 4H'],
      [1, 'check'],
      [3, 'bet', 80, 80],
      [4, 'fold'],
      [1, 'call', 80, 80],
      ['board', '2C'],
      [1, 'check'],
      [3, 'check'],
      ['board', '7D'],
      [1, 'bet', 100, 100],
      [3, 'call', 100, 100],
    ],
    { hole: { 3: 'AH KH', 1: 'QS QD' }, shown: { 1: 'QS QD', 3: 'AH KH' }, winners: [{ seat: 3, amount: 550 }] }
  );

// Б: все пасуют до баттона — кража; малый блайнд пасует, большой отвечает 3-бетом, баттон пасует
const HAND_B = () =>
  hand(
    [
      [2, 'fold'],
      [3, 'fold'],
      [4, 'fold'],
      [5, 'raise', 50, 50],
      [0, 'fold'],
      [1, 'raise', 130, 150],
      [5, 'fold'],
    ],
    { winners: [{ seat: 1, amount: 210 }] }
  );

describe('счётчики HUD', () => {
  it('раздача А: VPIP, PFR, 3-бет (возможность), AF, C-бет, фолд на C-бет, WTSD, W$SD', () => {
    const acc = new Map<number, Counts>();
    addHand(acc, HAND_A());
    const c = (p: number) => acc.get(p)!;
    for (let p = 0; p < 6; p++) expect(c(p).hands).toBe(1);
    expect([0, 1, 2, 3, 4, 5].map((p) => c(p).vpip)).toEqual([0, 1, 0, 1, 1, 0]);
    expect([0, 1, 2, 3, 4, 5].map((p) => c(p).pfr)).toEqual([0, 0, 0, 1, 0, 0]);
    // после одного рейза ходили 4, 5, 0, 1 — у всех была возможность 3-бета, никто не взял
    expect([0, 1, 2, 3, 4, 5].map((p) => c(p).threeOpp)).toEqual([1, 1, 0, 0, 1, 1]);
    expect([0, 1, 2, 3, 4, 5].map((p) => c(p).three)).toEqual([0, 0, 0, 0, 0, 0]);
    expect([c(3).cbetOpp, c(3).cbet]).toEqual([1, 1]);
    expect([c(4).fcbOpp, c(4).fcb]).toEqual([1, 1]);
    expect([c(1).fcbOpp, c(1).fcb]).toEqual([1, 0]);
    expect([c(3).aggr, c(3).calls]).toEqual([1, 1]);
    expect([c(1).aggr, c(1).calls]).toEqual([1, 1]);
    expect([1, 3, 4].map((p) => c(p).saw)).toEqual([1, 1, 1]);
    expect([1, 3, 4].map((p) => c(p).sd)).toEqual([1, 1, 0]);
    expect([1, 3].map((p) => c(p).wsd)).toEqual([0, 1]);
    // кражи нет: первым вошёл не поздний
    expect([0, 1, 2, 3, 4, 5].reduce((a, p) => a + c(p).stealOpp + c(p).fstOpp, 0)).toBe(0);
    const s3 = summary(c(3));
    expect([s3.vpip, s3.pfr, s3.cbet, s3.wtsd, s3.wsd, s3.af]).toEqual([100, 100, 100, 100, 100, 1]);
    expect(summary(c(4)).foldCbet).toBe(100);
  });

  it('раздача Б: кража с баттона, фолд малого на кражу, 3-бет большого', () => {
    const acc = new Map<number, Counts>();
    addHand(acc, HAND_B());
    const c = (p: number) => acc.get(p)!;
    // катофф (4) мог украсть и спасовал, баттон украл
    expect([c(4).stealOpp, c(4).steal]).toEqual([1, 0]);
    expect([c(5).stealOpp, c(5).steal]).toEqual([1, 1]);
    // на блайндах против кражи: малый — пас, большой — 3-бет
    expect([c(0).fstOpp, c(0).fst]).toEqual([1, 1]);
    expect([c(1).fstOpp, c(1).fst]).toEqual([1, 0]);
    expect([c(1).threeOpp, c(1).three]).toEqual([1, 1]);
    expect([c(0).threeOpp, c(0).three]).toEqual([1, 0]);
    // до кражи ходившие ранние места возможности не имели
    expect(c(2).stealOpp + c(3).stealOpp).toBe(0);
    expect([c(5).vpip, c(5).pfr, c(1).vpip, c(1).pfr]).toEqual([1, 1, 1, 1]);
    expect(c(1).saw + c(5).saw).toBe(0);
    const s = summary(c(0));
    expect(s.foldSteal).toBe(100);
    expect(summary(c(5)).steal).toBe(100);
    expect(summary(c(1)).threeBet).toBe(100);
  });

  it('хранилище: по именам, свои — отдельно, повтор не считается, bb/100 только вне турнира', () => {
    const d = emptyHud();
    const names = Object.fromEntries(NAMES.map((n, i) => [i, n]));
    expect(recordHand(d, HAND_A(), 3, names)).toBe(true);
    expect(recordHand(d, HAND_A(), 3, names)).toBe(false);
    expect(recordHand(d, HAND_B(), 3, names, { tour: true })).toBe(true);
    expect(d.me.hands).toBe(2);
    expect(d.bots['Танька']).toBeUndefined();
    expect(d.bots['Ленка'].hands).toBe(2);
    expect(d.bots['Ленка'].three).toBe(1);
    expect(d.cash.hands).toBe(1);
    expect(d.cash.bb).toBeCloseTo((550 - 240) / 20);
    expect(d.hist).toHaveLength(2);
    // старые данные без новых полей приводятся к полному виду
    const old = normHud({ bots: { Вовка: { hands: 5, vpip: 2 } as unknown as Counts } });
    expect(old.bots['Вовка'].fst).toBe(0);
    expect(statVal(summaryOf(old.bots['Вовка']), 'vpip')).toBe('40');
    expect(statVal(summaryOf(old.bots['Вовка']), 'cbet')).toBe('—');
  });

  it('партии ботов: счётчики не выходят за возможности', async () => {
    const rng = new SeededRng(5);
    const acc = new Map<number, Counts>();
    const seats = [0, 1, 2, 3, 4, 5];
    for (let h = 0; h < 60; h++) {
      const s0 = newState({ ...cfgFrom({ mode: 'holdem', every: 0 }), hands: 1 }, seats);
      s0.button = h % 6;
      let s: State = deal(s0, rng).state;
      for (let g = 0; g < 400 && !s.over; g++) {
        const a = choose(makeView(s, [s.turn]), s.turn, 1, rng)!;
        const r = apply(s, s.turn, a, rng)!;
        for (const e of r.events) if (e.type === 'hand') addHand(acc, e.rec);
        s = r.state;
      }
    }
    for (const c of acc.values()) {
      expect(c.hands).toBe(60);
      expect(c.pfr).toBeLessThanOrEqual(c.vpip);
      expect(c.three).toBeLessThanOrEqual(c.threeOpp);
      expect(c.cbet).toBeLessThanOrEqual(c.cbetOpp);
      expect(c.fcb).toBeLessThanOrEqual(c.fcbOpp);
      expect(c.wsd).toBeLessThanOrEqual(c.sd);
      expect(c.sd).toBeLessThanOrEqual(c.saw);
      expect(c.steal).toBeLessThanOrEqual(c.stealOpp);
      expect(c.fst).toBeLessThanOrEqual(c.fstOpp);
    }
    expect([...acc.values()].reduce((a, c) => a + c.stealOpp, 0)).toBeGreaterThan(0);
  });
});

describe('выгрузка для трекеров', () => {
  it('эталонная раздача: шапка, места, блайнды, ходы, улицы, вскрытие, итог', () => {
    const names = Object.fromEntries(NAMES.map((n, i) => [i, n]));
    const at = new Date(2026, 9, 22, 15, 4, 5).getTime();
    const t = handText({ at, me: 3, names, rec: HAND_A() }, 1234)!;
    expect(t.split('\n')).toEqual([
      "PokerStars Hand #1234: Hold'em No Limit (10/20) - 2026/10/22 15:04:05 ET",
      "Table 'Lavochka C' 6-max Seat #6 is the button",
      'Seat 1: Вовка (1000 in chips)',
      'Seat 2: Ленка (1000 in chips)',
      'Seat 3: Серёга (1000 in chips)',
      'Seat 4: Танька (1000 in chips)',
      'Seat 5: Димон (1000 in chips)',
      'Seat 6: Колян (1000 in chips)',
      'Вовка: posts small blind 10',
      'Ленка: posts big blind 20',
      '*** HOLE CARDS ***',
      'Dealt to Танька [Ah Kh]',
      'Серёга: folds',
      'Танька: raises 40 to 60',
      'Димон: calls 60',
      'Колян: folds',
      'Вовка: folds',
      'Ленка: calls 40',
      '*** FLOP *** [Ks 9h 4h]',
      'Ленка: checks',
      'Танька: bets 80',
      'Димон: folds',
      'Ленка: calls 80',
      '*** TURN *** [Ks 9h 4h] [2c]',
      'Ленка: checks',
      'Танька: checks',
      '*** RIVER *** [Ks 9h 4h 2c] [7d]',
      'Ленка: bets 100',
      'Танька: calls 100',
      '*** SHOW DOWN ***',
      'Ленка: shows [Qs Qd]',
      'Танька: shows [Ah Kh]',
      'Танька collected 550 from pot',
      '*** SUMMARY ***',
      'Total pot 550 | Rake 0',
      'Board [Ks 9h 4h 2c 7d]',
      'Seat 1: Вовка folded before Flop',
      'Seat 2: Ленка showed [Qs Qd] and lost',
      'Seat 3: Серёга folded before Flop',
      'Seat 4: Танька showed [Ah Kh] and won (550)',
      'Seat 5: Димон folded on the Flop',
      'Seat 6: Колян (button) folded before Flop',
    ]);
  });

  it('без вскрытия: возврат невостребованной ставки, забрал без показа; чужие карты не выгружаются', () => {
    const names = Object.fromEntries(NAMES.map((n, i) => [i, n]));
    const rec = recFor({ ...HAND_B(), hole: { ...HAND_B().hole, 1: L('AS AD') } }, [5]);
    const t = handText({ at: 0, me: 5, names, rec }, 1)!;
    expect(t).toContain('Колян: raises 30 to 50');
    expect(t).toContain('Ленка: raises 100 to 150');
    expect(t).toContain('Uncalled bet (100) returned to Ленка');
    expect(t).toContain('Ленка collected 110 from pot');
    expect(t).toContain('Total pot 110 | Rake 0');
    expect(t).toContain('Seat 2: Ленка collected (110)');
    expect(t).not.toContain('As Ad');
    expect(t).toContain('Dealt to Колян [2c 3d]');
    // стад и прочие виды трекеры не понимают — пропускаем
    const out = exportHistory([{ at: 0, me: 5, names, rec }, { at: 0, me: 5, names, rec: { ...rec, game: 'stud7' } }]);
    expect(out.count).toBe(1);
    expect(out.skipped).toBe(1);
  });

  it('реплеер: шаги и стеки сходятся с итогом', () => {
    const fr = frames(HAND_A(), (p) => NAMES[p]);
    const last = fr[fr.length - 1];
    expect(last.stacks[3]).toBe(1000 + 310);
    expect(last.stacks[1]).toBe(1000 - 240);
    const bet = fr.find((f) => f.act?.k === 'act' && f.act.a === 'bet')!;
    expect(bet.text).toBe('Танька: ставка 80');
    const call = fr.find((f) => f.act?.k === 'act' && f.act.seat === 1 && f.act.a === 'call' && f.street === 1)!;
    expect(call.toCall).toBe(80);
    expect(call.potBefore).toBe(10 + 60 + 60 + 60 + 80);
  });
});

// ---------------------------------------------------------------- пуш/фолд

/** До места me все пасуют; me делает ход a. stacks — по местам 0..n-1, баттон — последнее место. */
function pfHand(n: number, me: number, hole: string, stack: number, a: Step, extra: Step[] = [], stacks?: number[]): HandRecord {
  const seats = Array.from({ length: n }, (_, i) => i);
  const button = n - 1;
  const ring = seats;
  const nx = (p: number) => ring.find((x) => x > p) ?? ring[0];
  const sb = n === 2 ? button : nx(button);
  const bb = nx(sb);
  const order: number[] = [];
  let x = bb;
  for (let i = 0; i < n; i++) {
    x = nx(x);
    order.push(x);
  }
  const steps: Step[] = [];
  for (const p of order) {
    if (p === me) break;
    steps.push([p, 'fold']);
  }
  steps.push(a, ...extra);
  return hand(steps, { seats, button, stacks: stacks ?? seats.map(() => stack), hole: { [me]: hole } });
}

describe('лучший ход: пуш/фолд', () => {
  it('ва-банк с тузами на малом блайнде (10 ББ) — верно, плюс в ББ', () => {
    const r = pfHand(6, 0, 'AH AD', 200, [0, 'raise', 190, 200]);
    const f = findPF(r, 0)!;
    expect(f.spot.kind).toBe('push');
    expect(f.did).toBe('push');
    const res = solvePF(f.spot);
    expect(res.best).toBe('push');
    expect(res.evBB).toBeGreaterThan(0);
    const v = bestMove(r, 0);
    expect(v.kind).toBe('exact');
    expect(v.ok).toBe(true);
    expect(v.short).toContain('верно');
  });

  it('ва-банк с 72о первым из 9 при 15 ББ — ошибка, считается потеря', () => {
    const r = pfHand(9, 2, '7C 2D', 300, [2, 'raise', 300, 300]);
    const res = solvePF(findPF(r, 2)!.spot);
    expect(res.best).toBe('fold');
    expect(res.evBB).toBeLessThan(0);
    const v = bestMove(r, 2);
    expect(v.ok).toBe(false);
    expect(v.short).toMatch(/лучше пас — потеряно \d+(\.\d)? ББ/);
  });

  it('колл ва-банка: с AKs — колл, с 72о — пас (на большом блайнде против пуша малого)', () => {
    for (const [hole, best] of [
      ['AS KS', 'call'],
      ['7C 2D', 'fold'],
    ] as const) {
      const r = hand([[0, 'raise', 190, 200], [1, best === 'call' ? 'call' : 'fold', 180, 200]], { seats: [0, 1, 2], button: 2, stacks: [200, 200, 200], hole: { 1: hole } });
      // в раздаче на троих баттон (2) спасовал первым
      r.acts.splice(2, 0, { k: 'act', street: 0, seat: 2, a: 'fold', amount: 0, to: 0 });
      const f = findPF(r, 1)!;
      expect(f.spot.kind).toBe('call');
      const res = solvePF(f.spot);
      expect(res.best, hole).toBe(best);
      expect(bestMove(r, 1).ok, hole).toBe(true);
    }
  });

  it('ICM: на пузыре колл, выгодный в фишках, по призовым — пас', () => {
    // Sit&Go, четверо, платят троим 50/30/20; у короткого 300 — он ждёт; большой стек пушит на нас
    const stacks = [4000, 2400, 300, 1300];
    // 0 — малый (большой стек), 1 — большой блайнд (мы), баттон — 3, 2 — UTG
    const r = hand(
      [
        [2, 'fold'],
        [3, 'fold'],
        [0, 'raise', 3990, 4000],
        [1, 'fold'],
      ],
      { seats: [0, 1, 2, 3], button: 3, stacks, big: 200, hole: { 1: 'AH 9C' } }
    );
    const f = findPF(r, 1, [50, 30, 20])!;
    const res = solvePF(f.spot);
    expect(res.kind).toBe('call');
    expect(res.needIcm!).toBeGreaterThan(res.need!);
    expect(res.best).toBe('fold');
    const v = bestMove(r, 1, [50, 30, 20]);
    expect(v.ok).toBe(true);
    expect(v.html).toContain('по ICM');
    // без ICM тот же колл — в плюс по фишкам
    expect(solvePF(findPF(r, 1)!.spot).evBB).toBeGreaterThan(0);
  });

  it('не пуш/фолд (глубоко) — оценка по шансам, честно подписана', () => {
    const v = bestMove(HAND_A(), 1);
    expect(v.kind).toBe('estimate');
    expect(v.html).toContain('оценка');
  });
});

describe('подсказки', () => {
  it('ауты: флеш-дро на флопе — 9, к риверу ~35%', () => {
    const o = outs(L('AH 5H'), L('KH 9H 2C'))!;
    expect(o.n).toBeGreaterThanOrEqual(9);
    expect(o.groups.find((g) => g.name === 'флеш')!.n).toBe(9);
    expect(hitChance(9, 47, 2)).toBeCloseTo(0.35, 2);
    // туз или король дают две пары (6 аутов), а двойка спаривает только доску — не аут
    expect(outs(L('AH KD'), L('7C 7D 2S'))!.groups.find((g) => g.name === 'две пары')!.n).toBe(6);
  });

  it('M и зоны Харрингтона', () => {
    expect(zoneOf(3000, 50, 100, 0).name).toBe('зелёная');
    expect(zoneOf(1500, 50, 100, 0).name).toBe('жёлтая');
    expect(zoneOf(1000, 50, 100, 0).name).toBe('оранжевая');
    expect(zoneOf(400, 50, 100, 0).name).toBe('красная');
    expect(zoneOf(100, 50, 100, 0).name).toBe('мёртвая');
  });

  it('подсказки и разбор не зависят от чужих закрытых карт', () => {
    const mk = (opp: string) => {
      const s0 = newState({ ...cfgFrom({ mode: 'holdem', stack: 300 }), hands: 1 }, [0, 1, 2]);
      s0.button = 2;
      const s = deal(s0, new SeededRng(4)).state;
      s.hole[0] = L('AH KH');
      s.hole[1] = L(opp);
      s.hole[2] = L('2C 7D');
      if (s.rec) s.rec.hole = { 0: L('AH KH'), 1: L(opp), 2: L('2C 7D') };
      return s;
    };
    const a = mk('QS QD');
    const b = mk('3S 4D');
    const turn = a.turn;
    const va = makeView(a, [turn]);
    const vb = makeView(b, [turn]);
    expect(JSON.stringify(va.hole[1 === turn ? 2 : 1])).toBe(JSON.stringify(vb.hole[1 === turn ? 2 : 1]));
    expect(tipsFor(va, turn, null)).toEqual(tipsFor(vb, turn, null));
    // разбор по своей истории — то же самое, что по полной
    const r = HAND_A();
    const full = { ...r, hole: { ...r.hole, 4: L('AS AD') } };
    expect(bestMove(recFor(full, [3]), 3)).toEqual(bestMove(full, 3));
    // HUD считается по своей истории так же, как по полной
    const x = new Map<number, Counts>();
    const y = new Map<number, Counts>();
    addHand(x, recFor(full, [3]));
    addHand(y, full);
    expect([...x.entries()]).toEqual([...y.entries()]);
  });

  it('пуш/фолд-подсказка по Нэшу на коротком стеке', () => {
    const s0 = newState({ ...cfgFrom({ mode: 'holdem' }), hands: 1 }, [0, 1, 2, 3, 4, 5]);
    for (let p = 0; p < 6; p++) s0.chips[p] = 100;
    s0.button = 4;
    const s = deal(s0, new SeededRng(9)).state;
    const me = s.turn;
    s.hole[me] = L('AH AD');
    if (s.rec) s.rec.hole[me] = L('AH AD');
    const t = tipsFor(makeView(s, [me]), me, null);
    expect(t.nash).toContain('ва-банк</b>');
    expect(t.m).toContain('красная');
    expect(t.str).toContain('AA');
  });
});

describe('журнал', () => {
  it('первая ставка на улице подписана «ставка», а не «рейз до»', () => {
    const rng = new SeededRng(2);
    let opens = 0;
    let bets = 0;
    for (let h = 0; h < 30; h++) {
      const s0 = newState({ ...cfgFrom({ mode: 'holdem', every: 0 }), hands: 1 }, [0, 1, 2]);
      s0.button = h % 3;
      let s: State = deal(s0, rng).state;
      for (let g = 0; g < 200 && !s.over; g++) {
        const r = apply(s, s.turn, choose(makeView(s, [s.turn]), s.turn, 2, rng)!, rng)!;
        for (const e of r.events as Event[]) {
          if (e.type === 'act' && e.open) {
            opens++;
            if (e.action.type === 'raise') expect(def.describe!(e, () => 'X')).toMatch(/ставка \d+/);
          }
          if (e.type === 'hand') bets += e.rec.acts.filter((a) => a.k === 'act' && a.a === 'bet').length;
        }
        s = r.state;
      }
    }
    expect(opens).toBe(bets);
    expect(opens).toBeGreaterThan(0);
  });
});
