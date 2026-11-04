/* Шаблоны случайных карт (DESIGN.md §7.1): граф зон для одной «доли» карты; генератор поворачивает её на остальных игроков. */

export type SizeId = 's' | 'm' | 'l';
export type ZoneKind = 'start' | 'mid' | 'treasure' | 'center' | 'water';

export interface ZoneT {
  id: string;
  kind: ZoneKind;
  /** Относительная площадь. */
  size: number;
  /** Местность: по фракции хозяина доли, случайная, вода. */
  terrain: 'owner' | 'random' | 'water';
  /** Ценность объектов на 100 клеток, в семках. */
  value: number;
  /** Одна на всех (центр); иначе — по зоне на игрока. */
  shared?: boolean;
  /** Где стоит в доле первого игрока, доли карты 0…1. Общая — всегда посередине. */
  at: [number, number];
}

export interface EdgeT {
  a: string;
  b: string;
  /** Сила стража на проходе: 0 — без стража, 1…3. */
  guard: number;
  /** Ребро к соседней доле: зона a своей доли — зона b следующей. */
  cross?: boolean;
}

export interface MapTemplate {
  id: string;
  name: string;
  text: string;
  players: number;
  sizes: SizeId[];
  /** Сухопутных переходов нет: между зонами море, нужна лодка. */
  islands?: boolean;
  zones: ZoneT[];
  edges: EdgeT[];
}

export const TEMPLATES: Record<string, MapTemplate> = {
  duel: {
    id: 'duel', name: 'Дуэль на зеркале', text: 'Двое, карта повёрнута на 180°: у каждого то же самое. Две дороги к центру с кладом.', players: 2, sizes: ['s', 'm', 'l'],
    zones: [
      { id: 'start', kind: 'start', size: 4, terrain: 'owner', value: 4500, at: [0.17, 0.2] },
      { id: 'near', kind: 'mid', size: 3, terrain: 'random', value: 6500, at: [0.17, 0.58] },
      { id: 'far', kind: 'treasure', size: 3, terrain: 'random', value: 9000, at: [0.52, 0.16] },
      { id: 'center', kind: 'center', size: 4, terrain: 'random', value: 12000, shared: true, at: [0.5, 0.5] },
    ],
    edges: [
      { a: 'start', b: 'near', guard: 1 },
      { a: 'start', b: 'far', guard: 1 },
      { a: 'near', b: 'center', guard: 2 },
      { a: 'far', b: 'center', guard: 2 },
      { a: 'far', b: 'near', guard: 3, cross: true },
    ],
  },
  four: {
    id: 'four', name: 'Четверо', text: 'Четыре угла, между соседями — общий край, в середине — сокровищница.', players: 4, sizes: ['m', 'l'],
    zones: [
      { id: 'start', kind: 'start', size: 4, terrain: 'owner', value: 4500, at: [0.15, 0.15] },
      { id: 'side', kind: 'mid', size: 3, terrain: 'random', value: 6500, at: [0.5, 0.12] },
      { id: 'inner', kind: 'treasure', size: 2.5, terrain: 'random', value: 9000, at: [0.3, 0.3] },
      { id: 'center', kind: 'center', size: 4, terrain: 'random', value: 12000, shared: true, at: [0.5, 0.5] },
    ],
    edges: [
      { a: 'start', b: 'side', guard: 1 },
      { a: 'side', b: 'start', guard: 2, cross: true },
      { a: 'start', b: 'inner', guard: 1 },
      { a: 'inner', b: 'center', guard: 3 },
    ],
  },
  islands: {
    id: 'islands', name: 'Острова', text: 'Двое на островах. На своём — верфь и лодка у берега, дальше — морем.', players: 2, sizes: ['m', 'l'], islands: true,
    zones: [
      { id: 'start', kind: 'start', size: 5, terrain: 'owner', value: 5000, at: [0.2, 0.22] },
      { id: 'isle', kind: 'treasure', size: 2, terrain: 'random', value: 10000, at: [0.2, 0.8] },
      { id: 'seaA', kind: 'water', size: 3, terrain: 'water', value: 0, at: [0.58, 0.14] },
      { id: 'seaB', kind: 'water', size: 3, terrain: 'water', value: 0, at: [0.12, 0.52] },
      { id: 'center', kind: 'center', size: 2.5, terrain: 'random', value: 13000, shared: true, at: [0.5, 0.5] },
    ],
    edges: [
      { a: 'start', b: 'seaA', guard: 0 },
      { a: 'start', b: 'seaB', guard: 0 },
      { a: 'isle', b: 'seaB', guard: 0 },
      { a: 'isle', b: 'seaA', guard: 0, cross: true },
      { a: 'seaA', b: 'center', guard: 0 },
      { a: 'seaB', b: 'center', guard: 0 },
    ],
  },
  ring: {
    id: 'ring', name: 'Кольцо', text: 'Четверо по кругу вокруг озера: у каждого два соседа и свой тупик с кладом.', players: 4, sizes: ['m', 'l'],
    zones: [
      { id: 'start', kind: 'start', size: 4, terrain: 'owner', value: 4500, at: [0.17, 0.17] },
      { id: 'link', kind: 'mid', size: 3, terrain: 'random', value: 7000, at: [0.5, 0.12] },
      { id: 'pocket', kind: 'treasure', size: 2, terrain: 'random', value: 10000, at: [0.32, 0.34] },
      { id: 'lake', kind: 'water', size: 3, terrain: 'water', value: 0, shared: true, at: [0.5, 0.5] },
    ],
    edges: [
      { a: 'start', b: 'link', guard: 1 },
      { a: 'link', b: 'start', guard: 2, cross: true },
      { a: 'start', b: 'pocket', guard: 2 },
      { a: 'pocket', b: 'lake', guard: 0 },
    ],
  },
};
