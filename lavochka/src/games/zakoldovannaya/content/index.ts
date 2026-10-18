/* Реестр содержимого: приключения книги (места c1–c15), дорожные встречи «Прочее», кампании. */
import type { Scene, Site, Step } from '../script';
import { BOOK_SITES } from './book';
import { ROAD } from './road';
import { CAMPAIGNS, type Campaign } from './campaigns';

export { BOOK_SITES, ROAD, CAMPAIGNS, type Campaign };

/** Все места (замки книги + свои места кампаний). */
export function siteById(id: string, mode: string): Site | undefined {
  return BOOK_SITES[id] ?? CAMPAIGNS[mode]?.sites?.[id];
}

/** Сцена по ключу: 'site:c1:5', 'enter:c1', 'road:17', 'camp:<id>:<scene>'. */
export function sceneByKey(key: string, mode: string, custom?: Step[]): Scene | undefined {
  const [kind, a, b] = key.split(':');
  if (kind === 'site') return siteById(a, mode)?.rooms[b];
  if (kind === 'enter') {
    const site = siteById(a, mode);
    return site?.enter ? { id: key, title: site.title, steps: site.enter } : undefined;
  }
  if (kind === 'road') return ROAD.find((r) => r.id === key);
  if (kind === 'camp') return CAMPAIGNS[a]?.scenes[b];
  if (kind === 'custom') return custom ? { id: 'custom', steps: custom } : undefined;
  return undefined;
}
