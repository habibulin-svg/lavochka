/* Покер, общий движок: комбинации (и Short Deck), хедз-ап, минимальный рейз, побочные банки, анте, пайнэппл, Куршевель,
 * ротация 8-Game, рост блайндов, скрытые карты и история раздач (единый формат для всех видов). */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card, Suit } from '../src/cards/deck';
import { def } from '../src/games/poker/def';
import { choose } from '../src/games/poker/ai';
import { high, highCat, highName, highSD } from '../src/games/poker/hands';
import { apply, cfgFrom, deal, makeView, MIXES, newState, type Action, type Event, type HandRecord, type State } from '../src/games/poker/engine';

const rng = () => new SeededRng(8);
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);
const go = (s: State, seat: number, a: Action) => {
  const r = apply(s, seat, a, rng());
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!;
};
const start = (opts: Record<string, string | number | boolean>, seats: number[]) => deal(newState(cfgFrom(opts), seats), rng()).state;

describe('комбинации', () => {
  it('категории и кикеры; колесо — младший стрит', () => {
    expect(highCat(high(L('AH KD 9S 7C 4H 3D 2C')))).toBe(0);
    expect(highCat(high(L('AH 2D 3S 4C 5H KD QC')))).toBe(4);
    expect(highCat(high(L('AH AD AS 9C 9H 3D 2C')))).toBe(6);
    expect(highCat(high(L('9H 10H JH QH KH 3D 2C')))).toBe(8);
    expect(high(L('AH AD KS 7C 4H'))).toBeGreaterThan(high(L('AH AD QS 7C 4H')));
    expect(high(L('6H 2D 3S 4C 5H'))).toBeGreaterThan(high(L('AH 2D 3S 4C 5H')));
  });
  it('Short Deck: флеш старше фулл-хауса, A-6-7-8-9 — младший стрит', () => {
    const flush = highSD(L('AH 7H QH 9H 6H'));
    const full = highSD(L('QS QC QH 9H 9C'));
    expect(flush).toBeGreaterThan(full);
    expect(highName(flush, true)).toBe('флеш');
    expect(highName(full, true)).toBe('фулл-хаус');
    const wheel = highSD(L('AS 6D 7C 8H 9S'));
    expect(highName(wheel, true)).toBe('стрит');
    expect(highSD(L('6S 7D 8C 9H 10S'))).toBeGreaterThan(wheel);
    // в обычной колоде A-6-7-8-9 — не стрит
    expect(highCat(high(L('AS 6D 7C 8H 9S')))).toBe(0);
  });
});

describe('торговля', () => {
  it('вдвоём: баттон — малый блайнд и ходит первым до флопа, после — второй', () => {
    let s = start({ mode: 'holdem' }, [0, 1]);
    const btn = s.button;
    const other = 1 - btn;
    expect(s.bet[btn]).toBe(s.small);
    expect(s.bet[other]).toBe(s.big);
    expect(s.turn).toBe(btn);
    s = go(s, btn, { type: 'call' }).state;
    expect(s.turn).toBe(other);
    s = go(s, other, { type: 'check' }).state;
    expect(s.street).toBe(1);
    expect(s.board).toHaveLength(3);
    expect(s.turn).toBe(other);
  });
  it('безлимит: рейз не меньше прошлого повышения; пас — банк оставшемуся', () => {
    let s = start({ mode: 'holdem' }, [0, 1, 2]);
    expect(s.struct).toBe('nl');
    expect(apply(s, s.turn, { type: 'raise', to: 30 }, rng())).toBeNull();
    s = go(s, s.turn, { type: 'raise', to: 60 }).state;
    expect(apply(s, s.turn, { type: 'raise', to: 80 }, rng())).toBeNull();
    s = go(s, s.turn, { type: 'fold' }).state;
    const r = go(s, s.turn, { type: 'fold' });
    expect(r.events.find((e) => e.type === 'win')).toMatchObject({ uncontested: true, amount: 60 + 10 + 20 });
  });
  it('побочный банк: ва-банк с меньшим стеком претендует только на свою часть', () => {
    let s = start({ mode: 'holdem' }, [0, 1, 2]);
    // короткий стек у того, кто ходит первым
    const short = s.turn;
    s.chips[short] = 100;
    s.hole[short] = L('2C 3D');
    const others = [0, 1, 2].filter((p) => p !== short);
    s.hole[others[0]] = L('AS AH');
    s.hole[others[1]] = L('KS KH');
    s.deck = L('4C 7D 8S QC 5H JD 9H 10D');
    s = go(s, short, { type: 'allin' }).state;
    let r = go(s, s.turn, { type: 'raise', to: 500 });
    r = go(r.state, r.state.turn, { type: 'call' });
    // дальше двое с фишками досматривают чеками
    while (!r.events.some((e) => e.type === 'win')) r = go(r.state, r.state.turn, { type: 'check' });
    const wins = r.events.filter((e): e is Extract<Event, { type: 'win' }> => e.type === 'win');
    const total = 100 * 3 + 400 * 2;
    expect(wins.reduce((a, w) => a + w.amount, 0)).toBe(total);
    expect(wins.find((w) => w.seat === short)).toBeUndefined();
  });
  it('лимит: ставка ровно на единицу, не больше четырёх за круг', () => {
    let s = start({ mode: 'holdem', struct: 'limit' }, [0, 1, 2]);
    for (let i = 0; i < 3; i++) s = go(s, s.turn, { type: 'raise', to: s.current + s.big }).state;
    expect(s.raises).toBe(3);
    s = go(s, s.turn, { type: 'raise', to: s.current + s.big }).state;
    expect(apply(s, s.turn, { type: 'raise', to: s.current + s.big }, rng())).toBeNull();
  });
});

describe('анте и блайнды', () => {
  const posts = (s: State) => s.rec!.acts.filter((a) => a.k === 'post');
  it('анте с каждого — мёртвые фишки: в банке, но не в ставке круга', () => {
    const s = start({ mode: 'holdem', ante: 'all' }, [0, 1, 2]);
    expect(posts(s).filter((a) => a.k === 'post' && a.what === 'ante')).toHaveLength(3);
    expect(s.current).toBe(s.big);
    expect(s.total.reduce((a, b) => a + b, 0)).toBe(10 + 20 + 2 * 3);
    expect(s.bet.reduce((a, b) => a + b, 0)).toBe(30);
  });
  it('баттон-анте: баттон платит за всех; анте большого блайнда — блайнд за всех', () => {
    const s = start({ mode: 'holdem', ante: 'button' }, [0, 1, 2]);
    const an = posts(s).filter((a) => a.k === 'post' && a.what === 'ante');
    expect(an).toEqual([expect.objectContaining({ seat: s.button, amount: 6 })]);
    const b = start({ mode: 'holdem', ante: 'bb' }, [0, 1, 2]);
    const bbSeat = posts(b).find((a) => a.k === 'post' && a.what === 'bb')!;
    expect(posts(b).find((a) => a.k === 'post' && a.what === 'ante')).toMatchObject({ seat: (bbSeat as { seat: number }).seat, amount: 20 });
  });
  it('блайнды удваиваются каждые N раздач', () => {
    let s = start({ mode: 'holdem', every: 5 }, [0, 1]);
    const seen: Event[] = [];
    while (s.hand < 6) {
      const r = go(s, s.turn, { type: 'fold' });
      seen.push(...r.events);
      s = r.state;
    }
    expect(seen.find((e) => e.type === 'blinds')).toEqual({ type: 'blinds', small: 20, big: 40 });
    expect(s.big).toBe(40);
  });
});

describe('новые виды', () => {
  it('пайнэппл: три карты, после префлопа каждый сбрасывает одну, потом флоп', () => {
    let s = start({ mode: 'pineapple' }, [0, 1, 2]);
    expect(s.hole[0]).toHaveLength(3);
    s = go(s, s.turn, { type: 'call' }).state;
    s = go(s, s.turn, { type: 'call' }).state;
    s = go(s, s.turn, { type: 'check' }).state;
    expect(s.phase).toBe('discard');
    expect(s.board).toHaveLength(0);
    // чужую карту или вне очереди сбросить нельзя
    expect(apply(s, s.turn, { type: 'discard', card: s.hole[(s.turn + 1) % 3][0] }, rng())).toBeNull();
    for (let i = 0; i < 3; i++) s = go(s, s.turn, { type: 'discard', card: s.hole[s.turn][2] }).state;
    expect(s.phase).toBe('bet');
    expect(s.board).toHaveLength(3);
    expect([0, 1, 2].map((p) => s.hole[p].length)).toEqual([2, 2, 2]);
  });
  it('крейзи-пайнэппл: сброс после торговли на флопе, до тёрна', () => {
    let s = start({ mode: 'crazy' }, [0, 1]);
    s = go(s, s.turn, { type: 'call' }).state;
    s = go(s, s.turn, { type: 'check' }).state;
    expect(s.phase).toBe('bet');
    expect(s.board).toHaveLength(3);
    s = go(s, s.turn, { type: 'check' }).state;
    s = go(s, s.turn, { type: 'check' }).state;
    expect(s.phase).toBe('discard');
    for (let i = 0; i < 2; i++) s = go(s, s.turn, { type: 'discard', card: s.hole[s.turn][0] }).state;
    expect(s.board).toHaveLength(4);
  });
  it('Куршевель: пять карт, первая карта флопа открыта до торговли', () => {
    let s = start({ mode: 'courchevel' }, [0, 1, 2]);
    expect(s.hole[0]).toHaveLength(5);
    expect(s.board).toHaveLength(1);
    expect(s.struct).toBe('pot');
    s = go(s, s.turn, { type: 'call' }).state;
    s = go(s, s.turn, { type: 'call' }).state;
    s = go(s, s.turn, { type: 'check' }).state;
    expect(s.board).toHaveLength(3);
  });
  it('Short Deck: колода с шестёрки', () => {
    const s = start({ mode: 'shortdeck' }, [0, 1, 2]);
    expect([...s.deck, ...s.hole.flat()].every((c) => c.r >= 6)).toBe(true);
    expect(s.deck.length + 6).toBe(36);
  });
  it('8-Game: восемь видов по кругу, каждый на круг раздач, со своими ставками', () => {
    let s = start({ mode: 'eight' }, [0, 1, 2]);
    const seen: string[] = [];
    while (s.hand <= 24 && !s.over) {
      seen[Math.floor((s.hand - 1) / 3)] = `${s.game}${s.hilo ? '8' : ''}:${s.struct}`;
      const r = apply(s, s.turn, s.phase === 'draw' ? { type: 'draw', cards: [] } : { type: 'fold' }, rng());
      expect(r).not.toBeNull();
      s = r!.state;
    }
    expect(seen).toEqual(MIXES.eight.slots.map((x) => `${x.game}${x.hilo ? '8' : ''}:${x.struct}`));
  });
  it('у каждого вида — свой предел мест', () => {
    const counts = (mode: string) => def.countsFor!({ mode });
    expect(Math.max(...counts('holdem'))).toBe(9);
    expect(Math.max(...counts('stud7'))).toBe(7);
    expect(Math.max(...counts('draw5'))).toBe(6);
    expect(Math.max(...counts('eight'))).toBe(6);
  });
});

describe('скрытые карты и история раздач', () => {
  it('вид места: чужие закрытые карты скрыты, в истории — тоже', () => {
    const s = start({ mode: 'holdem' }, [0, 1, 2]);
    const v = makeView(s, [0]);
    expect(v.hole[0].every(Boolean)).toBe(true);
    expect(v.hole[1].every((c) => c === null)).toBe(true);
    expect(v.rec!.hole[0].every(Boolean)).toBe(true);
    expect(v.rec!.hole[1].every((c) => c === null)).toBe(true);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(s.hole[1][0]).slice(0, -1) + ',');
  });

  it('боты на всех видах: каждая раздача записана, фишки сходятся, чужое не утекает', () => {
    for (const p of def.presets!) {
      const opts = { ...Object.fromEntries(def.options!.map((o) => [o.key, o.default])), ...p.options, hands: 12 };
      const seats = [0, 1, 2, 3];
      const r0 = new SeededRng(11);
      let s = def.setup(seats.map((seat) => ({ seat, kind: 'bot', level: 1, name: '' })), opts, r0);
      const recs: HandRecord[] = [];
      let guard = 0;
      while (!s.over && guard++ < 5000) {
        const seat = s.turn;
        const a = choose(makeView(s, [seat]), seat, guard % 3, r0);
        expect(a, `${p.id}: бот не нашёл хода`).not.toBeNull();
        const r = apply(s, seat, a!, r0);
        expect(r, `${p.id}: ход отклонён ${JSON.stringify(a)}`).not.toBeNull();
        for (const e of r!.events) if (e.type === 'hand') recs.push(e.rec);
        // история глазами места 0: чужие сброшенные и обменянные карты закрыты
        for (const e of r!.events) {
          const red = def.redact!(e, [0]);
          if (red?.type === 'hand')
            for (const a2 of red.rec.acts) if ((a2.k === 'discard' || a2.k === 'draw') && a2.seat !== 0) expect(JSON.stringify(a2), p.id).not.toMatch(/"r":/);
        }
        s = r!.state;
      }
      expect(s.over, p.id).toBe(true);
      expect(recs.length, p.id).toBe(s.hand);
      for (const rec of recs) {
        const put = rec.acts.reduce((a, x) => a + (x.k === 'post' || x.k === 'act' ? x.amount : 0), 0);
        const won = rec.winners.reduce((a, w) => a + w.amount, 0);
        expect(won, `${p.id} раздача ${rec.no}: выигрыш = банку`).toBe(put);
        expect(Object.values(rec.net).reduce((a, b) => a + b, 0), `${p.id} раздача ${rec.no}: итог = 0`).toBe(0);
        expect(rec.v).toBe(1);
        if (rec.showdown) expect(Object.keys(rec.shown).length, `${p.id}: на вскрытии показаны руки`).toBeGreaterThan(1);
        if (rec.game === 'holdem' || rec.game === 'omaha4') expect(rec.board.length === 5 || !rec.showdown, p.id).toBe(true);
      }
    }
  }, 120_000);
});
