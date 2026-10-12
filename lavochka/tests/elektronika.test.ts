/* «Электроника ИМ» и Brick Game: эмуляторы SM5A и HT1190 на настоящих прошивках — оживает, показывает часы, по «игре А» начинает игру и пищит. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOCK_HZ, GwMachine, segIndex } from '../src/arcade/gw';
import { GAMES } from '../src/games/elektronika/games';
import { HT_CLOCK } from '../src/arcade/ht1190';
import { BrickMachine } from '../src/games/brick/machine';

const dir = join(__dirname, '..', 'public', 'elektronika');
const rom = (id: string) => new Uint8Array(readFileSync(join(dir, id, 'rom.bin')));
const svgSegs = (id: string) => new Set([...readFileSync(join(dir, id, 'screen.svg'), 'utf8').matchAll(/data-s="(\d+)\.(\d+)\.(\d+)"/g)].map((m) => segIndex(+m[1], +m[2], +m[3])));

function machine(id: string) {
  const g = GAMES.find((x) => x.id === id)!;
  return { g, m: new GwMachine(rom(id), { ba: g.buttons.some((b) => b.port === 'BA'), b: g.buttons.some((b) => b.port === 'B') }) };
}

const lit = (m: GwMachine) => [...m.lit].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

function press(m: GwMachine, g: (typeof GAMES)[number], id: string, ms = 120) {
  const b = g.buttons.find((x) => x.id === id)!;
  m.set(b.port, b.mask, true);
  m.run((CLOCK_HZ * ms) / 1000);
  m.set(b.port, b.mask, false);
}

describe('Электроника ИМ', () => {
  it.each(GAMES.map((g) => g.id))('%s: прошивка на месте, экран оживает, игра А запускается', (id) => {
    const { g, m } = machine(id);
    expect(rom(id).length).toBe(0x740);
    m.run(CLOCK_HZ * 2);
    const idle = lit(m);
    expect(idle.length, 'после включения что-то горит (часы)').toBeGreaterThan(0);
    // горящее видно на экране (прошивка одна на многие игры — у части экранов лишних сегментов просто нет)
    const known = svgSegs(id);
    expect(idle.filter((i) => known.has(i)).length, 'на экране что-то видно').toBeGreaterThan(idle.length / 2);

    // игра А: экран меняется, пищалка щёлкает
    press(m, g, 'a');
    const audio = new Float32Array(CLOCK_HZ * 3);
    m.run(CLOCK_HZ * 3, audio);
    const play = lit(m);
    expect(play.join(), 'после «игры А» картинка другая').not.toBe(idle.join());
    let edges = 0;
    for (let i = 1; i < audio.length; i++) if (audio[i] !== audio[i - 1]) edges++;
    expect(edges, 'пищит').toBeGreaterThan(10);
  });

  it('кнопки двигают героя (Ну, погоди!: волк перекладывает корзину)', () => {
    const { g, m } = machine('nupogodi');
    m.run(CLOCK_HZ);
    press(m, g, 'a');
    m.run(CLOCK_HZ / 2);
    press(m, g, 'lu');
    m.run(CLOCK_HZ / 4);
    const a = lit(m).join();
    press(m, g, 'rd');
    m.run(CLOCK_HZ / 4);
    expect(lit(m).join()).not.toBe(a);
  });

  it('сохранение и загрузка дают то же самое', () => {
    const { g, m } = machine('vespovar');
    m.run(CLOCK_HZ);
    press(m, g, 'a');
    m.run(CLOCK_HZ);
    const snap = JSON.parse(JSON.stringify(m.save()));
    const { m: m2 } = machine('vespovar');
    m2.load(snap);
    m.run(CLOCK_HZ);
    m2.run(CLOCK_HZ);
    expect(m2.save()).toEqual(m.save());
  });

  it('перемотка спящего прибора быстрая (часы за час)', () => {
    const { m } = machine('nupogodi');
    m.run(CLOCK_HZ * 2);
    const t = Date.now();
    m.skip(CLOCK_HZ * 3600);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

describe('Brick Game E-23 (HT1190)', () => {
  const brick = () => new BrickMachine(new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'brick', 'rom.bin'))), new Uint8Array(readFileSync(join(__dirname, '..', 'public', 'brick', 'melody.bin'))));
  const count = (m: InstanceType<typeof BrickMachine>) => m.lit.reduce((a, b) => a + b, 0);
  const svg = readFileSync(join(__dirname, '..', 'public', 'brick', 'screen.svg'), 'utf8');
  const known = new Set([...svg.matchAll(/data-s="(\d+)\.(\d+)"/g)].map((x) => +x[1] * 40 + +x[2]));

  it('включается, рисует на экране, кнопки работают, пищит', () => {
    const m = brick();
    const audio = new Float32Array(HT_CLOCK * 2);
    m.run(HT_CLOCK * 2, audio);
    const a = [...m.lit].join('');
    expect(count(m), 'что-то горит').toBeGreaterThan(0);
    const on = [...m.lit].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    expect(on.filter((i) => known.has(i)).length).toBeGreaterThan(on.length / 2);
    // старт и игра
    m.set('start', true);
    m.run(HT_CLOCK / 10);
    m.set('start', false);
    const audio2 = new Float32Array(HT_CLOCK * 2);
    m.run(HT_CLOCK * 2, audio2);
    for (let i = 0; i < 6; i++) {
      m.set('left', true);
      m.run(HT_CLOCK / 20);
      m.set('left', false);
      m.run(HT_CLOCK / 20);
    }
    expect([...m.lit].join('')).not.toBe(a);
    let edges = 0;
    for (const buf of [audio, audio2]) for (let i = 1; i < buf.length; i++) if (buf[i] !== buf[i - 1]) edges++;
    expect(edges, 'пищит').toBeGreaterThan(10);
  });
});
