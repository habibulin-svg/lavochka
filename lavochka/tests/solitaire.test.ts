import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/solitaire/def';

describe('пасьянсы: скрытое', () => {
  it('view не отдаёт seed, по которому восстанавливается колода', () => {
    const s = def.setup([{ seat: 0 } as never], { game: 'klondike' }, new SeededRng(3)) as { seed: number };
    const v = def.view(s as never, [0]) as unknown as Record<string, unknown>;
    expect('seed' in v).toBe(false);
    expect(JSON.stringify(v)).not.toContain(`"seed"`);
    expect(typeof v.deal).toBe('number');
    expect(Array.isArray(v.deck) && (v.deck as unknown[]).some((c) => c === null)).toBe(true);
  });
});
