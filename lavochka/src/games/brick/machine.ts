/* Brick Game E-23 как устройство: HT1190 + кнопки + ЖК 8×40 + пищалка. Без DOM.
 * ЖК опрашиваем 512 раз в секунду (64 Гц на каждый из 8 общих, как в MAME) с небольшой инерцией — без «рваных» кадров. */
import { HT_CLOCK, Ht1190, type HtState } from '../../arcade/ht1190';

export const COMS = 8;
export const SEGS = 40;
export const segIndex = (com: number, seg: number) => com * SEGS + seg;

/** Кнопки: порт и бит (активный ноль). */
export const KEYS = {
  start: ['ps', 0x01],
  mute: ['ps', 0x02],
  power: ['ps', 0x04],
  rotate: ['pp', 0x01],
  down: ['pp', 0x02],
  right: ['pp', 0x04],
  left: ['pp', 0x08],
} as const;
export type BrickKey = keyof typeof KEYS;

const LCD_EVERY = Math.round(HT_CLOCK / 512);

export class BrickMachine {
  readonly cpu: Ht1190;
  private ps = 0;
  private pp = 0;
  private lcdTick = 0;
  private acc = new Uint8Array(COMS * SEGS);
  readonly lit = new Uint8Array(COMS * SEGS);
  clocks = 0;
  private waitAt = -Infinity;

  constructor(rom: Uint8Array, melody: Uint8Array) {
    this.cpu = new Ht1190(rom, melody, { ps: () => ~this.ps & 0xf, pp: () => ~this.pp & 0xf });
  }

  set(key: BrickKey, down: boolean) {
    const [port, bit] = KEYS[key];
    if (port === 'ps') this.ps = down ? this.ps | bit : this.ps & ~bit;
    else this.pp = down ? this.pp | bit : this.pp & ~bit;
    if (key === 'power') this.cpu.setWake(down);
  }

  run(clocks: number, audio?: Float32Array): number {
    let done = 0;
    while (done < clocks) {
      const n = this.cpu.step(audio, done);
      done += n;
      if ((this.cpu.pc & 0xff0) === 0x230) this.waitAt = this.clocks + done;
      this.lcdTick += n;
      if (this.lcdTick >= LCD_EVERY) {
        this.lcdTick -= LCD_EVERY;
        this.lcdSample();
      }
    }
    this.clocks += done;
    return done;
  }

  private lcdSample() {
    for (let c = 0; c < COMS; c++)
      for (let s = 0; s < SEGS; s++) {
        const i = c * SEGS + s;
        if (this.cpu.seg(c, s)) {
          if (this.acc[i] < 4) this.acc[i]++;
        } else if (this.acc[i] > 0) this.acc[i]--;
        this.lit[i] = this.acc[i] >= 2 ? 1 : 0;
      }
  }

  /** Прибор молча выжидает после стартовой мелодии (подпрограмма 0x230–0x23f, ~1340 тиков таймера — 11 с,
   *  и кнопки не слушает): эту паузу можно проматывать. */
  get idleWait(): boolean {
    return this.clocks - this.waitAt < HT_CLOCK / 20 && !this.cpu.sounding;
  }

  save(): HtState {
    return this.cpu.save();
  }

  load(s: HtState) {
    this.cpu.load(s);
  }
}
