import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mayPlay, withDefaults } from '../../src/core/release';
import { CATALOG } from '../../src/games/catalog';
import { CLASSES, heroPortrait } from '../../src/geroi/sim/heroes';
import { CREATURES, FACTIONS } from '../../src/geroi/sim/creatures';
import { SPELLS, spellIcon } from '../../src/geroi/sim/spells';
import { OBJECTS, RES, ROAD_ART, TERRAINS } from '../../src/geroi/sim/adv/data';
import { ARTIFACTS, SKILLS } from '../../src/geroi/sim/adv/hero';
import { BUILDINGS, type TownFaction } from '../../src/geroi/sim/adv/town';
import { makeTestMap } from '../../src/geroi/sim/adv/testmap';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { SALE_OPEN } from '../../src/geroi/sale';

const A = join(__dirname, '../../public/geroi/a');

/** Картинки второй волны (платная часть) ждут упаковки, пока продажа закрыта: их не видит никто, кроме Мастера.
 * С SALE_OPEN тест требует всё. */
const PAID_ART = /plotina|ostrog|bazar|kurgany|coast|snow|saltflat|heath|neutral-(crab|lynx|scorpion|raven|nomad|griffin)|dwell-(crab|lynx|scorpion|raven|nomad|griffin)|campaign[3-6]|finale-battle|ending-|battle-d/;
const missing = (need: string[]): string[] => [...new Set(need)].filter((f) => !existsSync(join(A, f)) && (SALE_OPEN || !PAID_ART.test(f)));

// Всё, на что ссылается игра, лежит в public/geroi/a (упаковка studio/post/pack_geroi.py).
describe('geroi: выход на сайт', () => {
  it('карточка есть, и игра вышла из раннего доступа: играть может каждый (платная часть — отдельной покупкой)', () => {
    const known = (id: string) => CATALOG.some((g) => g.id === id);
    expect(known('geroi')).toBe(true);
    const rel = withDefaults({}, known);
    expect(mayPlay(rel, 'geroi', [])).toBe(true);
  });
});

describe('geroi/assets', () => {
  it('карта: грунты, объекты, декор, кони, замки, панорамы, осада, иконки, музыка', () => {
    const need: string[] = [];
    for (const t of TERRAINS) need.push(`map/ground-${t.id}.webp`);
    for (const r of ROAD_ART.slice(1)) need.push(`map/ground-${r}.webp`);
    for (const o of Object.values(OBJECTS)) if (o.art) need.push(`map/${o.art}.webp`);
    for (const r of RES) need.push(`icons/icon-${r}.webp`);
    for (const a of Object.keys(ARTIFACTS)) need.push(`icons/${a}.webp`);
    for (const s of SKILLS) need.push(`icons/skill-${String(s.icon).padStart(2, '0')}.webp`);
    for (const c of CLASSES) need.push(`mounts/${c.id}.webp`, `mounts/${c.id}.json`);
    const fs: TownFaction[] = ['zatulye', 'zatonye', 'kuznya', 'akademiya'];
    for (const f of fs) {
      need.push(`map/town-${f}.webp`, `towns/${f}-site.webp`, `music/town-${f}.ogg`);
      for (const p of ['wall', 'gate', 'tower']) need.push(`siege/${p}-${f}.webp`);
      for (const b of Object.values(BUILDINGS[f])) need.push(`towns/${f}-${b.art}.webp`);
    }
    for (const m of ['map', 'map-swamp', 'map-ash', 'map-pine', 'siege']) need.push(`music/${m}.ogg`);
    // вторая волна: замки и местности новых фракций, кампании 3–6, финал и концовки
    for (const m of ['town-plotina', 'town-ostrog', 'town-bazar', 'town-kurgany', 'map-coast', 'map-snow', 'map-saltflat', 'map-heath', 'battle-d', 'campaign3', 'campaign4', 'campaign5', 'campaign6', 'finale-battle', 'ending-home', 'ending-stay']) need.push(`music/${m}.ogg`);
    const w = makeTestMap({ seed: 1, players: fs.slice(0, 2).map((f) => ({ name: f, faction: f, hero: { cls: factionClasses(f)[0].id, n: 1 } })) });
    for (const d of w.decor) need.push(`map/${d.art}.webp`);
    for (const f of ['catapult', 'wall-break', 'tower-shot', 'horse-grass', 'horse-road', 'horse-swamp', 'horse-ash', 'boat-row', 'pickup-semki', 'pickup-res', 'chest-open', 'artifact', 'flag', 'mine-capture', 'shrine', 'levelup', 'newday', 'newweek', 'teleport', 'dig', 'learn', 'water-splash', 'build', 'recruit', 'market', 'gate', 'forge', 'horse-snort', 'ui-click', 'ui-close', 'ui-turn']) need.push(`sfx/${f}.ogg`);
    expect(missing(need)).toEqual([]);
  });

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
    expect(missing(need)).toEqual([]);
  });
});
