// Демо-миксы (как start.mix в Dance eJay): готовые треки из того же кита. Описаны по именам семей и сэмплов —
// если кит вырос и чего-то нет, это место просто пропускается.
import { KitIndex, newFx, newProject, place, setBars, type Kit, type Project, type TrackFx } from './project';

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
  /** Эффекты дорожек (как в микшере Dance eJay 2). */
  fx?: Record<number, Partial<TrackFx>>;
}

const P = (name: string, from: number, to: number, track: number): Part => ({ name, from, to, track });

export const DEMOS: Demo[] = [
  {
    title: 'Евродэнс 140',
    bpm: 140,
    vol: { 3: 0.8, 5: 0.75, 7: 0.75 },
    fx: { 3: { reverb: 0.35 }, 5: { echo: 0.35, time: 1 }, 10: { echo: 0.3, time: 2, reverb: 0.25 } },
    parts: [
      P('Euro Grp.5 Vers.1', 0, 8, 0), P('Shaker A', 0, 8, 1), P('Night On Moon', 0, 8, 3), P('Riser Long', 4, 8, 9),
      P('Crash A', 8, 10, 8), P('Euro Grp.5 Vers.1', 8, 24, 0), P('Euro Offbeat', 8, 24, 2), P('Organ One', 8, 24, 4),
      P('Night On Moon', 16, 24, 3), P('Come On', 7, 8, 10), P('Hands Up', 15, 16, 10), P('Euro Fill Snare', 23, 24, 1),
      P('Crash A', 24, 26, 8), P('Night On Moon', 24, 32, 3), P('Whirl-Pool', 24, 32, 5), P('Riser Long', 28, 32, 9),
      P('Laser A', 31, 32, 8), P('Crash A', 32, 34, 8), P('Euro Grp.5 Vers.1', 32, 48, 0), P('Kick A 4-4', 32, 48, 1),
      P('Euro Offbeat', 32, 48, 2), P('Anthem Stab', 32, 48, 6), P('Whirl-Pool', 32, 48, 5), P('Hook A', 32, 48, 7),
      P('Dance With Me', 31, 32, 10), P('Davay Davay', 39, 40, 10), P('Downer Mid', 48, 50, 9),
    ],
  },
  {
    title: 'Хаус 128',
    bpm: 128,
    vol: { 3: 0.7, 4: 0.85 },
    fx: { 2: { filter: -0.35 }, 4: { reverb: 0.2 }, 10: { echo: 0.35, time: 1 } },
    parts: [
      P('House Grp.5 Vers.1', 0, 16, 0), P('Hihat A 16th', 8, 16, 1), P('House Pluck', 8, 40, 2), P('House Piano', 16, 40, 4),
      P('Night On Moon', 24, 32, 3), P('House Fill Toms', 15, 16, 1), P('Crash A', 16, 18, 8), P('House Grp.5 Vers.1', 16, 40, 0),
      P('Open Hat A', 24, 40, 1), P('Diskoteka', 15, 16, 10), P('Lets Go', 23, 24, 10), P('Acid Pedal', 32, 40, 5),
      P('Riser Long', 28, 32, 9), P('Crash A', 32, 34, 8), P('Vse Na Tantspol', 39, 40, 10),
    ],
  },
  {
    title: 'Дрим-хаус 128',
    bpm: 128,
    vol: { 5: 0.8, 3: 0.75 },
    fx: { 5: { reverb: 0.45, echo: 0.25, time: 1 }, 3: { reverb: 0.4 }, 6: { echo: 0.3, time: 3 } },
    parts: [
      P('Dream Piano Am-F-C-G', 0, 16, 5), P('Choir Of Angels Am-F-C-G', 8, 16, 3), P('Dream Grp.5 Vers.1', 8, 40, 0),
      P('Rolling', 16, 40, 2), P('Dream Piano Am-F-C-G', 16, 40, 5), P('Night On Moon', 16, 40, 3),
      P('Riser Long', 12, 16, 9), P('Crash A', 16, 18, 8), P('Shaker A', 16, 40, 1), P('Whirl-Pool', 24, 40, 6),
      P('Jump Jump', 31, 32, 10), P('Crash A', 32, 34, 8), P('Downer Mid', 40, 42, 9),
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
  for (const [t, f] of Object.entries(d.fx ?? {})) p.tracks[+t].fx = { ...newFx(), ...f };
  setBars(p, ix, 64);
  return p;
}
