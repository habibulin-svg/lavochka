/* Сборка образов автоматов: файлы из materials/avtomaty/<id>/ (распакованные zip MAME) → public/avtomaty/<id>.bin.
 * Раскладка — подряд области: процессор, спрайты (gfx1), у «Кота» ещё фон (gfx2); пустые панели — нули, как в MAME.
 * npx tsx tools/avtomaty/pack.ts */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SRC = '../materials/avtomaty';
const OUT = 'public/avtomaty';
type Part = [file: string | null, at: number];
const K = 0x2000;
const tia = (cpu: (string | null)[], gfx: string[]): { size: number; parts: Part[] } => ({
  size: 0xe000 + 0x8000,
  parts: [...cpu.map((f, i): Part => [f, i * K]), ...gfx.map((f, i): Part => [f, 0xe000 + i * K])],
});
const SETS: Record<string, { size: number; parts: Part[] }> = {
  konek: tia(['g1.d17', 'g2.d17', 'g3.d17', 'g4.d17', 'g5.d17', null, 'g7.d17'], ['a2.b07', 'a3.g07', 'a5.l07', 'a6.r07']),
  sosterm: tia(['04.1g', '05.2g', '06.3g', '07.4g', '08.5g', null, '10.7g'], ['00.2a', '01.3a', '02.5a', '03.6a']),
  koroleva: tia(['04.1g', '05.2g', '06.3g', '07.4g', '08.5g', null, '10.7g'], ['00.2a', '01.3a', '02.5a', '03.6a']),
  bilyard: tia(['04.1g', '05.2g', null, null, null, null, '10.7g'], ['00.2a', '01.3a', '02.5a', '03.6a']),
  gorodki: tia(['70.1g', '71.2g', '72.3g', '73.4g', null, null, null], ['66.2a', '67.3a', '68.5a', '69.6a']),
  kot: {
    size: 0xc000 + 0x8000 + 0x8000,
    parts: [
      ['854.6', 0], ['855.7', K], ['856.8', 2 * K],
      ['850.5', 0xc000], ['851.6', 0xc000 + K], ['852.7', 0xc000 + 2 * K], ['853.8', 0xc000 + 3 * K],
      ['846.1', 0x14000], ['847.2', 0x14000 + K], ['848.3', 0x14000 + 2 * K], ['849.4', 0x14000 + 3 * K],
    ],
  },
  // «Фотон»: одно ПЗУ с нуля
  phtetris: { size: 0x4000, parts: [['foton_tetris.bin', 0]] },
  phpython: { size: 0x1800, parts: [['foton_piton.bin', 0]] },
  phklad: { size: 0x4000, parts: [['klad.bin', 0]] },
  // «Фотон ИК-2»: три банка ПЗУ по 16 К
  black: { size: 0xc000, parts: [['black1.bin', 0], ['black2.bin', K], ['black5.bin', 2 * K], ['black6.bin', 3 * K], ['black3.bin', 4 * K], ['black4.bin', 5 * K]] },
  brod: { size: 0xc000, parts: [['brod00.bin', 0], ['brod10.bin', 2 * K], ['brod11.bin', 3 * K], ['brod12.bin', 4 * K], ['brod13.bin', 5 * K]] },
};
mkdirSync(OUT, { recursive: true });
for (const [id, s] of Object.entries(SETS)) {
  const buf = new Uint8Array(s.size);
  for (const [f, at] of s.parts) if (f) buf.set(readFileSync(`${SRC}/${id}/${f}`), at);
  writeFileSync(`${OUT}/${id}.bin`, buf);
  console.log(id, buf.length);
}
