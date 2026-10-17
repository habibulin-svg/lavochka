/* «Фотон» — автомат на основе ПК-8000 «Сура» (по драйверу MAME photon + pk8000_v, Mariusz Wojcieszek, Miodrag Milanovic).
 * КР580ВМ80А на 1,78 МГц, 64 К ОЗУ, ПЗУ подключается банками через ВВ55 (порт 80h), прерывание RST 7 каждый кадр (50 Гц),
 * видео ПК-8000: текст 32/40 колонок или графика 256×192 со знакогенератором и цветом в ОЗУ, рамка — по 16 точек.
 * Звук — один бит (порт C первого ВВ55, бит 7) на динамик. Ручка в четыре стороны, кнопок нет. */
import { I8080 } from './i8080';
import type { ArcadeMachine, MachineInput } from './machine';

export const PHOTON_CPU_HZ = 1780000;
const FRAME = PHOTON_CPU_HZ / 50;
const AUDIO_DIV = 16;

const PENS = [
  0x000000, 0x000000, 0x00c000, 0x00ff00, 0x0000c0, 0x0000ff, 0x00c0c0, 0x00ffff,
  0xc00000, 0xff0000, 0xc0c000, 0xffff00, 0xc000c0, 0xff00ff, 0xc0c0c0, 0xffffff,
].map((c) => 0xff000000 | ((c & 0xff) << 16) | (c & 0xff00) | (c >> 16));

export class Photon implements ArcadeMachine {
  readonly width = 288;
  readonly height = 224;
  readonly cpuHz = PHOTON_CPU_HZ;
  readonly audioDiv = AUDIO_DIV;
  readonly coinLocked = false;
  readonly cpu: I8080;
  readonly frame = new Uint32Array(288 * 224);
  private rom = new Uint8Array(0x10000);
  private ram = new Uint8Array(0x10000);
  private bank = 0;
  private textStart = 0;
  private chargenStart = 0;
  private videoStart = 0;
  private colorStart = 0;
  private videoMode = 0;
  private videoColor = 0;
  private color = new Uint8Array(32);
  private videoEnable = 0;
  private ppi1C = 0;
  private ppi2C = 0;
  private in = new Set<MachineInput>();
  private frameCyc = 0;
  private irq = false;
  private acc = 0;
  private accN = 0;

  constructor(img: Uint8Array) {
    this.rom.set(img.subarray(0, Math.min(img.length, 0x10000)));
    this.cpu = new I8080({
      read: (a) => ((this.bank >> ((a >> 14) * 2)) & 3) === 3 ? this.ram[a] : this.rom[a],
      write: (a, v) => (this.ram[a] = v),
      input: (p) => this.input(p),
      output: (p, v) => this.output(p, v),
    });
  }

  reset() {
    this.cpu.reset();
    this.bank = 0;
    this.videoEnable = 0;
  }

  set(k: MachineInput, on: boolean) {
    if (on) this.in.add(k);
    else this.in.delete(k);
  }

  private input(p: number): number {
    switch (p) {
      case 0x80: return this.bank;
      case 0x81: return 0xff;
      case 0x82: return this.ppi1C;
      case 0x84: return this.videoMode;
      case 0x86: return this.ppi2C;
      case 0x88: return this.videoColor;
      case 0x8c: {
        const i = this.in;
        return (i.has('up') ? 1 : 0) | (i.has('down') ? 2 : 0) | (i.has('left') ? 4 : 0) | (i.has('right') ? 8 : 0) | (i.has('coin') ? 0x10 : 0);
      }
      case 0x8d: return 0;
      case 0x90: return this.textStart;
      case 0x91: return this.chargenStart;
      case 0x92: return this.videoStart;
      case 0x93: return this.colorStart;
    }
    if (p >= 0xa0 && p <= 0xbf) return this.color[p - 0xa0];
    return 0xff;
  }

  /** Управляющее слово ВВ55: установка режима сбрасывает выходы, иначе — установка/сброс бита порта C. */
  private ctrl(v: number, c: number, setC: (x: number) => void, resetA: () => void) {
    if (v & 0x80) {
      resetA();
      setC(0);
    } else {
      const bit = (v >> 1) & 7;
      setC(v & 1 ? c | (1 << bit) : c & ~(1 << bit));
    }
  }

  private output(p: number, v: number) {
    switch (p) {
      case 0x80: this.bank = v; return;
      case 0x82: this.ppi1C = v; return;
      case 0x83: this.ctrl(v, this.ppi1C, (x) => (this.ppi1C = x), () => (this.bank = 0)); return;
      case 0x84: this.videoMode = v; return;
      case 0x86: this.ppi2C = v; this.videoEnable = (v >> 4) & 1; return;
      case 0x87:
        this.ctrl(v, this.ppi2C, (x) => {
          this.ppi2C = x;
          this.videoEnable = (x >> 4) & 1;
        }, () => (this.videoMode = 0));
        return;
      case 0x88: this.videoColor = v; return;
      case 0x90: this.textStart = v; return;
      case 0x91: this.chargenStart = v; return;
      case 0x92: this.videoStart = v; return;
      case 0x93: this.colorStart = v; return;
    }
    if (p >= 0xa0 && p <= 0xbf) this.color[p - 0xa0] = v;
  }

  run(cycles: number, buf: Float32Array | null): number {
    let out = 0;
    let left = cycles;
    while (left > 0) {
      if (this.irq && this.cpu.interrupt(0xff)) this.irq = false;
      const n = this.cpu.step();
      left -= n;
      const lvl = this.ppi1C >> 7;
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
      if (this.frameCyc >= FRAME) {
        this.frameCyc -= FRAME;
        this.render();
        this.irq = true;
      }
    }
    return out;
  }

  private render() {
    const f = this.frame;
    const W = 288;
    const mem = this.ram;
    const off = (this.videoMode & 0xc0) << 8;
    const px = (x: number, y: number, c: number) => (f[y * W + x] = PENS[c & 15]);
    if (!this.videoEnable) {
      f.fill(PENS[0]);
      return;
    }
    f.fill(PENS[(this.videoColor >> 4) & 15]);
    const cg = ((this.chargenStart & 0x0e) << 10) + off;
    if (!(this.videoMode & 0x10)) {
      if (!(this.videoMode & 0x20)) {
        const ts = ((this.textStart & 0x0f) << 10) + off;
        for (let y = 0; y < 24; y++)
          for (let x = 0; x < 32; x++) {
            const chr = mem[(x + y * 32 + ts) & 0xffff];
            const color = this.color[chr >> 3];
            for (let j = 0; j < 8; j++) {
              const code = mem[((chr << 3) + j + cg) & 0xffff];
              for (let b = 0; b < 8; b++) px(x * 8 + (7 - b) + 16, y * 8 + j + 16, (code >> b) & 1 ? color : color >> 4);
            }
          }
      } else {
        const ts = ((this.textStart & 0x0e) << 10) + off;
        const vc = this.videoColor;
        for (let y = 0; y < 24; y++)
          for (let x = 0; x < 42; x++) {
            const chr = mem[(x + y * 64 + ts) & 0xffff];
            for (let j = 0; j < 8; j++) {
              const code = mem[((chr << 3) + j + cg) & 0xffff];
              for (let b = 2; b < 8; b++) {
                const xx = x * 6 + (7 - b) + 16 + 8;
                if (xx < W) px(xx, y * 8 + j + 16, (code >> b) & 1 ? vc : vc >> 4);
              }
            }
          }
      }
      return;
    }
    // графика: номер «знака» — из таблицы, рисунок и цвет — по трети экрана (как у MSX)
    for (let y = 0; y < 24; y++) {
      const oc = ((~this.colorStart & 0x08) << 10) + off + ((y >> 3) << 11);
      const ov = ((~this.videoStart & 0x08) << 10) + off + ((y >> 3) << 11);
      for (let x = 0; x < 32; x++) {
        const chr = mem[(x + y * 32 + cg) & 0xffff];
        for (let j = 0; j < 8; j++) {
          const color = mem[((chr << 3) + j + oc) & 0xffff];
          const code = mem[((chr << 3) + j + ov) & 0xffff];
          for (let b = 0; b < 8; b++) px(x * 8 + (7 - b) + 16, y * 8 + j + 16, (code >> b) & 1 ? color : color >> 4);
        }
      }
    }
  }
}
