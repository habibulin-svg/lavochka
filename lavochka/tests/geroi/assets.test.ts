import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mayPlay, withDefaults } from '../../src/core/release';
import { CATALOG } from '../../src/games/catalog';
import { CLASSES, heroPortrait } from '../../src/geroi/sim/heroes';
import { CREATURES, FACTIONS } from '../../src/geroi/sim/creatures';
import { SPELLS, spellIcon } from '../../src/geroi/sim/spells';

const A = join(__dirname, '../../public/geroi/a');

// Всё, на что ссылается игра, лежит в public/geroi/a (упаковка studio/post/pack_geroi.py).
describe('geroi: выход на сайт', () => {
  it('карточка есть, и ранний доступ действует: сервер признаёт его только у игр из каталога', () => {
    const known = (id: string) => CATALOG.some((g) => g.id === id);
    expect(known('geroi')).toBe(true);
    const rel = withDefaults({}, known);
    expect(mayPlay(rel, 'geroi', [])).toBe(false);
  });
});

describe('geroi/assets', () => {
  it('существа, звуки, портреты, иконки, поля, препятствия, музыка, шрифты', () => {
    const need: string[] = ['brand/title.webp', 'fonts/AlegreyaSC-Bold.ttf', 'fonts/Lora-Var.ttf', 'fonts/FiraSansCondensed-Bold.ttf'];
    for (const c of Object.values(CREATURES)) {
      need.push(`creatures/${c.id}.webp`, `creatures/${c.id}.json`);
      for (const s of Object.values(c.sfx)) if (s) need.push(`sfx/${s}.ogg`);
    }
    for (const cl of CLASSES) for (let n = 1; n <= 4; n++) need.push(`heroes/${heroPortrait({ cls: cl.id, n })}.webp`);
    for (const s of Object.values(SPELLS)) need.push(`icons/${spellIcon(s)}.webp`);
    for (const i of ['01', '02', '03', '04']) need.push(`icons/stat-${i}.webp`);
    for (const f of FACTIONS) need.push(`fields/${f.field}.webp`);
    for (let i = 1; i <= 10; i++) need.push(`obstacles/${i}.webp`);
    for (const m of ['menu', 'menu-vox', 'battle', 'battle-b', 'battle-c', 'victory', 'defeat']) need.push(`music/${m}.ogg`);
    for (const s of ['battle-start', 'battle-win', 'battle-lose', 'impact-arrow', 'morale', 'badmorale', 'luck', 'defend', 'spell-heal', 'spell-buff', 'spell-curse', 'spell-fire', 'spell-water', 'spell-earth', 'spell-air', 'ui-error']) need.push(`sfx/${s}.ogg`);
    expect(need.filter((f) => !existsSync(join(A, f)))).toEqual([]);
  });
});
