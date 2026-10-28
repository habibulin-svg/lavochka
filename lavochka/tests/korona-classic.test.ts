/**
 * «Корона Эмбера», «Классика 1994»: партии ботов против ботов и точечные проверки правил движка.
 */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { botAction } from '../src/games/korona/classic/ai';
import { ADV } from '../src/games/korona/classic/cards';
import { cellsNamed } from '../src/games/korona/classic/data';
import { H, apply, bump, capOf, lose, newHero, newState, placeAt, push, run } from '../src/games/korona/classic/engine';
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
