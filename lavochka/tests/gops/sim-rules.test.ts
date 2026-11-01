import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Детерминизм sim (docs/gops/CODE.md §2): никаких трансцендентных функций Math, случайности, времени и DOM.
const FORBIDDEN = [
  /Math\.(sin|cos|tan|asin|acos|atan|atan2|sqrt|cbrt|pow|exp|expm1|log|log2|log10|log1p|hypot|random|sinh|cosh|tanh)\b/,
  /\bDate\b/,
  /\bperformance\b/,
  /\bdocument\b/,
  /\bwindow\b/,
  /\*\*/,
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('gops/sim: правила детерминизма', () => {
  it('в исходниках sim нет запрещённого', () => {
    const bad: string[] = [];
    for (const f of files(join(__dirname, '../../src/gops/sim'))) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const re of FORBIDDEN) if (re.test(code)) bad.push(`${f}: ${re}`);
    }
    expect(bad).toEqual([]);
  });
});
