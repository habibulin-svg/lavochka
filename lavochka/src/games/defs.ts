/* Описания игр без DOM — для сервера (он ведёт партии сам). */
import type { GameDef } from '../core/types';

export const DEFS: Record<string, () => Promise<GameDef>> = {
  shishbesh: () => import('./shishbesh/def').then((m) => m.def),
  nardy: () => import('./nardy/def').then((m) => m.def),
  durak: () => import('./durak/def').then((m) => m.def),
};
