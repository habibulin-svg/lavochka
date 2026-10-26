/* «Полёт»: маршрут, взлёт, ход с остановкой на цветной точке, задания, белые точки (обходы, ветер, задержка), вопросы,
 * партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/polet/ai';
import { apply, makeView, newState, numOf, rightAnswer, toAct, walk, type State } from '../src/games/polet/engine';
import { LEGS, PTS } from '../src/games/polet/map';

const rig = (a: number) => ({ next: () => 0.5, int: () => a * 10, getState: () => 0 });
const at = (i: number, leg = 'main'): State => {
  const s = newState(2);
  s.planes[0] = { ...s.planes[0], leg, i, need: null };
  return s;
};

describe('Полёт', () => {
  it('маршрут: все номера 1…27 на месте, участки сходятся', () => {
    const nums = new Set(PTS.map((p) => p.n).filter(Boolean));
    for (let n = 1; n <= 27; n++) expect(nums.has(n)).toBe(true);
    for (const leg of Object.values(LEGS)) if (leg.next) expect(LEGS[leg.next[0]].pts[leg.next[1]]).toBe(leg.pts[leg.pts.length - 1]);
  });

  it('взлёт только в секторе «Взлёт разрешён», потом сразу ход', () => {
    let s = newState(2);
    s = apply(s, 0, { type: 'spin' }, rig(100))!.state;
    expect(toAct(s)).toEqual([1]);
    s = newState(2);
    s = apply(s, 0, { type: 'spin' }, rig(10))!.state;
    expect(s.planes[0].need).toBeNull();
    expect(toAct(s)).toEqual([0]);
  });

  it('до цветной точки не перелетают: ход 4 у точки 3 — стоп на 4, курс 97°', () => {
    let s = at(3);
    s = apply(s, 0, { type: 'spin' }, rig(110))!.state; // ход 4
    expect(s.path.length).toBe(1);
    s = apply(s, 0, { type: 'move' }, rig(0))!.state;
    expect(numOf(s.planes[0])).toBe(4);
    expect(s.planes[0].need).toBe('task');
    s = apply(s, 0, { type: 'spin' }, rig(110))!.state; // 97°
    expect(s.planes[0].need).toBeNull();
    expect(toAct(s)).toEqual([0]);
  });

  it('белые точки: 2 — на старт, 7 — обход грозы, 10 — ещё 4 точки', () => {
    let s = at(0);
    s = apply(s, 0, { type: 'spin' }, rig(300))!.state; // ход 1
    s = apply(s, 0, { type: 'move' }, rig(0))!.state;
    expect(s.planes[0].i).toBe(0);
    expect(s.planes[0].need).toBe('takeoff');
    s = at(8);
    s = apply(s, 0, { type: 'spin' }, rig(300))!.state;
    s = apply(s, 0, { type: 'move' }, rig(0))!.state;
    expect(s.planes[0].leg).toBe('storm');
    expect(walk(s.planes[0], 2).path.map((p) => PTS[p].n)).toEqual([0, 8]);
    s = at(16);
    s = apply(s, 0, { type: 'spin' }, rig(300))!.state;
    s = apply(s, 0, { type: 'move' }, rig(0))!.state;
    expect(s.phase).toBe('move');
    expect(s.path.length).toBe(3); // 10 → i, j, 11 (стоп на фиолетовой)
  });

  it('вопрос: ответ скрыт в view, ошибка — пропуск хода', () => {
    let s = at(6);
    s = apply(s, 0, { type: 'spin' }, rig(300))!.state;
    s = apply(s, 0, { type: 'move' }, rig(0))!.state;
    expect(s.phase).toBe('question');
    expect(makeView(s, [0]).question!.answer).toBe(-1);
    const right = rightAnswer(s.question!);
    const r = apply(s, 0, { type: 'answer', i: (right + 1) % s.question!.options.length }, rig(0))!.state;
    expect(r.planes[0].skip).toBe(1);
  });

  it('партии ботов доходят до конца на 1–3 игроках', () => {
    for (const n of [1, 2, 3]) {
      const rng = new SeededRng(n * 7);
      let s = newState(n);
      for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
        const seat = toAct(s)[0];
        s = apply(s, seat, choose(makeView(s, [seat]), seat, i % 3, rng)!, rng)!.state;
      }
      expect(s.phase).toBe('over');
    }
  }, 60000);
});
