/* Дурак: раздача, бой, подкидывание и лимиты, перевод, японский, скрытые карты, серия со званиями, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { Authority } from '../src/core/authority';
import { cd, def } from '../src/games/durak/def';
import { apply, beats, cfgFrom, DEFAULT_CFG, makeView, newState, setup, type Action, type Cfg, type State } from '../src/games/durak/engine';
import { botSeats, defaults } from './harness';

const cl = (t: string) => t.split(/\s+/).filter(Boolean).map(cd);

/** Позиция: руки по местам, колода (последняя — козырь). Ходит 0 под 1. */
function pos(c: Partial<Cfg>, hands: string[], deck: string, extra: Partial<State> = {}): State {
  const cfg: Cfg = { ...DEFAULT_CFG, ...c };
  const s = newState(cfg, hands.map((_, i) => i));
  hands.forEach((h, i) => (s.hands[i] = cl(h)));
  s.deck = cl(deck);
  const last = s.deck[s.deck.length - 1];
  s.trump = cfg.diamonds ? 'D' : last ? last.s : 'H';
  s.trumpCard = last && !cfg.diamonds ? last : null;
  s.game = 1;
  s.first = false;
  s.cap = Math.min(cfg.hand, s.hands[1].length);
  return Object.assign(s, extra);
}

const rng = () => new SeededRng(5);
function act(s: State, seat: number, a: Action): State {
  const r = apply(s, seat, a, rng());
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!.state;
}
const no = (s: State, seat: number, a: Action) => expect(apply(s, seat, a, rng())).toBeNull();

describe('раздача', () => {
  it('по шесть карт, козырь под колодой, первым ходит младший козырь', () => {
    for (let seed = 1; seed < 30; seed++) {
      const s = setup([0, 1, 2], { ...defaults(def) }, new SeededRng(seed));
      expect(s.seats.map((x) => s.hands[x].length)).toEqual([6, 6, 6]);
      expect(s.deck.length).toBe(36 - 18);
      expect(s.trumpCard).toEqual(s.deck[s.deck.length - 1]);
      const low = Math.min(...s.seats.flatMap((x) => s.hands[x].filter((c) => c.s === s.trump).map((c) => c.r)));
      if (Number.isFinite(low)) expect(s.hands[s.attacker].some((c) => c.s === s.trump && c.r === low)).toBe(true);
      expect(s.phase).toBe('attack');
    }
  });
  it('на шестерых 36 карт хватает впритык, а если не хватает — колода больше', () => {
    const s = setup([0, 1, 2, 3, 4, 5], { ...defaults(def), deck: 24 }, new SeededRng(3));
    expect(s.size).toBe(36);
  });
});

describe('бой', () => {
  const s = pos({}, ['7S'], '6H');
  it('старшей той же масти или козырем', () => {
    expect(beats(s, cd('7S'), cd('8S'))).toBe(true);
    expect(beats(s, cd('7S'), cd('6S'))).toBe(false);
    expect(beats(s, cd('7S'), cd('6H'))).toBe(true);
    expect(beats(s, cd('7H'), cd('6H'))).toBe(false);
    expect(beats(s, cd('7S'), cd('AD'))).toBe(false);
  });
  it('японский: пики только пиками, козырь — бубны', () => {
    const j = pos({ spades: true, diamonds: true }, ['7S'], '6H');
    expect(j.trump).toBe('D');
    expect(beats(j, cd('7S'), cd('6D'))).toBe(false);
    expect(beats(j, cd('7S'), cd('8S'))).toBe(true);
    expect(beats(j, cd('7H'), cd('6D'))).toBe(true);
    expect(beats(j, cd('7H'), cd('AS'))).toBe(false);
  });
});

describe('подкидывание', () => {
  it('только достоинства со стола, сначала ходивший, потом по кругу; все пас — бито и ход отбившегося', () => {
    let s = pos({}, ['7S 9H QD', '8S 10S AH QH', '7C KD 9C'], 'JC 6D 9S 10C AC 6H');
    s = act(s, 0, { type: 'attack', cards: cl('7S') });
    s = act(s, 1, { type: 'beat', i: 0, card: cd('8S') });
    expect(s.phase).toBe('throw');
    expect(s.asker).toBe(2); // у ходившего нет ни семёрок, ни восьмёрок — его пропускают
    no(s, 2, { type: 'throw', cards: cl('KD') });
    s = act(s, 2, { type: 'throw', cards: cl('7C') });
    expect(s.phase).toBe('defend');
    s = act(s, 1, { type: 'beat', i: 1, card: cd('AH') });
    // подкинуть больше никому нечем — бито само
    expect(s.table).toEqual([]);
    expect(s.bito.length).toBe(4);
    expect(s.attacker).toBe(1);
    expect(s.hands[0].length).toBe(6);
  });
  it('первый отбой — не больше пяти; и не больше, чем карт у отбивающегося', () => {
    let s = pos({}, ['7S 7H 7D 7C 8S 8H', '9S 9H 9D 9C 10S 10H', 'KC'], 'AC', { first: true });
    s.cap = 5;
    no(s, 0, { type: 'attack', cards: cl('7S 7H 7D 7C 8S') }); // разные достоинства
    s = act(s, 0, { type: 'attack', cards: cl('7S 7H 7D 7C') });
    s = act(s, 1, { type: 'take' });
    no(s, 0, { type: 'throw', cards: cl('8S 8H') }); // 4 + 2 > 5 … а восьмёрок на столе и нет
    const t = pos({}, ['7S 7H 7D', '9S 9H'], 'AC');
    no(t, 0, { type: 'attack', cards: cl('7S 7H 7D') }); // у отбивающегося только две карты
  });
  it('простой дурак: подкидывать нельзя — покрыл и бито', () => {
    let s = pos({ throwers: 'none' }, ['7S 8S', '9S 10S', '8H'], 'AC 6C');
    s = act(s, 0, { type: 'attack', cards: cl('7S') });
    s = act(s, 1, { type: 'beat', i: 0, card: cd('9S') });
    expect(s.table).toEqual([]);
    expect(s.attacker).toBe(1);
  });
  it('взял — подкидывают вдогонку, ход переходит через взявшего', () => {
    let s = pos({}, ['10S 10D 6H', '9S 7C', 'KH 10C'], 'AD 6D 8D 9D JD QD KD');
    s = act(s, 0, { type: 'attack', cards: cl('10S') });
    s = act(s, 1, { type: 'take' });
    expect(s.asker).toBe(0);
    s = act(s, 0, { type: 'throw', cards: cl('10D') });
    // у второго подкидывающего тоже десятка, но у отбивающегося осталось лишь 2 карты на 2 непокрытые — больше нельзя
    expect(s.hands[1].length).toBe(4);
    expect(s.known[1].length).toBe(2);
    expect(s.attacker).toBe(2);
  });
});

describe('переводной', () => {
  it('перевод картой того же достоинства на следующего, у которого хватает карт', () => {
    let s = pos({ transfer: true }, ['8H 6S 7D', '8S JH', '9C 8C KH'], 'AC 7C 6C 10S 6H JC');
    s = act(s, 0, { type: 'attack', cards: cl('8H') });
    s = act(s, 1, { type: 'transfer', card: cd('8S') });
    expect([s.attacker, s.defender, s.table.length]).toEqual([1, 2, 2]);
    // показом козыря: восьмёрка треф — козырь, остаётся на руке
    s = act(s, 2, { type: 'show', card: cd('8C') });
    expect([s.attacker, s.defender]).toEqual([2, 0]);
    expect(s.hands[2].some((c) => c.r === 8 && c.s === 'C')).toBe(true);
    no(s, 0, { type: 'transfer', card: cd('6S') });
  });
  it('нельзя переводить, если у следующего не хватит карт, и после того как покрыл', () => {
    const s = pos({ transfer: true }, ['8H 8D', '8S JH QH', '9C'], 'AC 7C');
    const a = act(s, 0, { type: 'attack', cards: cl('8H 8D') });
    no(a, 1, { type: 'transfer', card: cd('8S') });
    const b = act(pos({ transfer: true }, ['8H', '8S 9H 10H', '9C 7C 6C'], 'AC 7S'), 0, { type: 'attack', cards: cl('8H') });
    const c = act(b, 1, { type: 'beat', i: 0, card: cd('9H') });
    expect(c.phase).not.toBe('defend');
  });
});

describe('скрытые карты', () => {
  it('в view чужих рук и колоды нет, в событиях добора чужие карты скрыты', () => {
    const s = setup([0, 1, 2], defaults(def), new SeededRng(9));
    const v = makeView(s, [1]);
    expect(v.hands[0]).toEqual([]);
    expect(v.hands[1].length).toBe(6);
    expect(v.deck).toEqual([]);
    expect(v.counts[0]).toBe(6);
    const ev = { type: 'draw' as const, seat: 0, count: 2, cards: cl('7S 8S') };
    expect(def.redact!(ev, [1])).toMatchObject({ cards: undefined });
    expect(def.redact!(ev, [0])).toMatchObject({ cards: cl('7S 8S') });
  });
});

describe('партии ботов', () => {
  it('настоящие партии: дурак находится, конов много, карты не теряются', async () => {
    for (const n of [2, 3, 4, 6]) {
      let fools = 0;
      let bouts = 0;
      for (let g = 0; g < 10; g++) {
        const seats = botSeats(def, n, [g % 3]);
        const opts = defaults(def);
        const a = new Authority(def, seats, opts);
        a.rng = new SeededRng(100 * n + g);
        a.state = def.setup(seats, opts, a.rng);
        const brng = new SeededRng(g);
        let steps = 0;
        while (!a.result && steps < 5000) {
          const seat = a.toAct()[0];
          const total = a.state.deck.length + a.state.bito.length + a.state.table.reduce((x: number, p: any) => x + (p.d ? 2 : 1), 0) + a.state.seats.reduce((x: number, q: number) => x + a.state.hands[q].length, 0);
          expect(total).toBe(a.state.size);
          const action = await def.bot.choose(a.viewFor([seat]), seat, seats.find((x) => x.seat === seat)!.level, brng);
          expect(a.act(seat, action), `шаг ${steps}`).not.toBeNull();
          steps++;
        }
        expect(a.result).not.toBeNull();
        if (a.state.fool != null) fools++;
        bouts += a.state.bouts;
      }
      expect(fools).toBeGreaterThanOrEqual(8);
      expect(bouts / 10).toBeGreaterThan(n === 2 ? 6 : 4);
    }
  });
  it('сложный бот обыгрывает лёгкого', async () => {
    let hardFool = 0;
    let easyFool = 0;
    for (let g = 0; g < 60; g++) {
      const seats = [
        { seat: 0, kind: 'bot' as const, name: 'a', level: g % 2 ? 2 : 0 },
        { seat: 1, kind: 'bot' as const, name: 'b', level: g % 2 ? 0 : 2 },
      ];
      const a = new Authority(def, seats, defaults(def));
      a.rng = new SeededRng(7000 + g);
      a.state = def.setup(seats, defaults(def), a.rng);
      const brng = new SeededRng(g);
      while (!a.result) {
        const seat = a.toAct()[0];
        a.act(seat, await def.bot.choose(a.viewFor([seat]), seat, seats[seat].level, brng));
      }
      const f = a.state.fool;
      if (f == null) continue;
      if (seats[f].level === 2) hardFool++;
      else easyFool++;
    }
    expect(easyFool).toBeGreaterThan(hardFool);
  });
});

describe('серия со званиями', () => {
  it('король назначает козырь, г*вно сдаёт, ходят под г*вно', async () => {
    const opts = { ...defaults(def), ranks: true, games: 3 };
    const seats = botSeats(def, 3, [1]);
    const a = new Authority(def, seats, opts);
    a.rng = new SeededRng(42);
    a.state = def.setup(seats, opts, a.rng);
    const brng = new SeededRng(1);
    let sawTrump = false;
    while (!a.result) {
      const s = a.state as State;
      if (s.phase === 'trump') {
        sawTrump = true;
        expect(a.toAct()).toEqual([s.ranking[0]]);
        const fool = s.ranking[s.ranking.length - 1];
        const r = a.act(s.ranking[0], { type: 'trump', suit: 'S' });
        expect(r).not.toBeNull();
        expect(a.state.trump).toBe('S');
        expect(a.state.defender).toBe(fool);
        continue;
      }
      const seat = a.toAct()[0];
      a.act(seat, await def.bot.choose(a.viewFor([seat]), seat, 1, brng));
    }
    expect(sawTrump).toBe(true);
    expect(a.state.game).toBe(3);
  });
  it('cfgFrom: со званиями серия по умолчанию — 5 партий', () => {
    expect(cfgFrom({ ranks: true }).games).toBe(5);
  });
});

describe('показ', () => {
  it('позиция для превью — 36 разных карт', () => {
    const s = def.showcase!();
    const all = [...s.deck, ...s.bito, ...s.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a])), ...s.seats.flatMap((x) => s.hands[x])];
    expect(all.length).toBe(36);
    expect(new Set(all.map((c) => c.s + c.r)).size).toBe(36);
  });
});

describe('командами (2 на 2, 3 на 3)', () => {
  const teamPos = (hands: string[], deck = '') => pos({ teams: true }, hands, deck, { team: hands.length === 4 ? [0, 1, 0, 1, -1, -1] : [0, 1, 0, 1, 0, 1], trump: 'S' });
  it('напарник отбивающегося не подкидывает', () => {
    let s = teamPos(['8H 6S', '9H JH', '8C 6C', '8D 7D']);
    s = act(s, 0, { type: 'attack', cards: cl('8H') });
    s = act(s, 1, { type: 'beat', i: 0, card: cd('9H') });
    expect(s.asker).toBe(2); // Таньку (3, напарница Ленки) с восьмёркой бубен не спрашивают
    no(s, 3, { type: 'throw', cards: cl('8D') });
  });
  it('перевод — на соперника, через напарника', () => {
    let s = pos({ teams: true, transfer: true }, ['8H 6S 7S', '8S JH 9H', '9C 6C 7C', 'KH 7D QD'], 'AS', { team: [0, 1, 0, 1, -1, -1] });
    s = act(s, 0, { type: 'attack', cards: cl('8H') });
    s = act(s, 1, { type: 'transfer', card: cd('8S') });
    expect([s.attacker, s.defender]).toEqual([1, 2]);
  });
  it('вышла вся команда — партия кончена, дураки — оба соперника', () => {
    // колоды нет; Вовка ходит последней картой, Ленка кроет — Вовка вышел, у Серёги одна карта
    let s = teamPos(['8H', '9H JH', '6C', 'KH 7D']);
    s = act(s, 0, { type: 'attack', cards: cl('8H') });
    s = act(s, 1, { type: 'beat', i: 0, card: cd('9H') });
    expect(s.out).toEqual([0]);
    expect(s.phase).not.toBe('over');
    // ход у отбившейся Ленки — на соперника Серёгу (Вовка уже вышел)
    expect([s.attacker, s.defender]).toEqual([1, 2]);
    s = act(s, 1, { type: 'attack', cards: cl('JH') });
    s = act(s, 2, { type: 'take' });
    // Серёга взял; ход у Таньки на Серёгу
    expect([s.attacker, s.defender]).toEqual([3, 2]);
    s = act(s, 3, { type: 'attack', cards: cl('7D') });
    s = act(s, 2, { type: 'take' });
    s = act(s, 3, { type: 'attack', cards: cl('KH') });
    s = act(s, 2, { type: 'take' });
    // Ленка вышла, сыграв последнюю карту, теперь и Танька — их команда вся вышла:
    // дураки — Вовка с Серёгой, хоть Вовка и вышел первым
    expect(s.out).toEqual([0, 1, 3]);
    expect(s.phase).toBe('over');
    expect(s.losers).toEqual([0, 2]);
    expect(def.result(s)!.winners).toEqual([1, 3]);
  });
  it('партии ботов командами доигрываются, проигрывает целая команда', async () => {
    for (const n of [4, 6]) {
      for (let g = 0; g < 12; g++) {
        const seats = botSeats(def, n, [g % 3]);
        const opts = { ...defaults(def), teams: true, transfer: g % 2 === 1 };
        const a = new Authority(def, seats, opts);
        a.rng = new SeededRng(300 + 10 * n + g);
        a.state = def.setup(seats, opts, a.rng);
        const brng = new SeededRng(g);
        let steps = 0;
        while (!a.result && steps < 5000) {
          const seat = a.toAct()[0];
          const s = a.state as State;
          if (s.phase === 'attack') expect(s.team[s.attacker]).not.toBe(s.team[s.defender]);
          const r = a.act(seat, await def.bot.choose(a.viewFor([seat]), seat, seats.find((x) => x.seat === seat)!.level, brng));
          expect(r, `n=${n} g=${g} шаг ${steps}`).not.toBeNull();
          steps++;
        }
        const s = a.state as State;
        expect(a.result).not.toBeNull();
        if (!s.draw) {
          expect(s.losers.length).toBe(n / 2);
          expect(new Set(s.losers.map((x) => s.team[x])).size).toBe(1);
          expect(a.result!.winners.every((x) => !s.losers.includes(x))).toBe(true);
        }
      }
    }
  });
});
