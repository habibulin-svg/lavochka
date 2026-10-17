/* Z80 (Т34ВМ1 / КР1858ВМ1) — процессор «Фотона ИК-2» (клон «Спектрума»). Полный набор команд с префиксами CB, ED,
 * DD/FD и DDCB/FDCB, недокументированные IXH/IXL и флаги X/Y, регистр R (игры берут из него случайность),
 * прерывания IM 0/1/2 и NMI, задержка после EI. Такты — по справочнику. Проверяется тестом ZEXDOC (tools/avtomaty/cputest.ts). */

export interface BusZ80 {
  read(a: number): number;
  write(a: number, v: number): void;
  input(port: number): number;
  output(port: number, v: number): void;
}

const FC = 0x01, FN = 0x02, FP = 0x04, FX = 0x08, FH = 0x10, FY = 0x20, FZ = 0x40, FS = 0x80;

/** S, Z, X, Y по результату. */
const SZ = new Uint8Array(256);
/** S, Z, X, Y и чётность. */
const SZP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  SZ[i] = (i & (FS | FX | FY)) | (i === 0 ? FZ : 0);
  let p = 0;
  for (let b = i; b; b >>= 1) p ^= b & 1;
  SZP[i] = SZ[i] | (p ? 0 : FP);
}

export class Z80 {
  a = 0xff;
  f = 0xff;
  b = 0;
  c = 0;
  d = 0;
  e = 0;
  h = 0;
  l = 0;
  a2 = 0;
  f2 = 0;
  b2 = 0;
  c2 = 0;
  d2 = 0;
  e2 = 0;
  h2 = 0;
  l2 = 0;
  ix = 0xffff;
  iy = 0xffff;
  sp = 0xffff;
  pc = 0;
  i = 0;
  r = 0;
  iff1 = false;
  iff2 = false;
  im = 0;
  halted = false;
  cycles = 0;
  private eiWait = false;
  /** Режим индексного префикса текущей команды: 0 — HL, 1 — IX, 2 — IY. */
  private idx = 0;
  /** Адрес (IX+d) текущей команды. */
  private ea = 0;

  constructor(private bus: BusZ80) {}

  reset() {
    this.pc = 0;
    this.iff1 = this.iff2 = false;
    this.im = 0;
    this.i = 0;
    this.r = 0;
    this.halted = false;
    this.eiWait = false;
  }

  // ---- память и стек
  private rd(a: number) {
    return this.bus.read(a & 0xffff);
  }
  private wr(a: number, v: number) {
    this.bus.write(a & 0xffff, v & 0xff);
  }
  private n8() {
    const v = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }
  private n16() {
    const lo = this.n8();
    return lo | (this.n8() << 8);
  }
  private d8() {
    const v = this.n8();
    return v < 128 ? v : v - 256;
  }
  private push(v: number) {
    this.sp = (this.sp - 1) & 0xffff;
    this.bus.write(this.sp, (v >> 8) & 0xff);
    this.sp = (this.sp - 1) & 0xffff;
    this.bus.write(this.sp, v & 0xff);
  }
  private pop() {
    const lo = this.bus.read(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    const hi = this.bus.read(this.sp);
    this.sp = (this.sp + 1) & 0xffff;
    return lo | (hi << 8);
  }
  private incR() {
    this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f);
  }

  // ---- пары регистров
  get bc() {
    return (this.b << 8) | this.c;
  }
  set bc(v) {
    this.b = (v >> 8) & 0xff;
    this.c = v & 0xff;
  }
  get de() {
    return (this.d << 8) | this.e;
  }
  set de(v) {
    this.d = (v >> 8) & 0xff;
    this.e = v & 0xff;
  }
  get hl() {
    return (this.h << 8) | this.l;
  }
  set hl(v) {
    this.h = (v >> 8) & 0xff;
    this.l = v & 0xff;
  }
  /** HL / IX / IY — по префиксу. */
  private get xy() {
    return this.idx === 0 ? this.hl : this.idx === 1 ? this.ix : this.iy;
  }
  private set xy(v) {
    v &= 0xffff;
    if (this.idx === 0) this.hl = v;
    else if (this.idx === 1) this.ix = v;
    else this.iy = v;
  }
  private getRp(p: number) {
    return p === 0 ? this.bc : p === 1 ? this.de : p === 2 ? this.xy : this.sp;
  }
  private setRp(p: number, v: number) {
    v &= 0xffff;
    if (p === 0) this.bc = v;
    else if (p === 1) this.de = v;
    else if (p === 2) this.xy = v;
    else this.sp = v;
  }
  private getRp2(p: number) {
    return p === 3 ? (this.a << 8) | this.f : this.getRp(p);
  }
  private setRp2(p: number, v: number) {
    if (p === 3) {
      this.a = (v >> 8) & 0xff;
      this.f = v & 0xff;
    } else this.setRp(p, v);
  }

  /** Регистр по номеру (0 B, 1 C, 2 D, 3 E, 4 H, 5 L, 6 (HL)/(IX+d), 7 A). useIdx — H/L заменяются на IXH/IXL. */
  private getR(n: number, useIdx = true): number {
    switch (n) {
      case 0: return this.b;
      case 1: return this.c;
      case 2: return this.d;
      case 3: return this.e;
      case 4: return useIdx && this.idx ? (this.idx === 1 ? this.ix >> 8 : this.iy >> 8) : this.h;
      case 5: return useIdx && this.idx ? (this.idx === 1 ? this.ix & 0xff : this.iy & 0xff) : this.l;
      case 6: return this.rd(this.idx ? this.ea : this.hl);
      default: return this.a;
    }
  }
  private setR(n: number, v: number, useIdx = true) {
    v &= 0xff;
    switch (n) {
      case 0: this.b = v; break;
      case 1: this.c = v; break;
      case 2: this.d = v; break;
      case 3: this.e = v; break;
      case 4:
        if (useIdx && this.idx === 1) this.ix = (this.ix & 0xff) | (v << 8);
        else if (useIdx && this.idx === 2) this.iy = (this.iy & 0xff) | (v << 8);
        else this.h = v;
        break;
      case 5:
        if (useIdx && this.idx === 1) this.ix = (this.ix & 0xff00) | v;
        else if (useIdx && this.idx === 2) this.iy = (this.iy & 0xff00) | v;
        else this.l = v;
        break;
      case 6: this.wr(this.idx ? this.ea : this.hl, v); break;
      default: this.a = v;
    }
  }
  /** Перед обращением к (IX+d) — прочитать смещение. Возвращает доп. такты. */
  private prepM(n: number): number {
    if (n !== 6 || !this.idx) return 0;
    this.ea = ((this.idx === 1 ? this.ix : this.iy) + this.d8()) & 0xffff;
    return 8;
  }

  private cond(y: number) {
    const f = this.f;
    switch (y) {
      case 0: return !(f & FZ);
      case 1: return !!(f & FZ);
      case 2: return !(f & FC);
      case 3: return !!(f & FC);
      case 4: return !(f & FP);
      case 5: return !!(f & FP);
      case 6: return !(f & FS);
      default: return !!(f & FS);
    }
  }

  // ---- арифметика
  private alu(y: number, v: number) {
    const a = this.a;
    let r: number;
    switch (y) {
      case 0:
      case 1: {
        r = a + v + (y === 1 ? this.f & FC : 0);
        this.f = SZ[r & 0xff] | ((r >> 8) & FC) | ((a ^ v ^ r) & FH) | (((a ^ ~v) & (a ^ r) & 0x80) >> 5);
        this.a = r & 0xff;
        return;
      }
      case 2:
      case 3:
      case 7: {
        r = a - v - (y === 3 ? this.f & FC : 0);
        const f = FN | ((r >> 8) & FC) | ((a ^ v ^ r) & FH) | (((a ^ v) & (a ^ r) & 0x80) >> 5);
        if (y === 7) this.f = f | (SZ[r & 0xff] & ~(FX | FY)) | (v & (FX | FY));
        else {
          this.f = f | SZ[r & 0xff];
          this.a = r & 0xff;
        }
        return;
      }
      case 4:
        this.a = a & v;
        this.f = SZP[this.a] | FH;
        return;
      case 5:
        this.a = a ^ v;
        this.f = SZP[this.a];
        return;
      default:
        this.a = a | v;
        this.f = SZP[this.a];
    }
  }
  private inc8(v: number) {
    const r = (v + 1) & 0xff;
    this.f = (this.f & FC) | SZ[r] | ((r & 0x0f) === 0 ? FH : 0) | (r === 0x80 ? FP : 0);
    return r;
  }
  private dec8(v: number) {
    const r = (v - 1) & 0xff;
    this.f = (this.f & FC) | FN | SZ[r] | ((v & 0x0f) === 0 ? FH : 0) | (v === 0x80 ? FP : 0);
    return r;
  }
  private add16(x: number, v: number) {
    const r = x + v;
    this.f = (this.f & (FS | FZ | FP)) | ((r >> 16) & FC) | (((x ^ v ^ r) >> 8) & FH) | ((r >> 8) & (FX | FY));
    return r & 0xffff;
  }
  private adc16(v: number) {
    const x = this.hl;
    const r = x + v + (this.f & FC);
    this.f = ((r >> 16) & FC) | (((x ^ v ^ r) >> 8) & FH) | ((~(x ^ v) & (x ^ r) & 0x8000) >> 13) | ((r >> 8) & (FS | FX | FY)) | ((r & 0xffff) === 0 ? FZ : 0);
    this.hl = r & 0xffff;
  }
  private sbc16(v: number) {
    const x = this.hl;
    const r = x - v - (this.f & FC);
    this.f = FN | ((r >> 16) & FC) | (((x ^ v ^ r) >> 8) & FH) | (((x ^ v) & (x ^ r) & 0x8000) >> 13) | ((r >> 8) & (FS | FX | FY)) | ((r & 0xffff) === 0 ? FZ : 0);
    this.hl = r & 0xffff;
  }
  /** Сдвиги CB: 0 RLC, 1 RRC, 2 RL, 3 RR, 4 SLA, 5 SRA, 6 SLL, 7 SRL. */
  private rot(y: number, v: number) {
    let r: number, c: number;
    switch (y) {
      case 0: c = v >> 7; r = ((v << 1) | c) & 0xff; break;
      case 1: c = v & 1; r = (v >> 1) | (c << 7); break;
      case 2: c = v >> 7; r = ((v << 1) | (this.f & FC)) & 0xff; break;
      case 3: c = v & 1; r = (v >> 1) | ((this.f & FC) << 7); break;
      case 4: c = v >> 7; r = (v << 1) & 0xff; break;
      case 5: c = v & 1; r = (v >> 1) | (v & 0x80); break;
      case 6: c = v >> 7; r = ((v << 1) | 1) & 0xff; break;
      default: c = v & 1; r = v >> 1;
    }
    this.f = SZP[r] | c;
    return r;
  }

  /** Прерывание (IM 0/1/2); bus — байт на шине (IM 0: команда, IM 2: младший байт вектора). */
  interrupt(bus = 0xff): boolean {
    if (!this.iff1 || this.eiWait) return false;
    this.halted = false;
    this.iff1 = this.iff2 = false;
    this.incR();
    if (this.im === 2) {
      this.push(this.pc);
      const v = (this.i << 8) | bus;
      this.pc = this.rd(v) | (this.rd(v + 1) << 8);
      this.cycles += 19;
    } else {
      // IM 1 и IM 0 с RST 38h на шине
      this.push(this.pc);
      this.pc = this.im === 1 ? 0x38 : bus & 0x38;
      this.cycles += 13;
    }
    return true;
  }

  nmi() {
    this.halted = false;
    this.iff2 = this.iff1;
    this.iff1 = false;
    this.incR();
    this.push(this.pc);
    this.pc = 0x66;
    this.cycles += 11;
  }

  step(): number {
    this.eiWait = false;
    if (this.halted) {
      this.incR();
      this.cycles += 4;
      return 4;
    }
    this.idx = 0;
    let cyc = 0;
    let op = this.n8();
    this.incR();
    // префиксы DD/FD (подряд — действует последний)
    while (op === 0xdd || op === 0xfd) {
      this.idx = op === 0xdd ? 1 : 2;
      cyc += 4;
      op = this.n8();
      this.incR();
    }
    if (op === 0xcb) cyc += this.execCB();
    else if (op === 0xed) {
      this.idx = 0;
      cyc += this.execED();
    } else cyc += this.exec(op);
    this.cycles += cyc;
    return cyc;
  }

  private exec(op: number): number {
    const x = op >> 6;
    const y = (op >> 3) & 7;
    const z = op & 7;
    const p = y >> 1;
    const q = y & 1;
    if (x === 1) {
      if (op === 0x76) {
        this.halted = true;
        return 4;
      }
      // LD r,r': при (IX+d) другой операнд — настоящие H/L
      const extra = this.prepM(y) + this.prepM(z);
      const useIdx = y !== 6 && z !== 6;
      this.setR(y, this.getR(z, useIdx), useIdx);
      return y === 6 || z === 6 ? 7 + extra : 4;
    }
    if (x === 2) {
      const extra = this.prepM(z);
      this.alu(y, this.getR(z));
      return z === 6 ? 7 + extra : 4;
    }
    if (x === 0) {
      switch (z) {
        case 0:
          switch (y) {
            case 0: return 4;
            case 1: {
              let t = this.a; this.a = this.a2; this.a2 = t;
              t = this.f; this.f = this.f2; this.f2 = t;
              return 4;
            }
            case 2: {
              const d = this.d8();
              this.b = (this.b - 1) & 0xff;
              if (this.b) {
                this.pc = (this.pc + d) & 0xffff;
                return 13;
              }
              return 8;
            }
            case 3: {
              const d = this.d8();
              this.pc = (this.pc + d) & 0xffff;
              return 12;
            }
            default: {
              const d = this.d8();
              if (this.cond(y - 4)) {
                this.pc = (this.pc + d) & 0xffff;
                return 12;
              }
              return 7;
            }
          }
        case 1:
          if (!q) {
            this.setRp(p, this.n16());
            return 10;
          }
          this.xy = this.add16(this.xy, this.getRp(p));
          return 11;
        case 2:
          switch (y) {
            case 0: this.wr(this.bc, this.a); return 7;
            case 1: this.a = this.rd(this.bc); return 7;
            case 2: this.wr(this.de, this.a); return 7;
            case 3: this.a = this.rd(this.de); return 7;
            case 4: {
              const a = this.n16();
              const v = this.xy;
              this.wr(a, v & 0xff);
              this.wr(a + 1, v >> 8);
              return 16;
            }
            case 5: {
              const a = this.n16();
              this.xy = this.rd(a) | (this.rd(a + 1) << 8);
              return 16;
            }
            case 6: this.wr(this.n16(), this.a); return 13;
            default: this.a = this.rd(this.n16()); return 13;
          }
        case 3:
          this.setRp(p, this.getRp(p) + (q ? -1 : 1));
          return 6;
        case 4: {
          const extra = this.prepM(y);
          this.setR(y, this.inc8(this.getR(y)));
          return y === 6 ? 11 + extra : 4;
        }
        case 5: {
          const extra = this.prepM(y);
          this.setR(y, this.dec8(this.getR(y)));
          return y === 6 ? 11 + extra : 4;
        }
        case 6: {
          const extra = this.prepM(y) ? 5 : 0;
          this.setR(y, this.n8());
          return y === 6 ? 10 + extra : 7;
        }
        default: {
          const a = this.a;
          const keep = this.f & (FS | FZ | FP);
          switch (y) {
            case 0: this.a = ((a << 1) | (a >> 7)) & 0xff; this.f = keep | (this.a & (FX | FY)) | (a >> 7); break;
            case 1: this.a = (a >> 1) | ((a & 1) << 7); this.f = keep | (this.a & (FX | FY)) | (a & 1); break;
            case 2: this.a = ((a << 1) | (this.f & FC)) & 0xff; this.f = keep | (this.a & (FX | FY)) | (a >> 7); break;
            case 3: this.a = (a >> 1) | ((this.f & FC) << 7); this.f = keep | (this.a & (FX | FY)) | (a & 1); break;
            case 4: {
              const c = this.f & FC, h = this.f & FH, n = this.f & FN;
              let diff = 0;
              let co = c;
              if (h || (a & 0x0f) > 9) diff |= 0x06;
              if (c || a > 0x99) {
                diff |= 0x60;
                co = FC;
              }
              const r = (n ? a - diff : a + diff) & 0xff;
              const hf = n ? (h && (a & 0x0f) < 6 ? FH : 0) : (a & 0x0f) > 9 ? FH : 0;
              this.a = r;
              this.f = SZP[r] | n | co | hf;
              break;
            }
            case 5: this.a = ~a & 0xff; this.f = (this.f & (FS | FZ | FP | FC)) | FH | FN | (this.a & (FX | FY)); break;
            case 6: this.f = keep | FC | (a & (FX | FY)); break;
            default: this.f = keep | (this.f & FC ? FH : FC) | (a & (FX | FY));
          }
          return 4;
        }
      }
    }
    // x === 3
    switch (z) {
      case 0:
        if (this.cond(y)) {
          this.pc = this.pop();
          return 11;
        }
        return 5;
      case 1:
        if (!q) {
          this.setRp2(p, this.pop());
          return 10;
        }
        switch (p) {
          case 0: this.pc = this.pop(); return 10;
          case 1: {
            let t = this.b; this.b = this.b2; this.b2 = t;
            t = this.c; this.c = this.c2; this.c2 = t;
            t = this.d; this.d = this.d2; this.d2 = t;
            t = this.e; this.e = this.e2; this.e2 = t;
            t = this.h; this.h = this.h2; this.h2 = t;
            t = this.l; this.l = this.l2; this.l2 = t;
            return 4;
          }
          case 2: this.pc = this.xy; return 4;
          default: this.sp = this.xy; return 6;
        }
      case 2: {
        const a = this.n16();
        if (this.cond(y)) this.pc = a;
        return 10;
      }
      case 3:
        switch (y) {
          case 0: this.pc = this.n16(); return 10;
          case 2: this.bus.output((this.a << 8) | this.n8(), this.a); return 11;
          case 3: this.a = this.bus.input((this.a << 8) | this.n8()) & 0xff; return 11;
          case 4: {
            const v = this.rd(this.sp) | (this.rd(this.sp + 1) << 8);
            const xy = this.xy;
            this.wr(this.sp, xy & 0xff);
            this.wr(this.sp + 1, xy >> 8);
            this.xy = v;
            return 19;
          }
          case 5: {
            const t = this.de;
            this.de = this.hl;
            this.hl = t;
            return 4;
          }
          case 6: this.iff1 = this.iff2 = false; return 4;
          case 7:
            this.iff1 = this.iff2 = true;
            this.eiWait = true;
            return 4;
          default: return 4; // CB — разобран выше
        }
      case 4: {
        const a = this.n16();
        if (this.cond(y)) {
          this.push(this.pc);
          this.pc = a;
          return 17;
        }
        return 10;
      }
      case 5:
        if (!q) {
          this.push(this.getRp2(p));
          return 11;
        }
        if (p === 0) {
          const a = this.n16();
          this.push(this.pc);
          this.pc = a;
          return 17;
        }
        return 4; // DD/ED/FD — разобраны выше
      case 6:
        this.alu(y, this.n8());
        return 7;
      default:
        this.push(this.pc);
        this.pc = y * 8;
        return 11;
    }
  }

  private execCB(): number {
    if (this.idx) {
      // DDCB d op: всегда над (IX+d), результат (кроме BIT) ещё и в регистр z
      this.ea = ((this.idx === 1 ? this.ix : this.iy) + this.d8()) & 0xffff;
      const op = this.n8();
      const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
      const v = this.rd(this.ea);
      if (x === 1) {
        const bit = v & (1 << y);
        this.f = (this.f & FC) | FH | (bit ? 0 : FZ | FP) | (bit & FS) | ((this.ea >> 8) & (FX | FY));
        return 16;
      }
      const r = x === 0 ? this.rot(y, v) : x === 2 ? v & ~(1 << y) : v | (1 << y);
      this.wr(this.ea, r);
      if (z !== 6) this.setR(z, r, false);
      return 19;
    }
    const op = this.n8();
    this.incR();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    const v = this.getR(z);
    if (x === 1) {
      const bit = v & (1 << y);
      this.f = (this.f & FC) | FH | (bit ? 0 : FZ | FP) | (bit & FS) | (z === 6 ? this.f & (FX | FY) : v & (FX | FY));
      return z === 6 ? 12 : 8;
    }
    const r = x === 0 ? this.rot(y, v) : x === 2 ? v & ~(1 << y) : v | (1 << y);
    this.setR(z, r);
    return z === 6 ? 15 : 8;
  }

  private execED(): number {
    const op = this.n8();
    this.incR();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    if (x === 1) {
      switch (z) {
        case 0: {
          const v = this.bus.input(this.bc) & 0xff;
          if (y !== 6) this.setR(y, v);
          this.f = (this.f & FC) | SZP[v];
          return 12;
        }
        case 1:
          this.bus.output(this.bc, y === 6 ? 0 : this.getR(y));
          return 12;
        case 2:
          if (q) this.adc16(this.getRp(p));
          else this.sbc16(this.getRp(p));
          return 15;
        case 3: {
          const a = this.n16();
          if (q) this.setRp(p, this.rd(a) | (this.rd(a + 1) << 8));
          else {
            const v = this.getRp(p);
            this.wr(a, v & 0xff);
            this.wr(a + 1, v >> 8);
          }
          return 20;
        }
        case 4: {
          const v = this.a;
          this.a = 0;
          this.alu(2, v);
          return 8;
        }
        case 5:
          this.iff1 = this.iff2;
          this.pc = this.pop();
          return 14;
        case 6:
          this.im = [0, 0, 1, 2][y & 3];
          return 8;
        default:
          switch (y) {
            case 0: this.i = this.a; return 9;
            case 1: this.r = this.a; return 9;
            case 2:
              this.a = this.i;
              this.f = (this.f & FC) | SZ[this.a] | (this.iff2 ? FP : 0);
              return 9;
            case 3:
              this.a = this.r;
              this.f = (this.f & FC) | SZ[this.a] | (this.iff2 ? FP : 0);
              return 9;
            case 4: {
              const m = this.rd(this.hl);
              this.wr(this.hl, (this.a << 4) | (m >> 4));
              this.a = (this.a & 0xf0) | (m & 0x0f);
              this.f = (this.f & FC) | SZP[this.a];
              return 18;
            }
            case 5: {
              const m = this.rd(this.hl);
              this.wr(this.hl, (m << 4) | (this.a & 0x0f));
              this.a = (this.a & 0xf0) | (m >> 4);
              this.f = (this.f & FC) | SZP[this.a];
              return 18;
            }
            default: return 8;
          }
      }
    }
    if (x === 2 && y >= 4 && z <= 3) {
      const dec = y & 1;
      const rep = y >= 6;
      const step = dec ? -1 : 1;
      switch (z) {
        case 0: {
          const v = this.rd(this.hl);
          this.wr(this.de, v);
          this.hl = (this.hl + step) & 0xffff;
          this.de = (this.de + step) & 0xffff;
          this.bc = (this.bc - 1) & 0xffff;
          const n = v + this.a;
          this.f = (this.f & (FS | FZ | FC)) | (this.bc ? FP : 0) | (n & FX) | ((n << 4) & FY);
          if (rep && this.bc) {
            this.pc = (this.pc - 2) & 0xffff;
            return 21;
          }
          return 16;
        }
        case 1: {
          const v = this.rd(this.hl);
          const r = (this.a - v) & 0xff;
          this.hl = (this.hl + step) & 0xffff;
          this.bc = (this.bc - 1) & 0xffff;
          const hf = (this.a ^ v ^ r) & FH;
          const n = r - (hf ? 1 : 0);
          this.f = (this.f & FC) | FN | (SZ[r] & ~(FX | FY)) | hf | (this.bc ? FP : 0) | (n & FX) | ((n << 4) & FY);
          if (rep && this.bc && r !== 0) {
            this.pc = (this.pc - 2) & 0xffff;
            return 21;
          }
          return 16;
        }
        case 2: {
          const v = this.bus.input(this.bc) & 0xff;
          this.wr(this.hl, v);
          this.hl = (this.hl + step) & 0xffff;
          this.b = (this.b - 1) & 0xff;
          this.f = SZ[this.b] | FN;
          if (rep && this.b) {
            this.pc = (this.pc - 2) & 0xffff;
            return 21;
          }
          return 16;
        }
        default: {
          const v = this.rd(this.hl);
          this.b = (this.b - 1) & 0xff;
          this.bus.output(this.bc, v);
          this.hl = (this.hl + step) & 0xffff;
          this.f = SZ[this.b] | FN;
          if (rep && this.b) {
            this.pc = (this.pc - 2) & 0xffff;
            return 21;
          }
          return 16;
        }
      }
    }
    return 8;
  }
}
