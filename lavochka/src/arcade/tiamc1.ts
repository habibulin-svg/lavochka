/* ТИА-МЦ-1 («Терминал», Винница) — по драйверу MAME tiamc1 (Eugene Sandulenko, документация Shiru).
 * КР580ВМ80А на 1,75 МГц, фон из знаков 8×8 (у ТИА-МЦ-1 знакогенератор в ОЗУ, у позднего «Кота-рыболова» — в ПЗУ),
 * 16 спрайтов 16×16, палитра из 16 цветов, звук — два КР580ВИ53 (у «Кота» один, канал 2 прямо на динамик).
 * Кадр 336×312 точек на 5,25 МГц (50 Гц), видно 256×256; прерываний нет — игра сама ждёт кадровый гасящий. */
import { I8080 } from './i8080';
import type { ArcadeMachine, MachineInput } from './machine';

export const TIA_CPU_HZ = 15750000 / 9;
export const TIA_AUDIO_DIV = 16;
const LINES = 312;
const VISIBLE = 256;
const LINE_CYC = TIA_CPU_HZ / (15750000 / 3 / 336); // 112 тактов на строку

export type TiaKind = 'tia' | 'kot' | 'gorodki';

/** Кнопки автомата (общие названия, раскладка по портам — внутри). */
export type TiaInput = MachineInput;

// ---- палитра: напряжения ЦАП, подогнанные Shiru
const PAL = new Uint32Array(256);
{
  const g = [1.2071, 0.9971, 0.9259, 0.7159, 0.4912, 0.2812, 0.21, 0];
  const r = [1.5937, 1.3125, 1.1562, 0.875, 0.7187, 0.4375, 0.2812, 0];
  const b = [1.3523, 0.875, 0.4773, 0];
  for (let c = 0; c < 256; c++) {
    const rr = 255 - (Math.trunc((255 * r[(c >> 3) & 7]) / r[0]) & 255);
    const gg = 255 - (Math.trunc((255 * g[c & 7]) / g[0]) & 255);
    const bb = 255 - (Math.trunc((255 * b[(c >> 6) & 3]) / b[0]) & 255);
    PAL[c] = 0xff000000 | (bb << 16) | (gg << 8) | rr;
  }
}

/** Таймер КР580ВИ53 так, как его упрощённо считает MAME в звуке ТИА-МЦ-1 (режимы 0, 3, 4). */
class TiaTimer {
  count = new Uint16Array(3);
  cnval = new Uint16Array(3);
  cntMode = new Uint8Array(3);
  valMode = new Uint8Array(3);
  gate = new Uint8Array(3);
  out = new Uint8Array(3);
  loadCnt = new Uint8Array(3);
  enable = new Uint8Array(3);

  tick(c: number) {
    if (!this.enable[c] || !this.gate[c]) return;
    const n = (this.count[c] - 1) & 0xffff;
    this.count[c] = n;
    switch (this.cntMode[c]) {
      case 0:
        if (n === 0xffff) this.out[c] = 1;
        break;
      case 3:
        this.out[c] = n < this.cnval[c] >> 1 ? 0 : 1;
        if (n === 0xffff) this.count[c] = this.cnval[c];
        break;
      case 4:
        if (n === 0) this.out[c] = 1;
        if (n === 0xffff) {
          this.enable[c] = 0;
          this.out[c] = 1;
        }
        break;
    }
  }

  private reload(c: number) {
    const v = this.valMode[c];
    this.loadCnt[c] = v === 3 ? 2 : v ? 1 : 0;
  }

  write(reg: number, v: number) {
    if (reg === 3) {
      const c = v >> 6;
      if (c > 2) return;
      this.cntMode[c] = (v >> 1) & 7;
      this.valMode[c] = (v >> 4) & 3;
      this.reload(c);
      if (this.cntMode[c] === 0) {
        this.out[c] = 0;
        this.enable[c] = 0;
      } else if (this.cntMode[c] === 3) this.out[c] = 1;
      else if (this.cntMode[c] === 4) {
        this.out[c] = 1;
        this.enable[c] = 0;
      }
      return;
    }
    const c = reg;
    const vm = this.valMode[c];
    if (vm === 1) this.cnval[c] = (this.cnval[c] & 0xff00) | v;
    else if (vm === 2) this.cnval[c] = (this.cnval[c] & 0xff) | (v << 8);
    else if (vm === 3) this.cnval[c] = (this.cnval[c] >> 8) | (v << 8);
    if (this.cntMode[c] === 0) this.enable[c] = 0;
    if (--this.loadCnt[c] <= 0) {
      this.reload(c);
      this.count[c] = this.cnval[c];
      this.enable[c] = 1;
    }
  }
}

/** Обычный КР580ВИ53 для «Кота-рыболова»: режимы 0–5, чтение счёта с защёлкой. */
class Pit8253 {
  count = new Int32Array(3);
  reload = new Int32Array(3);
  mode = new Uint8Array(3);
  rw = new Uint8Array(3);
  out = new Uint8Array([1, 1, 1]);
  armed = new Uint8Array(3);
  private wLow = new Uint8Array(3);
  private wHi = new Uint8Array(3);
  private latch = new Int32Array([-1, -1, -1]);
  private rHi = new Uint8Array(3);
  private wLowVal = new Uint8Array(3);

  write(reg: number, v: number) {
    if (reg === 3) {
      const c = v >> 6;
      if (c > 2) return;
      const rw = (v >> 4) & 3;
      if (rw === 0) {
        this.latch[c] = this.count[c] & 0xffff;
        return;
      }
      this.rw[c] = rw;
      this.mode[c] = (v >> 1) & 7;
      if (this.mode[c] > 5) this.mode[c] -= 4;
      this.armed[c] = 0;
      this.out[c] = this.mode[c] === 0 ? 0 : 1;
      this.wHi[c] = 0;
      this.rHi[c] = 0;
      return;
    }
    const c = reg;
    let val: number;
    if (this.rw[c] === 1) val = v;
    else if (this.rw[c] === 2) val = v << 8;
    else if (!this.wHi[c]) {
      this.wLowVal[c] = v;
      this.wHi[c] = 1;
      return;
    } else {
      this.wHi[c] = 0;
      val = this.wLowVal[c] | (v << 8);
    }
    this.wLow[c] = 1;
    this.reload[c] = val || 0x10000;
    if (this.mode[c] === 0) this.out[c] = 0;
    if (this.mode[c] === 0 || this.mode[c] === 4 || !this.armed[c]) this.count[c] = this.reload[c];
    this.armed[c] = 1;
  }

  read(reg: number) {
    if (reg === 3) return 0xff;
    const c = reg;
    const v = this.latch[c] >= 0 ? this.latch[c] : this.count[c] & 0xffff;
    if (this.rw[c] === 1) {
      this.latch[c] = -1;
      return v & 0xff;
    }
    if (this.rw[c] === 2) {
      this.latch[c] = -1;
      return v >> 8;
    }
    if (!this.rHi[c]) {
      this.rHi[c] = 1;
      return v & 0xff;
    }
    this.rHi[c] = 0;
    this.latch[c] = -1;
    return v >> 8;
  }

  tick(c: number) {
    if (!this.armed[c]) return;
    const m = this.mode[c];
    if (m === 3) {
      // меандр: половина периода «1», половина «0»
      this.count[c] -= 1;
      if (this.count[c] <= 0) this.count[c] = this.reload[c];
      this.out[c] = this.count[c] > this.reload[c] >> 1 ? 1 : 0;
    } else if (m === 2) {
      this.count[c] -= 1;
      this.out[c] = this.count[c] === 1 ? 0 : 1;
      if (this.count[c] <= 0) this.count[c] = this.reload[c];
    } else {
      this.count[c] = (this.count[c] - 1) & 0xffff;
      if (this.count[c] === 0) this.out[c] = 1;
    }
  }
}

export class TiaMc1 implements ArcadeMachine {
  readonly width = 256;
  readonly height = 256;
  readonly cpuHz = TIA_CPU_HZ;
  readonly audioDiv = TIA_AUDIO_DIV;
  readonly cpu: I8080;
  readonly frame = new Uint32Array(256 * 256);
  private mem = new Uint8Array(0x10000);
  private gfx1: Uint8Array;
  private gfx2: Uint8Array | null;
  // видеопамять как в MAME: карта фона, знакогенератор (4 плоскости), спрайты, палитра
  private tileram: Uint8Array;
  private charram: Uint8Array;
  private spY = new Uint8Array(16);
  private spX = new Uint8Array(16);
  private spN = new Uint8Array(16);
  private spA = new Uint8Array(16);
  private palram = new Uint8Array(16);
  private pens = new Uint32Array(32);
  private layers = 0;
  private vshift = 0;
  private hshift = 0;
  private bplctrl = 0;
  private charBase = 0;
  private ppiC = 0;
  private t0 = new TiaTimer();
  private t1 = new TiaTimer();
  private t1div = 0;
  private pit = new Pit8253();
  private pitFrac = 0;
  private audioAcc = 0;
  private audioN = 0;
  private line = 0;
  private lineCyc = 0;
  private in = new Set<TiaInput>();
  /** Аналоговая ручка «Городков» (96…208). */
  stick = 152;
  /** Счётчик игр (выход порта C, бит 2) — сколько раз автомат «засчитал» монету. */
  games = 0;
  /** Монетоприёмник закрыт (выход порта C, бит 1 = 0) — монету автомат не берёт. */
  get coinLocked() {
    return !(this.ppiC & 0x02);
  }

  constructor(
    img: Uint8Array,
    readonly kind: TiaKind
  ) {
    const kot = kind === 'kot';
    const cpuSize = kot ? 0xc000 : 0xe000;
    this.mem.set(img.subarray(0, cpuSize));
    this.gfx1 = img.slice(cpuSize, cpuSize + 0x8000);
    this.gfx2 = kot ? img.slice(cpuSize + 0x8000, cpuSize + 0x10000) : null;
    this.tileram = new Uint8Array(kot ? 0x400 : 0x800);
    this.charram = kot ? this.gfx2! : new Uint8Array(0x2000);
    this.cpu = new I8080({
      read: (a) => this.mem[a],
      write: (a, v) => this.write(a, v),
      input: (p) => this.input(p),
      output: (p, v) => this.output(p, v),
    });
  }

  reset() {
    this.cpu.reset();
    this.layers = 0;
    this.ppiC = 0;
  }

  set(k: TiaInput, on: boolean) {
    if (on) this.in.add(k);
    else this.in.delete(k);
  }

  private write(a: number, v: number) {
    if (this.kind === 'kot') {
      if (a >= 0xc000 && a < 0xd000) this.mem[a] = v;
      else if (a >= 0xf000 && a < 0xf400 && !(this.layers & 1)) this.tileram[a - 0xf000] = v;
      return;
    }
    if (a >= 0xe000) this.mem[a] = v;
    else if (a >= 0xb000 && a < 0xb800) {
      const o = a - 0xb000;
      const l = this.layers;
      if (!(l & 2)) this.charram[o] = v;
      if (!(l & 4)) this.charram[o + 0x800] = v;
      if (!(l & 8)) this.charram[o + 0x1000] = v;
      if (!(l & 16)) this.charram[o + 0x1800] = v;
      if (!(l & 1)) this.tileram[o] = v;
    }
  }

  private vblank() {
    return this.line >= VISIBLE;
  }

  private port(n: 0 | 1 | 2): number {
    const i = this.in;
    const kot = this.kind === 'kot';
    let v = 0;
    if (n === 0) {
      if (this.kind === 'gorodki') return this.stick & 0xff;
      if (i.has('right')) v |= 0x02;
      if (i.has('left')) v |= 0x20;
      return kot ? ~v & 0xff : v;
    }
    if (n === 1) {
      if (this.kind === 'gorodki') return i.has('service') ? 0x80 : 0;
      if (i.has('up')) v |= 0x02;
      if (i.has('down')) v |= 0x20;
      if (i.has('service')) v |= 0x80;
      return kot ? ~v & 0xff : v;
    }
    // порт C: монета, кнопки, кадровый гасящий; биты 1–2 — выходы (замок монетоприёмника, счётчик)
    v = 0x08 | (this.ppiC & 0x06);
    if (i.has('coin')) v |= 0x10;
    // у «Городков» левая кнопка — 0x40, правая — 0x20; у остальных b1 — 0x20 («удар»), b2 — 0x40 («прыжок»)
    const b1 = this.kind === 'gorodki' ? 0x40 : 0x20;
    const b2 = this.kind === 'gorodki' ? 0x20 : 0x40;
    if (kot) {
      v |= 0x60;
      if (i.has('b1')) v &= ~0x40;
      if (i.has('b2')) v &= ~0x20;
    } else {
      if (i.has('b1')) v |= b1;
      if (i.has('b2')) v |= b2;
    }
    if (this.vblank()) v |= 0x80;
    return v;
  }

  private input(p: number): number {
    if (p >= 0xd0 && p <= 0xd3) return p === 0xd3 ? 0xff : this.port((p - 0xd0) as 0 | 1 | 2);
    if (this.kind === 'kot' && p >= 0xc0 && p <= 0xc3) return this.pit.read(p - 0xc0);
    return 0xff;
  }

  private setPortC(v: number) {
    if (v & 0x04 && !(this.ppiC & 0x04)) this.games++;
    this.ppiC = v;
  }

  private output(p: number, v: number) {
    const kot = this.kind === 'kot';
    if (p >= 0xd0 && p <= 0xd3) {
      if (p === 0xd2) this.setPortC(v);
      else if (p === 0xd3 && !(v & 0x80)) {
        // установка/сброс одного бита порта C
        const bit = (v >> 1) & 7;
        this.setPortC(v & 1 ? this.ppiC | (1 << bit) : this.ppiC & ~(1 << bit));
      }
      return;
    }
    const hi = p & 0xf0;
    const lo = p & 0x0f;
    if (kot) {
      if (hi === 0x00) this.spY[lo] = v;
      else if (hi === 0x10) this.spX[lo] = v;
      else if (hi === 0x20) this.spN[lo] = v;
      else if (hi === 0x30) this.spA[lo] = v;
      else if (hi === 0xe0) this.setPal(lo, v);
      else if (p === 0xf0) this.vshift = v;
      else if (p === 0xf4) this.hshift = v;
      else if (p === 0xf8) {
        this.charBase = (v >> 1) * 0x100;
        this.layers = v;
      } else if (p >= 0xc0 && p <= 0xc3) this.pit.write(p - 0xc0, v);
      return;
    }
    if (hi === 0x40) this.spY[lo] = v;
    else if (hi === 0x50) this.spX[lo] = v;
    else if (hi === 0x60) this.spN[lo] = v;
    else if (hi === 0x70) this.spA[lo] = v;
    else if (hi === 0xa0) this.setPal(lo, v);
    else if (p === 0xbc) this.vshift = v;
    else if (p === 0xbd) this.hshift = v;
    else if (p === 0xbe) this.layers = v;
    else if (p === 0xbf) {
      this.bplctrl = v;
      this.updBg();
    } else if (p >= 0xc0 && p <= 0xc3) this.t0.write(p - 0xc0, v);
    else if (p >= 0xd4 && p <= 0xd7) this.t1.write(p - 0xd4, v);
    else if (p === 0xda) for (let c = 0; c < 3; c++) this.t1.gate[c] = (v >> c) & 1;
  }

  private setPal(i: number, v: number) {
    this.palram[i] = v;
    this.pens[i] = PAL[v];
    this.updBg();
  }

  private updBg() {
    const b = this.bplctrl;
    const mask = (b & 1) | ((b >> 1) & 2) | ((b >> 2) & 4) | ((b >> 3) & 8);
    for (let i = 0; i < 16; i++) this.pens[16 + i] = PAL[this.palram[i | mask]];
  }

  /** Такты звука: выход по схеме MAME (!(o0|o1) & o2 у ТИА-МЦ-1, канал 2 таймера у «Кота»). */
  private sound(n: number, buf: Float32Array | null, at: { i: number }) {
    const kot = this.kind === 'kot';
    for (let k = 0; k < n; k++) {
      let bit: number;
      if (kot) {
        this.pit.tick(2);
        this.pitFrac += 0.75;
        if (this.pitFrac >= 1) {
          this.pitFrac -= 1;
          this.pit.tick(0);
        }
        bit = this.pit.out[2];
        this.audioAcc += bit;
      } else {
        if (++this.t1div === 228) {
          this.t1div = 0;
          for (let c = 0; c < 3; c++) {
            this.t1.tick(c);
            this.t0.gate[c] = this.t1.out[c];
          }
        }
        this.t0.tick(0);
        this.t0.tick(1);
        this.t0.tick(2);
        bit = !(this.t0.out[0] | this.t0.out[1]) && this.t0.out[2] ? 1 : 0;
        this.audioAcc |= bit;
      }
      if (++this.audioN === TIA_AUDIO_DIV) {
        if (buf && at.i < buf.length) buf[at.i++] = kot ? (this.audioAcc / TIA_AUDIO_DIV) * 0.5 : this.audioAcc ? 0.3 : 0;
        this.audioAcc = 0;
        this.audioN = 0;
      }
    }
  }

  /** Прогнать столько тактов; звук — в buf (по сэмплу на TIA_AUDIO_DIV тактов). Возвращает, сколько сэмплов записано. */
  run(cycles: number, buf: Float32Array | null): number {
    const at = { i: 0 };
    let left = cycles;
    while (left > 0) {
      const n = this.cpu.step();
      left -= n;
      this.sound(n, buf, at);
      this.lineCyc += n;
      while (this.lineCyc >= LINE_CYC) {
        this.lineCyc -= LINE_CYC;
        this.line++;
        if (this.line === VISIBLE) this.render();
        if (this.line >= LINES) this.line = 0;
      }
    }
    return at.i;
  }

  private render() {
    const f = this.frame;
    const kot = this.kind === 'kot';
    const tiles = this.tileram;
    const map = !kot && this.layers & 0x80 ? 0x400 : 0;
    const pens = this.pens;
    const po = kot ? 0 : 16;
    const ch = this.charram;
    const cb = kot ? this.charBase : 0;
    const plane = kot ? 0x2000 : 0x800;
    const hs = this.hshift - 4;
    const vs = this.vshift;
    for (let y = 0; y < 256; y++) {
      const ty = (y + vs) & 255;
      const row = (ty >> 3) * 32;
      const fy = ty & 7;
      for (let x = 0; x < 256; x++) {
        const tx = (x + hs) & 255;
        const code = tiles[map + row + (tx >> 3)];
        const o = cb + code * 8 + fy;
        const bit = 7 - (tx & 7);
        const pix =
          (((ch[(o + plane * 3) & 0x7fff] >> bit) & 1) << 3) |
          (((ch[(o + plane * 2) & 0x7fff] >> bit) & 1) << 2) |
          (((ch[(o + plane) & 0x7fff] >> bit) & 1) << 1) |
          ((ch[o & 0x7fff] >> bit) & 1);
        f[y * 256 + x] = pens[po + pix];
      }
    }
    // спрайты: 16 штук, 15 — прозрачный
    const g = this.gfx1;
    for (let s = 0; s < 16; s++) {
      const a = this.spA[s];
      if (a & 1) continue;
      const sx = this.spX[s] ^ 0xff;
      const sy = this.spY[s] ^ 0xff;
      const fx = !(a & 0x08);
      const fy = !(a & 0x02);
      const code = this.spN[s] ^ 0xff;
      for (let yy = 0; yy < 16; yy++) {
        const py = sy + yy;
        if (py > 255) break;
        const ry = fy ? 15 - yy : yy;
        for (let xx = 0; xx < 16; xx++) {
          const px = sx + xx;
          if (px > 255) break;
          const rx = fx ? 15 - xx : xx;
          const o = (rx < 8 ? 0 : 0x1000) + code * 16 + ry;
          const bit = 7 - (rx & 7);
          const pix =
            (((g[o + 0x6000] >> bit) & 1) << 3) |
            (((g[o + 0x4000] >> bit) & 1) << 2) |
            (((g[o + 0x2000] >> bit) & 1) << 1) |
            ((g[o] >> bit) & 1);
          if (pix !== 15) f[py * 256 + px] = pens[pix];
        }
      }
    }
  }
}
