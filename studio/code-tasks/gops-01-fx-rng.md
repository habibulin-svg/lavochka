# Задание gops-01: fx.ts и rng.ts (фундамент детерминированной логики ГОПС)

Работаешь в папке `lavochka/`. Создай ТОЛЬКО эти файлы:

- `lavochka/src/gops/sim/fx.ts`
- `lavochka/src/gops/sim/rng.ts`
- `lavochka/tools/gops/gen-trig.mjs` — скрипт-генератор таблицы синусов
- `lavochka/src/gops/sim/trig-table.ts` — результат работы генератора (не писать руками!)

Другие файлы не трогай. Тесты уже написаны и являются спецификацией — их НЕ меняй:
`lavochka/tests/gops/fx.test.ts`, `lavochka/tests/gops/rng.test.ts`, `lavochka/tests/gops/sim-rules.test.ts`. Прочитай их первыми.

## Главное правило (детерминизм)

Код в `src/gops/sim/` должен давать бит в бит одинаковый результат в любом браузере. Поэтому в `src/gops/sim/` ЗАПРЕЩЕНО: `Math.sin/cos/tan/atan2/sqrt/pow/exp/log/hypot/random`, оператор `**`, `Date`, `performance`, `document`, `window`. Разрешено: `+ - * /`, `Math.trunc`, `Math.floor`, `Math.imul`, `Math.abs`, `Math.min/max`, побитовые операции.

## fx.ts — фиксированная точка

```ts
export const ONE = 256;          // Q8: 1 пиксель = 256
export const TRIG_ONE = 16384;   // Q14: 1.0 для sin/cos
export const ANG_FULL = 4096;    // полный оборот; 1024 = 90°
export function toFx(px: number): number;           // px * 256
export function toPx(v: number): number;            // пол: v >> 8 (для отрицательных тоже пол)
export function fmul(a: number, b: number): number; // Math.trunc(a * b / 256)
export function fdiv(a: number, b: number): number; // Math.trunc(a * 256 / b)
export function isqrt(n: number): number;           // точный пол корня, n до 2^52; n<=0 → 0. Без Math.sqrt: метод Ньютона на целых или двоичный поиск. Осторожно: побитовые операции в JS 32-битные — для больших n используй Math.floor/деление, не >>.
export function len(dx: number, dy: number): number; // isqrt(dx*dx + dy*dy)
export function sinQ(a: number): number;            // a — любое целое (и отрицательное); результат Q14 из таблицы
export function cosQ(a: number): number;            // sinQ(a + 1024)
export function atan2Q(y: number, x: number): number; // угол 0…4095, (0,0) → 0, ошибка ≤ 2
export function fromAngle(a: number, speed: number): [number, number]; // [trunc(speed*cosQ(a)/16384), trunc(speed*sinQ(a)/16384)]
export function angleOf(dx: number, dy: number): number; // = atan2Q(dy, dx)
```

**sinQ:** берёт значение из `SIN_QUARTER` (импорт из `./trig-table`) — массив из 1025 целых: `SIN_QUARTER[i] = round(sin(i/4096 · 2π) · 16384)` для i = 0…1024 (четверть волны). Угол приводится к 0…4095 (`((a % 4096) + 4096) % 4096`), четверти — по симметрии: 0…1024 — таблица, 1024…2048 — `T[2048−a]`, 2048…3072 — `−T[a−2048]`, 3072…4096 — `−T[4096−a]`.

**atan2Q:** без Math.atan2. Способ: октант по знакам и |y| ≤ |x|, затем двоичный поиск угла t в 0…512, у которого tan ближе всего к отношению — сравнивай целыми: `sinQ(t) * |x|` против `|y| * cosQ(t)`. Потом разверни в нужный октант.

## gen-trig.mjs

Node-скрипт (здесь Math.sin МОЖНО — это инструмент, не sim): считает таблицу и пишет `src/gops/sim/trig-table.ts`:

```ts
/* Сгенерировано tools/gops/gen-trig.mjs — не править руками. */
export const SIN_QUARTER: readonly number[] = [0, 25, 50, ...];
```

Запуск из `lavochka/`: `node tools/gops/gen-trig.mjs`.

## rng.ts — mulberry32 (должен совпасть с Python `studio/post/terrain.py`)

```ts
export function fnv1a(s: string): number;  // по байтам UTF-8 (new TextEncoder().encode(s)), h = 0x811C9DC5; h = Math.imul(h ^ byte, 0x01000193) >>> 0; вернуть беззнаковое
export class Rng {
  s: number;                    // состояние, uint32 (публичное — сохраняется в мире)
  constructor(seed: number);    // this.s = seed >>> 0
  u32(): number;                // см. ниже
  f(): number;                  // u32() / 4294967296
  range(a: number, b: number): number; // a + (b - a) * f()
  int(a: number, b: number): number;   // включительно: a + Math.trunc(f() * (b - a + 1))
  below(n: number): number;     // 0…n−1: Math.trunc(f() * n)
}
```

u32 (точный перенос с Python, всё через Math.imul и >>> 0):
```
s = (s + 0x6D2B79F5) >>> 0
t = s
t = Math.imul(t ^ (t >>> 15), t | 1)
t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
return (t ^ (t >>> 14)) >>> 0
```

## Проверка (из `lavochka/`)

```
npx vitest run tests/gops
npx tsc --noEmit
```

Готово, когда все тесты в `tests/gops` зелёные и tsc без ошибок. Стиль: TypeScript strict, комментарии по-русски, коротко.
