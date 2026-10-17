/* «Фотон ИК-2/ИК-3» — автомат на клоне «Спектрума» «Ленинград-1» (по драйверу MAME photon2, Mariusz Wojcieszek).
 * Z80 на 3,5 МГц, ПЗУ 16 К переключается банками (0, 1, 5 → банки 0, 1, 2), ОЗУ 48 К с экраном «Спектрума» с 4000h.
 * Порты по линиям A7/A0: 00 — банк ПЗУ, 01 — ВВ55 (A5–A6 выбирают порт: A — ручка, C — монета и время на монету,
 * выходы C: бит 5 — запрет NMI), 10 — порт FEh (рамка, бит 4 — пищалка). Прерывание — посреди кадра, NMI — в начале.
 * Каждая монета покупает время игры (переключатели «Time per Coin»; ставим 6 минут, как в MAME по умолчанию). */
import type { ArcadeMachine, MachineInput } from './machine';
import { Z80 } from './z80';

export const P2_CPU_HZ = 3500000;
const FRAME = 69888;
const AUDIO_DIV = 32;
/** Видимая часть: рамка обрезана до 32 точек по бокам и 24 строк сверху и снизу. */
const BL = 32;
const BT = 24;
const W = 256 + BL * 2;
const H = 192 + BT * 2;

const PAL = [
  0x000000, 0x0000bf, 0xbf0000, 0xbf00bf, 0x00bf00, 0x00bfbf, 0xbfbf00, 0xbfbfbf,
  0x000000, 0x0000ff, 0xff0000, 0xff00ff, 0x00ff00, 0x00ffff, 0xffff00, 0xffffff,
].map((c) => 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | (c >> 16));

export class Photon2 implements ArcadeMachine {
  readonly width = W;
  readonly height = H;
  readonly cpuHz = P2_CPU_HZ;
  readonly audioDiv = AUDIO_DIV;
  readonly coinLocked = false;
  readonly cpu: Z80;
  readonly frame = new Uint32Array(W * H);
  private rom: Uint8Array;
  private ram = new Uint8Array(0x10000);
  private bank = 0;
  private fe = 0;
  private ppiC = 0;
  private nmiOn = true;
  private in = new Set<MachineInput>();
  private frameCyc = 0;
  private irq = false;
  private irqDone = false;
  private flashN = 0;
  private flash = false;
  private acc = 0;
  private accN = 0;

  constructor(img: Uint8Array) {
    this.rom = new Uint8Array(0x10000);
    this.rom.set(img.subarray(0, Math.min(img.length, 0x10000)));
    this.cpu = new Z80({
      read: (a) => (a < 0x4000 ? this.rom[this.bank * 0x4000 + a] : this.ram[a]),
      write: (a, v) => {
        if (a >= 0x4000) this.ram[a] = v;
      },
      input: (p) => this.input(p & 0xff),
      output: (p, v) => this.output(p & 0xff, v),
    });
  }

  reset() {
    this.cpu.reset();
    this.bank = 0;
    this.nmiOn = true;
  }

  set(k: MachineInput, on: boolean) {
    if (on) this.in.add(k);
    else this.in.delete(k);
  }

  private input(p: number): number {
    const sel = p & 0x81;
    if (sel === 0x01) {
      const port = (p >> 5) & 3;
      if (port === 0) {
        // раскладка «Чёрного корабля» и «Бродяги»: влево, вправо, вверх, вниз, огонь — активный ноль
        const i = this.in;
        const v = (i.has('left') ? 1 : 0) | (i.has('right') ? 2 : 0) | (i.has('up') ? 4 : 0) | (i.has('down') ? 8 : 0) | (i.has('b1') ? 0x10 : 0);
        return ~v & 0xff;
      }
      if (port === 1) return 0xff;
      if (port === 2) return (this.ppiC & 0xf0) | 0x0e | (this.in.has('coin') ? 1 : 0);
      return 0xff;
    }
    return 0xff;
  }

  private setC(v: number) {
    this.ppiC = v & 0xff;
    this.nmiOn = !(v & 0x20);
  }

  private output(p: number, v: number) {
    const sel = p & 0x81;
    if (sel === 0x00) {
      this.bank = v === 1 ? 1 : v === 5 ? 2 : 0;
    } else if (sel === 0x01) {
      const port = (p >> 5) & 3;
      if (port === 2) this.setC(v);
      else if (port === 3) {
        if (v & 0x80) this.setC(0);
        else {
          const bit = (v >> 1) & 7;
          this.setC(v & 1 ? this.ppiC | (1 << bit) : this.ppiC & ~(1 << bit));
        }
      }
    } else if (sel === 0x80) this.fe = v;
  }

  run(cycles: number, buf: Float32Array | null): number {
    let out = 0;
    let left = cycles;
    const cpu = this.cpu;
    while (left > 0) {
      if (this.irq && cpu.interrupt(0xff)) this.irq = false;
      const before = cpu.cycles;
      cpu.step();
      const n = cpu.cycles - before;
      left -= n;
      const lvl = (this.fe >> 4) & 1;
      let k = n;
      while (k > 0) {
        const take = Math.min(k, AUDIO_DIV - this.accN);
        this.acc += lvl * take;
        this.accN += take;
        k -= take;
        if (this.accN === AUDIO_DIV) {
          if (buf && out < buf.length) buf[out++] = (this.acc / AUDIO_DIV) * 0.5;
          this.acc = 0;
          this.accN = 0;
        }
      }
      this.frameCyc += n;
      if (!this.irqDone && this.frameCyc >= FRAME / 2) {
        this.irqDone = true;
        this.irq = true;
      }
      if (this.frameCyc >= FRAME) {
        this.frameCyc -= FRAME;
        this.irqDone = false;
        this.render();
        if (this.nmiOn) cpu.nmi();
      }
    }
    return out;
  }

  private render() {
    if (++this.flashN >= 25) {
      this.flashN = 0;
      this.flash = !this.flash;
    }
    const f = this.frame;
    f.fill(PAL[this.fe & 7]);
    const m = this.ram;
    for (let y = 0; y < 192; y++) {
      const addr = 0x4000 | ((y & 0xc0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
      const at = 0x5800 + (y >> 3) * 32;
      const row = (y + BT) * W + BL;
      for (let x = 0; x < 32; x++) {
        const a = m[at + x];
        let ink = (a & 7) | ((a >> 3) & 8);
        let pap = (a >> 3) & 15;
        if (this.flash && a & 0x80) {
          const t = ink;
          ink = pap;
          pap = t;
        }
        const bits = m[addr + x];
        for (let b = 0; b < 8; b++) f[row + x * 8 + b] = PAL[bits & (0x80 >> b) ? ink : pap];
      }
    }
  }
}
