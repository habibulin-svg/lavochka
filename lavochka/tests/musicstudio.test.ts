import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  KitIndex, audibleAt, canPlace, chordAt, move, newProject, nextFree, parseProject, place, remove, serialize, setBars,
  songEnd, type Kit,
} from '../src/musicstudio/project';

const kit = JSON.parse(readFileSync(new URL('../public/music-studio/dance/kit.json', import.meta.url), 'utf8')) as Kit;
const ix = new KitIndex(kit);
const pick = (pred: (s: Kit['samples'][number]) => boolean) => {
  const s = kit.samples.find(pred);
  if (!s) throw new Error('нет сэмпла');
  return s;
};

describe('Lavochka Music Studio — кит', () => {
  it('у каждого сэмпла длина в тактах, группа из списка, звёздочки — у семей', () => {
    expect(kit.samples.length).toBeGreaterThan(40);
    const ids = new Set<string>();
    for (const s of kit.samples) {
      expect([1, 2, 4, 8]).toContain(s.bars);
      expect(kit.groups).toContain(s.group);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      if (s.chord) {
        expect(kit.chords).toContain(s.chord);
        expect(s.star).toBe(kit.chords.indexOf(s.chord) + 1);
        for (let st = 1; st <= 4; st++) expect(ix.sibling(s.id, st), `${s.name} → ${st}`).toBeTruthy();
      }
    }
  });
});

describe('Lavochka Music Studio — проект', () => {
  const two = pick(s => s.bars === 2 && s.loop);
  const one = pick(s => s.bars === 1);

  it('блоки не перекрываются на дорожке и не вылезают за лист', () => {
    const p = newProject(kit);
    expect(place(p, ix, 0, 0, two.id)).toBeTruthy();
    expect(canPlace(p, ix, 0, 1, one.id)).toBe(false);
    expect(canPlace(p, ix, 0, 2, one.id)).toBe(true);
    expect(canPlace(p, ix, 1, 1, one.id)).toBe(true);
    expect(canPlace(p, ix, 0, p.bars - 1, two.id)).toBe(false);
    expect(canPlace(p, ix, 16, 0, one.id)).toBe(false);
    expect(nextFree(p, ix, 0, 0, two.id)).toBe(2);
  });

  it('перенос, удаление, конец песни, что звучит в такте', () => {
    const p = newProject(kit);
    const a = place(p, ix, 0, 0, two.id)!;
    const b = place(p, ix, 3, 4, one.id)!;
    expect(songEnd(p, ix)).toBe(5);
    expect(move(p, ix, b.id, 0, 1)).toBe(false); // на a
    expect(move(p, ix, b.id, 0, 2)).toBe(true);
    expect(audibleAt(p, ix, 1).map(x => x.id)).toEqual([a.id]);
    p.tracks[0].mute = true;
    expect(audibleAt(p, ix, 1)).toEqual([]);
    p.tracks[0].mute = false;
    p.tracks[5].solo = true;
    expect(audibleAt(p, ix, 0)).toEqual([]);
    expect(remove(p, a.id)).toBe(true);
    expect(songEnd(p, ix)).toBe(3);
  });

  it('аккорд такта — по «звёздным» сэмплам', () => {
    const p = newProject(kit);
    const am = pick(s => s.star === 1 && s.bars === 2);
    const f = ix.sibling(am.id, 2)!;
    place(p, ix, 0, 0, am.id);
    place(p, ix, 0, 2, f.id);
    expect(chordAt(p, ix, 1)).toBe('Am');
    expect(chordAt(p, ix, 3)).toBe('F');
    expect(chordAt(p, ix, 9)).toBe(null);
  });

  it('лист не короче песни', () => {
    const p = newProject(kit);
    place(p, ix, 0, 60, two.id);
    setBars(p, ix, 32);
    expect(p.bars).toBe(62);
  });

  it('сохранение туда-обратно; мусор и чужие сэмплы отбрасываются', () => {
    const p = newProject(kit, 140, 'Мой трек');
    place(p, ix, 2, 8, two.id);
    p.tracks[2].vol = 0.5;
    p.tracks[2].pan = -0.3;
    p.loop = { from: 8, to: 16 };
    const q = parseProject(JSON.parse(serialize(p)), kit);
    expect(q.bpm).toBe(140);
    expect(q.name).toBe('Мой трек');
    expect(q.blocks.map(b => [b.track, b.bar, b.sample])).toEqual([[2, 8, two.id]]);
    expect(q.tracks[2]).toEqual({ vol: 0.5, pan: -0.3, mute: false, solo: false, fx: { echo: 0, time: 1, reverb: 0, filter: 0 } });
    expect(q.loop).toEqual({ from: 8, to: 16 });
    const bad = parseProject({ bpm: 999, bars: 1e9, blocks: [{ track: 99, bar: 0, sample: two.id }, { track: 0, bar: 0, sample: 'нет' }, null], tracks: 'x' }, kit);
    expect(bad.bpm).toBe(kit.bpms[0]);
    expect(bad.bars).toBeLessThanOrEqual(256);
    expect(bad.blocks.length).toBe(1); // дорожка 99 прижата к 15, чужой сэмпл выброшен
    expect(parseProject(null, kit).blocks).toEqual([]);
  });
});
