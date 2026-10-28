/**
 * «Корона Эмбера», «Классика 1994»: партии ботов против ботов и точечные проверки правил движка.
 */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { botAction } from '../src/games/korona/classic/ai';
import { ADV } from '../src/games/korona/classic/cards';
import { TRAVELLERS, cellsNamed } from '../src/games/korona/classic/data';
import { cellKind } from '../src/games/korona/classic/cells';
import { H, apply, bump, capOf, distances, neighbours, lose, newHero, newState, placeAt, push, run } from '../src/games/korona/classic/engine';
import { duelPower, duelStat } from '../src/games/korona/classic/special-pvp';
import type { Seat, X } from '../src/games/korona/classic/engine';
import type { CState } from '../src/games/korona/classic/state';

const MAX_ACTIONS = 20000;

interface Played {
  s: CState;
  actions: number;
  turns: number;
}

function play(seed: number, n: number): Played {
  const rng = new SeededRng(seed);
  const seats: Seat[] = Array.from({ length: n }, (_, i) => ({ seat: i, kind: 'bot', name: `Бот ${i + 1}`, level: i % 3 }));
  let s = newState(seats, rng);
  let actions = 0;
  while (s.winner == null && actions < MAX_ACTIONS) {
    const actor = s.prompt ? s.prompt.seat : s.turn;
    const a = botAction(s, actor, s.levels[actor], rng);
    if (!a) throw new Error(`seed ${seed}: бот ${actor} не ответил (prompt=${JSON.stringify(s.prompt)}, phase=${s.phase}, turn=${s.turn})`);
    const r = apply(s, actor, a, rng);
    if (!r) throw new Error(`seed ${seed}: действие отклонено ${JSON.stringify(a)} (prompt=${JSON.stringify(s.prompt)}, phase=${s.phase}, turn=${s.turn})`);
    s = r.state;
    actions++;
    if (s.run.length > 100) throw new Error(`seed ${seed}: стек сценариев разросся (${s.run.length}) — зацикливание`);
    for (const o of s.seats) {
      const h = H(s, o);
      for (const k of ['ПС', 'ПУ', 'ПМ'] as const) if (!Number.isFinite(h.st[k]) || h.st[k] < 0) throw new Error(`seed ${seed}: ${k}=${h.st[k]}`);
      if (!Number.isFinite(h.life) || !Number.isFinite(h.gold) || h.gold < 0 || h.po < 0) throw new Error(`seed ${seed}: плохие пункты ${JSON.stringify([h.life, h.gold, h.po])}`);
    }
  }
  return { s, actions, turns: s.round };
}

describe('Корона Эмбера, Классика 1994: партии ботов', () => {
  const results: Played[] = [];
  const sizes = [2, 3, 4];
  it('30 партий 2–4 мест: без исключений и зависаний, бот всегда отвечает', () => {
    for (let k = 0; k < 30; k++) results.push(play(1000 + k * 7, sizes[k % 3]));
    const won = results.filter((r) => r.s.winner != null);
    const avg = won.reduce((a, r) => a + r.turns, 0) / Math.max(1, won.length);
    // eslint-disable-next-line no-console
    console.log(`Корона-классика: до победы дошло ${won.length} из ${results.length}, в среднем ${avg.toFixed(0)} кругов, действий ${Math.round(results.reduce((a, r) => a + r.actions, 0) / results.length)}`);
    expect(won.length).toBeGreaterThanOrEqual(Math.ceil(results.length * 0.6));
  }, 600000);
});

// ---------- точечные проверки правил ----------

const GOBLIN = 8; // у Гоблина нет особенностей в бою и на клетках — удобный «чистый» путник

function fresh(): { s: CState; x: X } {
  const rng = new SeededRng(7);
  const s = newState([{ seat: 0, kind: 'human', name: 'А' }, { seat: 1, kind: 'human', name: 'Б' }], rng);
  s.turn = 0;
  s.heroes[0] = newHero(0, GOBLIN, s.shelf);
  const h = H(s, 0);
  h.cell = 12;
  h.life = 5;
  h.gold = 0;
  h.po = 0;
  h.things = [];
  return { s, x: { ev: [], rng } };
}

describe('Классика 1994: правила движка', () => {
  it('компенсация потерь: нет ПС — платишь ПМ/ПУ, нет денег — ПУ, нет ничего — ПЖ', () => {
    const { s, x } = fresh();
    const h = H(s, 0);
    h.st = { ПС: 0, ПУ: 3, ПМ: 5 };
    lose(s, x, 0, 'ПС', 2);
    expect(h.st).toEqual({ ПС: 0, ПУ: 3, ПМ: 3 }); // платит тем, чего больше
    h.st = { ПС: 1, ПУ: 0, ПМ: 0 };
    lose(s, x, 0, 'ПС', 3); // 1 ПС, остальное — деньги нет, значит жизнь
    expect(h.st.ПС).toBe(0);
    expect(h.life).toBeLessThan(5);
    h.life = 5;
    h.gold = 7;
    h.st = { ПС: 0, ПУ: 4, ПМ: 0 };
    lose(s, x, 0, 'т', 12); // 7 т отдано, 5 т не хватило — 1 ПУ
    expect(h.gold).toBe(0);
    expect(h.st.ПУ).toBe(3);
    h.st = { ПС: 0, ПУ: 1, ПМ: 0 };
    lose(s, x, 0, 'ПУ', 3); // безумному ум жизнью
    expect(h.st.ПУ).toBe(0);
    expect(h.life).toBe(3);
  });

  it('предел 14: собственные ПС/ПУ/ПМ/ПО не растут выше; ПЖ и деньги — без предела', () => {
    const { s, x } = fresh();
    const h = H(s, 0);
    h.st = { ПС: 12, ПУ: 14, ПМ: 3 };
    expect(bump(s, x, 0, 'ПС', 5)).toBe(2);
    expect(h.st.ПС).toBe(14);
    expect(bump(s, x, 0, 'ПУ', 1)).toBe(0);
    h.po = 13;
    bump(s, x, 0, 'ПО', 4);
    expect(h.po).toBe(14);
    bump(s, x, 0, 'ПЖ', 30);
    expect(h.life).toBe(35);
    expect(capOf(h, 'ПЖ')).toBe(Infinity);
    h.zone = 'road'; // на дороге в столицу пределов нет
    bump(s, x, 0, 'ПС', 5);
    expect(h.st.ПС).toBe(19);
  });

  describe('бой по броскам', () => {
    const fight = (ps: number, foeIdx: number, myIdx: number) => {
      const { s, x } = fresh();
      const h = H(s, 0);
      h.st = { ПС: ps, ПУ: 3, ПМ: 3 };
      const rng = new RiggedRng(new SeededRng(1));
      rng.rig([foeIdx, myIdx]);
      x.rng = rng;
      push(s, {
        seat: 0,
        ops: [{ t: 'battle', foe: { name: 'Тест', ПС: 5 }, stat: 'ПС', win: [{ t: 'add', p: 'ПЖ', n: 1 }], lose: [{ t: 'add', p: 'ПЖ', n: -1 }], draw: [{ t: 'add', p: 'ПО', n: 1 }] }],
      });
      run(s, x);
      expect(s.prompt?.kind).toBe('fightRoll');
      const r = apply(s, 0, { type: 'answer', key: 'roll' }, rng)!;
      expect(r).not.toBeNull();
      return H(r.state, 0);
    };
    it('победа (12 против 6): +1 ПЖ', () => {
      const h = fight(8, 0, 3);
      expect(h.life).toBe(6);
      expect(h.po).toBe(0);
    });
    it('поражение (9 против 11): −1 ПЖ', () => {
      const h = fight(8, 5, 0);
      expect(h.life).toBe(4);
    });
    it('ничья (равные суммы): выполняется ветка ничьей', () => {
      const h = fight(5, 2, 2);
      expect(h.life).toBe(5);
      expect(h.po).toBe(1);
    });
  });

  it('карта на поле выполняется ВМЕСТО условий клетки', () => {
    // «Каньон»: по условиям поля берут 2 карты из колоды
    const a = fresh();
    placeAt(a.s, a.x, 0, 12, true);
    run(a.s, a.x);
    expect(a.s.deck.length).toBe(newState([{ seat: 0, kind: 'human', name: 'А' }, { seat: 1, kind: 'human', name: 'Б' }], new SeededRng(7)).deck.length - 2);
    const b = fresh();
    const before = b.s.deck.length;
    b.s.field[12] = [{ n: 19 }]; // «Ксаны» лежат на поле
    placeAt(b.s, b.x, 0, 12, true);
    run(b.s, b.x);
    expect(b.s.deck.length).toBe(before); // карты из колоды не брались
    expect(b.s.field[12]).toBeUndefined(); // карта снята с поля и выполняется
    expect(b.s.prompt?.kind).toBe('roll');
  });

  it('поселённый зверь при встрече начинает с места встречи; свежая карта — с поселения', () => {
    const brod = cellsNamed('Брод')[0];
    // встреча: после маркера — бросок «1–2 теряешь лошадь/друга, 3–6 бой»
    const m = fresh();
    H(m.s, 0).cell = brod;
    m.s.field[brod] = [{ n: 53, settled: true }];
    placeAt(m.s, m.x, 0, brod, true);
    run(m.s, m.x);
    const meet = (m.s.prompt?.data?.op ?? {}) as { br?: { ops: { t: string }[] }[] };
    expect(meet.br?.[0].ops[0].t).toBe('lose');
    // свежая карта из колоды: сначала бросок на поселение
    const f = fresh();
    push(f.s, { seat: 0, ops: ADV[53].ops, card: 53, at: 12 });
    run(f.s, f.x);
    const fr = (f.s.prompt?.data?.op ?? {}) as { br?: { ops: { t: string }[] }[] };
    expect(fr.br?.[0].ops[0].t).toBe('settle');
    // выброс 1–2: поселился на «Крепости», сценарий на этом кончился — карта лежит там и больше ничего не выполняется
    const rig = new RiggedRng(new SeededRng(1));
    rig.rig([0]);
    const r = apply(f.s, 0, { type: 'answer', key: 'roll' }, rig)!;
    expect(r).not.toBeNull();
    expect(r.state.field[cellsNamed('Крепость')[0]]?.some((c) => c.n === 53 && c.settled)).toBe(true);
    expect(r.state.prompt).toBeNull();
  });

  describe('Провал по порогу', () => {
    const at = (n: number, stats: number, po: number) => {
      const { s, x } = fresh();
      const h = H(s, 0);
      h.st = { ПС: stats, ПУ: stats, ПМ: stats };
      h.po = po;
      placeAt(s, x, 0, n, true);
      run(s, x);
      return s;
    };
    it('«Провал Мира Магии» (31): порог 11 — при 11/11/11 и 11 ПО можно выйти', () => {
      const s = at(31, 11, 11);
      expect(s.prompt?.kind).toBe('fallMenu');
      expect(s.prompt?.opts.some((o) => o.key === 'go')).toBe(true);
    });
    it('не хватает ПО или качества — выхода нет, платишь за остановку', () => {
      expect(at(31, 11, 10).prompt).toBeNull();
      const s = at(31, 10, 14);
      expect(s.prompt).toBeNull();
      expect(H(s, 0).st.ПМ).toBe(9);
    });
    it('«Провал Мира Силы» (54) требует 12, «Мира Ума» (22) — 13', () => {
      expect(at(54, 11, 14).prompt?.opts.some((o) => o.key === 'go') ?? false).toBe(false);
      expect(at(54, 12, 12).prompt?.opts.some((o) => o.key === 'go')).toBe(true);
      expect(at(22, 12, 14).prompt?.opts.some((o) => o.key === 'go') ?? false).toBe(false);
      expect(at(22, 13, 13).prompt?.opts.some((o) => o.key === 'go')).toBe(true);
    });
  });
});

// ---------- дуэли, сделки, граната против путника ----------

describe('Классика 1994: путник против путника', () => {
  /** Два путника на соседних полях, ход первого, оба «злые» (добрые с добрыми не дерутся). */
  function pair() {
    const f = fresh();
    const { s } = f;
    s.heroes[1] = newHero(1, GOBLIN, s.shelf);
    for (const o of [0, 1]) {
      const h = H(s, o);
      h.align = 'злой';
      h.life = 5;
      h.gold = 10;
      h.po = 14;
      h.things = [];
      h.friends = [];
      h.st = { ПС: 5, ПУ: 5, ПМ: 5 };
    }
    H(s, 0).cell = 12;
    H(s, 1).cell = neighbours(12).find((n) => cellKind(n) === 'plain')!;
    s.phase = 'roll';
    s.turn = 0;
    return f;
  }
  const strong = (s: CState, seat: number, v: number) => {
    H(s, seat).st = { ПС: v, ПУ: v, ПМ: v };
  };
  const rigged = (...v: number[]) => {
    const r = new RiggedRng(new SeededRng(1));
    r.rig(v);
    return r;
  };
  const star = () => TRAVELLERS.findIndex((q) => /ЗВЕЗДОЧ/.test(q.name));

  describe('дуэльный кодекс', () => {
    it('допустима на соседнем и на том же поле; далеко — нет', () => {
      const { s, x } = pair();
      expect(apply(s, 0, { type: 'duel', target: 1 }, x.rng)).not.toBeNull();
      H(s, 1).cell = 12;
      expect(apply(s, 0, { type: 'duel', target: 1 }, x.rng)).not.toBeNull();
      H(s, 1).cell = [...distances(12)].find(([, d]) => d >= 3)![0];
      expect(apply(s, 0, { type: 'duel', target: 1 }, x.rng)).toBeNull();
    });
    it('добрые с добрыми не дерутся; добрый со злым — можно', () => {
      const { s, x } = pair();
      H(s, 0).align = 'добрый';
      H(s, 1).align = 'добрый';
      expect(apply(s, 0, { type: 'duel', target: 1 }, x.rng)).toBeNull();
      H(s, 1).align = 'злой';
      expect(apply(s, 0, { type: 'duel', target: 1 }, x.rng)).not.toBeNull();
    });
    it('в лазарете, заготконторе и обменных пунктах поединки запрещены', () => {
      for (const c of [18, 52, 1, 2]) {
        const a = pair();
        H(a.s, 0).cell = c;
        H(a.s, 1).cell = c;
        expect(apply(a.s, 0, { type: 'duel', target: 1 }, a.x.rng), `поле ${c}`).toBeNull();
        const b = pair(); // вызывающий вне запретного поля, а цель — на нём
        H(b.s, 1).cell = c;
        H(b.s, 0).cell = [...distances(c)].find(([, d]) => d === 1)![0];
        expect(apply(b.s, 0, { type: 'duel', target: 1 }, b.x.rng), `цель на поле ${c}`).toBeNull();
      }
    });
    it('Звездочёт неуязвим; вызов — только в свой ход и вместо броска', () => {
      const { s, x } = pair();
      s.heroes[1] = newHero(1, star(), s.shelf);
      H(s, 1).cell = 12;
      expect(apply(s, 0, { type: 'duel', target: 1 }, x.rng)).toBeNull();
      const p = pair();
      p.s.turn = 1;
      expect(apply(p.s, 0, { type: 'duel', target: 1 }, p.x.rng)).toBeNull();
      p.s.turn = 0;
      p.s.phase = 'pick';
      expect(apply(p.s, 0, { type: 'duel', target: 1 }, p.x.rng)).toBeNull();
    });
    it('исход: проигравший −1 ПЖ, победитель забирает его себе (+1 ПЖ); оба бросают сами; ход уходит дальше', () => {
      const { s } = pair();
      strong(s, 0, 11);
      strong(s, 1, 2);
      let r = apply(s, 0, { type: 'duel', target: 1 }, rigged())!;
      expect(r.state.prompt).toMatchObject({ seat: 0, kind: 'duelRoll' });
      r = apply(r.state, 0, { type: 'answer', key: 'roll' }, rigged(0))!;
      expect(r.state.prompt).toMatchObject({ seat: 1, kind: 'duelRoll' }); // бросок защищающегося — его вопрос
      r = apply(r.state, 1, { type: 'answer', key: 'roll' }, rigged(5))!;
      expect(H(r.state, 0).life).toBe(6);
      expect(H(r.state, 1).life).toBe(4);
      expect(r.state.prompt).toBeNull();
      expect(r.state.turn).toBe(1);
    });
    it('слабый вызвавший проигрывает; ничья — ничего не меняется', () => {
      const { s } = pair();
      strong(s, 0, 2);
      strong(s, 1, 11);
      let r = apply(s, 0, { type: 'duel', target: 1 }, rigged())!;
      r = apply(r.state, 0, { type: 'answer', key: 'roll' }, rigged(5))!;
      r = apply(r.state, 1, { type: 'answer', key: 'roll' }, rigged(0))!;
      expect(H(r.state, 0).life).toBe(4);
      expect(H(r.state, 1).life).toBe(6);
      const q = pair();
      let d = apply(q.s, 0, { type: 'duel', target: 1 }, rigged())!;
      d = apply(d.state, 0, { type: 'answer', key: 'roll' }, rigged(2))!;
      d = apply(d.state, 1, { type: 'answer', key: 'roll' }, rigged(2))!;
      expect([H(d.state, 0).life, H(d.state, 1).life]).toEqual([5, 5]);
    });
    it('бьются качеством Мира вызывающего, с предметами', () => {
      const { s } = pair();
      const stat = duelStat(s, 0);
      H(s, 0).st = { ПС: 3, ПУ: 3, ПМ: 3 };
      H(s, 0).st[stat] = 9;
      H(s, 1).st = { ПС: 3, ПУ: 3, ПМ: 3 };
      expect(duelPower(s, 0, stat)).toBe(9);
      expect(duelPower(s, 1, stat)).toBe(3);
      H(s, 1).things = [{ id: 'i51' }]; // кольт: +2 ПС
      if (stat === 'ПС') expect(duelPower(s, 1, stat)).toBe(5);
    });
  });

  describe('торговые сделки', () => {
    const offer = { type: 'offer' as const, to: 1, give: [] as string[], giveGold: 0, take: [] as string[], takeGold: 0 };
    const HELMET = 'i17'; // шлем (Магшоп)
    const COLT = 'i51'; // кольт (Караван-сарай)
    it('обмен вещами и деньгами: предложение — вопрос адресату, «Принять» меняет всё разом', () => {
      const { s, x } = pair();
      H(s, 0).things = [{ id: HELMET }];
      H(s, 1).things = [{ id: COLT }];
      let r = apply(s, 0, { ...offer, give: [HELMET], take: [COLT], takeGold: 3 }, x.rng)!;
      expect(r).not.toBeNull();
      expect(r.state.prompt).toMatchObject({ seat: 1, kind: 'trade' });
      r = apply(r.state, 1, { type: 'answer', key: 'yes' }, x.rng)!;
      expect(H(r.state, 0).things.map((q) => q.id)).toEqual([COLT]);
      expect(H(r.state, 1).things.map((q) => q.id)).toEqual([HELMET]);
      expect([H(r.state, 0).gold, H(r.state, 1).gold]).toEqual([13, 7]);
      expect(r.state.turn).toBe(0); // ход не кончился: можно бросать кубик
      expect(r.state.phase).toBe('roll');
      expect(r.state.prompt).toBeNull();
    });
    it('продажа за деньги и обратная покупка', () => {
      const { s, x } = pair();
      H(s, 0).things = [{ id: HELMET }];
      let r = apply(s, 0, { ...offer, give: [HELMET], takeGold: 4 }, x.rng)!;
      r = apply(r.state, 1, { type: 'answer', key: 'yes' }, x.rng)!;
      expect([H(r.state, 0).gold, H(r.state, 1).gold]).toEqual([14, 6]);
      r = apply(r.state, 0, { ...offer, take: [HELMET], giveGold: 5 }, x.rng)!;
      r = apply(r.state, 1, { type: 'answer', key: 'yes' }, x.rng)!;
      expect(H(r.state, 0).things.map((q) => q.id)).toEqual([HELMET]);
      expect([H(r.state, 0).gold, H(r.state, 1).gold]).toEqual([9, 11]);
    });
    it('отказ: ничего не меняется, предложение всё равно засчитано', () => {
      const { s, x } = pair();
      H(s, 0).things = [{ id: HELMET }];
      let r = apply(s, 0, { ...offer, give: [HELMET], takeGold: 4 }, x.rng)!;
      r = apply(r.state, 1, { type: 'answer', key: 'no' }, x.rng)!;
      expect(H(r.state, 0).things.map((q) => q.id)).toEqual([HELMET]);
      expect([H(r.state, 0).gold, H(r.state, 1).gold]).toEqual([10, 10]);
      expect(r.state.offers).toBe(1);
      expect(r.state.trade).toBeNull();
    });
    it('запреты: друзья, принадлежащие владельцу вещи, чужие вещи, лишние деньги, пустая сделка, дальний путник', () => {
      const { s, x } = pair();
      const owned = 33; // лошадь Амазонки — «принадлежащий владельцу»
      H(s, 0).things = [{ id: HELMET }, { id: `i${owned}` }];
      H(s, 0).friends = [{ id: 'a25' }];
      H(s, 1).things = [{ id: COLT }];
      const bad = (o: Partial<typeof offer>) => apply(s, 0, { ...offer, ...o }, x.rng);
      expect(bad({ give: [`i${owned}`], takeGold: 1 })).toBeNull();
      expect(bad({ give: ['a25'], takeGold: 1 })).toBeNull();
      expect(bad({ give: [COLT], takeGold: 1 })).toBeNull(); // это вещь адресата, не его
      expect(bad({ take: [HELMET] })).toBeNull(); // а это моя
      expect(bad({ giveGold: 11 })).toBeNull();
      expect(bad({ takeGold: 11 })).toBeNull();
      expect(bad({})).toBeNull();
      expect(bad({ give: [HELMET, HELMET], takeGold: 1 })).toBeNull();
      expect(bad({ give: [HELMET], takeGold: 2 })).not.toBeNull();
      const far = pair();
      H(far.s, 1).cell = [...distances(12)].find(([, d]) => d >= 3)![0];
      H(far.s, 0).things = [{ id: HELMET }];
      expect(apply(far.s, 0, { ...offer, give: [HELMET], takeGold: 1 }, far.x.rng)).toBeNull();
    });
    it('не больше трёх предложений за ход; только в свой ход', () => {
      const { s, x } = pair();
      H(s, 0).things = [{ id: HELMET }];
      let st = s;
      for (let k = 0; k < 3; k++) {
        const r = apply(st, 0, { ...offer, give: [HELMET], takeGold: 1 }, x.rng)!;
        expect(r, `предложение ${k + 1}`).not.toBeNull();
        st = apply(r.state, 1, { type: 'answer', key: 'no' }, x.rng)!.state;
      }
      expect(apply(st, 0, { ...offer, give: [HELMET], takeGold: 1 }, x.rng)).toBeNull();
      const other = pair();
      other.s.turn = 1;
      H(other.s, 0).things = [{ id: HELMET }];
      expect(apply(other.s, 0, { ...offer, give: [HELMET], takeGold: 1 }, other.x.rng)).toBeNull();
    });
    it('схема сигнализации (карта 63) — тоже предмет сделки', () => {
      const { s, x } = pair();
      H(s, 0).things = [{ id: 'a63' }];
      let r = apply(s, 0, { ...offer, give: ['a63'], takeGold: 5 }, x.rng)!;
      expect(r).not.toBeNull();
      r = apply(r.state, 1, { type: 'answer', key: 'yes' }, x.rng)!;
      expect(H(r.state, 1).things.map((q) => q.id)).toEqual(['a63']);
    });
    it('вещей не унести — сделка невозможна (лимит 4)', () => {
      const { s, x } = pair();
      H(s, 0).things = [{ id: HELMET }];
      H(s, 1).things = [{ id: 'i29' }, { id: 'i43' }, { id: 'i51' }, { id: 'i61' }];
      expect(apply(s, 0, { ...offer, give: [HELMET] }, x.rng)).toBeNull();
    });
  });

  describe('граната против путника и «натравить друга»', () => {
    it('граната (карта 69) в путника на соседнем поле: −1 ПЖ, карта гранаты уходит', () => {
      const { s, x } = pair();
      H(s, 0).things = [{ id: 'a69' }];
      let r = apply(s, 0, { type: 'use', id: 'a69' }, x.rng)!;
      expect(r.state.prompt?.kind).toBe('c1_gren');
      expect(r.state.prompt?.opts.map((o) => o.key)).toContain('p:1');
      r = apply(r.state, 0, { type: 'answer', key: 'p:1' }, x.rng)!;
      expect(H(r.state, 1).life).toBe(4);
      expect(H(r.state, 0).things).toHaveLength(0);
    });
    it('граната в друга путника: он обязан отложить карту погибшего друга', () => {
      const { s, x } = pair();
      H(s, 0).things = [{ id: 'a69' }];
      H(s, 1).friends = [{ id: 'a25', with: 'вместе' }];
      let r = apply(s, 0, { type: 'use', id: 'a69' }, x.rng)!;
      r = apply(r.state, 0, { type: 'answer', key: 'f:1:a25' }, x.rng)!;
      expect(H(r.state, 1).friends).toHaveLength(0);
      expect(H(r.state, 1).life).toBe(5);
    });
    it('граната не действует на дальнего путника и на Звездочёта', () => {
      const { s, x } = pair();
      H(s, 0).things = [{ id: 'a69' }];
      s.heroes[1] = newHero(1, star(), s.shelf);
      H(s, 1).cell = 12;
      const r = apply(s, 0, { type: 'use', id: 'a69' }, x.rng);
      expect(r?.state.prompt?.opts.map((o) => o.key) ?? []).not.toContain('p:1');
    });
    it('пришёл на поле к путнику — можно натравить друга: тот выполняет условия карты или защищается гранатой', () => {
      const { s, x } = pair();
      H(s, 1).cell = 12;
      H(s, 0).cell = [...distances(12)].find(([, d]) => d === 1)![0];
      H(s, 0).friends = [{ id: 'a25', with: 'вместе' }]; // Пионер
      H(s, 1).things = [{ id: 'a69' }];
      placeAt(s, x, 0, 12, true);
      run(s, x);
      expect(s.prompt).toMatchObject({ seat: 0, kind: 'sic' });
      const r = apply(s, 0, { type: 'answer', key: 'a25:1' }, x.rng)!;
      expect(r.state.prompt).toMatchObject({ seat: 1, kind: 'sicDef' });
      expect(r.state.prompt?.opts.map((o) => o.key)).toContain('g:a69');
      // защищается гранатой: карта друга и граната уходят в отбой
      const g = apply(r.state, 1, { type: 'answer', key: 'g:a69' }, x.rng)!;
      expect(H(g.state, 0).friends).toHaveLength(0);
      expect(H(g.state, 1).things).toHaveLength(0);
      expect(g.state.discard).toContain(25);
      // не защищается: условия карты Пионера (бросок кубика) выполняет он сам
      const o = apply(r.state, 1, { type: 'answer', key: 'obey' }, x.rng)!;
      expect(H(o.state, 0).friends).toHaveLength(0);
      expect(o.state.prompt).toMatchObject({ seat: 1, kind: 'roll' });
    });
  });
});
