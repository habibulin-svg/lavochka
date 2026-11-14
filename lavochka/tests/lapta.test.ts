import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/lapta/def';
import { separate } from '../src/core/dvorsport/sim';
import { cfgFrom, cleanInput, flight, idleInput, intercept, judge, newGame, step, strike, type In, type State } from '../src/games/lapta/engine';

const human = (o: Partial<In> = {}): In => ({ mx: 0, my: 0, k: -1, ai: -1, ...o });
/** Крутить, пока не выполнится условие (не дольше max шагов). */
function run(s: State, ins: (s: State) => (In | null)[], until: (s: State) => boolean, max = 6000, rng = new SeededRng(3)) {
  const evs: string[] = [];
  for (let i = 0; i < max && !until(s) && !s.over; i++) for (const e of step(s, ins(s), rng)) evs.push(e.k + ('kind' in e ? ':' + e.kind : ''));
  return evs;
}

describe('лапта: удар и поле', () => {
  it('полёт мяча детерминирован', () => {
    const c = cfgFrom({});
    expect(flight(strike(c, 0.7, 0.1, 'far')).land).toEqual(flight({ ...strike(c, 0.7, 0.1, 'far') }).land);
  });
  it('дальний удар в полную силу — чуть за кон, слабый — недолёт', () => {
    for (const L of [50, 36, 26]) {
      const c = cfgFrom({ field: L, ctrl: 5 });
      const far = flight(strike(c, 1, 0, 'far')).land!;
      expect(far.y).toBeGreaterThan(L);
      expect(far.y).toBeLessThan(L * 1.3);
    }
    const big = cfgFrom({ field: 50, ctrl: 10 });
    expect(judge(big, flight(strike(big, 0, 0, 'low')).land)).toBe('short');
  });
  it('аут и недолёт', () => {
    const c = cfgFrom({});
    expect(judge(c, { x: c.W / 2 + 1, y: 20 })).toBe('out');
    expect(judge(c, { x: 0, y: c.ctrl - 1 })).toBe('short');
    expect(judge(c, { x: 0, y: c.L + 3 })).toBe('ok');
  });
  it('полевой под мячом ловит свечу с лёта', () => {
    const c = cfgFrom({});
    const b0 = strike(c, 0.5, 0, 'candle');
    const land = flight(b0).land!;
    expect(intercept(b0, [land.x + 1, land.y]).air).toBe(true);
  });
  it('ввод по сети чистится', () => {
    expect(cleanInput({ mx: 5, my: -9, k: 9, ai: 7 })).toMatchObject({ mx: 1, my: -1, k: 5, ai: 2 });
    expect(cleanInput('x')).toBeNull();
    expect(cleanInput({ hit: { n: 1, pow: 2, yaw: 0, style: 'boom' } })!.hit).toBeUndefined();
  });
});

describe('лапта: розыгрыш в реальном времени', () => {
  it('человек бьёт, выбегает сам и добегает до кона', () => {
    const s = newGame({ field: 36, ctrl: 7, n: 4, speed: 1 }, [0, 1], 1);
    // ждём подачу, бьём далеко вбок от полевых
    run(s, () => [human(), { ...idleInput(), ai: 0 }], (x) => x.phase === 'serve');
    const evs = run(s, () => [human({ hit: { n: 1, pow: 0.75, yaw: 0.28, style: 'low' } }), { ...idleInput(), ai: 0 }], (x) => x.phase === 'live', 10);
    expect(evs).toContain('hit:ok');
    // бьющий (он же мой пацан) бежит вперёд
    const evs2 = run(s, () => [human({ my: 1, mx: 0.15 }), { ...idleInput(), ai: 0 }], (x) => x.men[0][0].st === 'kon' || x.atk !== 0, 2000);
    expect(evs2).toContain('run');
    expect(s.men[0][0].st === 'kon' || s.atk === 1).toBe(true);
  });
  it('бегущего можно осалить — команды меняются', () => {
    let swapped = false;
    for (let seed = 1; seed < 40 && !swapped; seed++) {
      const s = newGame({ field: 50, ctrl: 10, n: 6, candle: 'point', speed: 1 }, [0, 1], 1);
      const rng = new SeededRng(seed);
      run(s, () => [human(), { ...idleInput(), ai: 2 }], (x) => x.phase === 'serve', 600, rng);
      run(s, () => [human({ hit: { n: 1, pow: 0.45, yaw: 0, style: 'low' } }), { ...idleInput(), ai: 2 }], (x) => x.phase !== 'serve', 10, rng);
      // бежим прямо на полевых, не уворачиваясь
      const evs = run(s, () => [human({ my: 1 }), { ...idleInput(), ai: 2 }], (x) => x.atk !== 0, 3000, rng);
      swapped = evs.includes('salit');
    }
    expect(swapped).toBe(true);
  });
  it('боты доигрывают партию во всех пресетах', () => {
    const rt = def.realtime!;
    for (const pr of def.presets!) {
      const rng = new SeededRng(7);
      const s = def.setup([{ seat: 0, kind: 'bot', name: 'a', level: 2 }, { seat: 1, kind: 'bot', name: 'b', level: 1 }], { ...pr.options, speed: 1 }, rng) as State;
      let n = 0;
      while (!s.over && n < 200000) {
        rt.tick(s, [0, 1].map((seat) => rt.input(rt.bot(def.view(s, [seat]), seat, seat ? 1 : 2, {}, rng))), rng);
        n++;
      }
      expect(s.over, pr.id).toBe(true);
      expect(def.result(s)).not.toBeNull();
    }
  });
});

describe('лапта: розыгрыши не застревают, люди не сливаются', () => {
  it('у ботов каждый розыгрыш кончается за 35 с игрового времени', () => {
    const rt = def.realtime!;
    let worst = 0;
    let jump = 0;
    for (const pr of def.presets!)
      for (const seed of [1, 2]) {
        const rng = new SeededRng(seed);
        const s = def.setup([{ seat: 0, kind: 'bot', name: 'a', level: seed % 3 }, { seat: 1, kind: 'bot', name: 'b', level: 1 }], pr.options, rng) as State;
        let start = -1;
        for (let n = 0; n < 120000 && !s.over; n++) {
          const was = s.men.map((t) => t.map((m) => [m.x, m.y]));
          const atk = s.atk;
          rt.tick(s, [0, 1].map((seat) => rt.input(rt.bot(def.view(s, [seat]), seat, 1, {}, rng))), rng);
          // по местам идут сами: за шаг никто не «прыгает» (смена сторон, новая подача)
          if (s.atk === atk) s.men.forEach((t, a) => t.forEach((m, i) => (jump = Math.max(jump, Math.hypot(m.x - was[a][i][0], m.y - was[a][i][1])))));
          if (s.phase === 'live' && start < 0) start = s.t;
          if (s.phase !== 'live' && start >= 0) (worst = Math.max(worst, s.t - start)), (start = -1);
        }
      }
    expect(worst).toBeGreaterThan(0);
    expect(worst).toBeLessThan(35);
    expect(jump).toBeLessThan(2.5);
  });
  it('расталкивание разводит людей на два радиуса, детерминированно', () => {
    const a = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0.2, y: 0.1 }];
    const b = JSON.parse(JSON.stringify(a));
    for (let k = 0; k < 6; k++) separate(a), separate(b);
    expect(a).toEqual(b);
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) expect(Math.hypot(a[i].x - a[j].x, a[i].y - a[j].y)).toBeGreaterThan(0.6);
  });
  it('на старте и в подаче никто не стоит в другом', () => {
    const s = newGame({ n: 6, field: 50 }, [0, 1], 1);
    const rng = new SeededRng(5);
    for (let n = 0; n < 200; n++) step(s, [human(), { ...idleInput(), ai: 2 }], rng);
    const all = [...s.men[0], ...s.men[1]];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y)).toBeGreaterThan(0.55);
  });
});
