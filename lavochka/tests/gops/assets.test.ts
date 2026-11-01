import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ANIM_ART, BRIGADES, FX_ART, WORLD_ART, atlasUrl, brandArt, cutsceneUrl, themeArt, weaponIcon } from '../../src/gops/assets';
import { MUSIC_COUNT } from '../../src/gops/audio';
import { WEAPONS } from '../../src/gops/sim/weapons';

const PUB = join(__dirname, '../../public');
const MISSIONS: { cutscene_after: string | null; theme: string; time: string }[] = JSON.parse(readFileSync(join(__dirname, '../../../docs/gops/levels/missions.json'), 'utf8'));
const has = (url: string) => existsSync(join(PUB, url));

// Отбор в assets.ts и упаковка studio/post/pack_gops.py должны совпадать: всё, на что ссылается игра, лежит в public/gops/a.
describe('gops/assets: ссылки игры — на упакованные файлы', () => {
  it('темы всех миссий, обложки меню, иконки оружия, картинки в мире, эффекты, атласы, ролики, музыка', () => {
    const missing: string[] = [];
    const need = (url: string | null) => url && !has(url) && missing.push(url);
    for (const m of MISSIONS) {
      const t = themeArt(m.theme, m.time);
      need(t.ground);
      need(t.far);
      need(t.near);
      if (m.cutscene_after) need(cutsceneUrl(m.cutscene_after));
    }
    for (const n of ['title-keyart-1', 'campaign-map-1', 'menu-bg-1', 'menu-bg-2', 'menu-bg-3', 'brigade-select-bg-1', 'brigade-select-bg-2', 'loading-1-1', 'loading-2-1', 'loading-3-1', 'loading-4-1'])
      need(brandArt(n));
    for (const id of Object.keys(WEAPONS)) if (!WEAPONS[id].hidden) need(weaponIcon(id) ?? `нет иконки: ${id}`);
    for (const a of Object.values(WORLD_ART)) need(a.url);
    for (const base of [...Object.values(FX_ART), ...Object.values(ANIM_ART)]) {
      need(`${base}.webp`);
      need(`${base}.json`);
    }
    for (const b of BRIGADES) {
      const url = atlasUrl(b.id);
      need(url);
      if (has(url)) need(url.replace(/[^/]+$/, JSON.parse(readFileSync(join(PUB, url), 'utf8')).meta.image));
    }
    for (const [kind, n] of Object.entries(MUSIC_COUNT)) for (let i = 1; i <= n; i++) need(`/gops/a/music/${kind}-${String(i).padStart(2, '0')}.ogg`);
    expect(missing).toEqual([]);
  });

  it('озвучка: на каждую фразу из picks.json есть файл', () => {
    const picks: Record<string, string> = JSON.parse(readFileSync(join(PUB, 'gops/a/33-voices-qwen/picks.json'), 'utf8'));
    const missing = Object.values(picks).filter((f) => !has(`/gops/a/33-voices-qwen/${f.replace('/', '/ogg/').replace(/\.wav$/, '.ogg')}`));
    expect(missing).toEqual([]);
    expect(readdirSync(join(PUB, 'gops/a/33-voices-qwen')).length).toBeGreaterThanOrEqual(6);
  });
});
