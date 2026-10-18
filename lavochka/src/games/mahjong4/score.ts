/* Подсчёт выигрышной руки по разным правилам. Без DOM.
 * Рука раскладывается всеми способами (обычная — сеты и пара, плюс семь пар и тринадцать сирот), для каждой — по стилю
 * считается ценность, берётся лучшая. Стили: hk — гонконгский (фань), riichi — японский (хан и фу), classic — китайский классический
 * (очки за сеты и удвоения), tw — тайваньский (таи), sc — сычуаньский (фань, без чоу, с «отсутствующей мастью»). */
import { isDragon, isHonor, isOrphan, isSuit, isTerminal, isWind, rankOf, suitOf } from '../mahjong/tiles';
import { decompose, isSevenPairs, isThirteen, type Counts, type Part } from './hand';

export type Style = 'hk' | 'riichi' | 'classic' | 'tw' | 'sc';

export interface Meld {
  t: 'chi' | 'pon' | 'kan';
  /** Младший вид (у ряда) или вид сета. */
  k: number;
  /** Выложен (взят с чужого сброса); закрытый конг — false. */
  open: boolean;
  ids: number[];
  /** У кого взята кость, и какая. */
  from?: number;
  called?: number;
  /** Конг из пона («добавленный»). */
  added?: boolean;
}

export interface WinInfo {
  style: Style;
  /** Закрытая часть с выигрышной костью. */
  closed: Counts;
  melds: Meld[];
  win: number;
  tsumo: boolean;
  seatWind: number;
  roundWind: number;
  dealer: boolean;
  /** Бонусные кости игрока (виды 34–41). */
  flowers: number[];
  sets: number;
  /** Особые обстоятельства. */
  riichi: 0 | 1 | 2;
  ippatsu: boolean;
  lastTile: boolean;
  rinshan: boolean;
  chankan: boolean;
  heaven: boolean;
  earth: boolean;
  /** Риичи: виды-доры по каждому указателю, ура-доры, число красных пятёрок. */
  dora: number[];
  ura: number[];
  aka: number;
  /** Число повторов дилера (тайвань: за каждый — по два тая). */
  repeat: number;
  /** Гонконг: потолок фаней; тайвань: без потолка. */
  limit: number;
  /** Риичи: открытые руки могут собирать «только простые». */
  kuitan: boolean;
}

export interface Item {
  name: string;
  v: number;
}

export interface Score {
  /** Ценность в единицах стиля: хан (риичи), фань, таи, очки (классика). Якуман — 13 хан на каждый. */
  value: number;
  items: Item[];
  /** Риичи: фу. */
  fu?: number;
  /** Риичи: есть ли яку (без доры). */
  yaku: boolean;
  /** Риичи: якуманов (0 — нет). */
  yakuman: number;
}

// ---------------------------------------------------------------- формы руки

type Wait = 'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki';

interface SetX {
  t: 'chi' | 'pon' | 'kan';
  k: number;
  concealed: boolean;
}

interface Shape {
  kind: 'normal' | 'seven' | 'thirteen';
  sets: SetX[];
  pair: number;
  wait: Wait;
  /** Все виды руки (по костям, с повторами). */
  tiles: number[];
}

function tilesOf(closed: Counts, melds: Meld[]): number[] {
  const r: number[] = [];
  closed.forEach((n, k) => {
    for (let i = 0; i < n; i++) r.push(k);
  });
  for (const m of melds) {
    if (m.t === 'chi') r.push(m.k, m.k + 1, m.k + 2);
    else for (let i = 0; i < (m.t === 'kan' ? 4 : 3); i++) r.push(m.k);
  }
  return r;
}

function shapes(w: WinInfo): Shape[] {
  const out: Shape[] = [];
  const tiles = tilesOf(w.closed, w.melds);
  const meldSets: SetX[] = w.melds.map((m) => ({ t: m.t, k: m.k, concealed: !m.open }));
  const need = w.sets - w.melds.length;
  for (const parts of decompose(w.closed, need)) {
    // выигрышная кость могла прийти в любой подходящий сет
    const seen = new Set<string>();
    parts.forEach((p, i) => {
      const has = p.t === 'chi' ? w.win >= p.k && w.win <= p.k + 2 : p.k === w.win;
      if (!has) return;
      const key = p.t + p.k;
      if (seen.has(key)) return;
      seen.add(key);
      let wait: Wait;
      if (p.t === 'pair') wait = 'tanki';
      else if (p.t === 'pon') wait = 'shanpon';
      else if (w.win === p.k + 1) wait = 'kanchan';
      else if ((w.win === p.k + 2 && rankOf(p.k) === 1) || (w.win === p.k && rankOf(p.k) === 7)) wait = 'penchan';
      else wait = 'ryanmen';
      const sets: SetX[] = [...meldSets];
      let pair = -1;
      parts.forEach((q, j) => {
        if (q.t === 'pair') pair = q.k;
        // пон, собранный чужим сбросом, — открытый (для фу и «спрятанных понов»)
        else sets.push({ t: q.t, k: q.k, concealed: !(j === i && q.t === 'pon' && !w.tsumo) });
      });
      out.push({ kind: 'normal', sets, pair, wait, tiles });
    });
  }
  if (w.melds.length === 0 && w.sets === 4 && isSevenPairs(w.closed)) out.push({ kind: 'seven', sets: [], pair: -1, wait: 'tanki', tiles });
  if (w.melds.length === 0 && w.sets === 4 && isThirteen(w.closed)) out.push({ kind: 'thirteen', sets: [], pair: -1, wait: 'tanki', tiles });
  return out;
}

// ---------------------------------------------------------------- общие признаки

const suitsIn = (tiles: number[]) => new Set(tiles.filter(isSuit).map(suitOf));
const hasHonor = (tiles: number[]) => tiles.some(isHonor);
const fullFlush = (t: number[]) => !hasHonor(t) && suitsIn(t).size === 1;
const halfFlush = (t: number[]) => hasHonor(t) && suitsIn(t).size === 1;
const allHonors = (t: number[]) => t.every(isHonor);
const allTerminals = (t: number[]) => t.every(isTerminal);
const allOrphans = (t: number[]) => t.every(isOrphan);
const allSimples = (t: number[]) => !t.some(isOrphan);
const pons = (s: Shape) => s.sets.filter((x) => x.t !== 'chi');
const chis = (s: Shape) => s.sets.filter((x) => x.t === 'chi');
const concealedHand = (w: WinInfo) => w.melds.every((m) => !m.open);
const dragonPons = (s: Shape) => pons(s).filter((x) => isDragon(x.k)).length;
const windPons = (s: Shape) => pons(s).filter((x) => isWind(x.k)).length;
const GREEN = new Set([19, 20, 21, 23, 25, 32]);

/** Чистые девять врат: одна масть, 1112345678999 + любая. */
function nineGates(w: WinInfo, t: number[]): boolean {
  if (!concealedHand(w) || w.melds.length || !fullFlush(t)) return false;
  const s = suitOf(t[0]) * 9;
  const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  return need.every((n, i) => w.closed[s + i] >= n);
}

function ownFlowers(w: WinInfo): number {
  return w.flowers.filter((f) => (f - 34) % 4 === w.seatWind).length;
}

function flowerSets(w: WinInfo): number {
  const f = w.flowers.filter((x) => x <= 37).length;
  const s = w.flowers.filter((x) => x >= 38).length;
  return (f === 4 ? 1 : 0) + (s === 4 ? 1 : 0);
}

// ---------------------------------------------------------------- Гонконг

function hk(w: WinInfo, s: Shape): Score {
  const it: Item[] = [];
  const t = s.tiles;
  const add = (name: string, v: number) => it.push({ name, v });
  const limit = (name: string) => ({ value: w.limit, items: [{ name, v: w.limit }], yaku: true, yakuman: 1 });
  if (w.heaven) return limit('Небесная рука');
  if (w.earth) return limit('Земная рука');
  if (s.kind === 'thirteen') return limit('Тринадцать сирот');
  if (nineGates(w, t)) return limit('Девять врат');
  if (allHonors(t)) return limit('Только честь');
  if (allTerminals(t)) return limit('Только крайние');
  if (s.kind === 'normal') {
    if (dragonPons(s) === 3) return limit('Большие три дракона');
    if (windPons(s) === 4) return limit('Большие четыре ветра');
    if (pons(s).filter((x) => x.t === 'kan').length === 4) return limit('Четыре конга');
    if (pons(s).length === 4 && pons(s).every((x) => x.concealed)) return limit('Четыре спрятанных пона');
  }
  if (w.tsumo) add('Взял сам', 1);
  if (concealedHand(w)) add('Закрытая рука', 1);
  if (w.flowers.length === 0) add('Без цветов', 1);
  const own = ownFlowers(w);
  if (own) add('Свой цветок', own);
  const fs = flowerSets(w);
  if (fs) add('Все четыре цветка' + (fs > 1 ? ' и сезона' : ''), 2 * fs);
  if (w.lastTile) add('Последняя кость', 1);
  if (w.rinshan) add('Кость за конг', 1);
  if (w.chankan) add('Ограбление конга', 1);
  if (fullFlush(t)) add('Чистая масть', 7);
  else if (halfFlush(t)) add('Масть с честью', 3);
  if (allOrphans(t)) add('Крайние и честь', 1);
  if (s.kind === 'seven') add('Семь пар', 4);
  else {
    const dp = dragonPons(s);
    if (dp === 2 && isDragon(s.pair)) add('Малые три дракона', 5);
    else if (dp) add('Пон дракона', dp);
    if (windPons(s) === 3 && isWind(s.pair)) add('Малые четыре ветра', 10);
    else {
      if (pons(s).some((x) => x.k === 27 + w.seatWind)) add('Свой ветер', 1);
      if (pons(s).some((x) => x.k === 27 + w.roundWind)) add('Ветер круга', 1);
    }
    if (pons(s).length === s.sets.length) add('Одни поны', 3);
    else if (chis(s).length === s.sets.length && !hasHonor(t.filter((k) => k !== s.pair)) && w.flowers.length === 0) add('Одни ряды', 1);
  }
  const value = Math.min(
    w.limit,
    it.reduce((a, b) => a + b.v, 0)
  );
  return { value, items: it, yaku: true, yakuman: value >= w.limit ? 1 : 0 };
}

// ---------------------------------------------------------------- Риичи

function riichiYaku(w: WinInfo, s: Shape): Score {
  const it: Item[] = [];
  const ym: Item[] = [];
  const t = s.tiles;
  const closed = concealedHand(w);
  const add = (name: string, v: number) => it.push({ name, v });
  const yk = (name: string, n = 1) => ym.push({ name, v: 13 * n });
  if (w.heaven) yk('Тэнхо — небесная рука');
  if (w.earth) yk('Тихо — земная рука');
  if (s.kind === 'thirteen') yk('Кокуси мусо — тринадцать сирот');
  if (allHonors(t)) yk('Цуисо — только честь');
  if (allTerminals(t)) yk('Тинрото — только крайние');
  if (t.every((k) => GREEN.has(k))) yk('Рюисо — всё зелёное');
  if (nineGates(w, t)) yk('Тюрен поото — девять врат');
  if (s.kind === 'normal') {
    if (dragonPons(s) === 3) yk('Дайсанген — большие три дракона');
    if (windPons(s) === 4) yk('Дайсуси — большие четыре ветра', 2);
    else if (windPons(s) === 3 && isWind(s.pair)) yk('Сёсуси — малые четыре ветра');
    if (pons(s).filter((x) => x.t === 'kan').length === 4) yk('Суканцу — четыре конга');
    if (pons(s).length === 4 && pons(s).every((x) => x.concealed)) yk('Суанко — четыре спрятанных пона');
  }
  if (ym.length) return { value: ym.reduce((a, b) => a + b.v, 0), items: ym, yaku: true, yakuman: ym.reduce((a, b) => a + b.v / 13, 0), fu: 0 };

  if (w.riichi === 2) add('Дабл риичи', 2);
  else if (w.riichi) add('Риичи', 1);
  if (w.ippatsu) add('Иппацу', 1);
  if (w.tsumo && closed) add('Мэндзэн цумо', 1);
  if (w.lastTile) add(w.tsumo ? 'Хайтэй — последняя кость' : 'Хотэй — последний сброс', 1);
  if (w.rinshan) add('Риншан кайхо — кость за конг', 1);
  if (w.chankan) add('Тянкан — ограбление конга', 1);
  if (allSimples(t) && (closed || w.kuitan)) add('Танъяо — только простые', 1);
  const flushBonus = closed ? 0 : -1;
  if (fullFlush(t)) add('Тиницу — чистая масть', 6 + flushBonus);
  else if (halfFlush(t)) add('Хоницу — масть с честью', 3 + flushBonus);
  if (s.kind === 'seven') {
    add('Тиитойцу — семь пар', 2);
    if (allOrphans(t)) add('Хонрото — крайние и честь', 2);
  } else {
    const dp = pons(s).filter((x) => isDragon(x.k));
    for (const d of dp) add(`Якухай — ${['белый', 'зелёный', 'красный'][d.k - 31]} дракон`, 1);
    if (pons(s).some((x) => x.k === 27 + w.seatWind)) add('Якухай — свой ветер', 1);
    if (pons(s).some((x) => x.k === 27 + w.roundWind)) add('Якухай — ветер круга', 1);
    if (dp.length === 2 && isDragon(s.pair)) add('Сёсанген — малые три дракона', 2);
    const pinfu = closed && chis(s).length === 4 && s.wait === 'ryanmen' && !isDragon(s.pair) && s.pair !== 27 + w.seatWind && s.pair !== 27 + w.roundWind;
    if (pinfu) add('Пинфу', 1);
    if (closed) {
      const cs = chis(s).map((x) => x.k);
      let dup = 0;
      const used = new Array(cs.length).fill(false);
      for (let i = 0; i < cs.length; i++)
        for (let j = i + 1; j < cs.length; j++)
          if (!used[i] && !used[j] && cs[i] === cs[j]) {
            used[i] = used[j] = true;
            dup++;
          }
      if (dup === 2) add('Рянпейко — дважды два одинаковых ряда', 3);
      else if (dup === 1) add('Иипейко — два одинаковых ряда', 1);
    }
    const cr = chis(s).map((x) => x.k);
    for (let r = 0; r < 7; r++)
      if ([0, 1, 2].every((su) => cr.includes(su * 9 + r))) {
        add('Сансёку — три одинаковых ряда в трёх мастях', closed ? 2 : 1);
        break;
      }
    for (let su = 0; su < 3; su++)
      if ([0, 3, 6].every((r) => cr.includes(su * 9 + r))) {
        add('Иццу — ряд от 1 до 9', closed ? 2 : 1);
        break;
      }
    const groupsTerm = s.sets.every((x) => (x.t === 'chi' ? rankOf(x.k) === 1 || rankOf(x.k) === 7 : isOrphan(x.k))) && isOrphan(s.pair);
    if (groupsTerm && chis(s).length) {
      if (hasHonor(t)) add('Чанта — в каждом сете крайняя или честь', closed ? 2 : 1);
      else add('Джунчан — в каждом сете крайняя', closed ? 3 : 2);
    }
    if (pons(s).length === 4) add('Тойтой — одни поны', 2);
    if (pons(s).filter((x) => x.concealed).length === 3) add('Сананко — три спрятанных пона', 2);
    const pr = pons(s)
      .filter((x) => isSuit(x.k))
      .map((x) => x.k);
    for (let r = 0; r < 9; r++)
      if ([0, 1, 2].every((su) => pr.includes(su * 9 + r))) {
        add('Сансёку доко — три одинаковых пона', 2);
        break;
      }
    if (pons(s).filter((x) => x.t === 'kan').length === 3) add('Санканцу — три конга', 2);
    if (allOrphans(t) && !chis(s).length) add('Хонрото — крайние и честь', 2);
  }
  const yaku = it.length > 0;
  // дора — только вдобавок к яку
  const dora = t.reduce((a, k) => a + w.dora.filter((d) => d === k).length, 0);
  const ura = w.riichi ? t.reduce((a, k) => a + w.ura.filter((d) => d === k).length, 0) : 0;
  if (dora) it.push({ name: 'Дора', v: dora });
  if (ura) it.push({ name: 'Ура-дора', v: ura });
  if (w.aka) it.push({ name: 'Красная пятёрка', v: w.aka });
  const han = it.reduce((a, b) => a + b.v, 0);
  return { value: han, items: it, yaku, yakuman: 0, fu: fuOf(w, s, it.some((x) => x.name === 'Пинфу')) };
}

function fuOf(w: WinInfo, s: Shape, pinfu: boolean): number {
  if (s.kind === 'seven') return 25;
  if (s.kind === 'thirteen') return 0;
  const closed = concealedHand(w);
  if (pinfu) return w.tsumo ? 20 : 30;
  let fu = 20;
  if (closed && !w.tsumo) fu += 10;
  if (w.tsumo) fu += 2;
  for (const x of pons(s)) {
    let v = isOrphan(x.k) ? 4 : 2;
    if (x.concealed) v *= 2;
    if (x.t === 'kan') v *= 4;
    fu += v;
  }
  if (isDragon(s.pair)) fu += 2;
  if (s.pair === 27 + w.seatWind) fu += 2;
  if (s.pair === 27 + w.roundWind) fu += 2;
  if (s.wait === 'kanchan' || s.wait === 'penchan' || s.wait === 'tanki') fu += 2;
  if (!closed && fu === 20) fu = 30;
  return Math.ceil(fu / 10) * 10;
}

/** Базовые очки риичи: фу × 2^(2+хан) с потолками (манган и выше). */
export function riichiBase(han: number, fu: number, yakuman: number): number {
  if (yakuman) return 8000 * yakuman;
  if (han >= 13) return 8000;
  if (han >= 11) return 6000;
  if (han >= 8) return 4000;
  if (han >= 6) return 3000;
  if (han >= 5) return 2000;
  return Math.min(2000, fu * 2 ** (2 + han));
}

export const riichiLabel = (han: number, fu: number, yakuman: number) =>
  yakuman ? (yakuman > 1 ? `${yakuman}× якуман` : 'якуман') : han >= 13 ? 'якуман по счёту' : han >= 11 ? 'санбайман' : han >= 8 ? 'байман' : han >= 6 ? 'ханэман' : han >= 5 || riichiBase(han, fu, 0) >= 2000 ? 'манган' : `${han} хан ${fu} фу`;

// ---------------------------------------------------------------- Китайская классика

function classic(w: WinInfo, s: Shape): Score {
  const it: Item[] = [];
  const t = s.tiles;
  const LIMIT = 1000;
  if (s.kind === 'thirteen' || w.heaven || w.earth || allHonors(t) || nineGates(w, t)) return { value: LIMIT, items: [{ name: s.kind === 'thirteen' ? 'Тринадцать сирот' : allHonors(t) ? 'Только честь' : w.heaven ? 'Небесная рука' : w.earth ? 'Земная рука' : 'Девять врат', v: LIMIT }], yaku: true, yakuman: 1 };
  let pts = 20;
  it.push({ name: 'Маджонг', v: 20 });
  if (w.tsumo) {
    pts += 2;
    it.push({ name: 'Взял со стены', v: 2 });
  }
  if (s.kind === 'normal') {
    for (const x of pons(s)) {
      let v = isOrphan(x.k) ? 4 : 2;
      if (x.concealed) v *= 2;
      if (x.t === 'kan') v *= 4;
      pts += v;
      it.push({ name: `${x.t === 'kan' ? 'Конг' : 'Пон'}${x.concealed ? ' закрытый' : ''}${isOrphan(x.k) ? ' (крайние/честь)' : ''}`, v });
    }
    if (isDragon(s.pair) || s.pair === 27 + w.seatWind || s.pair === 27 + w.roundWind) {
      pts += 2;
      it.push({ name: 'Пара драконов или своего ветра', v: 2 });
    }
    if (s.wait === 'kanchan' || s.wait === 'penchan' || s.wait === 'tanki') {
      pts += 2;
      it.push({ name: 'Единственное ожидание', v: 2 });
    }
  }
  if (w.flowers.length) {
    pts += 4 * w.flowers.length;
    it.push({ name: `Цветы и сезоны: ${w.flowers.length}`, v: 4 * w.flowers.length });
  }
  // удвоения
  let dbl = 0;
  const D = (name: string, n = 1) => {
    dbl += n;
    it.push({ name: `${name} — ×${2 ** n}`, v: 0 });
  };
  if (s.kind === 'seven') D('Семь пар', 2);
  if (s.kind === 'normal') {
    const dp = dragonPons(s);
    if (dp) D(`Пон дракона${dp > 1 ? ` (${dp})` : ''}`, dp);
    if (pons(s).some((x) => x.k === 27 + w.seatWind)) D('Пон своего ветра');
    if (pons(s).some((x) => x.k === 27 + w.roundWind)) D('Пон ветра круга');
    if (pons(s).length === s.sets.length) D('Одни поны');
    if (dp === 2 && isDragon(s.pair)) D('Малые три дракона');
    if (dp === 3) D('Большие три дракона', 2);
    if (chis(s).length === s.sets.length && concealedHand(w)) D('Одни ряды, закрытая');
  }
  if (ownFlowers(w)) D('Свой цветок', ownFlowers(w));
  if (fullFlush(t)) D('Чистая масть', 3);
  else if (halfFlush(t)) D('Масть с честью');
  if (allOrphans(t)) D('Крайние и честь');
  if (concealedHand(w) && !w.tsumo) D('Закрытая рука');
  if (w.lastTile) D('Последняя кость');
  if (w.rinshan) D('Кость за конг');
  if (w.chankan) D('Ограбление конга');
  const value = Math.min(LIMIT, Math.ceil((pts * 2 ** dbl) / 10) * 10);
  return { value, items: it, yaku: true, yakuman: value >= LIMIT ? 1 : 0 };
}

// ---------------------------------------------------------------- Тайвань

function tw(w: WinInfo, s: Shape): Score {
  const it: Item[] = [];
  const t = s.tiles;
  const add = (name: string, v: number) => it.push({ name, v });
  if (w.heaven) add('Небесная рука', 16);
  if (w.earth) add('Земная рука', 16);
  if (w.flowers.length === 8) add('Восемь цветов', 8);
  if (w.dealer) add(w.repeat ? `Дилер, повтор ${w.repeat}` : 'Дилер', 1 + 2 * w.repeat);
  const closed = concealedHand(w);
  if (closed && w.tsumo) add('Закрытая рука, взял сам', 3);
  else if (closed) add('Закрытая рука', 1);
  else if (w.tsumo) add('Взял сам', 1);
  const own = ownFlowers(w);
  if (own) add('Свой цветок', own);
  const fs = flowerSets(w);
  if (fs) add('Все четыре цветка' + (fs > 1 ? ' и сезона' : ''), 2 * fs);
  if (w.lastTile) add('Последняя кость', 1);
  if (w.rinshan) add('Кость за конг', 1);
  if (w.chankan) add('Ограбление конга', 1);
  if (allHonors(t)) add('Только честь', 16);
  else if (fullFlush(t)) add('Чистая масть', 8);
  else if (halfFlush(t)) add('Масть с честью', 4);
  if (s.kind === 'normal') {
    const dp = dragonPons(s);
    if (dp === 3) add('Большие три дракона', 8);
    else if (dp === 2 && isDragon(s.pair)) add('Малые три дракона', 4);
    else if (dp) add('Пон дракона', dp);
    if (windPons(s) === 4) add('Большие четыре ветра', 16);
    else if (windPons(s) === 3 && isWind(s.pair)) add('Малые четыре ветра', 8);
    else {
      if (pons(s).some((x) => x.k === 27 + w.seatWind)) add('Свой ветер', 1);
      if (pons(s).some((x) => x.k === 27 + w.roundWind)) add('Ветер круга', 1);
    }
    const hidden = pons(s).filter((x) => x.concealed).length;
    if (hidden >= 5) add('Пять спрятанных понов', 8);
    else if (hidden === 4) add('Четыре спрятанных пона', 5);
    else if (hidden === 3) add('Три спрятанных пона', 2);
    if (pons(s).length === s.sets.length) add('Одни поны', 4);
    else if (chis(s).length === s.sets.length && !w.tsumo && w.flowers.length === 0 && !hasHonor([s.pair]) && s.wait === 'ryanmen') add('Одни ряды', 2);
    if (s.wait === 'kanchan' || s.wait === 'penchan' || s.wait === 'tanki') add('Единственное ожидание', 1);
  }
  return { value: it.reduce((a, b) => a + b.v, 0), items: it, yaku: true, yakuman: 0 };
}

// ---------------------------------------------------------------- Сычуань

function sc(w: WinInfo, s: Shape): Score {
  const it: Item[] = [];
  const t = s.tiles;
  const add = (name: string, v: number) => it.push({ name, v });
  if (s.kind === 'seven') add('Семь пар', 2);
  else if (pons(s).length === s.sets.length) add('Одни поны', 1);
  if (fullFlush(t)) add('Чистая масть', 2);
  // «корни»: все четыре одинаковые кости у игрока
  const c = new Array(34).fill(0);
  for (const k of t) c[k]++;
  const gen = c.filter((n) => n === 4).length;
  if (gen) add(`Корни (четыре одинаковых): ${gen}`, gen);
  if (w.tsumo) add('Взял сам', 1);
  if (w.rinshan) add('Кость за конг', 1);
  if (w.chankan) add('Ограбление конга', 1);
  if (w.lastTile) add('Последняя кость', 1);
  if (w.heaven) add('Небесная рука', 3);
  if (w.earth) add('Земная рука', 3);
  return { value: Math.min(w.limit, it.reduce((a, b) => a + b.v, 0)), items: it.length ? it : [{ name: 'Простая рука', v: 0 }], yaku: true, yakuman: 0 };
}

// ---------------------------------------------------------------- выбор лучшего

const STYLE_FN: Record<Style, (w: WinInfo, s: Shape) => Score> = { hk, riichi: riichiYaku, classic, tw, sc };

/** Лучшая оценка выигрышной руки или null, если рука не собрана. */
export function scoreWin(w: WinInfo): Score | null {
  const ss = shapes(w);
  if (!ss.length) return null;
  let best: Score | null = null;
  const rank = (x: Score) => (w.style === 'riichi' ? (x.yaku ? riichiBase(x.value, x.fu ?? 30, x.yakuman) * 100 + x.value : x.value - 1000) : x.value);
  for (const s of ss) {
    const r = STYLE_FN[w.style](w, s);
    if (!best || rank(r) > rank(best)) best = r;
  }
  return best;
}

export type { Part };
