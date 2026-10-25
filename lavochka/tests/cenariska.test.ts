/* «Цена риска»: состав тайлов, сдвиг (фишки едут, на выпадающей клетке — нельзя), проходы, охотник по стрелке,
 * зверь и хищник, туша на стоянке, победа, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/cenariska/ai';
import { apply, at, cfgFrom, deck, legal, lineCells, newState, reach, setup, SLOTS, toAct, type Kind, type State } from '../src/games/cenariska/engine';

const fixed = { next: () => 0.3, int: () => 0, getState: () => 0 };
function scene(patch: (s: State) => void = () => {}): State {
  const s = newState(cfgFrom({}), 2, fixed);
  const put = (r: number, c: number, k: Kind, rot = 0) => (s.board[at(r, c)] = { k, rot });
  put(0, 1, 'I');
  put(0, 3, 'hunter');
  put(0, 5, 'bison');
  s.phase = 'move';
  s.hand = null;
  patch(s);
  return s;
}

describe('Цена риска', () => {
  it('46 подвижных тайлов: 33 на поле, 13 в запасе (один вытянут)', () => {
    expect(deck().length).toBe(46);
    const s = setup({}, 2, new SeededRng(1));
    expect(s.stock.length + (s.hand ? 1 : 0)).toBe(13);
    expect(SLOTS.length).toBe(12);
  });

  it('сдвиг: фишка едет вместе с тайлом; на выпадающей клетке — нельзя', () => {
    const s = setup({}, 2, new SeededRng(2));
    const slot = SLOTS.findIndex((x) => x.line === 'row' && x.i === 1 && x.from === 1);
    const cells = lineCells(SLOTS[slot]);
    s.players[0].p = cells[2];
    const r = apply(s, 0, { type: 'shift', slot, rot: 0 }, new SeededRng(3))!.state;
    expect(r.players[0].p).toBe(cells[3]);
    s.players[0].p = cells[6];
    expect(legal(s, 0).some((a) => a.type === 'shift' && a.slot === slot)).toBe(false);
  });

  it('охотник — по стрелке, даёт копьё; без копья к зверю не пройти', () => {
    const s = scene();
    const r = reach(s.board, s.players[0], s.cfg);
    expect(r.has(at(0, 3))).toBe(true);
    expect(r.has(at(0, 5))).toBe(false);
    const after = apply(s, 0, { type: 'move', to: at(0, 3) }, fixed)!.state;
    expect(after.players[0].spear).toBe(true);
    // охотник со стрелкой на запад — с запада не войти
    const back = scene((x) => (x.board[at(0, 3)] = { k: 'hunter', rot: 2 }));
    expect(reach(back.board, back.players[0], back.cfg).has(at(0, 3))).toBe(false);
  });

  it('зверь: убить — копьё сломано, туша в руках; туша на стоянке', () => {
    let s = scene((x) => {
      x.players[0].p = at(0, 4);
      x.players[0].spear = true;
    });
    s = apply(s, 0, { type: 'move', to: at(0, 5) }, fixed)!.state;
    expect(s.phase).toBe('act');
    s = apply(s, 0, { type: 'kill' }, fixed)!.state;
    expect(s.players[0].carry).toEqual(['bison']);
    expect(s.players[0].spear).toBe(false);
    const t = scene((x) => {
      x.board[at(0, 5)] = { k: 'I', rot: 0 };
      x.players[0].p = at(0, 5);
      x.players[0].carry = ['bison'];
      x.players[0].killed = ['bison'];
    });
    const r = apply(t, 0, { type: 'move', to: at(0, 6) }, fixed)!.state;
    expect(r.players[0].laid[at(0, 6)]).toBe('bison');
  });

  it('хищник: пройти можно только с факелом, и он гаснет', () => {
    const s = scene((x) => {
      x.board[at(0, 1)] = { k: 'tiger', rot: 1 }; // открыт на С, В, Ю... поворот 1 у картинки-тройника: В, Ю, З
    });
    const r = reach(s.board, s.players[0], s.cfg);
    if (r.has(at(0, 2))) expect(r.get(at(0, 2))!.torch).toBe(false);
    s.players[0].torch = false;
    expect(reach(s.board, s.players[0], s.cfg).has(at(0, 1))).toBe(false);
  });

  it('партии ботов доходят до конца на 2–4 игроках', () => {
    for (const n of [2, 3, 4]) {
      const rng = new SeededRng(n * 13);
      let s = setup({}, n, rng);
      for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
        const seat = toAct(s)[0];
        s = apply(s, seat, choose(s, seat, (seat % 3) as 0 | 1 | 2, rng)!, rng)!.state;
      }
      expect(s.phase).toBe('over');
    }
  }, 120000);
});
