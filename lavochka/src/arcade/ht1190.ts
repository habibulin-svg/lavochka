/* Процессор Holtek HT1190 — сердце Brick Game E-23 Plus Mark II «96 in 1». Без DOM.
 * Перенос ядра MAME (src/devices/cpu/ht1130, лицензия BSD-3-Clause, автор David Haywood, thanks-to azya):
 * 4-битный, ПЗУ 4 КБ, ОЗУ 160 полубайтов + 80 полубайтов экрана (8 общих × 40 сегментов), таймер, мелодии из ПЗУ.
 * Генератор — 125 кГц, как в MAME (там частота — догадка). Но у Holtek машинный цикл (выборка команды или её байта)
 * длится 4 такта генератора, а MAME считает цикл за такт — игра там вчетверо быстрее настоящей (тетрис на скорости 1
 * пролетал стакан за 3,6 с вместо ~14). Здесь процессор идёт циклами по CYCLE тактов, а пищалка и темп мелодий —
 * по тактам генератора (на слух в MAME они верные). */

export const HT_CLOCK = 125000;
/** Тактов генератора на машинный цикл. */
const CYCLE = 4;
const FREQ_DIV = 64;

/** Порядковый номер состояния 7-битного регистра сдвига = делитель частоты ноты. */
const LFSR2DIV = (() => {
  const t = new Uint8Array(128);
  let st = 0x40;
  for (let pos = 1; pos <= 127; pos++) {
    t[st] = pos;
    const fb = ((st >> 6) ^ st) & 1;
    st = ((st << 1) | fb) & 0x7f;
  }
  return t;
})();

const NOTE_TICKS = LFSR2DIV[1] * FREQ_DIV * 16;

export interface HtPins {
  /** Порт PS (активный 0): b0 старт/пауза, b1 звук, b2 вкл/выкл. */
  ps(): number;
  /** Порт PP (активный 0): b0 поворот, b1 вниз, b2 вправо, b3 влево. */
  pp(): number;
}

export interface HtState {
  ram: number[];
  pc: number;
  regs: number[];
  acc: number;
  carry: number;
  timerEn: number;
  timer: number;
  timerOver: number;
  halt: number;
  wake: number;
  stack: number;
  snd: [number, number, number, number, number, number, number];
}

export class Ht1190 {
  private rom: Uint8Array;
  private melody: Uint8Array;
  /** Данные: 0x00–0x9f — рабочее ОЗУ, 0xb0–0xff — экран. */
  readonly ram = new Uint8Array(256);
  pc = 0;
  private regs = new Uint8Array(5);
  private acc = 0;
  private carry = 0;
  private timerEn = 0;
  private timer = 0;
  private timerOver = 0;
  halt = 0;
  private wake = 0;
  private stack = 0;
  private stackCarry = 0;
  // звук
  private sndOn = false;
  private sndRepeat = false;
  private sndCh = 0;
  private noteCnt = 0;
  private noteClock = 0;
  private sndPos = 0;
  private sndSig = 0;

  constructor(
    rom: Uint8Array,
    melody: Uint8Array,
    private pins: HtPins
  ) {
    if (rom.length < 0x1000) throw new Error(`HT1190: прошивка ${rom.length} байт, нужно 4096`);
    this.rom = rom;
    this.melody = melody;
  }

  reset() {
    this.pc = 0;
    this.carry = 0;
    this.timerEn = 0;
    this.halt = 0;
    this.timerOver = 0;
    this.timer = 0;
  }

  /** Вывод «включение» (кнопка Вкл/Выкл): будит по фронту. */
  setWake(on: boolean) {
    const v = on ? 1 : 0;
    if (v && !this.wake) this.halt = 0;
    this.wake = v;
  }

  private rd(a: number) {
    return a < 0xa0 || a >= 0xb0 ? this.ram[a] & 0xf : 0;
  }
  private wr(a: number, v: number) {
    if (a < 0xa0 || a >= 0xb0) this.ram[a] = v & 0xf;
  }
  private get r1r0() {
    return (this.regs[1] << 4) | this.regs[0];
  }
  private get r3r2() {
    return (this.regs[3] << 4) | this.regs[2];
  }

  private cycles = 0;
  private fetch() {
    this.cycles++;
    if (this.timerEn) this.timer++;
    const v = this.rom[this.pc & 0xfff];
    this.pc = (this.pc + 1) & 0xfff;
    return v;
  }
  private extra() {
    this.cycles++;
    if (this.timerEn) this.timer++;
  }

  private setAccC(v: number) {
    this.carry = v & 0x10 ? 1 : 0;
    this.acc = v & 0xf;
  }

  /** Короткий переход внутри половины ПЗУ (старший бит адреса — от текущего). */
  private near(inst: number, cond: boolean) {
    const op = this.fetch();
    if (cond) this.pc = ((inst & 7) << 8) | op | (this.pc & 0x800);
  }

  private sound(ch: number) {
    this.sndCh = ch & 0xf;
    this.noteCnt = 0;
    this.sndOn = true;
    this.sndPos = 0;
    this.noteClock = NOTE_TICKS;
  }

  /**
   * Выполнить одну команду (в остановке — один цикл простоя). Возвращает такты генератора;
   * в out (с позиции at) — уровень пищалки по такту.
   */
  step(out?: Float32Array, at = 0): number {
    if (this.halt) {
      if (out) for (let i = 0; i < CYCLE && at + i < out.length; i++) out[at + i] = this.sample();
      return CYCLE;
    }
    this.cycles = 0;
    this.exec();
    const n = this.cycles * CYCLE;
    if (this.timer & 0x100) {
      this.timer -= 0x100;
      this.timerOver = 1;
    }
    if (out) for (let i = 0; i < n && at + i < out.length; i++) out[at + i] = this.sample();
    if (this.sndOn) {
      if (this.noteClock <= n) {
        this.noteCnt++;
        const limit = this.sndCh < 12 ? 32 : 64;
        if (this.noteCnt >= limit) {
          if (this.sndRepeat) this.noteCnt = 0;
          else this.sndOn = false;
        }
        if (this.sndOn) this.noteClock = NOTE_TICKS;
      } else this.noteClock -= n;
    }
    return n;
  }

  /** Играет ли мелодия. */
  get sounding() {
    return this.sndOn;
  }

  /** Один сэмпл пищалки (частота — такты процессора). */
  private sample(): number {
    if (!this.sndOn) return 0;
    const off = this.sndCh < 12 ? this.sndCh * 32 + (this.noteCnt & 31) : 12 * 32 + (this.sndCh - 12) * 64 + (this.noteCnt & 63);
    if (off >= this.melody.length) return 0;
    const note = this.melody[off];
    if (!note) return 0;
    const div = LFSR2DIV[note & 0x7f];
    if (!div) return 0;
    const period = Math.floor(Math.floor(Math.floor(HT_CLOCK / FREQ_DIV) / div) / 2) || 1;
    if (this.sndPos >= period) {
      this.sndPos -= period;
      this.sndSig = this.sndSig ? 0 : 1;
    }
    this.sndPos++;
    return this.sndSig;
  }

  private exec() {
    const inst = this.fetch();
    const R = this.regs;
    switch (inst) {
      case 0x08: // ADC A,[R1R0]
        return this.setAccC(this.acc + this.rd(this.r1r0) + this.carry);
      case 0x09: // ADD A,[R1R0]
        return this.setAccC(this.acc + this.rd(this.r1r0));
      case 0x1a: // AND A,[R1R0]
        this.acc &= this.rd(this.r1r0);
        return;
      case 0x1d: // AND [R1R0],A
        return this.wr(this.r1r0, this.rd(this.r1r0) & this.acc);
      case 0x2a: // CLC
        this.carry = 0;
        return;
      case 0x36: // DAA
        if (this.acc > 9 || this.carry) {
          this.acc = (this.acc + 6) & 0xf;
          this.carry = 1;
        }
        return;
      case 0x3f: // DEC A
        this.acc = (this.acc - 1) & 0xf;
        return;
      case 0x0d: // DEC [R1R0]
        return this.wr(this.r1r0, this.rd(this.r1r0) - 1);
      case 0x0f: // DEC [R3R2]
        return this.wr(this.r3r2, this.rd(this.r3r2) - 1);
      case 0x2d: // DI
      case 0x2c: // EI (прерывания игре не нужны)
        return;
      case 0x32: // IN A,PM — у HT1190 порта нет
        this.acc = 0xf;
        return;
      case 0x33: // IN A,PS
        this.acc = this.pins.ps() & 0xf;
        return;
      case 0x34: // IN A,PP
        this.acc = this.pins.pp() & 0xf;
        return;
      case 0x31: // INC A
        this.acc = (this.acc + 1) & 0xf;
        return;
      case 0x0c: // INC [R1R0]
        return this.wr(this.r1r0, this.rd(this.r1r0) + 1);
      case 0x0e: // INC [R3R2]
        return this.wr(this.r3r2, this.rd(this.r3r2) + 1);
      case 0x04: // MOV A,[R1R0]
        this.acc = this.rd(this.r1r0);
        return;
      case 0x06: // MOV A,[R3R2]
        this.acc = this.rd(this.r3r2);
        return;
      case 0x05: // MOV [R1R0],A
        return this.wr(this.r1r0, this.acc);
      case 0x07: // MOV [R3R2],A
        return this.wr(this.r3r2, this.acc);
      case 0x3e: // NOP
        return;
      case 0x1c: // OR A,[R1R0]
        this.acc |= this.rd(this.r1r0);
        return;
      case 0x1f: // OR [R1R0],A
        return this.wr(this.r1r0, this.rd(this.r1r0) | this.acc);
      case 0x30: // OUT PA,A — порт A у этой игры не подключён
        return;
      case 0x4e: {
        // READ MR0A
        this.extra();
        const d = this.rom[((this.pc & 0xf00) | (this.acc << 4) | R[4]) & 0xfff];
        this.wr(this.r1r0, d >> 4);
        this.acc = d & 0xf;
        return;
      }
      case 0x4c: {
        // READ R4A
        this.extra();
        const d = this.rom[((this.pc & 0xf00) | (this.acc << 4) | this.rd(this.r1r0)) & 0xfff];
        R[4] = d >> 4;
        this.acc = d & 0xf;
        return;
      }
      case 0x4f: {
        // READF MR0A
        this.extra();
        const d = this.rom[0xf00 | (this.acc << 4) | R[4]];
        this.wr(this.r1r0, d >> 4);
        this.acc = d & 0xf;
        return;
      }
      case 0x4d: {
        // READF R4A
        this.extra();
        const d = this.rom[0xf00 | (this.acc << 4) | this.rd(this.r1r0)];
        R[4] = d >> 4;
        this.acc = d & 0xf;
        return;
      }
      case 0x01: {
        // RL A
        const b = (this.acc >> 3) & 1;
        this.carry = b;
        this.acc = ((this.acc << 1) | b) & 0xf;
        return;
      }
      case 0x03: {
        // RLC A
        const c = this.carry;
        this.carry = (this.acc >> 3) & 1;
        this.acc = ((this.acc << 1) | c) & 0xf;
        return;
      }
      case 0x00: {
        // RR A
        const b = this.acc & 1;
        this.carry = b;
        this.acc = (this.acc >> 1) | (b << 3);
        return;
      }
      case 0x02: {
        // RRC A
        const c = this.carry;
        this.carry = this.acc & 1;
        this.acc = (this.acc >> 1) | (c << 3);
        return;
      }
      case 0x0a: // SBC A,[R1R0]
        return this.setAccC(this.acc + (0xf - this.rd(this.r1r0)) + this.carry);
      case 0x2b: // STC
        this.carry = 1;
        return;
      case 0x0b: // SUB A,[R1R0]
        return this.setAccC(this.acc + (0xf - this.rd(this.r1r0)) + 1);
      case 0x39: // TIMER OFF
        this.timerEn = 0;
        return;
      case 0x38: // TIMER ON
        this.timerEn = 1;
        return;
      case 0x1b: // XOR A,[R1R0]
        this.acc ^= this.rd(this.r1r0);
        return;
      case 0x1e: // XOR [R1R0],A
        return this.wr(this.r1r0, this.rd(this.r1r0) ^ this.acc);
      case 0x40: // ADD A,XH
        return this.setAccC(this.acc + (this.fetch() & 0xf));
      case 0x42: // AND A,XH
        this.acc &= this.fetch() & 0xf;
        return;
      case 0x46: // MOV R4,XH
        R[4] = this.fetch() & 0xf;
        return;
      case 0x44: // OR A,XH
        this.acc |= this.fetch() & 0xf;
        return;
      case 0x41: // SUB A,XH
        return this.setAccC(this.acc + (0xf - (this.fetch() & 0xf)) + 1);
      case 0x43: // XOR A,XH
        this.acc ^= this.fetch() & 0xf;
        return;
      case 0x2e: // RET
        this.pc = this.stack;
        return;
      case 0x2f: // RETI
        this.pc = this.stack;
        this.carry = this.stackCarry ? 1 : 0;
        return;
      case 0x3b: // MOV A,TMRH
        this.acc = (this.timer >> 4) & 0xf;
        return;
      case 0x3a: // MOV A,TMRL
        this.acc = this.timer & 0xf;
        return;
      case 0x3d: // MOV TMRH,A
        this.timer = (this.timer & 0xf) | (this.acc << 4);
        return;
      case 0x3c: // MOV TMRL,A
        this.timer = (this.timer & 0xf0) | this.acc;
        return;
      case 0x47: // TIMER XXH
        this.timer = this.fetch();
        return;
      case 0x4b: // SOUND A
        return this.sound(this.acc);
      case 0x49: // SOUND LOOP
        this.sndRepeat = true;
        return;
      case 0x4a: // SOUND OFF
        this.sndOn = false;
        return;
      case 0x48: // SOUND ONE
        this.sndRepeat = false;
        return;
      case 0x45: // SOUND n
        return this.sound(this.fetch() & 0xf);
      case 0x37: // HALT (за ним всегда NOP)
        if (this.fetch() === 0x3e) this.halt = 1;
        return;
    }
    const hi = inst & 0xf0;
    if (hi === 0x70) {
      this.acc = inst & 0xf; // MOV A,XH
      return;
    }
    if (hi === 0x10 && inst <= 0x19) {
      const r = (inst & 0x0e) >> 1;
      R[r] = (R[r] + (inst & 1 ? -1 : 1)) & 0xf; // INC/DEC Rn
      return;
    }
    if (hi === 0x20 && inst <= 0x29) {
      const r = (inst & 0x0e) >> 1;
      if (inst & 1) this.acc = R[r]; // MOV A,Rn
      else R[r] = this.acc; // MOV Rn,A
      return;
    }
    if (hi === 0x50) {
      // MOV R1R0,XXH
      const op = this.fetch();
      R[1] = op & 0xf;
      R[0] = inst & 0xf;
      return;
    }
    if (hi === 0x60) {
      // MOV R3R2,XXH
      const op = this.fetch();
      R[3] = op & 0xf;
      R[2] = inst & 0xf;
      return;
    }
    if (hi === 0xf0) {
      // CALL
      const op = this.fetch();
      this.stack = this.pc;
      this.pc = ((inst & 0xf) << 8) | op;
      return;
    }
    if (hi === 0xe0) {
      // JMP
      const op = this.fetch();
      this.pc = ((inst & 0xf) << 8) | op;
      return;
    }
    switch (inst & 0xf8) {
      case 0xc0:
        return this.near(inst, !!this.carry); // JC
      case 0xc8:
        return this.near(inst, !this.carry); // JNC
      case 0xb8:
        return this.near(inst, !!this.acc); // JNZ A
      case 0xa0:
        return this.near(inst, !!R[0]); // JNZ R0
      case 0xa8:
        return this.near(inst, !!R[1]); // JNZ R1
      case 0xd8:
        return this.near(inst, !!R[4]); // JNZ R4
      case 0xd0: {
        // JTMR
        const op = this.fetch();
        if (this.timerOver) {
          this.pc = ((inst & 7) << 8) | op | (this.pc & 0x800);
          this.timerOver = 0;
        }
        return;
      }
      case 0xb0:
        return this.near(inst, !this.acc); // JZ A
    }
    if ((inst & 0xe0) === 0x80) {
      // JAn: прыжок, если в A стоит бит n
      const bit = (inst & 0x18) >> 3;
      return this.near(inst, ((this.acc >> bit) & 1) === 1);
    }
    // прочее — пустые коды
  }

  /** Горит ли сегмент seg (0…39) на общем com (0…7) — как его выводит MAME (x.y = com.seg). */
  seg(com: number, seg: number): number {
    if (this.halt) return 0;
    const i = 39 - seg;
    return (this.ram[0xb0 + ((i << 1) | (com >> 2))] >> (com & 3)) & 1;
  }

  save(): HtState {
    return {
      ram: [...this.ram],
      pc: this.pc,
      regs: [...this.regs],
      acc: this.acc,
      carry: this.carry,
      timerEn: this.timerEn,
      timer: this.timer,
      timerOver: this.timerOver,
      halt: this.halt,
      wake: this.wake,
      stack: this.stack,
      snd: [this.sndOn ? 1 : 0, this.sndRepeat ? 1 : 0, this.sndCh, this.noteCnt, this.noteClock, this.sndPos, this.sndSig],
    };
  }

  load(s: HtState) {
    this.ram.set(s.ram.slice(0, 256).map((v) => v & 0xf));
    this.pc = s.pc & 0xfff;
    this.regs.set(s.regs.slice(0, 5).map((v) => v & 0xf));
    this.acc = s.acc & 0xf;
    this.carry = s.carry & 1;
    this.timerEn = s.timerEn & 1;
    this.timer = s.timer & 0x1ff;
    this.timerOver = s.timerOver & 1;
    this.halt = s.halt & 1;
    this.wake = s.wake & 1;
    this.stack = s.stack & 0xfff;
    const [on, rep, ch, nc, ncl, pos, sig] = s.snd;
    this.sndOn = !!on;
    this.sndRepeat = !!rep;
    this.sndCh = ch & 0xf;
    this.noteCnt = nc & 0xff;
    this.noteClock = ncl;
    this.sndPos = pos;
    this.sndSig = sig & 1;
  }
}
