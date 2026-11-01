# Задание gops-02: mask.ts — разрушаемый ландшафт ГОПС

Работаешь в папке `lavochka/`. Создай ТОЛЬКО файл `lavochka/src/gops/sim/mask.ts`. Другие файлы не трогай.
Тест-спецификация уже написан, его НЕ меняй: `lavochka/tests/gops/mask.test.ts` — прочитай его первым.

## Правило детерминизма

Это код `src/gops/sim/`: ЗАПРЕЩЕНЫ `Math.sin/cos/sqrt/pow/atan2/random`, оператор `**`, `Date`, `performance`, `document`, `window` (их ловит `tests/gops/sim-rules.test.ts`). Всё — на целых числах: `+ - * `, сравнения, `Math.min/max/abs/trunc/floor`, `Math.imul`.

## Что это

Карта — прямоугольник `w × h` пикселей, `d: Uint8Array` длиной `w*h`, `d[y*w + x]` = 1 — земля, 0 — воздух. Все координаты — целые пиксели. **За пределами карты — воздух** (solid → false, set — молча ничего не делает).

Пиксель (x, y) внутри круга (cx, cy, r), если `(x−cx)² + (y−cy)² ≤ r²`.

## Интерфейс

```ts
export class Mask {
  readonly w: number;
  readonly h: number;
  readonly d: Uint8Array;
  constructor(w: number, h: number, data?: Uint8Array); // data копируется (new Uint8Array(data)), без data — всё воздух
  solid(x: number, y: number): boolean;
  set(x: number, y: number, v: 0 | 1): void;
  count(): number;                                       // сколько всего земли
  fillRect(x: number, y: number, w: number, h: number): void; // обрезать по краям карты
  fillCircle(cx: number, cy: number, r: number): number; // сколько пикселей стало землёй
  carveCircle(cx: number, cy: number, r: number): number; // сколько земли удалено
  carveSegment(x0: number, y0: number, x1: number, y1: number, r: number): number; // капсула, сколько удалено
  countCircle(cx: number, cy: number, r: number): number; // сколько земли в круге
  hitsCircle(cx: number, cy: number, r: number): boolean; // есть ли земля в круге (выход на первом найденном)
  normal(cx: number, cy: number, r: number): [number, number]; // сумма (cx−x, cy−y) по всем пикселям земли в круге; нет земли → [0, 0]
  raycast(x0: number, y0: number, x1: number, y1: number): [number, number] | null; // Брезенхем от (x0,y0) до (x1,y1) включительно; первый твёрдый пиксель
  surfaceBelow(x: number, y: number): number; // первый y' ≥ y в столбце x, где земля; x вне карты или земли нет → −1
  hash(): number;  // FNV-1a по байтам d: h = 0x811C9DC5; h = Math.imul(h ^ b, 0x01000193) >>> 0; результат беззнаковый
}
```

## Подсказки по реализации

- **Круг — построчно:** для каждой строки dy от −r до r полуширина `hw` = наибольшее целое с `hw² ≤ r² − dy²` (считать целочисленно: начни с предыдущего значения и уменьшай, пока `hw*hw > r*r - dy*dy`, или двоичным поиском). Дальше отрезок x от `cx−hw` до `cx+hw`, обрезанный по краям карты, — цикл по `d` подряд. Без проверки каждого пикселя через solid() — это медленно (есть тест скорости).
- **carveSegment:** пиксель удаляется, если расстояние² до отрезка ≤ r². Обходи рамку отрезка ± r; расстояние до отрезка — целочисленно: проекция `t = ((px−x0)(x1−x0) + (py−y0)(y1−y0))`, длина² `L = (x1−x0)² + (y1−y0)²`; если `t ≤ 0` — до точки 0, если `t ≥ L` — до точки 1, иначе расстояние² = `cross² / L`, где `cross = (px−x0)(y1−y0) − (py−y0)(x1−x0)`; сравнивай `cross² ≤ r² · L` (без деления). Если `L = 0` — это круг.
- **raycast:** классический Брезенхем на целых, проверяет каждый пиксель линии, начиная с первого.
- Комментарии по-русски, коротко. TypeScript strict.

## Проверка (из `lavochka/`)

```
npx vitest run tests/gops
npx tsc --noEmit
```

Готово, когда все тесты в `tests/gops` зелёные (кроме чужих, ещё не сделанных заданий) и tsc без ошибок.
