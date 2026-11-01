/* Сгенерировано tools/gops/gen-trig.mjs — не править руками. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TRIG_ONE = 16384;

function sinQ(i) {
  const TWO_PI = 2 * Math.PI;
  const angle = (i / 4096) * TWO_PI;
  return Math.round(Math.sin(angle) * TRIG_ONE);
}

const SIN_QUARTER = [];
for (let i = 0; i <= 1024; i++) {
  SIN_QUARTER.push(sinQ(i));
}

const code = `/* Сгенерировано tools/gops/gen-trig.mjs — не править руками. */
export const SIN_QUARTER: readonly number[] = [${SIN_QUARTER.map(n => n.toString()).join(', ')}];
`;

writeFileSync(join(import.meta.dirname, '../../src/gops/sim/trig-table.ts'), code);
console.log('Сгенерировано src/gops/sim/trig-table.ts');
