/* Домино: раскладка ряда — кости не налезают друг на друга ни в одной разновидности, у колена дубль не встаёт поперёк. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/domino/ai';
import { apply, cfgFrom, deal, makeView, newState, type State } from '../src/games/domino/engine';
import { layout, type Slot } from '../src/games/domino/layout';

function rect(sl: Slot) {
  const dbl = sl.tile.a === sl.tile.b && sl.cross;
  const along = dbl ? 0.5 : 1;
  const across = dbl ? 1 : 0.5;
  const horiz = sl.dir[0] !== 0;
  return { x: sl.c[0], y: sl.c[1], hx: horiz ? along : across, hy: horiz ? across : along };
}

function overlaps(s: State): string | null {
  const lay = layout(s.chain);
  const all = [lay.center, ...lay.arms.flat()].filter((x): x is Slot => !!x);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const a = rect(all[i]);
      const b = rect(all[j]);
      if (Math.abs(a.x - b.x) < a.hx + b.hx - 0.05 && Math.abs(a.y - b.y) < a.hy + b.hy - 0.05)
        return `${all[i].tile.a}-${all[i].tile.b} @${all[i].c} и ${all[j].tile.a}-${all[j].tile.b} @${all[j].c}`;
    }
  return null;
}

describe('раскладка ряда', () => {
  for (const variant of ['kozel', 'morskoy', 'osel', 'telefon', 'muggins', 'general'])
    for (const n of [2, 4])
      it(`${variant}, ${n} игрока — без наложений`, () => {
        const seats = n === 2 ? [0, 2] : [0, 1, 2, 3];
        for (let g = 0; g < 25; g++) {
          const rng = new SeededRng(100 + g);
          let s = deal(newState(cfgFrom({ variant }), seats), rng).state;
          const round = s.round;
          let prev = new Map<string, string>();
          for (let k = 0; k < 200 && s.phase !== 'over' && s.round === round; k++) {
            const a = choose(makeView(s, [s.turn]), s.turn, 2, rng)!;
            const r = apply(s, s.turn, a, rng)!;
            if (r.state.round !== round) break;
            s = r.state;
            const bad = overlaps(s);
            expect(bad, `${variant} партия ${g}`).toBeNull();
            // уже лежащие кости не сдвигаются (кроме перестройки от первого дубля)
            const lay = layout(s.chain);
            const now = new Map([lay.center, ...lay.arms.flat()].filter((x): x is Slot => !!x).map((x) => [`${x.tile.n}`, `${x.c}`]));
            if (!r.events.some((e) => e.type === 'play' && e.root)) for (const [key, c] of prev) expect(now.get(key), `${variant} партия ${g}: сдвинулась кость`).toBe(c);
            prev = now;
          }
        }
      });

  it('у колена дубль кладут вдоль, а не поперёк', () => {
    const t = (a: number, b: number) => ({ a, b, seat: 0 });
    const arm = [t(1, 2), t(2, 3), t(3, 4), t(4, 5), t(5, 2), t(2, 2), t(2, 0)];
    const lay = layout({ center: t(1, 1), arms: [{ tiles: [], closed: false }, { tiles: arm, closed: false }, { tiles: [], closed: false }, { tiles: [], closed: false }] });
    const sl = lay.arms[1].find((x) => x.tile.a === 2 && x.tile.b === 2)!;
    expect(sl.cross).toBe(false);
  });
});
