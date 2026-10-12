/* Процессор Sharp SM5A (советский КБ1013ВК1-2) — сердце «Электроники ИМ». Без DOM: гоняется и в тестах.
 * Перенос ядра MAME (src/devices/cpu/sm510: sm510base, sm510op, sm500, sm500op, sm5a; лицензия BSD-3-Clause,
 * авторы — hap и др., «thanks-to: Igor»): такты, делитель, сдвиговые регистры ЖК, R-выводы.
 * Кварц 32768 Гц, команда — 2 такта; делитель считает каждый такт, переполнение раз в секунду (флаг 1S/gamma). */

const ROM_SIZE = 0x740;
const PRG_MASK = 0x7ff;
const PAGE_MASK = 0x3f;
const O_PINS = 9;

/** Знакогенератор для DTW/PDTW (PLA семисегментных цифр). */
const LUT_DIGITS = [
  0xe, 0x0, 0xc, 0x8, 0x2, 0xa, 0xe, 0x2, 0xe, 0xa, 0x0, 0x0, 0x2, 0xa, 0x2, 0x2, 0xb, 0x9, 0x7, 0xf, 0xd, 0xe, 0xe, 0xb, 0xf, 0xf, 0x4, 0x0, 0xd, 0xe,
  0x4, 0x0,
];

/** Подключение выводов: что прочитать с K, α (BA), β (B) и куда отдать R. */
export interface Sm5aPins {
  /** K1–K4 (подтяжка к земле: 0 — ничего не нажато). */
  k(): number;
  /** α: по умолчанию 1. */
  ba(): number;
  /** β: по умолчанию 1. */
  b(): number;
  /** R1–R4 (уже инвертированные, как на ножках): R1 — пищалка, R2–R4 — опрос клавиатуры. */
  r(out: number): void;
}

export interface Sm5aState {
  ram: number[];
  pc: number;
  op: number;
  prevOp: number;
  stack: number;
  acc: number;
  bl: number;
  bm: number;
  c: number;
  skip: boolean;
  halt: boolean;
  div: number;
  gamma: number;
  bp: number;
  r: number;
  rOut: number;
  cb: number;
  rsub: boolean;
  mx: number;
  s: number;
  o: number[];
  ox: number[];
}

export class Sm5a {
  private rom: Uint8Array;
  private ram = new Uint8Array(0x80);
  pc = 0;
  private op = 0;
  private prevOp = 0;
  private param = 0;
  private stack = 0; // один уровень
  private acc = 0;
  private bl = 0;
  private bm = 0;
  private c = 0;
  private skip = false;
  halt = false;
  /** Делитель частоты, 15 бит. */
  div = 0;
  private gamma = 0;
  /** Флаги ЖК: бит 0 — экран вкл, бит 3 — CN (выбор строки знакогенератора). */
  bp = 0;
  private r = 0;
  rOut = 0;
  private cb = 0;
  private rsub = false;
  private mx = 0;
  private s = 0;
  /** Защёлка W (то, что сейчас на сегментах H1) и сдвиговый регистр W' (H2). */
  readonly o = new Uint8Array(O_PINS);
  readonly ox = new Uint8Array(O_PINS);

  constructor(
    rom: Uint8Array,
    private pins: Sm5aPins
  ) {
    if (rom.length < ROM_SIZE) throw new Error(`SM5A: прошивка ${rom.length} байт, нужно ${ROM_SIZE}`);
    this.rom = rom;
    this.reset();
  }

  /** ACL: сброс (как при вставке батареек). */
  reset() {
    this.skip = false;
    this.halt = false;
    this.op = this.prevOp = 0;
    this.branch(0, 0xf, 0);
    this.bp = 1;
    this.r = this.rOut = 0;
    this.pins.r(0);
    // SM500
    this.stack = this.pc;
    this.div &= 0x3f;
    this.gamma = 1;
    this.cb = 0;
    this.rsub = false;
    this.r = 0xf;
  }

  // ------------------------------------------------------------------ память

  private read(addr: number) {
    // 0x700–0x73f отражается на 0x740–0x7ff
    return addr < 0x700 ? this.rom[addr] : this.rom[0x700 | (addr & 0x3f)];
  }

  /** Адрес ОЗУ 5×13×4: столбцы d–f читаются как c, 4-я страница отражается выше. */
  private ramAddr() {
    let a = ((this.bm << 4) | this.bl) & 0x7f;
    if ((a & 0xf) > 0xc) a = (a & 0x70) | 0xc;
    if (a >= 0x40) a = 0x40 | (a & 0xf);
    return a;
  }

  private ramR() {
    return this.ram[this.ramAddr()] & 0xf;
  }

  private ramW(v: number) {
    this.ram[this.ramAddr()] = v & 0xf;
  }

  private branch(pu: number, pm: number, pl: number) {
    this.pc = ((pu << 10) | ((pm << 6) & 0x3c0) | (pl & 0x3f)) & PRG_MASK;
  }

  private incPc() {
    // младшие 6 бит — сдвиговый регистр с обратной связью: новый бит = (b0 == b1)
    const feed = ((this.pc >> 1) ^ this.pc) & 1 ? 0 : 0x20;
    this.pc = feed | ((this.pc >> 1) & (PAGE_MASK >> 1)) | (this.pc & ~PAGE_MASK);
  }

  // ------------------------------------------------------------------ такты

  /** Один такт кварца для делителя (вызывает машина). */
  clock() {
    this.div = (this.div + 1) & 0x7fff;
    if (this.div === 0) this.gamma |= 1;
  }

  /**
   * Выполнить одну команду. Возвращает число машинных циклов (1 или 2; цикл = 2 такта кварца).
   * В остановке (CEND) ждёт 1S или нажатия: тогда возвращает 1 и ничего не делает.
   */
  step(): number {
    let cycles = 0;
    if (this.halt) {
      if (this.pins.k() !== 0 || this.gamma) {
        // пробуждение: вектор 0/0/0
        cycles++;
        this.halt = false;
        this.cb = 0;
        this.branch(0, 0, 0);
      } else return 1;
    }
    cycles++;
    this.prevOp = this.op;
    this.op = this.read(this.pc);
    this.incPc();
    if (this.op === 0x5e || this.op === 0x5f) {
      cycles++;
      this.param = this.read(this.pc);
      this.incPc();
    }
    if (this.skip) {
      this.skip = false;
      this.op = 0;
    } else this.exec();
    return cycles;
  }

  private exec() {
    const op = this.op;
    switch (op & 0xf0) {
      case 0x20: // LAX x: соседние LAX пропускаются
        if ((op & ~0xf) !== (this.prevOp & ~0xf)) this.acc = op & 0xf;
        return;
      case 0x30: {
        // ADX x
        const x = op & 0xf;
        this.acc += x;
        this.skip = x !== 10 && (this.acc & 0x10) !== 0;
        this.acc &= 0xf;
        return;
      }
      case 0x40: // LB x
        this.bm = op & 3;
        this.bl = ((op >> 2) & 3) | (op & 0xc ? 8 : 0);
        return;
      case 0x70: // SSR x
        this.stack = (this.stack & ~0x3c0) | ((op << 6) & 0x3c0);
        return;
      case 0x80:
      case 0x90:
      case 0xa0:
      case 0xb0: // TR x
        this.pc = (this.pc & ~0x3f) | (op & 0x3f);
        if (!this.rsub) this.branch(this.cb, (this.stack >> 6) & 0xf, this.pc & 0x3f);
        return;
      case 0xc0:
      case 0xd0:
      case 0xe0:
      case 0xf0: // TRS x
        if (!this.rsub) {
          this.rsub = true;
          const su = (this.stack >> 6) & 0xf;
          this.stack = this.pc;
          this.branch(1, 0, op & 0x3f);
          if ((this.prevOp & 0xf0) === 0x70) this.branch(this.cb, su, this.pc & 0x3f);
        } else this.pc = (this.pc & ~0xff) | ((op << 2) & 0xc0) | (op & 0xf);
        return;
    }
    switch (op & 0xfc) {
      case 0x04: // RM
        this.ramW(this.ramR() & ~(1 << (op & 3)));
        return;
      case 0x0c: // SM
        this.ramW(this.ramR() | (1 << (op & 3)));
        return;
      case 0x10: // EXC
        this.exc();
        return;
      case 0x14: // EXCI
        this.exc();
        this.incb();
        return;
      case 0x18: // LDA
        this.acc = this.ramR();
        this.bm ^= op & 3;
        return;
      case 0x1c: // EXCD
        this.exc();
        this.bl = (this.bl - 1) & 0xf;
        this.skip = this.bl === 0xf;
        return;
      case 0x54: // TMI
        this.skip = (this.ramR() & (1 << (op & 3))) !== 0;
        return;
    }
    switch (op) {
      case 0x00: // SKIP
        return;
      case 0x01: // ATR
        this.r = this.acc;
        this.outR();
        return;
      case 0x02: // SBM
        this.bm |= 4;
        return;
      case 0x03: // ATBP
        this.bp = this.acc;
        return;
      case 0x08: // ADD
        this.acc = (this.acc + this.ramR()) & 0xf;
        return;
      case 0x09: // ADD11
        this.acc += this.ramR() + this.c;
        this.c = (this.acc >> 4) & 1;
        this.skip = this.c === 1;
        this.acc &= 0xf;
        return;
      case 0x0a: // COMA
        this.acc ^= 0xf;
        return;
      case 0x0b: {
        // EXBLA
        const a = this.acc;
        this.acc = this.bl;
        this.bl = a;
        return;
      }
      case 0x50: // TAL
        this.skip = this.pins.ba() !== 0;
        return;
      case 0x51: // TB
        this.skip = this.pins.b() !== 0;
        return;
      case 0x52: // TC
        this.skip = !this.c;
        return;
      case 0x53: // TAM
        this.skip = this.acc === this.ramR();
        return;
      case 0x58: // TIS
        this.skip = !this.gamma;
        this.gamma = 0;
        return;
      case 0x59: // PTW
        this.o[O_PINS - 1] = this.ox[O_PINS - 1];
        this.o[O_PINS - 2] = this.ox[O_PINS - 2];
        return;
      case 0x5a: // TA0
        this.skip = !this.acc;
        return;
      case 0x5b: // TABL
        this.skip = this.acc === this.bl;
        return;
      case 0x5c: // TW
        this.o.set(this.ox);
        return;
      case 0x5d: // DTW
        this.shiftW();
        this.ox[O_PINS - 1] = this.digit();
        return;
      case 0x5e: // CEND / DTA
        this.op = (op << 8) | this.param;
        if (this.param === 0x00) this.halt = true;
        else if (this.param === 0x04) this.acc = (this.div >> 11) & 0xf;
        return;
      case 0x5f: // LBL
        this.bl = this.param & 0xf;
        this.bm = (this.param & 0x7f) >> 4;
        return;
      case 0x60: // COMCN
        this.bp ^= 8;
        return;
      case 0x61: // PDTW
        this.ox[O_PINS - 2] = this.ox[O_PINS - 1];
        this.ox[O_PINS - 1] = this.digit();
        return;
      case 0x62: // WR
        this.shiftW();
        this.ox[O_PINS - 1] = this.acc & 7;
        return;
      case 0x63: // WS
        this.shiftW();
        this.ox[O_PINS - 1] = this.acc | 8;
        return;
      case 0x64: // INCB
        this.incb();
        return;
      case 0x65: // IDIV
        this.div &= 0x3f;
        return;
      case 0x66: // RC
        this.c = 0;
        return;
      case 0x67: // SC
        this.c = 1;
        return;
      case 0x68: // RMF
        this.mx = 0;
        this.acc = 0;
        return;
      case 0x69: // SMF
        this.mx = 1;
        return;
      case 0x6a: // KTA
        this.acc = this.pins.k() & 0xf;
        return;
      case 0x6b: // RBM
        this.bm &= ~4;
        return;
      case 0x6c: // DECB
        this.bl = (this.bl - 1) & 0xf;
        this.skip = this.bl === 0xf;
        return;
      case 0x6d: // COMCB
        this.cb ^= 1;
        return;
      case 0x6e: // RTN
        this.pc = this.stack & PRG_MASK;
        this.rsub = false;
        return;
      case 0x6f: // RTNS
        this.pc = this.stack & PRG_MASK;
        this.rsub = false;
        this.skip = true;
        return;
    }
    // 0x05–0x07 и прочие пустые коды — ничего (MAME пишет в лог)
  }

  private exc() {
    const a = this.acc;
    this.acc = this.ramR();
    this.ramW(a);
    this.bm ^= this.op & 3;
  }

  private incb() {
    // у SM500 перенос — на третьем бите
    this.bl = (this.bl + 1) & 0xf;
    this.skip = this.bl === 8;
  }

  private shiftW() {
    for (let i = 0; i < O_PINS - 1; i++) this.ox[i] = this.ox[i + 1];
  }

  private digit() {
    const sel = (this.bp >> 3) & 1;
    return LUT_DIGITS[(sel << 4) | this.acc] | (~sel & this.mx);
  }

  /** R-выводы инверсные; маска R1 — прямое управление. */
  private outR() {
    const out = ~this.r & 0xf;
    if (out !== this.rOut) {
      this.rOut = out;
      this.pins.r(out);
    }
  }

  // ------------------------------------------------------------------ сохранение

  save(): Sm5aState {
    return {
      ram: [...this.ram],
      pc: this.pc,
      op: this.op,
      prevOp: this.prevOp,
      stack: this.stack,
      acc: this.acc,
      bl: this.bl,
      bm: this.bm,
      c: this.c,
      skip: this.skip,
      halt: this.halt,
      div: this.div,
      gamma: this.gamma,
      bp: this.bp,
      r: this.r,
      rOut: this.rOut,
      cb: this.cb,
      rsub: this.rsub,
      mx: this.mx,
      s: this.s,
      o: [...this.o],
      ox: [...this.ox],
    };
  }

  load(st: Sm5aState) {
    this.ram.set(st.ram.slice(0, 0x80));
    this.pc = st.pc & PRG_MASK;
    this.op = st.op;
    this.prevOp = st.prevOp;
    this.stack = st.stack;
    this.acc = st.acc & 0xf;
    this.bl = st.bl & 0xf;
    this.bm = st.bm & 7;
    this.c = st.c & 1;
    this.skip = !!st.skip;
    this.halt = !!st.halt;
    this.div = st.div & 0x7fff;
    this.gamma = st.gamma & 1;
    this.bp = st.bp & 0xf;
    this.r = st.r & 0xf;
    this.rOut = st.rOut & 0xf;
    this.cb = st.cb & 1;
    this.rsub = !!st.rsub;
    this.mx = st.mx & 1;
    this.s = st.s & 0xf;
    this.o.set(st.o.slice(0, O_PINS));
    this.ox.set(st.ox.slice(0, O_PINS));
    this.pins.r(this.rOut);
  }

  /** Для тестов и отладки. */
  peek(addr: number) {
    return this.ram[addr & 0x7f];
  }
}
