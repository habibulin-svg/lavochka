/* КР580ВМ80А (Intel 8080) — процессор автоматов ТИА-МЦ-1 и «Фотон». Такты — по справочнику (условные CALL/RET +6,
 * если переход состоялся); недокументированные коды — как у настоящего кристалла (NOP, JMP, RET, CALL).
 * Проверено тестами 8080PRE/TST8080/CPUTEST (tests/i8080.test.ts, если файлы тестов лежат в materials/). */

export interface Bus8080 {
  read(a: number): number;
  write(a: number, v: number): void;
  input(port: number): number;
  output(port: number, v: number): void;
}

const CYC = [
  4, 10, 7, 5, 5, 5, 7, 4, 4, 10, 7, 5, 5, 5, 7, 4,
  4, 10, 7, 5, 5, 5, 7, 4, 4, 10, 7, 5, 5, 5, 7, 4,
  4, 10, 16, 5, 5, 5, 7, 4, 4, 10, 16, 5, 5, 5, 7, 4,
  4, 10, 13, 5, 10, 10, 10, 4, 4, 10, 13, 5, 5, 5, 7, 4,
  5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 7, 5,
  5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 7, 5,
  5, 5, 5, 5, 5, 5, 7, 5, 5, 5, 5, 5, 5, 5, 7, 5,
  7, 7, 7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 5, 5, 7, 5,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  5, 10, 10, 10, 11, 11, 7, 11, 5, 10, 10, 10, 11, 17, 7, 11,
  5, 10, 10, 10, 11, 11, 7, 11, 5, 10, 10, 10, 11, 17, 7, 11,
  5, 10, 10, 18, 11, 11, 7, 11, 5, 5, 10, 4, 11, 17, 7, 11,
  5, 10, 10, 4, 11, 11, 7, 11, 5, 5, 10, 4, 11, 17, 7, 11,
];

/** Чётность байта: 1 — чётное число единиц. */
const PAR = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = 0;
  for (let b = i; b; b >>= 1) p ^= b & 1;
  PAR[i] = p ^ 1;
}

export interface I8080Save {
  r: number[];
  f: number;
  ie: boolean;
  halt: boolean;
}

export class I8080 {
  // регистры: 0 B, 1 C, 2 D, 3 E, 4 H, 5 L, 7 A (6 — память по HL)
  r = new Uint8Array(8);
  sp = 0;
  pc = 0;
  fs = 0;
  fz = 0;
  fac = 0;
  fp = 0;
  fcy = 0;
  ie = false;
  halted = false;
  /** Отсрочка EI: прерывания разрешаются после следующей команды. */
  private eiWait = 0;
  cycles = 0;

  constructor(private bus: Bus8080) {}

  reset() {
    this.pc = 0;
    this.ie = false;
    this.halted = false;
    this.eiWait = 0;
  }

  save(): I8080Save {
    return { r: [...this.r, this.sp, this.pc], f: this.flags(), ie: this.ie, halt: this.halted };
  }

  load(s: I8080Save) {
    for (let i = 0; i < 8; i++) this.r[i] = s.r[i];
    this.sp = s.r[8];
    this.pc = s.r[9];
    this.setFlags(s.f);
    this.ie = s.ie;
    this.halted = s.halt;
  }

  flags() {
    return (this.fs << 7) | (this.fz << 6) | (this.fac << 4) | (this.fp << 2) | 2 | this.fcy;
  }

  setFlags(f: number) {
    this.fs = (f >> 7) & 1;
    this.fz = (f >> 6) & 1;
    this.fac = (f >> 4) & 1;
    this.fp = (f >> 2) & 1;
    this.fcy = f & 1;
  }

  /** Запрос прерывания: процессор берёт с шины команду op (обычно RST n). Возвращает, принято ли. */
  interrupt(op = 0xff): boolean {
    if (!this.ie || this.eiWait) return false;
    this.ie = false;
    this.halted = false;
    this.cycles += this.exec(op);
    return true;
  }

  private szp(v: number) {
    this.fs = v >> 7;
    this.fz = v === 0 ? 1 : 0;
    this.fp = PAR[v];
  }

  private get hl() {
    return (this.r[4] << 8) | this.r[5];
  }

  private getR(i: number) {
    return i === 6 ? this.bus.read(this.hl) : this.r[i];
  }

  private setR(i: number, v: number) {
    if (i === 6) this.bus.write(this.hl, v & 0xff);
    else this.r[i] = v;
  }

  private rp(i: number) {
    // 0 BC, 1 DE, 2 HL, 3 SP
    return i === 3 ? this.sp : (this.r[i * 2] << 8) | this.r[i * 2 + 1];
  }

  private setRp(i: number, v: number) {
    v &= 0xffff;
    if (i === 3) this.sp = v;
    else {
      this.r[i * 2] = v >> 8;
      this.r[i * 2 + 1] = v & 0xff;
    }
  }

  private imm8() {
    const v = this.bus.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    return v;
  }

  private imm16() {
    const lo = this.bus.read(this.pc);
    const hi = this.bus.read((this.pc + 1) & 0xffff);
    this.pc = (this.pc + 2) & 0xffff;
    return (hi << 8) | lo;
  }

  private push(v: number) {
    this.sp = (this.sp - 1) & 0xffff;
    this.bus.write(this.sp, v >> 8);
    this.sp = (this.sp - 1) & 0xffff;
    this.bus.write(this.sp, v & 0xff);
  }

  private pop() {
    const lo = this.bus.read(this.sp);
    const hi = this.bus.read((this.sp + 1) & 0xffff);
    this.sp = (this.sp + 2) & 0xffff;
    return (hi << 8) | lo;
  }

  private add(v: number, cy: number) {
    const a = this.r[7];
    const res = a + v + cy;
    this.fac = (a ^ v ^ res) & 0x10 ? 1 : 0;
    this.fcy = res > 0xff ? 1 : 0;
    this.r[7] = res & 0xff;
    this.szp(res & 0xff);
  }

  private sub(v: number, cy: number) {
    this.add(~v & 0xff, cy ? 0 : 1);
    this.fcy ^= 1;
  }

  private cmp(v: number) {
    const a = this.r[7];
    const res = a - v;
    this.fcy = res < 0 ? 1 : 0;
    this.fac = ~(a ^ res ^ v) & 0x10 ? 1 : 0;
    this.szp(res & 0xff);
  }

  private cond(c: number) {
    switch (c) {
      case 0: return !this.fz;
      case 1: return !!this.fz;
      case 2: return !this.fcy;
      case 3: return !!this.fcy;
      case 4: return !this.fp;
      case 5: return !!this.fp;
      case 6: return !this.fs;
      default: return !!this.fs;
    }
  }

  /** Одна команда; возвращает такты. */
  step(): number {
    if (this.halted) {
      this.cycles += 4;
      return 4;
    }
    if (this.eiWait) this.eiWait--;
    const op = this.imm8();
    const n = this.exec(op);
    this.cycles += n;
    return n;
  }

  private exec(op: number): number {
    let cyc = CYC[op];
    const r = this.r;
    if (op >= 0x40 && op < 0x80) {
      if (op === 0x76) this.halted = true;
      else this.setR((op >> 3) & 7, this.getR(op & 7));
      return cyc;
    }
    if (op >= 0x80 && op < 0xc0) {
      const v = this.getR(op & 7);
      this.alu((op >> 3) & 7, v);
      return cyc;
    }
    switch (op) {
      case 0x00: case 0x08: case 0x10: case 0x18: case 0x20: case 0x28: case 0x30: case 0x38:
        break;
      case 0x01: case 0x11: case 0x21: case 0x31:
        this.setRp(op >> 4, this.imm16());
        break;
      case 0x02: this.bus.write(this.rp(0), r[7]); break;
      case 0x12: this.bus.write(this.rp(1), r[7]); break;
      case 0x0a: r[7] = this.bus.read(this.rp(0)); break;
      case 0x1a: r[7] = this.bus.read(this.rp(1)); break;
      case 0x22: {
        const a = this.imm16();
        this.bus.write(a, r[5]);
        this.bus.write((a + 1) & 0xffff, r[4]);
        break;
      }
      case 0x2a: {
        const a = this.imm16();
        r[5] = this.bus.read(a);
        r[4] = this.bus.read((a + 1) & 0xffff);
        break;
      }
      case 0x32: this.bus.write(this.imm16(), r[7]); break;
      case 0x3a: r[7] = this.bus.read(this.imm16()); break;
      case 0x03: case 0x13: case 0x23: case 0x33:
        this.setRp(op >> 4, this.rp(op >> 4) + 1);
        break;
      case 0x0b: case 0x1b: case 0x2b: case 0x3b:
        this.setRp(op >> 4, this.rp(op >> 4) - 1);
        break;
      case 0x09: case 0x19: case 0x29: case 0x39: {
        const res = this.hl + this.rp(op >> 4);
        this.fcy = res > 0xffff ? 1 : 0;
        this.setRp(2, res);
        break;
      }
      case 0x04: case 0x0c: case 0x14: case 0x1c: case 0x24: case 0x2c: case 0x34: case 0x3c: {
        const i = (op >> 3) & 7;
        const v = (this.getR(i) + 1) & 0xff;
        this.fac = (v & 0x0f) === 0 ? 1 : 0;
        this.szp(v);
        this.setR(i, v);
        break;
      }
      case 0x05: case 0x0d: case 0x15: case 0x1d: case 0x25: case 0x2d: case 0x35: case 0x3d: {
        const i = (op >> 3) & 7;
        const v = (this.getR(i) - 1) & 0xff;
        this.fac = (v & 0x0f) === 0x0f ? 0 : 1;
        this.szp(v);
        this.setR(i, v);
        break;
      }
      case 0x06: case 0x0e: case 0x16: case 0x1e: case 0x26: case 0x2e: case 0x36: case 0x3e:
        this.setR((op >> 3) & 7, this.imm8());
        break;
      case 0x07: {
        const a = r[7];
        this.fcy = a >> 7;
        r[7] = ((a << 1) | this.fcy) & 0xff;
        break;
      }
      case 0x0f: {
        const a = r[7];
        this.fcy = a & 1;
        r[7] = (a >> 1) | (this.fcy << 7);
        break;
      }
      case 0x17: {
        const a = r[7];
        r[7] = ((a << 1) | this.fcy) & 0xff;
        this.fcy = a >> 7;
        break;
      }
      case 0x1f: {
        const a = r[7];
        r[7] = (a >> 1) | (this.fcy << 7);
        this.fcy = a & 1;
        break;
      }
      case 0x27: {
        let cy = this.fcy;
        let corr = 0;
        const a = r[7];
        const lsb = a & 0x0f;
        const msb = a >> 4;
        if (this.fac || lsb > 9) corr += 0x06;
        if (this.fcy || msb > 9 || (msb >= 9 && lsb > 9)) {
          corr += 0x60;
          cy = 1;
        }
        this.add(corr, 0);
        this.fcy = cy;
        break;
      }
      case 0x2f: r[7] = ~r[7] & 0xff; break;
      case 0x37: this.fcy = 1; break;
      case 0x3f: this.fcy ^= 1; break;

      // переходы, вызовы, возвраты
      case 0xc3: case 0xcb: this.pc = this.imm16(); break;
      case 0xc2: case 0xca: case 0xd2: case 0xda: case 0xe2: case 0xea: case 0xf2: case 0xfa: {
        const a = this.imm16();
        if (this.cond((op >> 3) & 7)) this.pc = a;
        break;
      }
      case 0xcd: case 0xdd: case 0xed: case 0xfd: {
        const a = this.imm16();
        this.push(this.pc);
        this.pc = a;
        break;
      }
      case 0xc4: case 0xcc: case 0xd4: case 0xdc: case 0xe4: case 0xec: case 0xf4: case 0xfc: {
        const a = this.imm16();
        if (this.cond((op >> 3) & 7)) {
          this.push(this.pc);
          this.pc = a;
          cyc += 6;
        }
        break;
      }
      case 0xc9: case 0xd9: this.pc = this.pop(); break;
      case 0xc0: case 0xc8: case 0xd0: case 0xd8: case 0xe0: case 0xe8: case 0xf0: case 0xf8:
        if (this.cond((op >> 3) & 7)) {
          this.pc = this.pop();
          cyc += 6;
        }
        break;
      case 0xc7: case 0xcf: case 0xd7: case 0xdf: case 0xe7: case 0xef: case 0xf7: case 0xff:
        this.push(this.pc);
        this.pc = op & 0x38;
        break;
      case 0xe9: this.pc = this.hl; break;

      // стек
      case 0xc5: case 0xd5: case 0xe5: this.push(this.rp((op >> 4) & 3)); break;
      case 0xf5: this.push((r[7] << 8) | this.flags()); break;
      case 0xc1: case 0xd1: case 0xe1: this.setRp((op >> 4) & 3, this.pop()); break;
      case 0xf1: {
        const v = this.pop();
        r[7] = v >> 8;
        this.setFlags(v & 0xff);
        break;
      }
      case 0xe3: {
        const v = this.bus.read(this.sp) | (this.bus.read((this.sp + 1) & 0xffff) << 8);
        this.bus.write(this.sp, r[5]);
        this.bus.write((this.sp + 1) & 0xffff, r[4]);
        this.setRp(2, v);
        break;
      }
      case 0xf9: this.sp = this.hl; break;
      case 0xeb: {
        const d = r[2], e = r[3];
        r[2] = r[4];
        r[3] = r[5];
        r[4] = d;
        r[5] = e;
        break;
      }

      // АЛУ с непосредственным, ввод-вывод, прерывания
      case 0xc6: case 0xce: case 0xd6: case 0xde: case 0xe6: case 0xee: case 0xf6: case 0xfe:
        this.alu((op >> 3) & 7, this.imm8());
        break;
      case 0xd3: this.bus.output(this.imm8(), r[7]); break;
      case 0xdb: r[7] = this.bus.input(this.imm8()) & 0xff; break;
      case 0xf3: this.ie = false; break;
      case 0xfb:
        this.ie = true;
        this.eiWait = 1;
        break;
    }
    return cyc;
  }

  private alu(k: number, v: number) {
    const r = this.r;
    switch (k) {
      case 0: this.add(v, 0); break;
      case 1: this.add(v, this.fcy); break;
      case 2: this.sub(v, 0); break;
      case 3: this.sub(v, this.fcy); break;
      case 4:
        this.fac = (r[7] | v) & 0x08 ? 1 : 0;
        r[7] &= v;
        this.fcy = 0;
        this.szp(r[7]);
        break;
      case 5:
        r[7] ^= v;
        this.fac = 0;
        this.fcy = 0;
        this.szp(r[7]);
        break;
      case 6:
        r[7] |= v;
        this.fac = 0;
        this.fcy = 0;
        this.szp(r[7]);
        break;
      default:
        this.cmp(v);
    }
  }
}
