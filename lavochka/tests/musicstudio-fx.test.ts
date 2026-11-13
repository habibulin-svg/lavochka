// Lavochka Music Studio: эффекты дорожек, Groove Generator, упаковка Ogg Opus (модель без DOM).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { muxOggOpus, oggCrc, oggPage } from '../src/musicstudio/ogg';
import {
  GROOVE_PRESETS, GROOVE_ROWS, KitIndex, STEPS, applyPreset, canPlace, cycleStep, deleteGroove, filterParams, fxOn, grooveSources,
  newGroove, newProject, nextGrooveId, parseProject, place, renderGroove, saveGroove, serialize, setGrooveBars, songEnd, type Kit,
} from '../src/musicstudio/project';

const kit = JSON.parse(readFileSync(new URL('../public/music-studio/dance/kit.json', import.meta.url), 'utf8')) as Kit;
const ix = new KitIndex(kit);
const two = kit.samples.find(s => s.bars === 2 && s.loop)!;

describe('Lavochka Music Studio — эффекты дорожек', () => {
  it('старое сохранение (без эффектов и грувов) открывается с выключенными эффектами', () => {
    const old = {
      v: 1, name: 'Старый', kit: 'dance', bpm: 128, bars: 64, master: 0.9, loop: null,
      tracks: [{ vol: 0.8, pan: 0.2 }, { vol: 1, pan: 0, mute: true }], blocks: [{ track: 0, bar: 0, sample: two.id }],
    };
    const p = parseProject(old, kit);
    expect(p.tracks.length).toBe(16);
    expect(p.tracks.every(t => !fxOn(t.fx))).toBe(true);
    expect(p.tracks[1].mute).toBe(true);
    expect(p.grooves).toEqual([]);
    expect(p.blocks.length).toBe(1);
    // запись без эффектов и грувов не раздувается (ссылка #mix= остаётся короткой)
    expect(serialize(p)).not.toContain('fx');
    expect(serialize(p)).not.toContain('grooves');
  });

  it('эффекты сохраняются туда-обратно и прижимаются к границам', () => {
    const p = newProject(kit);
    p.tracks[3].fx = { echo: 0.5, time: 2, reverb: 0.25, filter: -0.6 };
    const q = parseProject(JSON.parse(serialize(p)), kit);
    expect(q.tracks[3].fx).toEqual({ echo: 0.5, time: 2, reverb: 0.25, filter: -0.6 });
    expect(fxOn(q.tracks[3].fx)).toBe(true);
    const bad = parseProject({ tracks: [{ fx: { echo: 9, time: 77, reverb: -1, filter: 'x' } }] }, kit);
    expect(bad.tracks[0].fx).toEqual({ echo: 1, time: 3, reverb: 0, filter: 0 });
  });

  it('фильтр: середина — прозрачно, влево — НЧ, вправо — ВЧ', () => {
    expect(filterParams(0, 22050)).toMatchObject({ type: 'lowpass', freq: 22050 });
    const lo = filterParams(-1, 22050);
    expect(lo.type).toBe('lowpass');
    expect(lo.freq).toBeLessThan(200);
    const hi = filterParams(1, 22050);
    expect(hi.type).toBe('highpass');
    expect(hi.freq).toBeGreaterThan(3000);
    expect(filterParams(-0.5, 22050).freq).toBeGreaterThan(lo.freq);
  });
});

describe('Lavochka Music Studio — Groove Generator', () => {
  it('все удары режутся из сэмплов группы drum, кусок помещается в сэмпл', () => {
    for (const row of GROOVE_ROWS) {
      for (const h of row.hits) {
        const s = ix.get(h.src);
        expect(s, `${h.id} ← ${h.src}`).toBeTruthy();
        expect(s!.group).toBe('drum');
        expect(h.step + h.len).toBeLessThanOrEqual(s!.bars * STEPS);
      }
    }
  });

  it('готовые рисунки — из звуков своих строк, по 16 шагов; house, euro, breaks есть', () => {
    expect(GROOVE_PRESETS.map(p => p.id)).toEqual(expect.arrayContaining(['house', 'euro', 'breaks']));
    for (const pr of GROOVE_PRESETS) {
      expect(pr.rows.length).toBe(GROOVE_ROWS.length);
      pr.rows.forEach(([sound, pat], i) => {
        expect(GROOVE_ROWS[i].hits.map(h => h.id), `${pr.id}/${sound}`).toContain(sound);
        expect(pat).toMatch(/^[.xX]{16}$/);
      });
    }
  });

  it('клетки, длина, пресет на два такта', () => {
    const g = newGroove('~g1', 'Тест');
    cycleStep(g, 0, 0);
    expect(g.rows[0].pat[0]).toBe('x');
    cycleStep(g, 0, 0);
    expect(g.rows[0].pat[0]).toBe('X');
    cycleStep(g, 0, 0);
    expect(g.rows[0].pat[0]).toBe('.');
    cycleStep(g, 0, 4);
    setGrooveBars(g, 2);
    expect(g.rows[0].pat).toHaveLength(32);
    expect(g.rows[0].pat[20]).toBe('x'); // второй такт — копия первого
    applyPreset(g, 'house');
    expect(g.rows[0].pat).toBe('X...X...X...X...'.repeat(2));
    setGrooveBars(g, 1);
    expect(g.rows[0].pat).toBe('X...X...X...X...');
    expect(grooveSources(g).length).toBeGreaterThan(2);
  });

  it('грув — блок на дорожке, сохраняется в проекте и ссылке; мусор отбрасывается', () => {
    const p = newProject(kit);
    const lix = new KitIndex(kit);
    const g = newGroove(nextGrooveId(p), 'Мой бит', 2);
    applyPreset(g, 'breaks');
    saveGroove(p, lix, g);
    expect(lix.get(g.id)?.bars).toBe(2);
    expect(place(p, lix, 0, 0, g.id)).toBeTruthy();
    expect(canPlace(p, lix, 0, 1, g.id)).toBe(false);
    expect(songEnd(p, lix)).toBe(2);
    const q = parseProject(JSON.parse(serialize(p)), kit);
    expect(q.grooves).toEqual(p.grooves);
    expect(q.blocks.map(b => b.sample)).toEqual([g.id]);
    const bad = parseProject({
      grooves: [{ id: 'x' }, { id: '~g5', bars: 7, swing: 3, rows: [{ sound: 'нет', pat: 'xxQ' }] }],
      blocks: [{ track: 0, bar: 0, sample: '~g9' }],
    }, kit);
    expect(bad.grooves.map(x => x.id)).toEqual(['~g5']);
    expect(bad.grooves[0].bars).toBe(1);
    expect(bad.grooves[0].swing).toBe(0.5);
    expect(bad.grooves[0].rows[0]).toEqual({ sound: 'kick-a', pat: 'xx..............' });
    expect(bad.blocks).toEqual([]); // блок с неизвестным грувом выброшен
    expect(nextGrooveId(q)).toBe('~g2');
  });

  it('удлинённый грув убирает блоки, которые налезли бы на соседей; удаление — вместе с блоками', () => {
    const p = newProject(kit);
    const lix = new KitIndex(kit);
    const g = newGroove('~g1', 'Г');
    applyPreset(g, 'house');
    saveGroove(p, lix, g);
    place(p, lix, 0, 0, g.id);
    place(p, lix, 0, 1, g.id);
    place(p, lix, 0, 5, g.id);
    const g2 = { ...g, rows: g.rows.map(r => ({ ...r })) };
    setGrooveBars(g2, 2);
    expect(saveGroove(p, lix, g2)).toBe(1);
    expect(p.blocks.map(b => b.bar)).toEqual([1, 5]); // блок в такте 0 налез бы на такт 1
    deleteGroove(p, lix, g.id);
    expect(p.blocks).toEqual([]);
    expect(p.grooves).toEqual([]);
    expect(lix.get(g.id)).toBeUndefined();
  });

  it('звук грува: удары на своих шагах, свинг сдвигает нечётные шаги, хвост заворачивается', () => {
    const sr = 1000;
    const bpm = 120; // такт 2 с, шаг 0,125 с = 125 отсчётов
    const g = newGroove('~g1', 'Т');
    g.rows[0] = { sound: 'kick-a', pat: 'x.......x.......' };
    g.rows[3] = { sound: 'hat-a', pat: '.X..............' };
    const src = (id: string) => {
      const a = new Float32Array(2000);
      if (id === 'kick-a-half') a.fill(1, 0, 50); // удар бочки на шаге 0
      if (id === 'hihat-a-offbeat') a.fill(0.5, 250, 260); // хэт на шаге 2
      return [a];
    };
    let out = renderGroove(g, bpm, sr, src);
    expect(out[0].length).toBe(2000);
    expect(out[0][10]).toBeCloseTo(0.65);
    expect(out[0][1000 + 10]).toBeCloseTo(0.65);
    expect(out[1][125 + 2]).toBeCloseTo(0.45); // акцент хэта = 0,9 × 0,5, моно → оба канала
    expect(out[0][600]).toBe(0);
    g.swing = 0.4;
    out = renderGroove(g, bpm, sr, src);
    expect(out[0][125 + 2]).toBe(0);
    expect(out[0][175 + 2]).toBeCloseTo(0.45);
    g.swing = 0;
    g.rows[3].pat = '.'.repeat(16);
    g.rows[0] = { sound: 'kick-a', pat: '...............x' };
    const long = (id: string) => (id === 'kick-a-half' ? [new Float32Array(2000).fill(1, 0, 600)] : null);
    out = renderGroove(g, bpm, sr, long);
    expect(out[0][1875 + 10]).toBeCloseTo(0.65);
    expect(out[0][50]).toBeCloseTo(0.65); // хвост завернулся в начало петли
  });
});

describe('Lavochka Music Studio — Ogg Opus', () => {
  it('CRC Ogg: известное значение', () => {
    expect(oggCrc(new TextEncoder().encode('123456789'))).toBe(0x89a1897f);
  });

  it('страница: заголовок OggS, сегменты, CRC сходится', () => {
    const pkt = new Uint8Array(600).fill(7);
    const page = oggPage([pkt], 960n, 42, 3, 0);
    expect(String.fromCharCode(...page.subarray(0, 4))).toBe('OggS');
    expect(page[26]).toBe(3); // 255 + 255 + 90
    expect([...page.subarray(27, 30)]).toEqual([255, 255, 90]);
    const v = new DataView(page.buffer);
    expect(v.getBigInt64(6, true)).toBe(960n);
    const crc = v.getUint32(22, true);
    const copy = page.slice();
    new DataView(copy.buffer).setUint32(22, 0, true);
    expect(oggCrc(copy)).toBe(crc);
  });

  it('файл: OpusHead, OpusTags, гранулы растут, последняя обрезана по длине трека', () => {
    const packets = Array.from({ length: 120 }, (_, i) => ({ data: new Uint8Array(100 + (i % 7)), samples: 960 }));
    const total = 120 * 960 - 500;
    const ogg = muxOggOpus(packets, { channels: 2, preSkip: 312, rate: 48000, total });
    const pages: { flags: number; granule: bigint; seq: number }[] = [];
    let o = 0;
    while (o < ogg.length) {
      expect(String.fromCharCode(...ogg.subarray(o, o + 4))).toBe('OggS');
      const v = new DataView(ogg.buffer, o);
      const n = ogg[o + 26];
      const body = ogg.subarray(o + 27, o + 27 + n).reduce((a, b) => a + b, 0);
      const first = String.fromCharCode(...ogg.subarray(o + 27 + n, o + 27 + n + 8));
      if (pages.length === 0) expect(first).toBe('OpusHead');
      if (pages.length === 1) expect(first).toBe('OpusTags');
      pages.push({ flags: ogg[o + 5], granule: v.getBigInt64(6, true), seq: v.getUint32(18, true) });
      o += 27 + n + body;
    }
    expect(o).toBe(ogg.length);
    expect(pages[0].flags).toBe(2);
    expect(pages.at(-1)!.flags).toBe(4);
    expect(pages.map(p => p.seq)).toEqual(pages.map((_, i) => i));
    for (let i = 3; i < pages.length; i++) expect(pages[i].granule).toBeGreaterThan(pages[i - 1].granule);
    expect(pages.at(-1)!.granule).toBe(BigInt(312 + total));
  });
});
