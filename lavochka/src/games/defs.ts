/* Описания игр без DOM — для сервера (он ведёт партии сам). */
import type { GameDef } from '../core/types';
import { loadDict } from '../words/dict';
import { loadClues } from '../words/clues';

export const DEFS: Record<string, () => Promise<GameDef>> = {
  shishbesh: () => import('./shishbesh/def').then((m) => m.def),
  hodilki: () => import('./hodilki/def').then((m) => m.def),
  manager: () => import('./manager/def').then((m) => m.def),
  vorona: () => import('./vorona/def').then((m) => m.def),
  western: () => import('./western/def').then((m) => m.def),
  star: () => import('./star/def').then((m) => m.def),
  djio: () => import('./djio/def').then((m) => m.def),
  korona: () => import('./korona/def').then((m) => m.def),
  beglye: () => import('./beglye/def').then((m) => m.def),
  nardy: () => import('./nardy/def').then((m) => m.def),
  durak: () => import('./durak/def').then((m) => m.def),
  chess: () => import('./chess/def').then((m) => m.def),
  billiards: () => import('./billiards/def').then((m) => m.def),
  hockey: () => import('./hockey/def').then((m) => m.def),
  basketball: () => import('./basketball/def').then((m) => m.def),
  football: () => import('./football/def').then((m) => m.def),
  zarulem: () => import('./zarulem/def').then((m) => m.def),
  checkers: () => import('./checkers/def').then((m) => m.def),
  domino: () => import('./domino/def').then((m) => m.def),
  seabattle: () => import('./seabattle/def').then((m) => m.def),
  dots: () => import('./dots/def').then((m) => m.def),
  puzzles: () => Promise.all([import('./puzzles/def'), loadClues()]).then(([m]) => m.def),
  thousand: () => import('./thousand/def').then((m) => m.def),
  bura: () => import('./bura/def').then((m) => m.def),
  '101': () => import('./sto/def').then((m) => m.def),
  preferans: () => import('./preferans/def').then((m) => m.def),
  holdem: () => import('./holdem/def').then((m) => m.def),
  solitaire: () => import('./solitaire/def').then((m) => m.def),
  geo: () => import('./geo/def').then((m) => m.def),
  mafia: () => import('./mafia/def').then((m) => m.def),
  balda: () => Promise.all([import('./balda/def'), loadDict()]).then(([m]) => m.def),
  erudit: () => Promise.all([import('./erudit/def'), loadDict()]).then(([m]) => m.def),
};
