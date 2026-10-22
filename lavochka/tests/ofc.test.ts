/* Китайский покер (OFC): роялти, фол, счёт 1-6, фантазия, скрытый сброс, партии ботов на всех пресетах. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card, Suit } from '../src/cards/deck';
import { def } from '../src/games/poker/def';
import { chooseOfc, fantasySet } from '../src/games/poker/ofc/ai';
import { applyOfc, fantasyFor, foulRisk, isFoul, makeOView, ocfgFrom, redactOfc, royalty, scoreHand, setupOfc, type OState } from '../src/games/poker/ofc/engine';

const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14, T: 10 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const R = (top: string, mid: string, bot: string) => [L(top), L(mid), L(bot)];

describe('китайский покер: ряды и роялти', () => {
  it('роялти низа, середины и верха', () => {
    expect(royalty(L('2S 3D 4C 5H 6S'), 2)).toBe(2);
    expect(royalty(L('2S 3D 4C 5H 6S'), 1)).toBe(4);
    expect(royalty(L('2H 7H 9H JH KH'), 2)).toBe(4);
    expect(royalty(L('2H 7H 9H JH KH'), 1)).toBe(8);
    expect(royalty(L('9S 9D 9C 4S 4D'), 2)).toBe(6);
    expect(royalty(L('9S 9D 9C 4S 4D'), 1)).toBe(12);
    expect(royalty(L('9S 9D 9C 9H 4D'), 2)).toBe(10);
    expect(royalty(L('9S 9D 9C 9H 4D'), 1)).toBe(20);
    expect(royalty(L('5H 6H 7H 8H 9H'), 2)).toBe(15);
    expect(royalty(L('AH KH QH JH TH'), 2)).toBe(25);
    expect(royalty(L('AH KH QH JH TH'), 1)).toBe(50);
    expect(royalty(L('9S 9D 9C 4S 2D'), 1)).toBe(2);
    expect(royalty(L('9S 9D 9C 4S 2D'), 2)).toBe(0);
    expect(royalty(L('5S 5D AC'), 0)).toBe(0);
    expect(royalty(L('6S 6D 2C'), 0)).toBe(1);
    expect(royalty(L('QS QD 2C'), 0)).toBe(7);
    expect(royalty(L('AS AD 2C'), 0)).toBe(9);
    expect(royalty(L('2S 2D 2C'), 0)).toBe(10);
    expect(royalty(L('AS AD AC'), 0)).toBe(22);
  });

  it('фол: ряды должны усиливаться сверху вниз, равенство можно', () => {
    expect(isFoul(R('AS AD 3C', '6C 6D QD 8C 4D', 'TS TD 7S 7C 2D'))).toBe(true);
    expect(isFoul(R('AS KD 3C', '6C 6D QD 8C 4D', 'TS TD 7S 7C 2D'))).toBe(false);
    expect(isFoul(R('2S 3D 4C', 'KC KD 5S 5H 3D', 'QC QH 6S 6H 2D'))).toBe(true);
    // пара дам вверху и пара дам с теми же кикерами в середине — не фол
    expect(isFoul(R('QS QD 5C', 'QC QH 5S 4H 3D', 'AS AD AC 2S 2D'))).toBe(false);
    expect(isFoul(R('QS QD 9C', 'QC QH 5S 4H 3D', 'AS AD AC 2S 2D'))).toBe(true);
  });

  it('подсказка «фол!»: верх уже сильнее полной середины', () => {
    expect(foulRisk(R('AS AD', 'KC 5S 7D', ''))).toBe('risk');
    expect(foulRisk(R('AS AD', 'KC QS 7D 5H 3C', ''))).toBe('foul');
    expect(foulRisk(R('2S', 'KC KS', 'AH'))).toBe(null);
    expect(foulRisk(R('AS AD', 'KC 5S', ''))).toBe(null);
  });
});

const cfg = ocfgFrom({ mode: 'ofcp', fant: 'on' });
const st = (rows: Card[][][]): Pick<OState, 'seats' | 'rows' | 'cfg' | 'fant'> => ({ seats: rows.map((_, i) => i), rows, cfg, fant: Array(9).fill(0) });

describe('китайский покер: счёт', () => {
  it('по очку за ряд, скуп +3, роялти — разница', () => {
    const a = R('KS KD 2C', '8C 8D 8H 4S 3D', 'AH 7H 9H JH 2H'); // KK = 8, сет в середине = 2, флеш внизу = 4
    const b = R('QS 5D 2D', 'JC JD 6H 4C 3C', 'TS TD 7S 7C 2S'); // без роялти
    const sc = scoreHand(st([a, b]));
    expect(sc.roy[0]).toEqual([8, 2, 4]);
    expect(sc.net[0]).toBe(3 + 3 + 14);
    expect(sc.net[1]).toBe(-20);
  });

  it('ряды пополам: 2:1 — одно очко; ничья в ряду — ноль', () => {
    const a = R('2S 3D 4C', 'KC KD 5S 5H 3S', 'AH AD 9C 7C 2H');
    a[2] = L('AH AD AC 7C 2H');
    const b = R('AS 3H 5C', 'QC QD 6S 6H 7S', 'KS KH 8S 8D 2C');
    // верх — у b, середина и низ — у a
    expect(scoreHand(st([a, b])).net[0]).toBe(1);
    const c = R('2S 3D 4C', 'KC KD 5S 5H 3S', 'AH AD 9C 7C 2H');
    const d = R('2H 3C 4S', 'KS KH 5D 5C 3H', 'AS AC 9H 7H 2D');
    expect(scoreHand(st([c, d])).net[0]).toBe(0);
  });

  it('фол: 6 очков и роялти соперника; свои роялти сгорают; фол у обоих — 0', () => {
    const good = R('6S 6D 2C', 'KC KD 5S 5H 3D', '7H 8H JH 2H 4H'); // 1 + 4
    const foul = R('AS AC 3S', '6C 6H QD 8C 4D', 'TS TD TC 7C 2D');
    const sc = scoreHand(st([good, foul]));
    expect(sc.foul[1]).toBe(true);
    expect(sc.roy[1]).toEqual([0, 0, 0]);
    expect(sc.net[0]).toBe(6 + 5);
    expect(scoreHand(st([foul, foul.map((r) => r.slice())])).net[0]).toBe(0);
  });

  it('втроём: итог раздачи — ноль', () => {
    const sc = scoreHand(st([R('KS KD 2C', '8C 8D 8H 4S 3D', 'AH 7H 9H JH 2H'), R('QS 5D 2D', 'JC JD 6H 4C 3C', 'TS TD 7S 7C 2S'), R('AS AC 3S', '6C 6H QD 8C 4D', 'TH TC 9C 9S 2D')]));
    expect(Object.values(sc.net).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('китайский покер: фантазия', () => {
  const prog = ocfgFrom({ mode: 'ofcp', fant: 'prog' });
  const classic = ocfgFrom({ mode: 'ofc', fant: 'on' });
  const rows = (top: string) => R(top, 'KC KD KH 5S 5D', 'AS AD AH AC 2D');
  it('вход: QQ+ без фола; прогрессивная — 14/15/16/17; классика — 13', () => {
    expect(fantasyFor(rows('JS JD 2C'), cfg, false)).toBe(0);
    expect(fantasyFor(rows('QS QD 2C'), cfg, false)).toBe(14);
    expect(fantasyFor(rows('QS QH 2C'), prog, false)).toBe(14);
    expect(fantasyFor(R('KS KS 2C', '9C 9D 9H 5S 5D', 'AS AD AH AC 2D'), prog, false)).toBe(15);
    expect(fantasyFor(R('QS QH QC', '9C 9D 9H 5S 5D', 'AS AD AH AC 2D'), prog, false)).toBe(17);
    expect(fantasyFor(rows('QS QH 2C'), classic, false)).toBe(13);
    expect(fantasyFor(rows('QS QH 2C'), ocfgFrom({ mode: 'ofcp', fant: 'off' }), false)).toBe(0);
    // фол — никакой фантазии
    expect(fantasyFor(R('AS AH 2C', '9C 8D 7H 5S 3D', 'AS AD AH AC 2D'), cfg, false)).toBe(0);
  });
  it('остаться: сет вверху, фулл в середине или каре внизу', () => {
    expect(fantasyFor(R('2S 3H 4C', '9C 9D 9H 5S 5D', 'TS TD TH TC 2D'), cfg, true)).toBe(14);
    expect(fantasyFor(R('7S 7H 7C', '9C 9D 9H 5S 4D', 'TS TD TH 8C 2D'), cfg, true)).toBe(14);
    expect(fantasyFor(R('2S 3H 4C', '9C 9D 5H 5S 3D', 'AS AD AH AC 2D'), cfg, true)).toBe(14);
    expect(fantasyFor(R('QS QH 4C', 'KC KD 5H 5S 3D', 'AS AD AH 7C 2D'), cfg, true)).toBe(0);
  });
  it('бот раскладывает фантазию без фола', () => {
    const held = L('AH KH QH JH TH 9S 9D 9C 4S 4D 2C 2D 7S 3H');
    const to = fantasySet(held, prog);
    expect(to.filter((x) => x === 'x').length).toBe(1);
    const r: Card[][] = [[], [], []];
    to.forEach((t, i) => t !== 'x' && r[t].push(held[i]));
    expect(isFoul(r)).toBe(false);
    expect(r[2].every((c) => c.s === 'H')).toBe(true);
  });
});

describe('китайский покер: ход партии', () => {
  it('сброс и фантазия скрыты от соперников', () => {
    const rng = new SeededRng(5);
    let s = setupOfc([0, 1, 2], { mode: 'ofcp', fant: 'on' }, rng);
    const v = makeOView(s, [1]);
    expect(v.held[s.turn].every((c) => c === null) || s.turn === 1).toBe(true);
    // раскладка до первого добора
    for (let i = 0; i < 3; i++) s = applyOfc(s, s.turn, chooseOfc(makeOView(s, [s.turn]), s.turn, 0, rng)!, rng)!.state;
    const p = s.turn;
    const r = applyOfc(s, p, chooseOfc(makeOView(s, [p]), p, 0, rng)!, rng)!;
    const pl = r.events.find((e) => e.type === 'oplace')!;
    const other = [0, 1, 2].find((x) => x !== p)!;
    expect(JSON.stringify(redactOfc(pl, [other]))).not.toContain('"cards"');
    expect(makeOView(r.state, [other]).disc[p]).toEqual([]);
    expect(makeOView(r.state, [p]).disc[p].length).toBe(1);
    // фантазия соперника — рубашками до подсчёта
    const f = { ...r.state, fant: r.state.fant.map((x, i) => (i === p ? 14 : x)) };
    expect(makeOView(f, [other]).rows[p].flat().every((c) => c === null)).toBe(true);
  });

  it('боты на всех пресетах: партия доходит до конца, счёт сходится к нулю', () => {
    for (const pr of def.presets!.filter((x) => String(x.options.mode).startsWith('ofc'))) {
      for (const n of pr.options.mode === 'ofc' ? [2, 4] : [2, 3]) {
        const rng = new SeededRng(17 + n);
        const seats = Array.from({ length: n }, (_, i) => i);
        let s = setupOfc(seats, { ...pr.options, deals: 4 }, rng);
        let scores = 0;
        let guard = 0;
        while (!s.over && guard++ < 1000) {
          const p = s.turn;
          const a = chooseOfc(makeOView(s, [p]), p, (p + guard) % 3, rng);
          expect(a, pr.id).not.toBeNull();
          const r = applyOfc(s, p, a!, rng);
          expect(r, `${pr.id}: ход отклонён`).not.toBeNull();
          for (const e of r!.events) if (e.type === 'oscore') {
            scores++;
            expect(Object.values(e.score.net).reduce((x, y) => x + y, 0)).toBe(0);
          }
          s = r!.state;
        }
        expect(s.over, pr.id).toBe(true);
        expect(scores).toBe(4);
        expect(seats.reduce((x, p) => x + s.pts[p], 0)).toBe(0);
      }
    }
  }, 120_000);

  it('сложный бот фолит редко', () => {
    const rng = new SeededRng(3);
    let fouls = 0;
    let total = 0;
    let s = setupOfc([0, 1], { mode: 'ofcp', fant: 'on', deals: 12 }, rng);
    while (!s.over) {
      const p = s.turn;
      const r = applyOfc(s, p, chooseOfc(makeOView(s, [p]), p, 2, rng)!, rng)!;
      for (const e of r.events) if (e.type === 'oscore') for (const q of [0, 1]) (total++, e.score.foul[q] && fouls++);
      s = r.state;
    }
    expect(fouls / total).toBeLessThan(0.35);
  }, 120_000);
});
