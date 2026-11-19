/* Симулятор дирижёра — карьера: что пройдено, звёзды, гонорары, улучшения оркестра, настрой и сыгранность.
 * Без DOM: хранение — снаружи (save.ts). */
import { CONCERTS, PIECES, type DiffName } from './pieces';
import type { InstrId } from './score';

/** Семьи оркестра (улучшения и настрой — по ним; строки ленты собираются из инструментов семей). */
export type Family = 'str' | 'ww' | 'br' | 'perc';
export const FAMILIES: { id: Family; name: string }[] = [
  { id: 'str', name: 'Струнные' },
  { id: 'ww', name: 'Деревянные духовые' },
  { id: 'br', name: 'Медные духовые' },
  { id: 'perc', name: 'Ударные' },
];
export const FAMILY_OF: Record<InstrId, Family> = {
  vn1: 'str', vn2: 'str', va: 'str', vc: 'str', cb: 'str', harp: 'str',
  picc: 'ww', fl: 'ww', ob: 'ww', eh: 'ww', cl: 'ww', bcl: 'ww', bn: 'ww', cbn: 'ww',
  hn: 'br', tp: 'br', tb: 'br', tu: 'br', timp: 'perc', perc: 'perc', cel: 'perc',
};

export interface Upgrade {
  id: string;
  name: string;
  about: string;
  /** Цена уровня 1, 2, 3. */
  cost: [number, number, number];
}

/** Улучшения: «новые музыканты» семьи (окно попадания шире на 10 % за уровень), «чай в перерыве» (настрой). */
export const UPGRADES: Upgrade[] = [
  ...FAMILIES.map((f) => ({ id: `hire-${f.id}`, name: `${f.name}: новые музыканты`, about: 'Опытнее — прощают неточный показ (окно попадания шире на 10 % за уровень).', cost: [60, 180, 420] as [number, number, number] })),
  { id: 'tea', name: 'Чай и пирожки в перерыве', about: 'Оркестр выходит на сцену в хорошем настроении (+8 к настрою за уровень).', cost: [50, 150, 350] },
  { id: 'stands', name: 'Новые пюпитры и свет', about: 'Подсказка «кто вступает» над группой и на концерте.', cost: [120, 0, 0] },
];

export interface CareerState {
  v: 1;
  /** Имя дирижёра (для афиши). */
  name: string;
  /** Лучшие звёзды за концерт (0 — не пройден). */
  stars: Record<string, number>;
  best: Record<string, number>;
  money: number;
  upgrades: Record<string, number>;
  /** Настрой семей 0..100. */
  mood: Record<Family, number>;
  /** Сыгранность пьес 0..3 (репетиции). */
  rehearsed: Record<string, number>;
  /** Сколько концертов сыграно (для отзывов). */
  played: number;
  /** Свои переложения. */
  arrangements: Arrangement[];
}

/** Переложение: какую партию (номер в партитуре) каким инструментом играть; пусто — молчит; два — удвоение. */
export interface Arrangement {
  id: string;
  name: string;
  piece: string;
  map: Record<number, InstrId[]>;
}

export function newCareer(name = 'Маэстро'): CareerState {
  return { v: 1, name, stars: {}, best: {}, money: 0, upgrades: {}, mood: { str: 70, ww: 70, br: 70, perc: 70 }, rehearsed: {}, played: 0, arrangements: [] };
}

export function validCareer(x: unknown): x is CareerState {
  const c = x as CareerState;
  return !!c && c.v === 1 && typeof c.stars === 'object' && typeof c.money === 'number' && typeof c.mood === 'object';
}

/** Открыт ли концерт: первый — всегда, дальше — после прохождения предыдущего (хотя бы одна звезда). */
export function unlocked(c: CareerState, concertId: string): boolean {
  const i = CONCERTS.findIndex((x) => x.id === concertId);
  if (i <= 0) return i === 0;
  return (c.stars[CONCERTS[i - 1].id] ?? 0) > 0;
}

export function nextConcert(c: CareerState): string | null {
  return CONCERTS.find((x) => !(c.stars[x.id] > 0))?.id ?? null;
}

/** Пьесы, которые уже встречались на открытых концертах (для репетиции и свободной сцены). */
export function openPieces(c: CareerState): string[] {
  const out = new Set<string>();
  for (const x of CONCERTS) if (unlocked(c, x.id)) x.pieces.forEach((p) => out.add(p));
  return PIECES.map((p) => p.id).filter((id) => out.has(id));
}

export function reputation(c: CareerState): number {
  return Object.values(c.stars).reduce((a, b) => a + b, 0);
}

export const level = (c: CareerState, id: string): number => c.upgrades[id] ?? 0;

export function buy(c: CareerState, id: string): boolean {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return false;
  const lv = level(c, id);
  const price = u.cost[lv];
  if (!price || c.money < price) return false;
  c.money -= price;
  c.upgrades[id] = lv + 1;
  return true;
}

/** Окно попадания по инструментам строки: среднее «новых музыкантов» семей строки. */
export function widenFor(c: CareerState, laneInstr: InstrId[][]): number[] {
  return laneInstr.map((list) => {
    const fams = [...new Set(list.map((i) => FAMILY_OF[i]))];
    const lv = fams.reduce((a, f) => a + level(c, `hire-${f}`), 0) / Math.max(1, fams.length);
    return 1 + 0.1 * lv;
  });
}

export function moodFor(c: CareerState, laneInstr: InstrId[][]): number[] {
  const tea = level(c, 'tea') * 8;
  return laneInstr.map((list) => {
    const fams = [...new Set(list.map((i) => FAMILY_OF[i]))];
    const m = fams.reduce((a, f) => a + (c.mood[f] ?? 70), 0) / Math.max(1, fams.length);
    return Math.min(100, m + tea);
  });
}

export interface PlayedPiece {
  piece: string;
  stars: number;
  score: number;
  failed: boolean;
  /** Настрой по строкам в конце и инструменты строк — вернуть в семьи. */
  mood: number[];
  laneInstr: InstrId[][];
}

/** Итог концерта в карьеру. Звёзды концерта — наименьшие по пьесам (провал любой — провал). Возвращает гонорар. */
export function settleConcert(c: CareerState, concertId: string, played: PlayedPiece[]): { stars: number; fee: number; first: boolean } {
  const con = CONCERTS.find((x) => x.id === concertId);
  if (!con) return { stars: 0, fee: 0, first: false };
  const failed = played.some((p) => p.failed);
  const stars = failed ? 0 : Math.min(...played.map((p) => p.stars));
  const score = played.reduce((a, p) => a + p.score, 0);
  const before = c.stars[concertId] ?? 0;
  const first = before === 0 && stars > 0;
  // гонорар: за звёзды сверх прежнего лучшего (переигрывать выгодно, но не бесконечно) + понемногу всегда
  const fee = stars > 0 ? con.fee * Math.max(0, stars - before) + Math.round(con.fee * 0.2) : 0;
  c.money += fee;
  c.stars[concertId] = Math.max(before, stars);
  c.best[concertId] = Math.max(c.best[concertId] ?? 0, score);
  c.played++;
  // настрой: конец концерта → в семьи (среднее по строкам семьи)
  const acc: Record<Family, number[]> = { str: [], ww: [], br: [], perc: [] };
  for (const p of played)
    p.laneInstr.forEach((list, li) => {
      for (const f of new Set(list.map((i) => FAMILY_OF[i]))) acc[f].push(p.mood[li]);
    });
  for (const f of Object.keys(acc) as Family[]) if (acc[f].length) c.mood[f] = Math.round(acc[f].reduce((a, b) => a + b, 0) / acc[f].length);
  return { stars, fee, first };
}

/** Между концертами настрой возвращается к 70 (наполовину). */
export function restDay(c: CareerState): void {
  for (const f of Object.keys(c.mood) as Family[]) c.mood[f] = Math.round(c.mood[f] + (70 - c.mood[f]) * 0.5);
}

/** Репетиция пьесы доиграна: +1 к сыгранности, если точность ≥ 60 % (не больше 3). */
export function rehearsed(c: CareerState, piece: string, acc: number): boolean {
  const r = c.rehearsed[piece] ?? 0;
  if (acc < 0.6 || r >= 3) return false;
  c.rehearsed[piece] = r + 1;
  return true;
}

export function diffOf(name: DiffName): DiffName {
  return name;
}

// ---------------------------------------------------------------- критик

/** Отзыв критика: по звёздам, лучшей и худшей группе. lanes — названия строк, miss — промахи по строкам. */
export function review(opts: { hall: string; piece: string; stars: number; failed: boolean; lanes: string[]; miss: number[]; total: number[]; arranged?: boolean }, seed = 1): string {
  let s = seed >>> 0 || 1;
  const pick = <T>(a: T[]): T => {
    s = (s * 1103515245 + 12345) >>> 0;
    return a[s % a.length];
  };
  const { hall, piece, stars, failed, lanes, miss, total } = opts;
  const rate = lanes.map((_, i) => (total[i] ? miss[i] / total[i] : 0));
  const worst = rate.indexOf(Math.max(...rate));
  const best = rate.indexOf(Math.min(...rate));
  if (failed)
    return pick([
      `${hall}: публика начала расходиться задолго до финала. «${piece}» развалилась — оркестр явно не понимал, чего от него хотят.`,
      `Неловкий вечер в зале «${hall}». Группы вступали кто во что горазд; к середине «${piece}» половина партера уже искала гардероб.`,
    ]);
  const opening =
    stars >= 5
      ? pick([`Триумф! ${hall} аплодировал стоя.`, `Это был вечер, о котором будут вспоминать: ${hall} взорвался овацией.`, `Безупречно. ${hall} давно не слышал такой собранности.`])
      : stars >= 4
        ? pick([`Сильное выступление: ${hall} провожал оркестр долгими аплодисментами.`, `Уверенная работа дирижёра — ${hall} остался доволен.`])
        : stars >= 3
          ? pick([`Добротный концерт: ${hall} аплодировал вежливо, но тепло.`, `Неплохо, хотя до совершенства далеко.`])
          : pick([`Скромно. ${hall} хлопал скорее из уважения к Бетховену и Брамсу.`, `Вечер с шероховатостями: оркестр местами терял нить.`]);
  const good = best >= 0 && lanes[best] ? pick([` Особенно хороши были ${lanes[best].toLowerCase()} — точные, живые вступления.`, ` Лучше всех звучали ${lanes[best].toLowerCase()}.`]) : '';
  const bad = worst >= 0 && rate[worst] > 0.15 && worst !== best ? pick([` А вот ${lanes[worst].toLowerCase()} вступали робко и вразнобой — им бы ещё репетицию.`, ` Подвели ${lanes[worst].toLowerCase()}: дирижёр будто забывал о них.`]) : '';
  const arr = opts.arranged ? pick([' Смелая авторская редакция партитуры удивила даже знатоков.', ' Публика оценила необычное переложение — свежо и со вкусом.']) : '';
  return opening + good + bad + arr;
}
