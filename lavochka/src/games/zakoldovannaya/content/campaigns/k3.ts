/* Кампания k3 «Драконья осень»: проснулись пять драконов; гномы, потомки рудокопов, знают, как снова заковать их. */
import type { Campaign } from '../campaigns';
import { ch1, INTRO } from './k3-1';
import { ch2 } from './k3-2';
import { ch3 } from './k3-3';
import { ch4 } from './k3-4';
import { ch5 } from './k3-5';
import { ch6 } from './k3-6';
import { road } from './k3-road';
import type { Part } from './k3-lib';

const parts: Part[] = [ch1, ch2, ch3, ch4, ch5, ch6, road];

export const k3: Campaign = {
  id: 'k3',
  title: 'Драконья осень',
  hint: 'Проснулись драконы. Гномы помнят, как сковать их снова, — если их найти и освободить.',
  intro: INTRO,
  scenes: Object.assign({}, ...parts.map((p) => p.scenes)),
  sites: Object.assign({}, ...parts.map((p) => p.sites ?? {})),
  places: parts.flatMap((p) => p.places ?? []),
  triggers: parts.flatMap((p) => p.triggers ?? []),
  rooms: Object.assign({}, ...parts.map((p) => p.rooms ?? {})),
  layout: ['c1', 'c6', 'c7', 'c8', 'c3', 'c2', 'c11', 'c13', 'c4', 'c12', 'c14', 'c10', 'c9', 'c15', 'c5'],
  road: 'both',
  roadScenes: parts.flatMap((p) => p.roadScenes ?? []),
};
