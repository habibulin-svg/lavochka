/* «Вкладыши»: карты из фактов, колоды, правила боя (Рывок, Стенка, Броня, Пара, приёмы, усталость), жвачки и гарантия; прикидка баланса стартовых колод. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { CARDS, DECK_SIZE, MAX_COPIES, STARTERS, card, deckFrom, starterDeck } from '../src/games/vkladyshi/cards';
import { GUMS, PITY, autoDeck, deckValid, openGum, load, type Collection } from '../src/games/vkladyshi/collection';
import { choose } from '../src/games/vkladyshi/bot';
import { apply, legal, newState, view, type Action, type State, type Unit } from '../src/games/vkladyshi/engine';

const rng = () => new SeededRng(11);
function act(s: State, a: Action): State {
  const r = apply(s, s.players[s.cur].seat, a, rng());
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!.state;
}
function unit(uid: number, id: string, patch: Partial<Unit> = {}): Unit {
  const c = card(id);
  return { uid, id, atk: c.atk, hp: c.hp, maxHp: c.hp, kw: c.kw.slice(), sleep: false, done: false, armor: c.kw.includes('armor'), stun: false, ...patch };
}
function bare(): State {
  const s = newState([0, 1], ['garage', 'team'], rng());
  for (const p of s.players) {
    p.board = [];
    p.hand = [];
    p.maxMana = p.mana = 10;
  }
  s.uid = 100;
  return s;
}
const plain = CARDS.find((c) => !c.spell && !c.kw.length && !c.play && !c.death && c.atk >= 2 && c.hp > c.atk)!;

describe('Вкладыши: карты', () => {
  it('у каждой карты разумные числа, картинка и имя', () => {
    expect(CARDS.length).toBeGreaterThan(1000);
    for (const c of CARDS) {
      expect(c.cost, c.id).toBeGreaterThanOrEqual(0);
      expect(c.cost, c.id).toBeLessThanOrEqual(10);
      if (!c.spell) {
        expect(c.atk, c.id).toBeGreaterThanOrEqual(1);
        expect(c.hp, c.id).toBeGreaterThanOrEqual(1);
      } else expect(c.play, c.id).toBeTruthy();
      expect(c.img).toMatch(/^[a-z0-9]+\/\d{3}\.webp$/);
      expect(c.name.length, c.id).toBeGreaterThan(0);
    }
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
  });
  it('цены разнообразны в каждой коллекции', () => {
    for (const coll of ['turbo', 'bomb', 'final', 'lazer'] as const) {
      const costs = new Set(CARDS.filter((c) => c.coll === coll).map((c) => c.cost));
      expect(costs.size, coll).toBeGreaterThanOrEqual(3);
    }
  });
  it('стартовые колоды — по 20, не больше двух одинаковых', () => {
    for (const st of STARTERS) {
      const d = starterDeck(st.id);
      expect(d.length, st.id).toBe(DECK_SIZE);
      const n = new Map<string, number>();
      for (const id of d) n.set(id, (n.get(id) ?? 0) + 1);
      expect(Math.max(...n.values()), st.id).toBeLessThanOrEqual(MAX_COPIES);
    }
  });
  it('своя колода из опции: мусор выкидывается, недобор добирается', () => {
    const d = deckFrom(`c:${[plain.id, plain.id, plain.id, 'нет-такой'].join(';')}`);
    expect(d.length).toBe(DECK_SIZE);
    expect(d.filter((x) => x === plain.id).length).toBeLessThanOrEqual(MAX_COPIES + 1); // добор стартовой мог совпасть
  });
});

describe('Вкладыши: бой', () => {
  it('выложенный вкладыш спит, с Рывком — бьёт сразу', () => {
    const rush = CARDS.find((c) => !c.spell && c.kw.includes('rush') && !c.play)!;
    let s = bare();
    s.players[0].hand = [plain.id, rush.id];
    s.players[0].mana = plain.cost + rush.cost;
    s = act(s, { t: 'play', i: 0 });
    expect(apply(s, 0, { t: 'attack', uid: 100, tgt: { p: 1 } }, rng())).toBeNull();
    s = act(s, { t: 'play', i: 0 });
    const hero = s.players[1].hero;
    s = act(s, { t: 'attack', uid: 101, tgt: { p: 1 } });
    expect(s.players[1].hero).toBe(hero - rush.atk);
  });
  it('Стенка прикрывает хозяина и соседей', () => {
    const wall = CARDS.find((c) => !c.spell && c.kw.includes('wall'))!;
    const s = bare();
    s.players[0].board = [unit(1, plain.id)];
    s.players[1].board = [unit(2, wall.id), unit(3, plain.id)];
    expect(apply(s, 0, { t: 'attack', uid: 1, tgt: { p: 1 } }, rng())).toBeNull();
    expect(apply(s, 0, { t: 'attack', uid: 1, tgt: { p: 1, uid: 3 } }, rng())).toBeNull();
    expect(apply(s, 0, { t: 'attack', uid: 1, tgt: { p: 1, uid: 2 } }, rng())).not.toBeNull();
  });
  it('размен — урон обоим; Броня гасит первый удар', () => {
    let s = bare();
    s.players[0].board = [unit(1, plain.id)];
    s.players[1].board = [unit(2, plain.id, { armor: true })];
    s = act(s, { t: 'attack', uid: 1, tgt: { p: 1, uid: 2 } });
    const t = s.players[1].board.find((u) => u.uid === 2)!;
    expect(t.hp).toBe(plain.hp);
    expect(t.armor).toBe(false);
    expect(s.players[0].board[0].hp).toBe(plain.hp - plain.atk);
  });
  it('Пара: +1 за соседа той же сборной', () => {
    const a = CARDS.find((c) => c.coll === 'final' && c.kw.includes('pair') && !c.spell && CARDS.some((x) => x.id !== c.id && x.team === c.team && x.kw.includes('pair')))!;
    expect(a, 'есть пара игроков одной сборной').toBeTruthy();
    const b = CARDS.find((c) => c.team === a.team && c.id !== a.id && !c.spell && c.kw.includes('pair'))!;
    let s = bare();
    s.players[0].board = [unit(1, a.id), unit(2, b.id)];
    const hero = s.players[1].hero;
    s = act(s, { t: 'attack', uid: 1, tgt: { p: 1 } });
    expect(s.players[1].hero).toBe(hero - a.atk - 1);
  });
  it('приём Love is: лечение не выше максимума, цель обязательна', () => {
    const heal = CARDS.find((c) => c.coll === 'love' && c.play?.k === 'heal' && c.play.to === 'none')!;
    const buff = CARDS.find((c) => c.coll === 'love' && c.spell && c.play?.k === 'buff')!;
    let s = bare();
    s.players[0].hero = s.heroHp - 1;
    s.players[0].hand = [heal.id, buff.id];
    s = act(s, { t: 'play', i: 0 });
    expect(s.players[0].hero).toBe(s.heroHp);
    expect(apply(s, 0, { t: 'play', i: 0 }, rng())).toBeNull(); // некого усиливать
  });
  it('пустая колода — усталость растёт', () => {
    let s = bare();
    s.players[1].deck = [];
    const h = s.players[1].hero;
    s = act(s, { t: 'end' });
    expect(s.players[1].hero).toBe(h - 1);
    s = act(s, { t: 'end' });
    s = act(s, { t: 'end' });
    expect(s.players[1].hero).toBe(h - 3);
  });
  it('чужая рука скрыта во view', () => {
    const s = newState([0, 1], ['garage', 'team'], rng());
    const v = view(s, [0]);
    expect(v.players[0].hand.every((x) => typeof x === 'string')).toBe(true);
    expect(v.players[1].hand.every((x) => x === null)).toBe(true);
  });
  it('бот отвечает допустимым действием', () => {
    const s = newState([0, 1], ['army', 'love'], rng());
    for (let lvl = 0; lvl < 3; lvl++) {
      const a = choose(view(s, [0]), 0, lvl, rng()) as Action;
      expect(legal(s).some((x) => JSON.stringify(x) === JSON.stringify(a)) || a.t === 'end', JSON.stringify(a)).toBe(true);
    }
  });
});

describe('Вкладыши: коллекция', () => {
  it('жвачка: 3 вкладыша своей серии, монеты списаны, редкий не позже 10-й', () => {
    const c: Collection = { ...load(), coins: 10000, owned: {}, pity: {} };
    const g = GUMS.find((x) => x.id === 'turbo')!;
    let r = 0.5;
    const flat = () => (r = (r * 9301 + 49297) % 233280 / 233280); // детерминированно
    let sinceRare = 0;
    let maxGap = 0;
    for (let i = 0; i < 60; i++) {
      const got = openGum(c, g.id, () => Math.min(0.69, flat()))!; // «невезучий» бросок: только обычные…
      expect(got.length).toBe(3);
      for (const x of got) expect(g.sets).toContain(x.set);
      sinceRare = got.some((x) => x.rarity >= 2) ? 0 : sinceRare + 1;
      maxGap = Math.max(maxGap, sinceRare);
    }
    expect(maxGap).toBeLessThan(PITY); // …но гарантия срабатывает
    expect(c.coins).toBe(10000 - 60 * g.price);
  });
  it('стартовая коллекция: колоды готовы, «Собрать само» даёт годную колоду', () => {
    const c = load();
    for (const d of c.decks) expect(deckValid(c, d.ids)).toBeNull();
    expect(deckValid(c, autoDeck(c))).toBeNull();
  });
});

describe('Вкладыши: баланс (прикидка)', () => {
  it('стартовые колоды друг против друга — никто не выигрывает всухую', () => {
    const wins = new Map<string, number>();
    const games = new Map<string, number>();
    const r = new SeededRng(5);
    for (const a of STARTERS)
      for (const b of STARTERS) {
        if (a.id === b.id) continue;
        for (let k = 0; k < 6; k++) {
          let s = newState([0, 1], [a.id, b.id], r);
          for (let step = 0; step < 2000 && !s.over; step++) {
            const seat = s.players[s.cur].seat;
            const act2 = (choose(view(s, [seat]), seat, 1, r) as Action) ?? { t: 'end' };
            s = apply(s, seat, act2, r)?.state ?? apply(s, seat, { t: 'end' }, r)!.state;
          }
          expect(s.over).toBe(true);
          games.set(a.id, (games.get(a.id) ?? 0) + 1);
          games.set(b.id, (games.get(b.id) ?? 0) + 1);
          if (s.winner === 0) wins.set(a.id, (wins.get(a.id) ?? 0) + 1);
          if (s.winner === 1) wins.set(b.id, (wins.get(b.id) ?? 0) + 1);
        }
      }
    const rates = STARTERS.map((st) => [st.id, (wins.get(st.id) ?? 0) / (games.get(st.id) ?? 1)] as const);
    console.log('доля побед стартовых колод:', rates.map(([id, x]) => `${id} ${(x * 100).toFixed(0)}%`).join(', '));
    for (const [id, x] of rates) {
      expect(x, id).toBeGreaterThan(0.1);
      expect(x, id).toBeLessThan(0.9);
    }
  });
});
