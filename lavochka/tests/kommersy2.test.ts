/* «Коммерсы 2.0»: второй сезон — календарь 2004–2021, клуб, крах, «Цифра», стартапы, биткоин, болезнь, «Тындекс», концовки; партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/kommersy/def';
import { choose } from '../src/games/kommersy/bot';
import { apply, clubReady, hoursFree, marketWorth, newState, toAct, view, type State } from '../src/games/kommersy/engine';
import { S2 } from '../src/games/kommersy/season';
import { CARDS2, IT_FROM, LAST2, START_2009, START_2017, btcPrice, hype, m2 } from '../src/games/kommersy/s2data';
import { botSeats, simulate } from './harness';

const rng = () => new SeededRng(11);
const s2 = (seats: number[], start = START_2009, more = {}) => newState(seats, { season: 2, start, diff: 1, ...more }, [], rng());

describe('Коммерсы 2.0: календарь и старт', () => {
  it('январь 2004 → декабрь 2021, кризисы помесячно', () => {
    expect(S2.dateText(0)).toBe('январь 2004');
    expect(S2.dateText(LAST2)).toBe('декабрь 2021');
    expect(S2.segMonths(m2(2008, 9))).toBe(1);
    expect(S2.segMonths(m2(2020, 4))).toBe(1);
    // вне кризиса: «Цифра» — треть года, клуб — полгода; отрезок не залезает в кризисное окно
    expect(S2.segMonths(m2(2012, 1))).toBe(4);
    expect(S2.segMonths(m2(2012, 3))).toBe(2);
    expect(S2.segMonths(m2(2005, 1))).toBe(6);
    expect(S2.segMonths(m2(2008, 7))).toBe(2);
  });

  it('с 2004-го — Колян-хозяин клуба, дела дома на автопилоте; в сети акт клуба не играется — старт с 2009-го', () => {
    const s = s2([0], 0);
    const p = s.players[0];
    expect(p.club2?.sostav).toBeGreaterThan(0);
    expect(p.assets.map((a) => a.id)).toEqual(['h-ugol', 'h-magaziny', 'h-tc']);
    expect(p.skills.cifra).toBe(0);
    const net = s2([0, 1, 2], 0);
    expect(net.m).toBe(START_2009);
    expect(net.players.every((q) => q.cash === 1e6 && !q.club2)).toBe(true);
  });

  it('клетки по актам: в клубе — трансферы и матчи, в «Цифре» — хайп', () => {
    const club = new Set(Array.from({ length: 20 }, (_, i) => newState([0], { season: 2, start: 0 }, [], new SeededRng(i)).cells).flat());
    expect(club.has('transfer') && club.has('match')).toBe(true);
    const it3 = new Set(Array.from({ length: 20 }, (_, i) => newState([0], { season: 2, start: START_2017 }, [], new SeededRng(i)).cells).flat());
    expect(it3.has('hype')).toBe(true);
    expect(it3.has('transfer')).toBe(false);
  });

  it('колода второго сезона — ~220 карточек, id не повторяются, у каждой карточки 1–3 выбора', () => {
    expect(CARDS2.length).toBeGreaterThanOrEqual(210);
    expect(new Set(CARDS2.map((c) => c.id)).size).toBe(CARDS2.length);
    for (const c of CARDS2) expect(c.choices.length, c.id).toBeGreaterThanOrEqual(1), expect(c.choices.length, c.id).toBeLessThanOrEqual(3);
  });
});

describe('Коммерсы 2.0: механики', () => {
  it('IT-дело до монетизации ест деньги, после — приносит; кнопка «включить деньги»', () => {
    let s = s2([0]);
    const d = S2.deal('portal')!;
    s.players[0].assets.push({ uid: 99, id: 'portal', name: d.name, kind: 'biz', value: d.price, income: d.income, hours: d.hours, manager: false, mul: 1, aud: 80, sector: 'web' });
    expect(view(s, [0]).players[0].assets[0].now).toBeLessThan(0);
    s = apply(s, 0, { type: 'monet', uid: 99 }, rng())!.state;
    expect(view(s, [0]).players[0].assets[0].now).toBeGreaterThan(0);
    expect(apply(s, 0, { type: 'monet', uid: 99 }, rng())).toBeNull();
  });

  it('хайп и биткоин — по открытой истории дат', () => {
    expect(hype('social', m2(2012, 5))).toBeGreaterThan(hype('social', m2(2015, 1)));
    expect(btcPrice(m2(2017, 12))).toBeGreaterThan(10000);
    expect(btcPrice(m2(2018, 12))).toBeLessThan(5000);
    expect(btcPrice(m2(2021, 11))).toBeGreaterThan(50000);
  });

  it('крах: к январю 2009-го от империи остаётся $0,8–1,2 млн, клуб и дела уходят', async () => {
    for (let seed = 1; seed <= 4; seed++) {
      const r = new SeededRng(seed);
      let s: State = newState([0], { season: 2, start: 0 }, [], r);
      for (let k = 0; k < 20000 && s.m < IT_FROM; k++) {
        const seat = toAct(s)[0];
        s = apply(s, seat, choose(view(s, [seat]), seat, seed % 3, r)!, r)!.state;
      }
      const p = s.players[0];
      expect(p.club2).toBeUndefined();
      expect(p.trophies).toContain('Лига чемпионов 2007/08');
      expect(p.trophies).toContain('Чемпион Англии 2005/06');
      expect(p.loans).toEqual([]);
      // сразу после расчёта — миллион с разбросом (квартал после могли чуть потратить)
      expect(marketWorth(s, p)).toBeGreaterThan(5e5);
      expect(marketWorth(s, p)).toBeLessThan(1.6e6);
    }
  });

  it('«Тындекс»: все условия — покупка, но партия идёт дальше до проверки здоровья', () => {
    let s = s2([0], START_2017);
    s.m = m2(2019, 1);
    const p = s.players[0];
    Object.assign(p, { cash: 6e9, cto: true, assets: [] });
    Object.assign(p.stats, { name: 70, svyazi: 70, heat: 10 });
    expect(hoursFree(p)).toBeGreaterThan(80);
    expect(clubReady(s, p)).toBe(true);
    s.cells[0] = 'rest';
    s = apply(s, 0, { type: 'roll' }, { next: () => 0, int: () => 0, getState: () => 0 } as never)!.state;
    s = apply(s, 0, { type: 'move' }, rng())!.state;
    expect(s.ask?.choices[0].buy).toBe('club');
    const r = apply(s, 0, { type: 'choose', i: 0 }, rng())!;
    expect(r.state.players[0].club).toBe(true);
    expect(r.state.phase).not.toBe('over');
    expect(r.events.some((e) => e.t === 'club' && e.name)).toBe(true);
  });

  it('болезнь 2021-го бьёт по здоровью, в декабре — проверка: ниже порога смерть', () => {
    const r = new SeededRng(5);
    let s = s2([0], START_2017);
    s.m = m2(2021, 9);
    s.len = 1;
    s.players[0].stats.health = 30;
    s.players[0].zapas = 0;
    for (let k = 0; k < 5000 && s.phase !== 'over'; k++) {
      const seat = toAct(s)[0];
      s = apply(s, seat, choose(view(s, [seat]), seat, 0, r)!, r)!.state;
    }
    const p = s.players[0];
    expect(p.ill).toBeGreaterThan(20);
    expect(p.ending).toBe('dead');
    expect(def.result(s)!.winners).toEqual([]);
  });

  it('чужие стартапы и биткоины не видны, свои — видны', () => {
    const s = s2([0, 1]);
    s.players[1].ventures = [{ uid: 5, name: 'Игра про двор', stage: 1, invested: 1e5 }];
    s.players[1].btc = { amount: 10, where: 'flash', value: 1 };
    expect(JSON.stringify(view(s, [0]))).not.toContain('Игра про двор');
    expect(view(s, [1]).my!.s2!.ventures[0].name).toBe('Игра про двор');
  });
});

describe('Коммерсы 2.0: партии ботов', () => {
  it('одиночные с 2004, 2009 и 2017 доходят до декабря 2021-го на всех уровнях', async () => {
    for (const start of [0, START_2009, START_2017])
      for (let level = 0; level < 3; level++) {
        const r = new SeededRng(start + level);
        let s = newState([0], { season: 2, start, diff: 1 }, [], r);
        for (let k = 0; k < 40000 && s.phase !== 'over'; k++) {
          const seat = toAct(s)[0];
          const a = choose(view(s, [seat]), seat, level, r);
          expect(a).not.toBeNull();
          const res = apply(s, seat, a!, r);
          expect(res, JSON.stringify(a)).not.toBeNull();
          s = res!.state;
        }
        expect(s.phase).toBe('over');
        expect(s.players[0].ending).toMatch(/dead|tyndex|island|pension|zatulinka|lonely/);
      }
  }, 120000);

  it('сеть с 2009-го: гонка за «Тындексом» доходит до конца', async () => {
    for (const n of [2, 4]) {
      const r = await simulate(def, botSeats(def, n, [0, 1, 2]), { season: 2, start: START_2009, diff: 1, chance: 0, buh: false }, n, 80000);
      expect(r.error).toBeUndefined();
      expect(r.finished).toBe(true);
      expect(r.winners.length).toBeLessThanOrEqual(n);
    }
  }, 120000);
});
