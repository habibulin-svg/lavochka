/** «Корона Эмбера», «Классика 1994» — все 200 карт приключений (сценарии — cards/c1…c4.ts). */
import { CARDS_1 } from './cards/c1';
import { CARDS_2 } from './cards/c2';
import { CARDS_3 } from './cards/c3';
import { CARDS_4 } from './cards/c4';
import type { AdvDef } from './script';

export const ADV: Record<number, AdvDef> = Object.fromEntries([...CARDS_1, ...CARDS_2, ...CARDS_3, ...CARDS_4].map((c) => [c.n, c]));
