// Проверка лабиринта «Магии»: из каких клеток не дойти до выхода ходом на восток/север/юг.
// npx tsx tools/magiya/maze-check.ts
import { CELLS, X_D, mazeNext } from '../../src/games/magiya/data';

const maze = CELLS.filter((c) => c.region === 'maze');
const ok = new Set<number>([X_D]);
let changed = true;
while (changed) {
  changed = false;
  for (const c of maze) {
    if (!ok.has(c.id) && mazeNext(c.id).some((n) => ok.has(n))) {
      ok.add(c.id);
      changed = true;
    }
  }
}
const bad = maze.filter((c) => !ok.has(c.id)).map((c) => `r${c.rc![0]}c${c.rc![1]}`);
console.log('тупиков:', bad.length, bad.join(' '));
const dead = maze.filter((c) => mazeNext(c.id).length === 0).map((c) => `r${c.rc![0]}c${c.rc![1]}`);
console.log('без ходов совсем:', dead.join(' '));
