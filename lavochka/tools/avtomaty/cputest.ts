/* Прогон тестов КР580ВМ80А (CP/M .COM: 8080PRE, TST8080, CPUTEST, 8080EXM) на нашем ядре.
 * npx tsx tools/avtomaty/cputest.ts ../materials/cputests/TST8080.COM */
import { readFileSync } from 'node:fs';
import { I8080 } from '../../src/arcade/i8080';
import { Z80 } from '../../src/arcade/z80';

const mem = new Uint8Array(0x10000);
const file = process.argv[2];
mem.set(readFileSync(file), 0x100);
mem[5] = 0xc9;
mem[6] = 0x00; mem[7] = 0xf0; // CALL 5 у ZEX берёт вершину стека из (6) // BDOS — RET, вызов перехватываем ниже
const bus = {
  read: (a) => mem[a],
  write: (a, v) => (mem[a] = v),
  input: () => 0,
  output: () => {},
};
const isZ80 = /zex/i.test(file);
const cpu = isZ80 ? new Z80(bus) : new I8080(bus);
const regC = () => (cpu instanceof Z80 ? cpu.c : cpu.r[1]);
const regE = () => (cpu instanceof Z80 ? cpu.e : cpu.r[3]);
const regDE = () => (cpu instanceof Z80 ? cpu.de : (cpu.r[2] << 8) | cpu.r[3]);
cpu.pc = 0x100;
let out = '';
const t0 = Date.now();
for (;;) {
  if (cpu.pc === 0) break;
  if (cpu.pc === 5) {
    const c = regC();
    if (c === 2) out += String.fromCharCode(regE());
    else if (c === 9) {
      let a = regDE();
      while (mem[a] !== 0x24) out += String.fromCharCode(mem[a++]);
    }
    if (out.includes('\n')) {
      process.stdout.write(out);
      out = '';
    }
  }
  cpu.step();
}
process.stdout.write(out + `\n[${file}: ${cpu.cycles} тактов, ${((Date.now() - t0) / 1000).toFixed(1)} с]\n`);
