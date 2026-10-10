/* Описания игр без DOM — для сервера (он ведёт партии сам). */
import type { GameDef } from '../core/types';

export const DEFS: Record<string, () => Promise<GameDef>> = {
  shishbesh: () => import('./shishbesh/def').then((m) => m.def),
  nardy: () => import('./nardy/def').then((m) => m.def),
  durak: () => import('./durak/def').then((m) => m.def),
  chess: () => import('./chess/def').then((m) => m.def),
  checkers: () => import('./checkers/def').then((m) => m.def),
  domino: () => import('./domino/def').then((m) => m.def),
};
