/* Кампании: сюжеты поверх карты и приключений книги. Каждая — свой файл в campaigns/, здесь только реестр и формат. */
import type { Cond, Scene, Site, Step } from '../script';

export interface Trigger {
  /** Когда: отряд вошёл в узел карты, в место, в комнату места, начался день, взведён флаг. */
  on: 'node' | 'site' | 'room' | 'day' | 'flag';
  node?: number;
  site?: string;
  room?: string;
  day?: number;
  flag?: string;
  if?: Cond;
  /** id сцены кампании. */
  scene: string;
  /** Сработать один раз (по умолчанию да). */
  once?: boolean;
}

export interface Campaign {
  id: string;
  title: string;
  /** Подпись в выборе режима. */
  hint: string;
  /** Пролог (в Форпосте, до первого шага). */
  intro: Step[];
  /** Сцены кампании: ключ — id сцены (ключ движка — 'camp:<campaign>:<id>'). */
  scenes: Record<string, Scene>;
  /** Свои места с планом (деревни, пещеры) — id 'k1-<что-то>'; card 0 — без карточки замка. */
  sites?: Record<string, Site>;
  /** Свои места на белых узлах карты. */
  places?: { node: number; site: string }[];
  /** Раскладка замков по местам карты (15 id; по умолчанию — книжная). */
  layout?: string[];
  /** Сюжетные события. */
  triggers?: Trigger[];
  /** Подменить сцену комнаты замка своей: 'c3:7' → id сцены кампании. */
  rooms?: Record<string, string>;
  /** Дорожные встречи: книжные «Прочее», свои (id сцен кампании с метками) или и то и другое. */
  road?: 'book' | 'own' | 'both';
  roadScenes?: string[];
  /** Эпилог победы. */
  victory?: string;
}

import { k1 } from './campaigns/k1';
import { k2 } from './campaigns/k2';
import { k3 } from './campaigns/k3';

/** Пустые заготовки (без пролога) в выборе режима не показываются. */
export const CAMPAIGNS: Record<string, Campaign> = Object.fromEntries([k1, k2, k3].filter((k) => k.intro.length).map((k) => [k.id, k]));
