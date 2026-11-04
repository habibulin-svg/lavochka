/* Кампании первого выпуска, тексты роликов и прохождение (localStorage). */
import { ZATULYE } from './zatulye';
import { AKADEMIYA } from './akademiya';
import type { CampaignDef, Carry, Difficulty } from './types';

export const CAMPAIGNS: CampaignDef[] = [ZATULYE, AKADEMIYA];

/** Вступление — во весь экран, перед первой кампанией. */
export const INTRO = ['intro-1', 'intro-2', 'intro-3', 'intro-4', 'intro-5', 'intro-6'];

/** Строки под роликом (CAMPAIGNS.md): каждая — отдельный щелчок. */
export const CUTSCENE_TEXT: Record<string, string[]> = {
  'intro-1': ['Июль девяносто пятого. Новосибирск. Каникулы, жара и ничего не происходит.'],
  'intro-2': ['На стройке у Тулы Серёга нашёл кастет. Старый, латунный — и тёплый, будто живой.'],
  'intro-3': ['Потом было затмение. Хотя по радио ни про какое затмение не говорили.'],
  'intro-4': ['Кастет треснул на восемь кусков. И каждый унёс кого-то из нас.'],
  'intro-5': ['Я очнулся в траве. Над головой — две луны. В кулаке — осколок кастета.'],
  'intro-6': ['Затулинки больше не было. На её месте стоял другой мир. И он меня, похоже, ждал.'],
  'c1-1a': ['— Тула! Вернулся!', '— Дед, я тебя первый раз вижу.', '— Зато мы тебя ждали триста лет.'],
  'c1-2a': ['С бродов гонец: из тумана выходят лягушки с трубками. Много лягушек.'],
  'c1-2b': ['На том берегу, говорят, сидит новый болотный князь. Здоровый, ленивый и очень упрямый. Похож на Димона с Затона.'],
  'c1-3a': ['— Димон, это ж я!', '— Знаю. Здесь, Серёга, рыба клюёт без перерыва. Я домой не пойду.'],
  'c1-3b': ['Но в болото пришли не только мы. Чёрные всадники искали то же, что и я.'],
  'c1-4a': ['Обелиск гудел, как трансформатор на Затулинке. Под ним лежал осколок. А перед ним — войско Старшого.'],
  'c1-fin1': ['Осколки срослись сами. Кастет помнил, каким он был.'],
  'c1-fin2': ['Старшой. Кто он — никто не знал. Но говорил он, как у нас во дворе.'],
  'c1-fin3': ['— Ну что, Сом, идём за остальными?', '— Идём. Но рыбалку я тебе потом покажу.'],
  'c2-1a': ['Я проснулась под куполом. Кругом телескопы, как у мамы в институте. Только мамины не разговаривали.'],
  'c2-1b': ['— Та, что считает звёзды!', '— Я считаю всё. Это не повод кланяться.'],
  'c2-2a': ['На востоке дымила Кузня. Там строили машины, которым не нужны ни сон, ни звёзды.'],
  'c2-2b': ['— Шлак?!', '— Кнопка?! Слушай, тут из железа можно собрать что угодно. Я мопед себе сделал. Шагающий.'],
  'c2-3a': ['Заклинание показало восемь огней. Восемь осколков. Значит, кастет можно собрать.'],
  'c2-3b': ['А через минуту карту украли. Вор был в кепке. Такие носили только у нас.'],
  'c2-4a': ['Звёзды падали, как семечки из кулька. Под каждой — пожар. Под самой большой — осколок.'],
  'c2-fin1': ['Второй осколок. Тёплый. Как тот, что у Серёги.'],
  'c2-fin2': ['В сумке вора нашлось фото. Наш двор. Восемьдесят третий год. Старшой — один из нас.'],
  'c2-fin3': ['Я отправила свет на запад, туда, где Тула. Серёга должен увидеть.'],
  win: ['Победа.'],
  lose: ['Поражение.'],
};

export interface CampaignProgress {
  /** Сколько сценариев пройдено. */
  done: number;
  diff: Difficulty;
  carry: Carry | null;
  /** Лучшее по сценариям: дней на победу. */
  best: Record<string, number>;
}

const KEY = 'geroi-campaigns';
type All = { intro?: boolean; c: Record<string, CampaignProgress> };

function all(): All {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as All;
    return { intro: !!v.intro, c: v.c ?? {} };
  } catch {
    return { c: {} };
  }
}
function put(v: All): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* хранилище закрыто — прохождение живёт до перезагрузки */
  }
}

export const progressOf = (id: string): CampaignProgress => all().c[id] ?? { done: 0, diff: 'normal', carry: null, best: {} };
export function saveProgress(id: string, p: CampaignProgress): void {
  const v = all();
  v.c[id] = p;
  put(v);
}
export const introSeen = (): boolean => !!all().intro;
export function markIntro(): void {
  const v = all();
  v.intro = true;
  put(v);
}

export const campaignById = (id: string): CampaignDef | undefined => CAMPAIGNS.find((c) => c.id === id);
/** Сценарий по id мира: `c1-1` → кампания и номер. */
export function scenarioOf(id: string): { c: CampaignDef; i: number } | null {
  for (const c of CAMPAIGNS) {
    const i = c.scenarios.findIndex((s) => s.id === id);
    if (i >= 0) return { c, i };
  }
  return null;
}
