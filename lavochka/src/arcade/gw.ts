/* «Электроника ИМ» как устройство: процессор SM5A + кнопки + ЖК + пищалка. Без DOM.
 * Как в MAME (hh_sm510): R1 — пищалка, R2–R4 — какие строки кнопок опрашиваются (K1–K4);
 * ЖК обновляется 1024 раза в секунду, сегмент загорается/гаснет с задержкой (иначе мерцает сдвиговый регистр). */
import { Sm5a, type Sm5aState } from './sm5a';

export const CLOCK_HZ = 32768;
/** Сегменты: x — группа O (0…8), y — сегмент (0…3), z — общий H1/H2 (0…1). */
export const SEG_COUNT = 9 * 4 * 2;
export const segIndex = (x: number, y: number, z: number) => x * 8 + y * 2 + z;

/** Куда подключена кнопка: строка IN.0…IN.2 (бит), или вывод α (BA) / β (B). */
export type GwPort = 'IN.0' | 'IN.1' | 'IN.2' | 'BA' | 'B';

const DECAY_PIVOT = 8;
const DECAY_LEN = 17;

export interface GwSave {
  cpu: Sm5aState;
  mux: number;
}

export class GwMachine {
  readonly cpu: Sm5a;
  private rows = [0, 0, 0];
  private ba = 0;
  private b = 0;
  private mux = 0;
  private speaker = 0;
  private lcdTick = 0;
  /** Сколько тактов прошло с создания (для «держать кнопку не меньше…»). */
  clocks = 0;
  private state = new Uint8Array(32);
  private decay = new Uint8Array(32 * 4);
  /** Горит ли сегмент (после задержки ЖК). */
  readonly lit = new Uint8Array(SEG_COUNT);

  constructor(
    rom: Uint8Array,
    /** Есть ли кнопки на α / β (иначе там подтяжка — 1). */
    private wired: { ba: boolean; b: boolean }
  ) {
    this.cpu = new Sm5a(rom, {
      k: () => {
        let v = 0;
        for (let i = 0; i < 3; i++) if ((this.mux >> i) & 1) v |= this.rows[i];
        return v;
      },
      ba: () => (this.wired.ba ? this.ba : 1),
      b: () => (this.wired.b ? this.b : 1),
      r: (out) => {
        this.speaker = out & 1;
        this.mux = out >> 1;
      },
    });
  }

  set(port: GwPort, mask: number, down: boolean) {
    if (port === 'BA') this.ba = down ? 1 : 0;
    else if (port === 'B') this.b = down ? 1 : 0;
    else {
      const i = Number(port.slice(3));
      this.rows[i] = down ? this.rows[i] | mask : this.rows[i] & ~mask;
    }
  }

  /** ACL — сброс, как кнопкой на обороте. */
  reset() {
    this.cpu.reset();
  }

  /**
   * Прогнать clocks тактов кварца. audio — куда писать уровень пищалки (по сэмплу на такт), с позиции at;
   * возвращает, сколько тактов прошло на самом деле (команда не режется пополам).
   */
  run(clocks: number, audio?: Float32Array, at = 0): number {
    let done = 0;
    const cpu = this.cpu;
    while (done < clocks) {
      const n = cpu.step() * 2;
      for (let i = 0; i < n; i++) {
        cpu.clock();
        if (audio && at + done + i < audio.length) audio[at + done + i] = this.speaker;
        if (++this.lcdTick >= 32) {
          this.lcdTick = 0;
          this.lcdUpdate();
        }
      }
      done += n;
    }
    this.clocks += done;
    return done;
  }

  /** Перемотать вперёд без экрана и звука (часы, пока страница была закрыта). */
  skip(clocks: number) {
    const cpu = this.cpu;
    let done = 0;
    while (done < clocks) {
      if (cpu.halt && this.cpuK() === 0) {
        // спит до 1S: делитель докручиваем сразу
        const left = Math.min(0x8000 - cpu.div, clocks - done);
        for (let i = 0; i < left; i++) cpu.clock();
        done += left;
        continue;
      }
      const n = cpu.step() * 2;
      for (let i = 0; i < n; i++) cpu.clock();
      done += n;
    }
  }

  private cpuK() {
    let v = 0;
    for (let i = 0; i < 3; i++) if ((this.mux >> i) & 1) v |= this.rows[i];
    return v;
  }

  private lcdUpdate() {
    const cpu = this.cpu;
    const on = cpu.bp & 1;
    for (let o = 0; o < 9; o++) {
      this.state[o << 1] = on ? cpu.o[o] : 0;
      this.state[(o << 1) | 1] = on ? cpu.ox[o] : 0;
    }
    for (let zx = 0; zx < 18; zx++) {
      const s = this.state[zx];
      for (let y = 0; y < 4; y++) {
        const k = zx * 4 + y;
        if ((s >> y) & 1) {
          if (this.decay[k] < DECAY_PIVOT + DECAY_LEN) this.decay[k]++;
        } else if (this.decay[k] > 0) this.decay[k]--;
        this.lit[segIndex(zx >> 1, y, zx & 1)] = this.decay[k] >= DECAY_PIVOT ? 1 : 0;
      }
    }
  }

  save(): GwSave {
    return { cpu: this.cpu.save(), mux: this.mux };
  }

  load(s: GwSave) {
    this.cpu.load(s.cpu);
    this.mux = s.mux & 7;
  }
}
