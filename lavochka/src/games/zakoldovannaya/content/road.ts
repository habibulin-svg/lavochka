/* «Прочее» — дорожные встречи книги ведущего (124 сцены). Сцены — в road-1.ts и road-2.ts. */
import type { Scene } from '../script';
import { ROAD_1 } from './road-1';
import { ROAD_2 } from './road-2';

export const ROAD: Scene[] = [...ROAD_1, ...ROAD_2];
