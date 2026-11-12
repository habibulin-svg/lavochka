// Демо-миксы (как start.mix в Dance eJay): готовые треки из того же кита. Описаны по именам семей и сэмплов —
// если кит вырос и чего-то нет, это место просто пропускается.
import { KitIndex, newProject, place, setBars, type Kit, type Project } from './project';

interface Part {
  /** Имя сэмпла или семьи (тогда — по аккордам *…**** по 2 такта). */
  name: string;
  from: number;
  to: number;
  track: number;
}

interface Demo {
  title: string;
  bpm: number;
  parts: Part[];
  vol?: Record<number, number>;
}

const P = (name: string, from: number, to: number, track: number): Part => ({ name, from, to, track });

export const DEMOS: Demo[] = [
  {
    title: 'Евродэнс 140',
    bpm: 140,
    vol: { 3: 0.8, 5: 0.75, 7: 0.75 },
    parts: [
      P('Groove Euro', 0, 8, 0), P('Shaker', 0, 8, 1), P('Warm Strings', 0, 8, 3), P('Riser 4', 4, 8, 9),
      P('Crash', 8, 10, 8), P('Groove Euro', 8, 24, 0), P('Euro Offbeat', 8, 24, 2), P('Organ', 8, 24, 4),
      P('Warm Strings', 16, 24, 3), P('Come On', 7, 8, 10), P('Hands Up', 15, 16, 10), P('Fill Snare', 23, 24, 1),
      P('Crash', 24, 26, 8), P('Warm Strings', 24, 32, 3), P('Trance Arp', 24, 32, 5), P('Riser 4', 28, 32, 9),
      P('Laser', 31, 32, 8), P('Crash', 32, 34, 8), P('Groove Euro', 32, 48, 0), P('Kick 4-4', 32, 48, 1),
      P('Euro Offbeat', 32, 48, 2), P('Anthem Stab', 32, 48, 6), P('Trance Arp', 32, 48, 5), P('Hook', 32, 48, 7),
      P('Dance With Me', 31, 32, 10), P('Davay', 39, 40, 10), P('Downer 2', 48, 50, 9),
    ],
  },
  {
    title: 'Хаус 128',
    bpm: 128,
    vol: { 3: 0.7, 4: 0.85 },
    parts: [
      P('Groove House', 0, 16, 0), P('Hihat 16', 8, 16, 1), P('House Pluck', 8, 40, 2), P('House Piano', 16, 40, 4),
      P('Warm Strings', 24, 32, 3), P('Fill Toms', 15, 16, 1), P('Crash', 16, 18, 8), P('Groove House', 16, 40, 0),
      P('Open Hat', 24, 40, 1), P('Diskoteka', 15, 16, 10), P('Lets Go', 23, 24, 10), P('Acid Pedal', 32, 40, 5),
      P('Riser 4', 28, 32, 9), P('Crash', 32, 34, 8), P('Vse Na Tantspol', 39, 40, 10),
    ],
  },
  {
    title: 'Дрим-хаус 128',
    bpm: 128,
    vol: { 5: 0.8, 3: 0.75 },
    parts: [
      P('Dream Piano Am-F-C-G', 0, 16, 5), P('Choir Am-F-C-G', 8, 16, 3), P('Groove Dream', 8, 40, 0),
      P('Rolling', 16, 40, 2), P('Dream Piano Am-F-C-G', 16, 40, 5), P('Warm Strings', 16, 40, 3),
      P('Riser 4', 12, 16, 9), P('Crash', 16, 18, 8), P('Shaker', 16, 40, 1), P('Trance Arp', 24, 40, 6),
      P('Jump', 31, 32, 10), P('Crash', 32, 34, 8), P('Downer 2', 40, 42, 9),
    ],
  },
];

export function buildDemo(kit: Kit, d: Demo): Project {
  const ix = new KitIndex(kit);
  const p = newProject(kit, kit.bpms.includes(d.bpm) ? d.bpm : kit.bpms[0], d.title);
  p.bars = 64;
  for (const part of d.parts) {
    const exact = kit.samples.find(s => s.name === part.name);
    if (exact) {
      for (let bar = part.from; bar + exact.bars <= part.to; bar += exact.bars) place(p, ix, part.track, bar, exact.id);
      continue;
    }
    const fam = kit.samples.filter(s => s.family === part.name && s.star > 0);
    if (!fam.length) continue;
    for (let bar = part.from, k = 0; bar < part.to; k++) {
      // аккорд по месту в песне: каждые 2 такта следующий, как в «Авто-аккордах»
      const star = (Math.floor(bar / 2) % 4) + 1;
      const s = fam.find(x => x.star === star) ?? fam[0];
      place(p, ix, part.track, bar, s.id);
      bar += s.bars;
      if (k > 512) break;
    }
  }
  for (const [t, v] of Object.entries(d.vol ?? {})) p.tracks[+t].vol = v;
  setBars(p, ix, 64);
  return p;
}
