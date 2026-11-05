/* Кампания 3 «Обское море»: Макс «Штиль», Плотина бурь. Про воду, лодки и напор (CAMPAIGNS2.md). */
import type { HeroPick } from '../sim/heroes';
import type { CampaignDef, ScenarioDef } from './types';
import { HINT, NOTHING, mainDead, noTowns, paint } from './common';

const MAKS: HeroPick = { cls: 'plotina-smotritel', n: 0, lad: 'maks' };
const ZHEKA: HeroPick = { cls: 'bazar-kupets', n: 0, lad: 'zheka' };
const KOSTYA: HeroPick = { cls: 'plotina-bureveshchun', n: 0, lad: 'kostya' };
const MAIN_DEAD = mainDead('Макс');
const NO_TOWNS = noTowns('Гребень');
const FLEET = 'Чёрный флот';

// ------------------------------------------------------------------ 3.1 «Шлюз»

const s31: ScenarioDef = {
  id: 'c3-1',
  title: 'Шлюз',
  brief: 'Макс очнулся на гребне огромной плотины. Смотрители в синих плащах зовут его Штилем и ждут напора: шлюзы стоят, верфь не достроена, а с севера, вдоль берега, идут чёрные паруса.',
  before: ['c3-1a', 'c3-1b'],
  sketch: () => ({
    name: 'Шлюз',
    seed: 31,
    scale: 2,
    rows: paint(18, 18, 'r', [
      [8, 0, 10, 18, 'c'], [15, 0, 3, 18, '~'], [12, 0, 3, 4, '~'], [0, 0, 3, 4, 'R'], [3, 0, 3, 2, '^'],
      [0, 13, 4, 5, 'R'], [9, 7, 2, 2, 'C'], [3, 9, 3, 2, 'R'], [0, 6, 2, 2, '^'],
    ]),
    players: [
      { name: 'Макс', faction: 'plotina', res: { semki: 8000, wood: 25, stone: 15 } },
      { name: FLEET, faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [{ at: [27, 22], faction: 'plotina', owner: 0, name: 'Гребень', tag: 'town' }],
    heroes: [{ at: [26, 25], owner: 0, pick: MAKS, army: [['plotina-lockguard', 14], ['plotina-harpooner', 6]], tag: 'main' }],
    objects: [
      { kind: 'mine-wood', at: [6, 14] },
      { kind: 'stack', at: [7, 16], army: [['neutral-wolf', 5]] },
      { kind: 'mine-stone', at: [18, 30] },
      { kind: 'stack', at: [18, 32], army: [['neutral-crab', 6]] },
      { kind: 'res-stone', at: [20, 18], n: 6 },
      { kind: 'res-wood', at: [14, 24], n: 8 },
      { kind: 'res-semki', at: [8, 28], n: 800 },
      { kind: 'chest', at: [8, 4], n: 1500 },
      { kind: 'campfire', at: [22, 6], n: 500 },
      { kind: 'watchtower', at: [16, 10] },
      { kind: 'dwell-crab', at: [21, 12], army: [['neutral-crab', 8]] },
      { kind: 'artifact', at: [27, 34], artRank: 1, army: [['neutral-crab', 7]] },
      { kind: 'learnstone', at: [10, 32] },
      { kind: 'signpost', at: [25, 24], text: 'Плотина в Гребне копит напор. Набег придёт с севера — вдоль берега.' },
    ],
    roads: [
      [[27, 23], [20, 23], [8, 16]],
      [[27, 23], [24, 12], [22, 4]],
    ],
  }),
  spec: {
    goals: [
      { id: 'dam', text: 'Поставить в Гребне Плотину', cond: { t: 'built', b: 'dam' } },
      { id: 'napor', text: 'Накопить напор 4 перед набегом', cond: { t: 'napor', n: 4 } },
      { id: 'yard', text: 'Построить верфь', cond: { t: 'built', b: 'shipyard' } },
      { id: 'raid', text: 'Отбить набег с моря', cond: { t: 'gone', tags: ['raid'] } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Плотина строится в Гребне, верфь — там же. Строить можно раз в день. Напор копится сам, по 1 в день — не сбрасывай его, пока не наберёшь 4. Через неделю с севера придёт набег.' }] },
      { id: 'dam-up', when: { t: 'built', b: 'dam' }, do: [{ t: 'msg', title: 'Напор', text: 'Шлюзы гудят. Плотина копит напор каждый день — сброс даёт семки, ход героям в городе или вторую стройку за день.' }] },
      { id: 'sails', when: { t: 'day', day: 6 }, do: [{ t: 'msg', title: 'Смотрители', text: 'С мыса видны чёрные паруса. Через два дня будут у берега.' }] },
      {
        id: 'raid-in', when: { t: 'day', day: 8 }, do: [
          { t: 'hero', owner: 1, pick: { cls: 'kuznya-master', n: 2 }, at: [22, 2], army: [['kuznya-riveter', 10], ['zatonye-frog', 10], ['kuznya-wasp', 6]], level: 3, tag: 'raid' },
          { t: 'msg', title: FLEET, text: 'На северный берег высадился набег. Идут к Гребню.' },
        ],
      },
      { id: 'raid-out', when: { t: 'gone', tags: ['raid'] }, do: [{ t: 'msg', title: 'Набег отбит', text: 'Чёрные паруса ушли в туман. Смотрители говорят: это был только дозор.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 3.2 «Шторм»

const s32: ScenarioDef = {
  id: 'c3-2',
  title: 'Шторм',
  brief: 'Брат Макса два года назад ушёл на лодке по Обскому морю и пропал. Здесь у моря есть маяк — на дальнем северо-восточном острове. Мосты туда не ведут: нужна лодка. Каждые четыре дня налетает буря.',
  before: ['c3-2a'],
  carry: true,
  sketch: () => ({
    name: 'Шторм',
    seed: 32,
    scale: 2,
    rows: paint(24, 24, '~', [
      [0, 15, 10, 9, 'c'], [2, 18, 3, 2, 'C'],
      [6, 9, 7, 5, 'c'], [9, 10, 2, 2, 'C'],
      [12, 5, 6, 4, 'c'],
      [17, 0, 6, 3, 'c'],
      [1, 2, 6, 5, 'c'], [3, 3, 2, 2, 'C'],
      [18, 11, 5, 4, 'c'],
      [14, 18, 6, 4, 'c'],
    ]),
    players: [{ name: 'Макс', faction: 'plotina', res: { semki: 8000, wood: 25 } }],
    towns: [{ at: [16, 32], faction: 'plotina', owner: 0, name: 'Гавань', tag: 'town', built: ['shipyard', 'dwell2'] }],
    heroes: [{ at: [17, 35], owner: 0, pick: MAKS, army: [['plotina-lockguard', 20], ['plotina-harpooner', 10], ['plotina-stormbird', 4]], tag: 'main' }],
    objects: [
      { kind: 'watchtower', at: [40, 3], tag: 'lighthouse' },
      { kind: 'shipyard', at: [27, 12] },
      { kind: 'mine-wood', at: [6, 40] },
      { kind: 'mine-semki', at: [16, 22] },
      { kind: 'stack', at: [18, 26], army: [['neutral-crab', 8]] },
      { kind: 'stack', at: [26, 15], army: [['neutral-sirin', 5]] },
      { kind: 'treasury-coast', at: [7, 8], army: [['neutral-crab', 15]], reward: { semki: 4000, wood: 6 }, artRank: 1 },
      { kind: 'chest', at: [40, 26], n: 2000 },
      { kind: 'res-salt', at: [34, 40], n: 4 },
      { kind: 'campfire', at: [8, 44], n: 600 },
      { kind: 'learnstone', at: [14, 24] },
      { kind: 'windmill', at: [4, 34] },
      { kind: 'luckfountain', at: [22, 20] },
      { kind: 'res-semki', at: [32, 12], n: 1000 },
      { kind: 'signpost', at: [19, 33], text: 'Маяк — на северо-восточном острове. Мостов туда нет: лодки продают верфь Гавани и верфь на среднем острове.' },
    ],
    roads: [
      [[16, 33], [18, 24]],
      [[18, 24], [28, 14]],
    ],
  }),
  spec: {
    goals: [{ id: 'light', text: 'Доплыть до маяка за 3 недели', cond: { t: 'near', at: 'lighthouse', r: 1 } }],
    lose: [MAIN_DEAD, NO_TOWNS, { text: 'Три недели прошли — маяк не найден.', cond: { t: 'all', of: [{ t: 'day', day: 21 }, { t: 'not', c: { t: 'near', at: 'lighthouse', r: 1 } }] } }],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Лодку покупают в городе с верфью или на верфи на берегу — встань у воды. Сойти на сушу — шагнуть на берег.' }, { t: 'reveal', at: 'lighthouse', r: 3 }] },
      {
        id: 'storm', when: { t: 'day', day: 4 }, every: 4, do: [
          { t: 'msg', title: 'Буря', text: 'Буря гонит волны. Из пены на берег лезут крабы.' },
          { t: 'ambush', cre: 'neutral-crab', n: 6, r: 2 },
        ],
      },
      { id: 'week2', when: { t: 'day', day: 14 }, do: [{ t: 'msg', title: 'Неделя до срока', text: 'Осталась неделя. Маяк ещё горит — но долго ли?' }] },
    ],
  },
};

// ------------------------------------------------------------------ 3.3 «Маяк»

const s33: ScenarioDef = {
  id: 'c3-3',
  title: 'Маяк',
  brief: 'Маяк заняли люди Старшого. Подход к нему знает Жека: он и тут торгует, на базаре за солончаком, и продаёт карту фарватера. Можно купить — Жеке нужны буревестники для почты, — а можно отбить базар.',
  before: ['c3-3a', 'c3-3b'],
  carry: true,
  sketch: () => ({
    name: 'Маяк',
    seed: 33,
    scale: 2,
    rows: paint(24, 24, 'c', [
      [13, 0, 11, 24, 'l'], [0, 0, 3, 24, '~'], [3, 0, 2, 6, '~'], [0, 18, 6, 6, '~'],
      [8, 4, 3, 3, 'C'], [16, 14, 3, 3, 'L'], [10, 19, 2, 3, '^'], [19, 3, 3, 2, '^'],
    ]),
    players: [
      { name: 'Макс', faction: 'plotina', res: { semki: 10000 } },
      { name: 'Жека', faction: 'bazar', bot: 'easy', res: { semki: 4000 } },
      { name: FLEET, faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [
      { at: [16, 40], faction: 'plotina', owner: 0, name: 'Гребень', tag: 'town', built: ['dwell2', 'dwell3', 'dam'], garrison: [['plotina-lockguard', 20], ['plotina-harpooner', 8]] },
      { at: [38, 26], faction: 'bazar', owner: 1, name: 'Нахалов базар', tag: 'bazar', built: ['dwell2', 'market'], garrison: [['bazar-pickpocket', 16], ['bazar-pepperthrower', 8]] },
    ],
    heroes: [
      { at: [17, 43], owner: 0, pick: MAKS, army: [['plotina-lockguard', 26], ['plotina-harpooner', 12], ['plotina-stormbird', 6]], tag: 'main' },
      { at: [36, 29], owner: 1, pick: ZHEKA, army: [['bazar-pickpocket', 8], ['bazar-pepperthrower', 4]], level: 2, tag: 'zheka' },
    ],
    objects: [
      { kind: 'garrison', at: [11, 7], owner: 2, army: [['kuznya-riveter', 16], ['zatonye-frog', 14], ['kuznya-steamhound', 4]], tag: 'lighthouse' },
      { kind: 'seerhut', at: [32, 22], tag: 'chart', quest: { cre: 'plotina-stormbird', count: 6, reward: { semki: 2000, salt: 4 }, xp: 1500 } },
      { kind: 'signpost', at: [30, 24], text: 'Лавка Жеки. «Карта фарватера — за шесть буревестников: почту возить».' },
      { kind: 'mine-wood', at: [20, 30] },
      { kind: 'mine-stone', at: [24, 10] },
      { kind: 'stack', at: [24, 12], army: [['neutral-crab', 8]] },
      { kind: 'mine-salt', at: [44, 40] },
      { kind: 'stack', at: [44, 42], army: [['neutral-scorpion', 6]] },
      { kind: 'tradepost', at: [30, 36] },
      { kind: 'dwell-nomad', at: [40, 10], army: [['neutral-nomad', 8]] },
      { kind: 'stack', at: [30, 6], army: [['neutral-scorpion', 7]] },
      { kind: 'chest', at: [44, 6], n: 2000 },
      { kind: 'campfire', at: [24, 44], n: 600 },
      { kind: 'res-salt', at: [34, 44], n: 4 },
      { kind: 'res-wood', at: [12, 30], n: 8 },
      { kind: 'learnstone', at: [8, 24] },
      { kind: 'luckfountain', at: [26, 30] },
    ],
    roads: [
      [[16, 41], [20, 24], [12, 9], [11, 8]],
      [[16, 41], [30, 36], [38, 27]],
    ],
  }),
  spec: {
    goals: [
      { id: 'chart', text: 'Достать карту фарватера: выполнить просьбу Жеки или взять его базар', cond: { t: 'any', of: [{ t: 'quest', tag: 'chart' }, { t: 'own', tags: ['bazar'] }] } },
      { id: 'light', text: 'Взять маяк', cond: { t: 'own', tags: ['lighthouse'] } },
      { id: 'fleet', text: 'Разбить флот Старшого у скал', cond: { t: 'gone', tags: ['fleet'] }, optional: true, hidden: true },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Маяк — застава на северных скалах. Без карты фарватера туда не подойти незамеченным: Жека торгует за солончаком.' }] },
      {
        id: 'deal', when: { t: 'quest', tag: 'chart' }, do: [
          { t: 'team', player: 0, team: 1 }, { t: 'team', player: 1, team: 1 },
          { t: 'reveal', at: 'lighthouse', r: 6 },
          { t: 'msg', title: 'Жека', text: '— По рукам, Штиль! Карта твоя. И это… я теперь за тебя. Старшой всё равно не платит.' },
        ],
      },
      { id: 'taken', when: { t: 'own', tags: ['bazar'] }, do: [{ t: 'reveal', at: 'lighthouse', r: 6 }, { t: 'msg', title: 'Нахалов базар', text: 'Карта фарватера нашлась под прилавком. Жека ушёл в пески — обиделся, но ненадолго.' }] },
      {
        id: 'fleet-in', when: { t: 'day', day: 9 }, do: [
          { t: 'hero', owner: 2, pick: { cls: 'kuznya-master', n: 3 }, at: [7, 14], army: [['kuznya-wasp', 10], ['zatonye-frog', 12], ['kuznya-riveter', 8], ['zatonye-wisp', 4]], level: 4, tag: 'fleet' },
          { t: 'show', goal: 'fleet' },
          { t: 'msg', title: FLEET, text: 'У скал под маяком встал флот Старшого. Он будто ждал тебя.' },
        ],
      },
    ],
  },
};

// ------------------------------------------------------------------ 3.4 «Брат»

const s34: ScenarioDef = {
  id: 'c3-4',
  title: 'Брат',
  brief: 'В остроге на скале посреди моря держат пленных. В окне башни — Костя. Скалу стережёт адмирал Старшого, его флот стоит у северо-восточного острова. Жека с нами: его базар — на юго-востоке.',
  before: ['c3-4a'],
  carry: true,
  sketch: () => ({
    name: 'Брат',
    seed: 34,
    scale: 2,
    rows: paint(30, 30, '~', [
      [0, 20, 12, 10, 'c'], [2, 23, 3, 3, 'C'],
      [10, 12, 8, 6, 'c'], [13, 13, 2, 2, 'C'],
      [20, 4, 9, 7, 'c'], [25, 5, 3, 2, '^'],
      [2, 3, 7, 6, 'c'],
      [20, 20, 8, 7, 'c'], [23, 22, 2, 2, 'C'],
      [14, 2, 3, 3, 'r'],
    ]),
    players: [
      { name: 'Макс', faction: 'plotina', team: 1, res: { semki: 12000, wood: 25 } },
      { name: 'Жека', faction: 'bazar', bot: 'medium', team: 1 },
      { name: FLEET, faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [
      { at: [14, 42], faction: 'plotina', owner: 0, name: 'Гавань', tag: 'town', built: ['shipyard', 'dwell2', 'dwell3', 'dwell4', 'hall2', 'dam'] },
      { at: [48, 48], faction: 'bazar', owner: 1, name: 'Нахалов базар', tag: 'bazar', built: ['dwell2', 'dwell3', 'market'] },
    ],
    heroes: [
      { at: [16, 45], owner: 0, pick: MAKS, army: [['plotina-gatekeeper', 34], ['plotina-whaler', 16], ['plotina-thunderbird', 10], ['plotina-triton', 6], ['plotina-seawitch', 3]], tag: 'main' },
      { at: [46, 51], owner: 1, pick: ZHEKA, army: [['bazar-cutpurse', 24], ['bazar-peppermaster', 12], ['bazar-carpetrider', 6], ['bazar-mirrorman', 3]], level: 5, tag: 'zheka' },
      { at: [48, 14], owner: 2, pick: { cls: 'kuznya-master', n: 4 }, army: [['kuznya-riveter', 22], ['zatonye-frog', 18], ['kuznya-wasp', 12], ['zatonye-willow', 4], ['kuznya-founder', 3]], level: 7, tag: 'admiral' },
    ],
    objects: [
      { kind: 'prison', at: [30, 6], captive: KOSTYA, tag: 'brother' },
      { kind: 'stack', at: [31, 8], army: [['kuznya-riveter', 12], ['kuznya-steamhound', 6]] },
      { kind: 'shipyard', at: [32, 26] },
      { kind: 'mine-wood', at: [6, 50] },
      { kind: 'mine-semki', at: [20, 54] },
      { kind: 'mine-salt', at: [28, 30] },
      { kind: 'stack', at: [28, 32], army: [['neutral-crab', 12]] },
      { kind: 'mine-stariron', at: [50, 18] },
      { kind: 'treasury-coast', at: [10, 10], army: [['neutral-crab', 20], ['neutral-sirin', 6]], reward: { semki: 6000, salt: 5 }, artRank: 2 },
      { kind: 'dwell-sirin', at: [8, 14], army: [['neutral-sirin', 8]] },
      { kind: 'chest', at: [24, 30], n: 2000 },
      { kind: 'chest', at: [52, 44], n: 2000 },
      { kind: 'res-salt', at: [44, 46], n: 5 },
      { kind: 'campfire', at: [4, 46], n: 600 },
      { kind: 'learnstone', at: [30, 28] },
      { kind: 'gloryhill', at: [44, 42], army: [['neutral-crab', 10]] },
      { kind: 'watchtower', at: [22, 34] },
      { kind: 'signpost', at: [17, 43], text: 'Острог на скале — к северу от среднего острова. Лодкой — напрямик, а мост туда ведёт только с острова адмирала.' },
    ],
    roads: [
      [[14, 43], [26, 30]],
      [[26, 30], [34, 30], [46, 44], [48, 49]],
      [[48, 42], [48, 20]],
      [[44, 12], [32, 7]],
    ],
  }),
  spec: {
    goals: [
      { id: 'brother', text: 'Вытащить брата из острога на скале', cond: { t: 'gone', tags: ['brother'] } },
      { id: 'admiral', text: 'Разбить адмирала Старшого', cond: { t: 'gone', tags: ['admiral'] } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: 'Союз', text: 'Жека — союзник: его войска тебя не тронут. Острог на скале — к северу: напрямик лодкой или по мосту мимо адмирала.' }, { t: 'reveal', at: 'brother', r: 3 }] },
      { id: 'free', when: { t: 'gone', tags: ['brother'] }, do: [{ t: 'msg', title: 'Костя', text: '— Макс?.. Ты как здесь? — Потом, дома. Держись рядом.' }] },
      {
        id: 'raid', when: { t: 'day', day: 10 }, every: 7, do: [
          { t: 'stack', at: 'town', cre: 'zatonye-frog', n: 14 },
          { t: 'msg', title: FLEET, text: 'Шлюпки адмирала высадили десант у Гавани.' },
        ],
      },
      { id: 'admiral-out', when: { t: 'gone', tags: ['admiral'] }, do: [{ t: 'msg', title: 'Адмирал разбит', text: 'Чёрный флот без адмирала разбегается по бухтам.' }] },
    ],
  },
};

export const PLOTINA: CampaignDef = {
  id: 'c3',
  title: 'Обское море',
  hero: 'Макс «Штиль»',
  lad: 'maks',
  text: 'Плотина бурь: шлюзы, лодки и напор. Макс ищет брата, пропавшего на Обском море.',
  scenarios: [s31, s32, s33, s34],
  finale: ['c3-fin1', 'c3-fin2'],
  paid: true,
};
