/* Приключения книги ведущего: 15 мест (c1–c15) и Форпост. Каждое место — свой файл c<N>.ts. */
import type { Site } from '../script';
import { c1 } from './c1';
import { c2 } from './c2';
import { c3 } from './c3';
import { c4 } from './c4';
import { c5 } from './c5';
import { c6 } from './c6';
import { c7 } from './c7';
import { c8 } from './c8';
import { c9 } from './c9';
import { c10 } from './c10';
import { c11 } from './c11';
import { c12 } from './c12';
import { c13 } from './c13';
import { c14 } from './c14';
import { c15 } from './c15';
import { forpost } from './forpost';

export const BOOK_SITES: Record<string, Site> = {
  forpost,
  c1,
  c2,
  c3,
  c4,
  c5,
  c6,
  c7,
  c8,
  c9,
  c10,
  c11,
  c12,
  c13,
  c14,
  c15,
};

/** Названия 15 замков и городов (как в книге). */
export const BOOK_TITLES: Record<string, string> = {
  c1: 'Замок «Бешеные деньги»',
  c2: 'Железный замок',
  c3: 'Замок происшествий',
  c4: 'Каменный город',
  c5: 'Замок страха и ужаса',
  c6: 'Мёртвый замок',
  c7: 'Город Граунд',
  c8: 'Отель «Весёлая ночка»',
  c9: 'Коготь дракона',
  c10: 'Владения Чёрного мага',
  c11: 'Смерть в лесу',
  c12: 'Подземный замок',
  c13: 'Домик людоедов',
  c14: 'Замок убийств',
  c15: 'Башня зла',
};
