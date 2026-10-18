/* Кампания «Посох Белого мага» (k1): главная эпическая линия — собрать разбитый Посох Белого мага и вместе с гнумом
 * пройти Владения Чёрного мага. Главы лежат в k1-ch*.ts, дорожные встречи — в k1-road.ts, общие помощники — в k1-util.ts. */
import type { Campaign, Trigger } from '../campaigns';
import type { Scene, Site } from '../../script';
import { ch1, INTRO } from './k1-ch1';
import { ch2 } from './k1-ch2';
import { ch3 } from './k1-ch3';
import { ch4 } from './k1-ch4';
import { ch5 } from './k1-ch5';
import { ch6 } from './k1-ch6';
import { ROAD } from './k1-road';
import type { Chapter } from './k1-util';

const CHAPTERS: Chapter[] = [ch1, ch2, ch3, ch4, ch5, ch6];

const scenes: Record<string, Scene> = {};
for (const sc of [...CHAPTERS.flatMap((c) => c.scenes), ...ROAD]) {
  if (sc.id.startsWith('camp:k1:')) scenes[sc.id.slice('camp:k1:'.length)] = sc;
}
const sites: Record<string, Site> = {};
for (const c of CHAPTERS) for (const s of c.sites ?? []) sites[s.id] = s;
const rooms: Record<string, string> = Object.assign({}, ...CHAPTERS.map((c) => c.rooms ?? {}));
const triggers: Trigger[] = CHAPTERS.flatMap((c) => c.triggers ?? []);
const places = CHAPTERS.flatMap((c) => c.places ?? []);

export const k1: Campaign = {
  id: 'k1',
  title: 'Посох Белого мага',
  hint: 'Эпическая линия: собрать разбитый Посох и пройти Владения Чёрного мага',
  intro: INTRO,
  scenes,
  sites,
  places,
  triggers,
  rooms,
  road: 'both',
  roadScenes: ROAD.map((sc) => sc.id.slice('camp:k1:'.length)),
  layout: ['c1', 'c6', 'c7', 'c8', 'c3', 'c2', 'c11', 'c13', 'c4', 'c12', 'c14', 'c10', 'c9', 'c15', 'c5'],
};
