/* Ханафуда — подсчёт комбинаций (яку коикои и очков го-стопа) по взятым картам. Без DOM. */
import { BOAR, BRIGHTS, BUTTERFLY, CUCKOO, CURTAIN, DEER, GEESE, MOON, RAIN, SAKE, SSANGPI, WARBLER, info } from './cards';

export interface YakuLine {
  name: string;
  pts: number;
}

export interface KoiRules {
  /** Ханами и цукими (вишня/луна + чашка сакэ). */
  viewing: boolean;
  /** Чашка сакэ считается ещё и пустой (касу). */
  sakeKasu: boolean;
}

const count = (cards: number[], f: (id: number) => boolean) => cards.filter(f).length;
const has = (cards: number[], id: number) => cards.includes(id);

/** Яку коикои. */
export function koiYaku(cards: number[], r: KoiRules): YakuLine[] {
  const out: YakuLine[] = [];
  const lights = count(cards, (id) => info(id).kind === 'hikari');
  const rain = has(cards, RAIN);
  if (lights === 5) out.push({ name: 'гоко — пять светов', pts: 10 });
  else if (lights === 4 && !rain) out.push({ name: 'сико — четыре света', pts: 8 });
  else if (lights === 4) out.push({ name: 'амэ-сико — четыре света с дождём', pts: 7 });
  else if (lights === 3 && !rain) out.push({ name: 'санко — три света', pts: 5 });
  if (r.viewing && has(cards, SAKE)) {
    if (has(cards, CURTAIN)) out.push({ name: 'ханами-дзакэ — сакэ под вишней', pts: 5 });
    if (has(cards, MOON)) out.push({ name: 'цукими-дзакэ — сакэ под луной', pts: 5 });
  }
  const tane = count(cards, (id) => info(id).kind === 'tane');
  if (has(cards, BOAR) && has(cards, DEER) && has(cards, BUTTERFLY)) out.push({ name: 'иносикатё — кабан, олень, бабочки', pts: 5 + (tane - 3) });
  if (tane >= 5) out.push({ name: `тане — ${tane} животных`, pts: tane - 4 });
  const tan = count(cards, (id) => info(id).kind === 'tan');
  const poem = count(cards, (id) => info(id).ribbon === 'poem');
  const blue = count(cards, (id) => info(id).ribbon === 'blue');
  if (poem === 3 && blue === 3) out.push({ name: 'акатан и аотан — шесть лент', pts: 10 + (tan - 6) });
  else if (poem === 3) out.push({ name: 'акатан — красные ленты со стихами', pts: 5 + (tan - 3) });
  else if (blue === 3) out.push({ name: 'аотан — синие ленты', pts: 5 + (tan - 3) });
  if (tan >= 5) out.push({ name: `тандзаку — ${tan} лент`, pts: tan - 4 });
  const kasu = count(cards, (id) => info(id).kind === 'kasu') + (r.sakeKasu && has(cards, SAKE) ? 1 : 0);
  if (kasu >= 10) out.push({ name: `касу — ${kasu} пустых`, pts: kasu - 9 });
  return out;
}

export const total = (lines: YakuLine[]) => lines.reduce((a, l) => a + l.pts, 0);

// ---------------------------------------------------------------- го-стоп

/** Сколько «пустых» (пи) у карты в го-стопе: двойные — 2. Чашка сакэ — решает `sakePi`. */
export function piValue(id: number, sakePi = false): number {
  if (SSANGPI.includes(id)) return 2;
  if (id === SAKE) return sakePi ? 2 : 0;
  return info(id).kind === 'kasu' ? 1 : 0;
}

export const piCount = (cards: number[], sakePi = false) => cards.reduce((a, id) => a + piValue(id, sakePi), 0);

/** Птицы годори: соловей, кукушка, гуси. */
const BIRDS = [WARBLER, CUCKOO, GEESE];

export interface GoTally {
  lines: YakuLine[];
  total: number;
  /** Сколько светов, животных (ёль), пи — для штрафов. */
  lights: number;
  animals: number;
  pi: number;
  /** Очки за светы и за пи были — для кван-бака и пи-бака. */
  byLights: boolean;
  byPi: boolean;
  /** Чашка сакэ пошла в пи. */
  sakePi: boolean;
}

function goTallyWith(cards: number[], sakePi: boolean): GoTally {
  const lines: YakuLine[] = [];
  const lights = count(cards, (id) => BRIGHTS.includes(id));
  const rain = has(cards, RAIN);
  let byLights = false;
  if (lights === 5) lines.push({ name: 'огван — пять светов', pts: 15 });
  else if (lights === 4) lines.push({ name: 'сагван — четыре света', pts: 4 });
  else if (lights === 3) lines.push(rain ? { name: 'бисамгван — три света с дождём', pts: 2 } : { name: 'самгван — три света', pts: 3 });
  if (lights >= 3) byLights = true;
  const animals = count(cards, (id) => info(id).kind === 'tane' && !(id === SAKE && sakePi));
  if (BIRDS.every((b) => has(cards, b))) lines.push({ name: 'годори — пять птиц', pts: 5 });
  if (animals >= 5) lines.push({ name: `ёль — ${animals} животных`, pts: animals - 4 });
  // ленту ивы (дождя) в го-стопе лентой не считают
  const tan = count(cards, (id) => info(id).kind === 'tan' && id !== 42);
  if (count(cards, (id) => info(id).ribbon === 'poem') === 3) lines.push({ name: 'хондан — красные ленты со стихами', pts: 3 });
  if (count(cards, (id) => info(id).ribbon === 'blue') === 3) lines.push({ name: 'чхондан — синие ленты', pts: 3 });
  // чходан — простые красные ленты глицинии, ириса и леспедецы (ленту ивы не считают)
  if ([13, 17, 25].every((id) => has(cards, id))) lines.push({ name: 'чходан — простые красные ленты', pts: 3 });
  if (tan >= 5) lines.push({ name: `ти — ${tan} лент`, pts: tan - 4 });
  const pi = piCount(cards, sakePi);
  let byPi = false;
  if (pi >= 10) {
    lines.push({ name: `пи — ${pi} пустых`, pts: pi - 9 });
    byPi = true;
  }
  return { lines, total: total(lines), lights, animals, pi, byLights, byPi, sakePi };
}

/** Очки го-стопа; чашку сакэ (кукчин) считают туда, где она выгоднее. */
export function goTally(cards: number[]): GoTally {
  const a = goTallyWith(cards, false);
  if (!has(cards, SAKE)) return a;
  const b = goTallyWith(cards, true);
  return b.total > a.total ? b : a;
}
