/* Кампания 7 «Кастет»: финал, восьмеро вместе. Серёга ведёт, остальные пацаны — союзники-боты (CAMPAIGNS2.md). */
import type { HeroPick } from '../sim/heroes';
import type { ScnAct } from '../sim/adv/scenario';
import type { CampaignDef, ScenarioDef } from './types';
import { HINT, NOTHING, STARSHOY, mainDead, noTowns, paint } from './common';

const SERYOGA: HeroPick = { cls: 'zatulye-sotnik', n: 0, lad: 'seryoga' };
const LENKA: HeroPick = { cls: 'akademiya-zvezdochet', n: 0, lad: 'lenka' };
const MAKS: HeroPick = { cls: 'plotina-smotritel', n: 0, lad: 'maks' };
const ANDRYUKHA: HeroPick = { cls: 'ostrog-voevoda', n: 0, lad: 'andryukha' };
const MAIN_DEAD = mainDead('Серёга');
const NO_TOWNS = noTowns('Заречье');
const OLD = 'Старшой';

// ------------------------------------------------------------------ 7.1 «Сбор»

const MET = ['met-lenka', 'met-maks', 'met-andr'];
const cutter = (n: number, army: [string, number][]): ScnAct => ({ t: 'hero', owner: 4, pick: { cls: n % 2 ? 'kuznya-master' : 'kuznya-ognelit', n: 1 + (n % 4) }, at: [30, 30], army, level: 4 + n, tag: `cut${n}` });

const s71: ScenarioDef = {
  id: 'c7-1',
  title: 'Сбор',
  brief: 'Шесть осколков у пацанов, два — у Старшого. Пора собраться всем: Ленка — в бору на северо-востоке, Макс — на берегу на юго-западе, Андрюха с Тёмой и Жекой — в снегах на юго-востоке. Старшой режет дороги через пепелище посередине.',
  before: ['c7-1a', 'c7-1b'],
  carry: true,
  sketch: () => ({
    name: 'Сбор',
    seed: 71,
    scale: 2,
    rows: paint(30, 30, 'g', [
      [15, 0, 15, 15, 'p'], [0, 15, 15, 15, 'c'], [15, 15, 15, 15, 'n'], [0, 0, 4, 4, 'G'], [26, 0, 4, 4, 'P'], [0, 26, 4, 4, 'C'], [26, 26, 4, 4, 'N'],
      [12, 12, 6, 6, 'a'], [14, 6, 2, 3, '^'], [6, 14, 3, 2, '^'], [21, 14, 3, 2, '^'], [14, 21, 2, 3, '^'],
    ]),
    players: [
      { name: 'Серёга', faction: 'zatulye', team: 1, res: { semki: 12000 } },
      { name: 'Ленка', faction: 'akademiya', bot: 'medium', team: 1 },
      { name: 'Макс', faction: 'plotina', bot: 'medium', team: 1 },
      { name: 'Андрюха', faction: 'ostrog', bot: 'medium', team: 1 },
      { name: OLD, faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [
      { at: [10, 10], faction: 'zatulye', owner: 0, name: 'Заречье', tag: 'town', built: ['dwell2', 'dwell3', 'dwell4', 'smithy', 'hall2'], garrison: [['zatulye-militia', 20]] },
      { at: [50, 10], faction: 'akademiya', owner: 1, name: 'Сосновый купол', tag: 'lenka', built: ['dwell2', 'dwell3', 'guild1'] },
      { at: [10, 50], faction: 'plotina', owner: 2, name: 'Гребень', tag: 'maks', built: ['dwell2', 'dwell3', 'dam'] },
      { at: [50, 50], faction: 'ostrog', owner: 3, name: 'Острог', tag: 'andr', built: ['dwell2', 'dwell3', 'drill'] },
    ],
    heroes: [
      { at: [12, 13], owner: 0, pick: SERYOGA, army: [['zatulye-militia', 40], ['zatulye-slinger', 18], ['zatulye-vataga', 10], ['zatulye-boatman', 5], ['zatulye-herbalist', 2]], tag: 'main' },
      { at: [48, 13], owner: 1, pick: LENKA, army: [['akademiya-student', 24], ['akademiya-owl', 10]], level: 6, tag: 'lenka-h' },
      { at: [12, 53], owner: 2, pick: MAKS, army: [['plotina-gatekeeper', 26], ['plotina-whaler', 10], ['plotina-thunderbird', 4]], level: 6, tag: 'maks-h' },
      { at: [48, 53], owner: 3, pick: ANDRYUKHA, army: [['ostrog-druzhinnik', 26], ['ostrog-snowarcher', 10], ['ostrog-wolfrider', 4]], level: 6, tag: 'andr-h' },
    ],
    objects: [
      { kind: 'mine-wood', at: [4, 22] },
      { kind: 'mine-stone', at: [22, 4] },
      { kind: 'mine-stariron', at: [30, 26] },
      { kind: 'stack', at: [30, 23], army: [['kuznya-steamhound', 10]] },
      { kind: 'mine-amber', at: [40, 22] },
      { kind: 'mine-salt', at: [20, 40] },
      { kind: 'mine-semki', at: [40, 40] },
      { kind: 'treasury-ash', at: [30, 34], army: [['kuznya-riveter', 20], ['neutral-salamander', 8]], reward: { semki: 6000, stariron: 5 }, artRank: 2 },
      { kind: 'chest', at: [4, 4], n: 2000 },
      { kind: 'chest', at: [56, 56], n: 2000 },
      { kind: 'campfire', at: [24, 16], n: 800 },
      { kind: 'campfire', at: [36, 44], n: 800 },
      { kind: 'learnstone', at: [18, 24] },
      { kind: 'gloryhill', at: [42, 30], army: [['neutral-griffin', 6]] },
      { kind: 'watchtower', at: [26, 30] },
      { kind: 'signpost', at: [13, 12], text: 'Дороги к своим сходятся на пепелище посередине. Там Старшой и ставит заслоны.' },
    ],
    roads: [
      [[10, 11], [30, 30], [50, 11]],
      [[30, 30], [10, 51]],
      [[30, 30], [50, 51]],
      [[10, 11], [4, 23]],
    ],
  }),
  spec: {
    goals: [
      { id: 'gather', text: 'Собрать восьмерых: дойти до Ленки, Макса и Андрюхи', cond: { t: 'all', of: MET.map((id) => ({ t: 'flag' as const, id })) } },
      { id: 'cuts', text: 'Разбить заслоны Старшого на дорогах', cond: { t: 'gone', tags: ['cut1', 'cut2', 'cut3'] }, optional: true },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: 'Сбор', text: 'Все свои — союзники: их войска тебя не тронут. Дойди до каждого города — там и договоритесь.' }] },
      { id: 'lenka', when: { t: 'near', at: 'lenka', r: 4 }, do: [{ t: 'flag', id: 'met-lenka' }, { t: 'msg', title: 'Ленка', text: '— Серёга! Я посчитала: шесть огней у нас, два — на востоке, в крепости.' }] },
      { id: 'maks', when: { t: 'near', at: 'maks', r: 4 }, do: [{ t: 'flag', id: 'met-maks' }, { t: 'msg', title: 'Макс', text: '— Тула! Костя со мной, Жека тоже тут — торгует с кем попало. Димон рыбачит, но обещал.' }] },
      { id: 'andr', when: { t: 'near', at: 'andr', r: 4 }, do: [{ t: 'flag', id: 'met-andr' }, { t: 'msg', title: 'Андрюха', text: '— Строиться! Тёма, Витёк, все сюда. — Прапор, не командуй. — Я не командую, я предлагаю.' }] },
      { id: 'c1', when: { t: 'day', day: 3 }, do: [cutter(1, [['kuznya-riveter', 20], ['kuznya-wasp', 10], ['kuznya-steamhound', 6]]), { t: 'msg', title: OLD, text: 'На перекрёстке посреди пепелища встал заслон Старшого.' }] },
      { id: 'c2', when: { t: 'day', day: 9 }, do: [cutter(2, [['kuznya-riveter', 26], ['kuznya-wasp', 14], ['zatonye-willow', 4], ['kuznya-founder', 2]]), { t: 'msg', title: OLD, text: 'Ещё один заслон перерезал дороги.' }] },
      { id: 'c3', when: { t: 'day', day: 15 }, do: [cutter(3, [['kuznya-riveter', 30], ['kuznya-steamhound', 10], ['ostrog-bearguard', 5], ['kuznya-founder', 3]]), { t: 'msg', title: OLD, text: 'Старшой бросил на дороги медвежью гвардию.' }] },
      { id: 'all', when: { t: 'all', of: MET.map((id) => ({ t: 'flag' as const, id })) }, do: [{ t: 'msg', title: 'Восемь', text: 'Первый раз с той стройки — все вместе. Ленка пересчитала два раза.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 7.2 «Чёрная крепость»

const FORTS = ['f1', 'f2', 'f3'];

const s72: ScenarioDef = {
  id: 'c7-2',
  title: 'Чёрная крепость',
  brief: 'Чёрная крепость стоит на скале над пепельной равниной. Двенадцать лет Валера строил её из всего, что отобрал. Перед ней — три форпоста. Ленка и Андрюха ведут свои войска рядом.',
  before: ['c7-2a'],
  carry: true,
  sketch: () => ({
    name: 'Чёрная крепость',
    seed: 72,
    scale: 2,
    rows: paint(30, 30, 'a', [[0, 18, 30, 12, 'r'], [0, 22, 6, 8, 'R'], [24, 20, 6, 6, 'R'], [10, 6, 3, 3, '^'], [18, 4, 3, 3, '^'], [4, 10, 3, 3, 'A'], [24, 10, 3, 3, 'A']]),
    players: [
      { name: 'Серёга', faction: 'zatulye', team: 1, res: { semki: 15000 } },
      { name: 'Ленка', faction: 'akademiya', bot: 'medium', team: 1 },
      { name: 'Андрюха', faction: 'ostrog', bot: 'medium', team: 1 },
      { name: OLD, faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [
      { at: [14, 50], faction: 'zatulye', owner: 0, name: 'Заречье', tag: 'town', built: ['dwell2', 'dwell3', 'dwell4', 'dwell5', 'smithy', 'hall2'], garrison: [['zatulye-militia', 24]] },
      { at: [46, 52], faction: 'akademiya', owner: 1, name: 'Сосновый купол', tag: 'lenka', built: ['dwell2', 'dwell3', 'dwell4', 'guild1'] },
      { at: [30, 56], faction: 'ostrog', owner: 2, name: 'Острог', tag: 'andr', built: ['dwell2', 'dwell3', 'dwell4', 'drill'] },
      { at: [30, 8], faction: 'kuznya', owner: 3, name: 'Чёрная крепость', tag: 'fortress', built: ['fort2', 'fort3', 'smithy', 'dwell2', 'dwell3', 'dwell4'], garrison: [['kuznya-riveter', 40], ['kuznya-wasp', 24], ['kuznya-steamhound', 12], ['kuznya-founder', 6], ['kuznya-walkcannon', 3], ['zatonye-troll', 2]] },
    ],
    heroes: [
      { at: [16, 53], owner: 0, pick: SERYOGA, army: [['zatulye-spearman', 40], ['zatulye-slinger', 24], ['zatulye-vataga', 14], ['zatulye-boatman', 8], ['zatulye-herbalist', 4], ['zatulye-rider', 2]], tag: 'main' },
      { at: [44, 55], owner: 1, pick: LENKA, army: [['akademiya-student', 30], ['akademiya-owl', 14], ['akademiya-crystal', 6]], level: 8, tag: 'lenka-h' },
      { at: [32, 59], owner: 2, pick: ANDRYUKHA, army: [['ostrog-druzhinnik', 30], ['ostrog-snowarcher', 14], ['ostrog-wolfrider', 7], ['ostrog-bearguard', 4]], level: 8, tag: 'andr-h' },
    ],
    objects: [
      { kind: 'garrison', at: [12, 28], owner: 3, army: [['kuznya-riveter', 26], ['kuznya-steamhound', 8], ['zatonye-willow', 3]], tag: 'f1' },
      { kind: 'garrison', at: [30, 24], owner: 3, army: [['kuznya-riveter', 30], ['kuznya-wasp', 12], ['kuznya-founder', 3]], tag: 'f2' },
      { kind: 'garrison', at: [48, 28], owner: 3, army: [['kuznya-riveter', 26], ['ostrog-bearguard', 5], ['kuznya-steamhound', 8]], tag: 'f3' },
      { kind: 'mine-wood', at: [4, 40] },
      { kind: 'mine-stone', at: [22, 44] },
      { kind: 'mine-stariron', at: [8, 14] },
      { kind: 'stack', at: [8, 16], army: [['neutral-salamander', 10]] },
      { kind: 'mine-amber', at: [52, 14] },
      { kind: 'stack', at: [52, 16], army: [['neutral-salamander', 10]] },
      { kind: 'treasury-ash', at: [44, 4], army: [['neutral-salamander', 16], ['kuznya-founder', 4]], reward: { semki: 8000, stariron: 6 }, artRank: 3 },
      { kind: 'chest', at: [4, 56], n: 2500 },
      { kind: 'chest', at: [56, 40], n: 2500 },
      { kind: 'campfire', at: [26, 38], n: 1000 },
      { kind: 'learnstone', at: [38, 40] },
      { kind: 'gloryhill', at: [6, 34], army: [['neutral-stonegiant', 3]] },
      { kind: 'watchtower', at: [30, 34] },
      { kind: 'signpost', at: [17, 52], text: 'Три форпоста стерегут подходы к крепости. Стены у неё — втрое: Твердыня.' },
    ],
    roads: [
      [[14, 51], [12, 29]],
      [[14, 51], [30, 36], [30, 25]],
      [[30, 36], [48, 29]],
      [[12, 27], [30, 9]],
      [[30, 23], [30, 9]],
      [[48, 27], [30, 9]],
      [[30, 36], [46, 53]],
      [[30, 36], [30, 57]],
    ],
  }),
  spec: {
    goals: [
      { id: 'forts', text: 'Взять три форпоста', cond: { t: 'own', tags: FORTS } },
      { id: 'fortress', text: 'Взять Чёрную крепость', cond: { t: 'own', tags: ['fortress'] } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Форпосты — заставы Старшого: разбей гарнизон и встань на вход. Крепость — осада: стены, две башни и большой гарнизон.' }, { t: 'reveal', at: 'fortress', r: 6 }] },
      { id: 'fort-one', when: { t: 'own', tags: FORTS, n: 1 }, do: [{ t: 'msg', title: 'Форпост', text: 'Первый форпост взят. На стенах крепости зажгли тысячи факелов.' }] },
      { id: 'fort-all', when: { t: 'own', tags: FORTS }, do: [{ t: 'msg', title: 'Форпосты', text: 'Все три форпоста наши. Дорога к Чёрной крепости открыта.' }] },
      {
        id: 'sortie', when: { t: 'day', day: 10 }, every: 10, do: [
          { t: 'hero', owner: 3, pick: { cls: 'kuznya-master', n: 3 }, at: 'fortress', army: [['kuznya-riveter', 24], ['kuznya-wasp', 12], ['kuznya-steamhound', 6]], level: 8 },
          { t: 'msg', title: OLD, text: 'Из ворот крепости вышла вылазка.' },
        ],
      },
      { id: 'throne', when: { t: 'own', tags: ['fortress'] }, do: [{ t: 'msg', title: 'Тронный зал', text: 'Трон был пустой. На подлокотнике лежала кепка. Он ушёл вниз — в Котлован.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 7.3 «Котлован»

const s73: ScenarioDef = {
  id: 'c7-3',
  title: 'Котлован',
  brief: 'Котлован — такой же, как дома, только в сто раз глубже. Внизу светится сердце мира. Там ждёт Старшой с последними двумя осколками. Разбей его — и донеси все восемь осколков до сердца.',
  before: ['c7-2b', 'c7-3a', 'c7-3b'],
  carry: true,
  sketch: () => ({
    name: 'Котлован',
    seed: 73,
    scale: 2,
    rows: paint(24, 24, 'a', [
      [3, 3, 18, 18, 'r'], [6, 6, 12, 12, 'a'], [9, 9, 6, 6, 'd'],
      [3, 8, 2, 8, '^'], [19, 8, 2, 8, '^'], [8, 3, 8, 2, '^'], [8, 19, 3, 2, '^'], [13, 19, 3, 2, '^'],
      [6, 9, 2, 6, '^'], [16, 9, 2, 6, '^'],
    ]),
    players: [
      { name: 'Серёга', faction: 'zatulye', team: 1, res: { semki: 15000 } },
      { name: 'Ленка', faction: 'akademiya', bot: 'medium', team: 1 },
      { name: OLD, faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [
      { at: [8, 44], faction: 'zatulye', owner: 0, name: 'Лагерь у края', tag: 'town', built: ['dwell2', 'dwell3', 'dwell4', 'dwell5', 'smithy', 'hall2'] },
      { at: [40, 44], faction: 'akademiya', owner: 1, name: 'Звёздный лагерь', tag: 'lenka', built: ['dwell2', 'dwell3', 'dwell4'] },
    ],
    heroes: [
      { at: [10, 47], owner: 0, pick: SERYOGA, army: [['zatulye-spearman', 50], ['zatulye-slinger', 28], ['zatulye-vataga', 16], ['zatulye-boatman', 10], ['zatulye-herbalist', 5], ['zatulye-rider', 3]], tag: 'main' },
      { at: [38, 47], owner: 1, pick: LENKA, army: [['akademiya-student', 34], ['akademiya-owl', 16], ['akademiya-crystal', 8]], level: 10, tag: 'lenka-h' },
      { at: [24, 28], owner: 2, pick: STARSHOY, army: [['kuznya-riveter', 40], ['kuznya-wasp', 24], ['kurgany-barrowknight', 10], ['ostrog-bearguard', 8], ['plotina-stormbull', 3], ['kuznya-walkcannon', 2], ['kurgany-greatancestor', 1]], level: 12, tag: 'starshoy' },
    ],
    objects: [
      { kind: 'obelisk', at: [24, 24], tag: 'heart' },
      { kind: 'stack', at: [24, 12], army: [['kuznya-steamhound', 14]] },
      { kind: 'stack', at: [10, 24], army: [['kurgany-barrowknight', 10]] },
      { kind: 'stack', at: [38, 24], army: [['ostrog-bearguard', 8]] },
      { kind: 'mine-stariron', at: [4, 4] },
      { kind: 'mine-amber', at: [44, 4] },
      { kind: 'mine-semki', at: [24, 44] },
      { kind: 'chest', at: [4, 30], n: 3000 },
      { kind: 'chest', at: [44, 30], n: 3000 },
      { kind: 'learnstone', at: [24, 38] },
      { kind: 'wisewell', at: [16, 40] },
      { kind: 'luckfountain', at: [32, 40] },
      { kind: 'signpost', at: [11, 46], text: 'Вниз ведут спуски с юга, запада и востока. Сердце — на самом дне.' },
    ],
    roads: [
      [[8, 45], [24, 40], [24, 25]],
      [[40, 45], [24, 40]],
      [[24, 25], [10, 25]],
      [[24, 25], [38, 25]],
      [[24, 25], [24, 13]],
    ],
  }),
  spec: {
    goals: [
      { id: 'starshoy', text: 'Разбить Старшого в последнем бою', cond: { t: 'gone', tags: ['starshoy'] } },
      { id: 'heart', text: 'Донести восемь осколков до сердца Котлована', cond: { t: 'all', of: [{ t: 'gone', tags: ['starshoy'] }, { t: 'near', at: 'heart', r: 1 }] } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: 'Котлован', text: 'Ленка рядом. Остальные держат края воронки. Старшой — у сердца, на самом дне.' }, { t: 'reveal', at: 'heart', r: 5 }] },
      { id: 'voice', when: { t: 'near', at: 'starshoy', r: 6 }, do: [{ t: 'msg', title: 'Старшой', text: '— Пацаны. Я тут двенадцать лет. Мне тридцать. Мне домой — к кому? — К мамке, Валер. Она тебя ждёт. До сих пор.' }] },
      {
        id: 'shadows', when: { t: 'day', day: 5 }, every: 5, do: [
          { t: 'stack', at: 'town', cre: 'kurgany-shadowwanderer', n: 20 },
          { t: 'msg', title: 'Котлован', text: 'Из глубины воронки поднимаются тени.' },
        ],
      },
      { id: 'beaten', when: { t: 'gone', tags: ['starshoy'] }, do: [{ t: 'msg', title: 'Валера', text: 'Старшой опустил руки. Два осколка покатились по латуни к сердцу. Осталось донести остальные.' }] },
    ],
  },
};

export const FINALE: CampaignDef = {
  id: 'c7',
  title: 'Кастет',
  hero: 'Серёга «Тула»',
  lad: 'seryoga',
  text: 'Финал: восьмеро вместе против Старшого. Чёрная крепость, Котлован и выбор — домой или остаться.',
  scenarios: [s71, s72, s73],
  finale: ['c7-fin1', 'c7-fin2'],
  ending: {
    ask: 'Кастет спрашивает: домой или остаться?',
    options: [
      { id: 'home', text: 'Домой', cut: ['c7-home1', 'c7-home2'] },
      { id: 'stay', text: 'Остаться', cut: ['c7-stay1', 'c7-stay2'] },
    ],
  },
  paid: true,
  needs: { all: ['c1', 'c2'], some: { of: ['c3', 'c4', 'c5', 'c6'], n: 2 } },
  carryFrom: 'c1',
};
