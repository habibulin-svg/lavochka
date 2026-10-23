/* Гонки древности: ключевые правила Королевской игры Ура и сенета. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import * as ur from '../src/games/ur/engine';
import * as sn from '../src/games/senet/engine';
import { choose as urBot } from '../src/games/ur/ai';
import { choose as snBot } from '../src/games/senet/ai';

describe('Королевская игра Ура', () => {
  it('путь: свой ряд, общий средний, обратно по малому блоку', () => {
    expect(ur.cell(0, 1)).toEqual([3, 2]);
    expect(ur.cell(0, 4)).toEqual([0, 2]);
    expect(ur.cell(1, 5)).toEqual([0, 1]);
    expect(ur.cell(0, 8)).toEqual([3, 1]);
    expect(ur.cell(1, 13)).toEqual([7, 0]);
    expect(ur.cell(1, 14)).toEqual([6, 0]);
  });
  it('бой в общем ряду, средняя розетка безопасна, розетка — ещё бросок', () => {
    const s = ur.newState(ur.cfgFrom({}));
    s.pos = [[5, 6, 0, 0, 0, 0, 0], [7, 8, 0, 0, 0, 0, 0]];
    s.phase = 'move';
    s.value = 2;
    expect(ur.legal(s).map((m) => m.from)).toEqual([0, 5]); // с 6 на 8 нельзя — занятая средняя розетка
    const r = ur.apply(s, 0, { type: 'move', from: 5 }, new SeededRng(1))!;
    expect(r.state.pos[1][0]).toBe(0);
    expect(r.state.cur).toBe(1);
    const t = ur.newState(ur.cfgFrom({}));
    t.phase = 'move';
    t.value = 4;
    const q = ur.apply(t, 0, { type: 'move', from: 0 }, new SeededRng(1))!;
    expect(q.state.cur).toBe(0);
    expect(q.state.phase).toBe('roll');
  });
  it('выход — только точным броском, в быстрой — любым', () => {
    for (const exact of [true, false]) {
      const s = ur.newState(ur.cfgFrom({ exact }));
      s.pos[0] = [13, 15, 15, 15, 15, 15, 15];
      s.phase = 'move';
      s.value = 3;
      expect(ur.legal(s).length).toBe(exact ? 0 : 1);
    }
  });
  it('ставки: проскочил розетку — жетон в кон', () => {
    const s = ur.newState(ur.cfgFrom({ stakes: true, pieces: 5 }));
    s.pos[0] = [6, 0, 0, 0, 0];
    s.phase = 'move';
    s.value = 3;
    const r = ur.apply(s, 0, { type: 'move', from: 6 }, new SeededRng(1))!;
    expect(r.state.pool).toBe(1);
    expect(r.state.tokens[0]).toBe(ur.STAKE - 1);
  });
  it('сложный бот обыгрывает лёгкого', () => {
    let wins = 0;
    for (let g = 0; g < 20; g++) {
      const rng = new SeededRng(100 + g);
      let s = ur.newState(ur.cfgFrom({}));
      const hard = g % 2;
      for (let i = 0; i < 2000 && s.phase !== 'over'; i++) {
        const a = urBot(s, s.seats[s.cur], s.cur === hard ? 2 : 0, rng)!;
        s = ur.apply(s, s.seats[s.cur], a, rng)!.state;
      }
      if (s.winner === hard) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(13);
  });
});

describe('Сенет', () => {
  it('расстановка через одну и путь змейкой', () => {
    const s = sn.newState(sn.cfgFrom({}));
    expect(s.board.slice(1, 11)).toEqual([0, 1, 0, 1, 0, 1, 0, 1, 0, 1]);
    expect(sn.cell(11)).toEqual([9, 1]);
    expect(sn.cell(21)).toEqual([0, 2]);
    expect(sn.stickValue([0, 0, 0, 0])).toBe(5);
  });
  it('обмен, защита пары и стена из трёх', () => {
    const s = sn.newState(sn.cfgFrom({}));
    s.board.fill(-1);
    s.board[5] = 0;
    s.board[7] = 1;
    s.board[12] = 0;
    s.board[13] = 1;
    s.board[14] = 1;
    s.board[1] = 0;
    s.board[2] = 1;
    s.board[3] = 1;
    s.board[4] = 1;
    s.phase = 'move';
    s.value = 2;
    const r = sn.apply(s, 0, { type: 'move', from: 5 }, new SeededRng(1))!;
    expect(r.state.board[5]).toBe(1);
    expect(r.state.board[7]).toBe(0);
    s.value = 1;
    expect(sn.target(s, 0, 12, 1, false)).toBeNull(); // 13–14 — пара
    s.value = 4;
    expect(sn.target(s, 0, 1, 5, false)).toBeNull(); // через 2–3–4 — стена
  });
  it('26 не перепрыгнуть, вода — на 15, выход ровно', () => {
    const s = sn.newState(sn.cfgFrom({}));
    s.board.fill(-1);
    s.board[24] = 0;
    s.board[26] = 0;
    s.board[29] = 0;
    expect(sn.target(s, 0, 24, 3, false)).toBeNull();
    expect(sn.target(s, 0, 29, 2, false)).toBe(sn.OFF);
    expect(sn.target(s, 0, 29, 3, false)).toBeNull();
    s.phase = 'move';
    s.value = 1;
    const r = sn.apply(s, 0, { type: 'move', from: 26 }, new SeededRng(1))!;
    expect(r.state.board[15]).toBe(0);
    expect(r.state.board[27]).toBe(-1);
  });
  it('нет хода вперёд — ход назад', () => {
    const s = sn.newState(sn.cfgFrom({}));
    s.board.fill(-1);
    s.board[10] = 0;
    s.board[13] = 1;
    s.board[14] = 1;
    s.phase = 'move';
    s.value = 3;
    const ms = sn.legal(s);
    expect(ms).toEqual([{ from: 10, to: 7, back: true }]);
  });
  it('сложный бот обыгрывает лёгкого', () => {
    let wins = 0;
    for (let g = 0; g < 16; g++) {
      const rng = new SeededRng(200 + g);
      let s = sn.newState(sn.cfgFrom({}));
      const hard = g % 2;
      for (let i = 0; i < 4000 && s.phase !== 'over'; i++) {
        const a = snBot(s, s.seats[s.cur], s.cur === hard ? 2 : 0, rng)!;
        s = sn.apply(s, s.seats[s.cur], a, rng)!.state;
      }
      if (s.winner === hard) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(10);
  });
});
