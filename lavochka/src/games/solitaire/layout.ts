/* «Пасьянсы» — где на столе лежит каждая стопка. Без DOM: только числа (центры карт на сцене).
 * Сцена — альбомная 1000×760 или вертикальная 540×960 (телефон); размер карты подбирается по числу столбцов. */
import { CH, CW } from '../../cards/stage';
import type { Cfg, GameId, Kind } from './engine';
import { PEAK_COVER, pyrSlot } from './games';

/** Как раскладываются карты стопки: лесенкой вниз, веером вправо (три карты сброса), стопкой. */
export type Fan = 'down' | 'w3' | 'stack';

export interface PileGeo {
  x: number;
  y: number;
  fan: Fan;
  /** Слой стопки (пирамида: нижние ряды поверх верхних). */
  z: number;
}

export interface Geo {
  W: number;
  H: number;
  /** Масштаб карт. */
  s: number;
  piles: PileGeo[];
  /** Нижняя граница для лесенок (сжимаются, чтобы влезть). */
  bottom: number;
}

export const LAND = { W: 1000, H: 760 };
export const PORT = { W: 540, H: 960 };

/** Столбцовые пасьянсы: верхний ряд (колода, сброс, дома, ячейки) в тех же колонках, ниже — столбцы. */
function columns(W: number, H: number, n: number, top: [number, number][], tabs: number[], kinds: Kind[], wasteFan: Fan, maxS = 1): Geo {
  const m = 10;
  const step = (W - 2 * m) / n;
  const s = Math.min(maxS, (step * 0.9) / CW);
  const col = (i: number) => m + step * (i + 0.5);
  const topY = 12 + (CH * s) / 2;
  const tabY = topY + CH * s + 18;
  const piles: PileGeo[] = kinds.map(() => ({ x: 0, y: 0, fan: 'stack' as Fan, z: 0 }));
  for (const [pile, c] of top) piles[pile] = { x: col(c), y: topY, fan: kinds[pile] === 'waste' ? wasteFan : 'stack', z: 0 };
  tabs.forEach((pile, i) => (piles[pile] = { x: col(i), y: tabY, fan: 'down', z: 0 }));
  return { W, H, s, piles, bottom: H - 8 - (CH * s) / 2 };
}

const range = (a: number, n: number) => Array.from({ length: n }, (_, i) => a + i);

export function geoOf(game: GameId, cfg: Cfg, kinds: Kind[], port: boolean): Geo {
  const { W, H } = port ? PORT : LAND;
  const idx = (k: Kind) => kinds.map((x, i) => (x === k ? i : -1)).filter((i) => i >= 0);
  const found = idx('found');
  const tabs = idx('tab');
  switch (game) {
    case 'klondike':
      return columns(W, H, 7, [[0, 0], [1, 1], ...found.map((f, i) => [f, 3 + i] as [number, number])], tabs, kinds, cfg.draw === 3 ? 'w3' : 'stack');
    case 'scorpion':
      return columns(W, H, 7, [[0, 0], ...found.map((f, i) => [f, 3 + i] as [number, number])], tabs, kinds, 'stack');
    case 'spider':
      return columns(W, H, 10, [...found.map((f, i) => [f, i] as [number, number]), [0, 9]], tabs, kinds, 'stack');
    case 'freecell': {
      const cells = idx('cell');
      return columns(W, H, 8, [...cells.map((c, i) => [c, i] as [number, number]), ...found.map((f, i) => [f, 4 + i] as [number, number])], tabs, kinds, 'stack');
    }
    case 'thieves':
      return columns(W, H, 10, [[0, 0], [1, 1], ...found.map((f, i) => [f, 2 + i] as [number, number])], tabs, kinds, 'w3');
    case 'golf': {
      const g = columns(W, H, 7, [], tabs, kinds, 'stack', 0.95);
      const y = H - 20 - (CH * g.s) / 2;
      g.piles[0] = { x: W / 2 - CW * g.s * 1.4, y, fan: 'stack', z: 0 };
      g.piles[1] = { x: W / 2 + CW * g.s * 0.2, y, fan: 'w3', z: 0 };
      g.piles.forEach((p, i) => i >= 2 && (p.y = 12 + (CH * g.s) / 2));
      g.bottom = y - CH * g.s * 0.7;
      return g;
    }
    case 'pyramid': {
      const step = Math.min(96, (W - 20) / 7);
      const s = Math.min(0.9, (step * 0.92) / CW);
      const dy = CH * s * 0.42;
      const piles: PileGeo[] = kinds.map(() => ({ x: 0, y: 0, fan: 'stack' as Fan, z: 0 }));
      for (let r = 0; r < 7; r++) for (let k = 0; k <= r; k++) piles[3 + pyrSlot(r, k)] = { x: W / 2 + (k - r / 2) * step, y: 14 + (CH * s) / 2 + r * dy, fan: 'stack', z: r * 2 };
      const y = 14 + (CH * s) / 2 + 6 * dy + CH * s + 30;
      piles[0] = { x: W / 2 - step * 2.4, y, fan: 'stack', z: 0 };
      piles[1] = { x: W / 2 - step * 1.1, y, fan: 'stack', z: 0 };
      piles[2] = { x: W / 2 + step * 2.4, y, fan: 'stack', z: 0 };
      return { W, H, s, piles, bottom: H };
    }
    case 'tripeaks': {
      const step = Math.min(90, (W - 16) / 10);
      const s = Math.min(0.85, (step * 0.92) / CW);
      const dy = CH * s * 0.4;
      const piles: PileGeo[] = kinds.map(() => ({ x: 0, y: 0, fan: 'stack' as Fan, z: 0 }));
      const xs: number[] = [];
      for (let j = 0; j < 10; j++) xs[18 + j] = W / 2 + (j - 4.5) * step;
      for (let slot = 17; slot >= 0; slot--) xs[slot] = (xs[PEAK_COVER[slot][0]] + xs[PEAK_COVER[slot][1]]) / 2;
      const row = (slot: number) => (slot < 3 ? 0 : slot < 9 ? 1 : slot < 18 ? 2 : 3);
      for (let slot = 0; slot < 28; slot++) piles[2 + slot] = { x: xs[slot], y: 14 + (CH * s) / 2 + row(slot) * dy, fan: 'stack', z: row(slot) * 2 };
      const y = 14 + (CH * s) / 2 + 3 * dy + CH * s + 40;
      piles[0] = { x: W / 2 - step * 1.4, y, fan: 'stack', z: 0 };
      piles[1] = { x: W / 2 + step * 0.4, y, fan: 'w3', z: 0 };
      return { W, H, s, piles, bottom: H };
    }
    case 'well': {
      // как в PySol: колода и пять сбросов сверху, ниже — ромб резервов, вокруг — столбцы, по углам — дома
      const gx = (W - 20) / 6;
      const gy = (H - 24) / 6.3;
      const s = Math.min(0.85, (gx * 0.9) / CW, (gy * 0.92) / CH);
      const at = (x: number, y: number, fan: Fan = 'stack'): PileGeo => ({ x: 10 + gx * (x + 0.5), y: 12 + (CH * s) / 2 + gy * y, fan, z: 0 });
      const piles: PileGeo[] = kinds.map(() => at(0, 0));
      piles[0] = at(0, 0);
      for (let w = 0; w < 5; w++) piles[1 + w] = at(1 + w, 0);
      [
        [4.5, 1.6],
        [1.5, 4.6],
        [4.5, 4.6],
        [1.5, 1.6],
      ].forEach(([x, y], i) => (piles[6 + i] = at(x, y)));
      [
        [1, 3.1],
        [3, 1.1],
        [5, 3.1],
        [3, 5.1],
      ].forEach(([x, y], i) => (piles[10 + i] = at(x, y)));
      piles[14] = at(0, 1.1);
      [
        [2, 3.1],
        [3, 2.1],
        [4, 3.1],
        [3, 4.1],
      ].forEach(([x, y], i) => (piles[15 + i] = at(x, y)));
      return { W, H, s, piles, bottom: H };
    }
  }
  return columns(W, H, 7, [], range(0, kinds.length), kinds, 'stack');
}
