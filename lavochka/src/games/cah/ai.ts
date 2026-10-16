/* Карты против человечества — боты. Юмора бот не понимает, поэтому честные эвристики по тексту карт.
 * Лёгкий — наугад. Средний — подбирает ответ по форме: на «кто?» — человека, после «нравится/чтобы» — действие,
 * на «Сыграй 2/3» — покороче. Сложный — то же плюс подстраивается под вкус текущего Царя: по прошлым раундам смотрит,
 * какие ответы тот брал (длина, «шоковость», люди/действия), а сам как Царь выбирает по своей оценке. Видят только свой view. */
import type { Rng } from '../../core/types';
import { BLACK, isBlank, WHITE, type Action, type RoundRec, type SubView, type View } from './engine';

export interface Feat {
  len: number;
  shock: number;
  person: number;
  act: number;
}

const SHOCK = [
  'сперм', 'член', 'пенис', 'дроч', 'секс', 'анал', 'оргазм', 'трах', 'конч', 'героин', 'нарко', 'кокаин', 'смерт', 'мёртв', 'мертв', 'труп',
  'абор', 'убий', 'убит', 'распят', 'опухол', 'спид', 'диаре', 'понос', 'моч', 'кака', 'какает', 'говн', 'жоп', 'сиськ', 'сосок', 'соск', 'мудак',
  'хуе', 'хуё', 'пизд', 'бляд', 'сук', 'лобк', 'вагин', 'киск', 'эрекц', 'презерв', 'порн', 'инцест', 'педоф', 'гитлер', 'холокост', 'рак ',
  'беремен', 'плод', 'девствен', 'шлюх', 'проститут', 'изнасил', 'насил', 'рвот', 'блев', 'пердеж', 'пёрд', 'пердё', 'газы', 'менструа', 'тампон',
  'бусин', 'фалло', 'дилдо', 'вибрат', 'фетиш', 'бдсм', 'оргия', 'тройнич', 'голый', 'голая', 'гол ', 'алкогол', 'суицид', 'самоубий', 'ядерн',
];
const PERSON = [
  'мужчин', 'женщин', 'мальчик', 'девочк', 'парен', 'парн', 'девушк', 'старик', 'старух', 'бабушк', 'бабк', 'дед', 'мама', 'мать', 'папа', 'отец',
  'ребён', 'ребен', 'дети', 'друг', 'подруг', 'неудачник', 'стукач', 'брат', 'сестр', 'сын', 'дочь', 'муж', 'жена', 'бог', 'президент', 'учитель',
  'врач', 'поп ', 'священник', 'монах', 'клоун', 'карлик', 'гном', 'ковбой', 'солдат', 'полицейск', 'мент', 'бомж', 'гопник', 'школьник', 'студент',
  'блогер', 'рэпер', 'актёр', 'актер', 'вековух', 'холостяк', 'тёща', 'теща', 'сосед', 'бывш', 'орда', 'викинг', 'миллиардер', 'чувак',
];
const VERB_END = /(ть|ться|тся|ю|юсь|ешь|ишь|ет|ит|ем|им|ал|ала|ались|ался|ясь|вшись)$/;

const cache = new Map<string, Feat>();

/** Признаки белой карты (по тексту — пустая карта получает вписанное). */
export function feat(text: string): Feat {
  const hit = cache.get(text);
  if (hit) return hit;
  const low = ` ${text.toLowerCase().replace(/ё/g, 'е')} `;
  const shock = Math.min(3, SHOCK.filter((r) => low.includes(r.replace(/ё/g, 'е'))).length);
  const first = (text.match(/[А-ЯЁа-яёA-Za-z-]+/) ?? [''])[0].toLowerCase();
  const name = /^[А-ЯЁA-Z][а-яёa-z]+(\s[А-ЯЁA-Z]\.?)*\s[А-ЯЁA-Z][а-яёa-z]+/.test(text);
  const person = name || PERSON.some((p) => low.slice(0, 30).includes(p)) ? 1 : 0;
  const act = VERB_END.test(first) && !/(ость|есть|сть)$/.test(first) && first.length > 3 ? 1 : 0;
  const f = { len: text.length, shock, person, act };
  cache.set(text, f);
  return f;
}

export interface Want {
  person: number;
  act: number;
  pick: number;
  blank: boolean;
}

/** Чего просит чёрная карта (очень грубо). */
export function want(black: number): Want {
  const b = BLACK[black];
  const t = b.t;
  const person = /(Кто |теперь я — _|Я — _|пара на вечер|команду супергероев|Жертва — _|малышка теперь|Заказчик: _|получает _|министром|если рядом _)/.test(t) ? 1 : 0;
  const act = /(Шаг \d:|способ разрешить|умеет лучше|справляюсь|пучит|дорожка)/.test(t) ? 1 : 0;
  return { person, act, pick: b.pick, blank: t.includes('_') };
}

/** Насколько белая карта подходит по форме. */
export function fit(f: Feat, w: Want): number {
  let s = 0;
  if (w.person) s += f.person ? 1.5 : -0.3;
  if (w.act) s += f.act ? 1.2 : -0.2;
  else if (w.blank && f.act) s -= 0.6; // глагол в «предметный» пропуск читается плохо
  s -= w.pick > 1 ? f.len / 60 : Math.max(0, f.len - 60) / 80;
  return s;
}

/** Вкус Царя: какие признаки у выигравших ответов против остальных (по прошлым раундам). */
export interface Taste {
  shock: number;
  len: number;
  person: number;
  act: number;
}

const subFeat = (u: { cards: number[]; texts?: Record<number, string> }): Feat => {
  const fs = u.cards.map((c) => feat(isBlank(c) ? u.texts?.[c] ?? '' : WHITE[c] ?? ''));
  const avg = (k: keyof Feat) => fs.reduce((a, f) => a + f[k], 0) / Math.max(1, fs.length);
  return { len: avg('len'), shock: avg('shock'), person: avg('person'), act: avg('act') };
};

export function taste(history: RoundRec[], czar: number | null): Taste {
  const acc: Taste = { shock: 0, len: 0, person: 0, act: 0 };
  let wsum = 0;
  for (const r of history) {
    if (r.subs.length < 2 || !r.win.length) continue;
    // свой Царь — в полную силу, остальные — как вкус стола
    const wgt = czar != null && r.czar === czar ? 1 : 0.25;
    const win = subFeat(r.subs[r.win[0]]);
    const rest = r.subs.filter((_, i) => !r.win.includes(i)).map(subFeat);
    if (!rest.length) continue;
    const mean = (k: keyof Feat) => rest.reduce((a, f) => a + f[k], 0) / rest.length;
    acc.shock += wgt * (win.shock - mean('shock'));
    acc.len += (wgt * (win.len - mean('len'))) / 40;
    acc.person += wgt * (win.person - mean('person'));
    acc.act += wgt * (win.act - mean('act'));
    wsum += wgt;
  }
  if (!wsum) return { shock: 0.3, len: 0, person: 0, act: 0 };
  const k = 1 / (wsum + 1); // сглаживание к нулю при малом числе раундов
  return { shock: 0.3 * k + acc.shock * k, len: acc.len * k, person: acc.person * k, act: acc.act * k };
}

const noise = (rng: Rng, a: number) => (rng.next() - 0.5) * 2 * a;

function score(f: Feat, w: Want, t: Taste | null, level: number, rng: Rng): number {
  if (level <= 0) return rng.next();
  let s = fit(f, w) + noise(rng, level === 1 ? 0.9 : 0.5);
  if (t) s += t.shock * f.shock + (t.len * f.len) / 40 + t.person * f.person + t.act * f.act;
  return s;
}

/** Оценка готового ответа Царём (по своему вкусу). */
function judgeScore(u: SubView, w: Want, level: number, rng: Rng): number {
  if (level <= 0) return rng.next();
  const f = subFeat(u);
  let s = fit(f, w) + noise(rng, level === 1 ? 1 : 0.5);
  if (level >= 2) s += 0.5 * f.shock;
  return s;
}

const filler = (rng: Rng) => WHITE[rng.int(WHITE.length)].replace(/[.!]+$/, '');

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  switch (v.phase) {
    case 'play': {
      const hand = v.hands[seat] ?? [];
      const w = want(v.black);
      const t = level >= 2 ? taste(v.history, v.czar) : null;
      // пустые карты бот не любит (за отключившегося): только если иначе никак
      const ranked = hand
        .map((c) => ({ c, s: isBlank(c) ? -99 : score(feat(WHITE[c]), w, t, level, rng) }))
        .sort((a, b) => b.s - a.s);
      const n = w.pick;
      if (ranked.length < n) return null;
      const cards = ranked.slice(0, n).map((x) => x.c);
      const textsFor = (cs: number[]) => {
        const bl = cs.filter(isBlank);
        return bl.length ? Object.fromEntries(bl.map((c) => [c, filler(rng)])) : undefined;
      };
      const a: Action = { type: 'play', cards, ...(textsFor(cards) ? { texts: textsFor(cards) } : {}) };
      // азартные игры: второй набор на залог очка
      const pts = v.scores[seat] ?? 0;
      if (v.house.gamble && pts >= 1 && ranked.length >= 2 * n) {
        const best = ranked[0].s;
        const second = ranked.slice(n, 2 * n);
        const near = second.every((x) => x.s > -50) && second[0].s >= best - 0.3;
        const go = level === 0 ? rng.next() < 0.12 : level === 1 ? pts >= 2 && rng.next() < 0.08 : near && pts < v.goal - 1 && rng.next() < 0.5;
        if (go) {
          const bet = second.map((x) => x.c);
          const bt = textsFor(bet);
          return { ...a, bet, ...(bt ? { betTexts: bt } : {}) };
        }
      }
      return a;
    }
    case 'judge': {
      const w = want(v.black);
      const idx = v.subs.map((u, i) => ({ i, u })).filter(({ u }) => !(v.house.godless && u.by === seat));
      const pool = idx.length ? idx : v.subs.map((u, i) => ({ i, u }));
      let best = pool[0].i;
      let bs = -Infinity;
      for (const { i, u } of pool) {
        const s = judgeScore(u, w, level, rng);
        if (s > bs) {
          bs = s;
          best = i;
        }
      }
      return v.house.godless ? { type: 'vote', index: best } : { type: 'pick', index: best };
    }
    case 'reveal':
      return { type: 'next' };
  }
  return null;
}
