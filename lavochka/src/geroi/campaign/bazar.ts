/* Кампания 5 «Навар»: Жека «Барыга», Нахалов базар. Про торговлю, кредит и хитрость (CAMPAIGNS2.md). */
import type { HeroPick } from '../sim/heroes';
import type { CampaignDef, ScenarioDef } from './types';
import { HINT, NOTHING, STARSHOY, mainDead, noTowns, paint } from './common';

const ZHEKA: HeroPick = { cls: 'bazar-kupets', n: 0, lad: 'zheka' };
const MAIN_DEAD = mainDead('Жека');
const NO_TOWNS = noTowns('Нахалов базар');
const DEBT = 25000;

// ------------------------------------------------------------------ 5.1 «Лавка»

const s51: ScenarioDef = {
  id: 'c5-1',
  title: 'Лавка',
  brief: 'Жека проснулся на базаре посреди солончака — и сразу понял, что он дома. Старый купец отдал ему лавку. Навар — твой: собери двадцать тысяч семок и найми кочевников со стана за солончаком — чужой отряд, зато какой.',
  before: ['c5-1a', 'c5-1b'],
  sketch: () => ({
    name: 'Лавка',
    seed: 51,
    scale: 2,
    rows: paint(18, 18, 'l', [[0, 0, 6, 5, 'g'], [12, 12, 6, 6, 'L'], [0, 13, 3, 5, 'L'], [13, 0, 5, 3, 'L'], [8, 6, 2, 2, '^'], [1, 1, 2, 2, 'G']]),
    players: [{ name: 'Жека', faction: 'bazar', res: { semki: 5000 } }],
    towns: [{ at: [18, 22], faction: 'bazar', owner: 0, name: 'Нахалов базар', tag: 'town', built: ['market'] }],
    heroes: [{ at: [20, 25], owner: 0, pick: ZHEKA, army: [['bazar-pickpocket', 14], ['bazar-pepperthrower', 6]], tag: 'main' }],
    objects: [
      { kind: 'mine-semki', at: [6, 6] },
      { kind: 'stack', at: [6, 8], army: [['neutral-bandit', 6]] },
      { kind: 'dwell-nomad', at: [28, 8], army: [['neutral-nomad', 8]], tag: 'nomads' },
      { kind: 'mine-salt', at: [8, 30] },
      { kind: 'stack', at: [8, 32], army: [['neutral-scorpion', 5]] },
      { kind: 'tradepost', at: [26, 22] },
      { kind: 'treasury-saltflat', at: [30, 30], army: [['neutral-scorpion', 12]], reward: { semki: 4000, salt: 3 }, artRank: 1 },
      { kind: 'chest', at: [4, 18], n: 1500 },
      { kind: 'chest', at: [32, 18], n: 1500 },
      { kind: 'res-semki', at: [14, 14], n: 1000 },
      { kind: 'res-semki', at: [22, 32], n: 1000 },
      { kind: 'campfire', at: [16, 4], n: 600 },
      { kind: 'watermill', at: [12, 28] },
      { kind: 'learnstone', at: [24, 14] },
      { kind: 'signpost', at: [21, 24], text: 'Семки — с поля на северо-западе, с мельницы и с торгового поста. Кочевников нанимают на их стане, когда он твой.' },
    ],
    roads: [
      [[18, 23], [8, 10], [6, 7]],
      [[18, 23], [26, 23], [28, 9]],
      [[18, 23], [9, 31]],
    ],
  }),
  spec: {
    goals: [
      { id: 'navar', text: 'Собрать 20 000 семок', cond: { t: 'res', res: 'semki', n: 20000 } },
      { id: 'nomads', text: 'Нанять отряд чужого края: шесть кочевников с их стана', cond: { t: 'army', cre: ['neutral-nomad'], n: 6 } },
      { id: 'serai', text: 'Поставить Караван-сарай — найм чужих отрядов', cond: { t: 'built', b: 'caravanserai' }, optional: true },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Задание засчитывается, когда в казне разом лежат 20 000 семок. Рынок в базаре меняет ресурсы на семки.' }] },
      { id: 'nomads-near', when: { t: 'near', at: 'nomads', r: 5 }, do: [{ t: 'msg', title: 'Стан кочевников', text: 'Кочевники служат тому, чей флаг над станом. Разгони охрану — и нанимай.' }] },
      { id: 'half', when: { t: 'res', res: 'semki', n: 10000 }, do: [{ t: 'msg', title: 'Купец', text: '— Половина навара есть, Барыга. Вторая всегда тяжелее.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 5.2 «Долг»

const s52: ScenarioDef = {
  id: 'c5-2',
  title: 'Долг',
  brief: `Старшой дал Жеке в долг — много. Теперь прислал счёт: ${DEBT.toLocaleString('ru')} семок к концу четвёртой недели. Можно собрать и отдать, а можно не отдавать — тогда придут сборщики, и от них придётся отбиться.`,
  before: ['c5-2a'],
  carry: true,
  sketch: () => ({
    name: 'Долг',
    seed: 52,
    scale: 2,
    rows: paint(24, 24, 'l', [[0, 12, 24, 12, 'g'], [0, 16, 5, 8, 'G'], [16, 14, 6, 4, 'G'], [2, 2, 4, 3, 'L'], [16, 2, 6, 4, 'L'], [10, 6, 3, 3, '^']]),
    players: [
      { name: 'Жека', faction: 'bazar', res: { semki: 6000 } },
      { name: 'Сборщики Старшого', faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [{ at: [24, 34], faction: 'bazar', owner: 0, name: 'Нахалов базар', tag: 'town', built: ['dwell2', 'market', 'bank'], garrison: [['bazar-pickpocket', 16]] }],
    heroes: [{ at: [26, 37], owner: 0, pick: ZHEKA, army: [['bazar-pickpocket', 22], ['bazar-pepperthrower', 10], ['bazar-carpetrider', 4]], tag: 'main' }],
    objects: [
      { kind: 'mine-semki', at: [10, 40] },
      { kind: 'mine-semki', at: [40, 26] },
      { kind: 'stack', at: [40, 28], army: [['neutral-nomad', 8]] },
      { kind: 'mine-wood', at: [6, 28] },
      { kind: 'mine-salt', at: [38, 8] },
      { kind: 'stack', at: [38, 10], army: [['neutral-scorpion', 8]] },
      { kind: 'tradepost', at: [32, 40] },
      { kind: 'watermill', at: [16, 44] },
      { kind: 'windmill', at: [44, 42] },
      { kind: 'treasury-saltflat', at: [8, 8], army: [['neutral-scorpion', 14], ['neutral-nomad', 6]], reward: { semki: 6000 }, artRank: 1 },
      { kind: 'dwell-nomad', at: [30, 18], army: [['neutral-nomad', 10]] },
      { kind: 'chest', at: [20, 24], n: 2000 },
      { kind: 'chest', at: [46, 46], n: 2000 },
      { kind: 'res-semki', at: [14, 30], n: 1000 },
      { kind: 'res-semki', at: [34, 32], n: 1000 },
      { kind: 'campfire', at: [4, 46], n: 800 },
      { kind: 'learnstone', at: [28, 46] },
      { kind: 'signpost', at: [27, 36], text: 'Долг отдаётся сам, когда в казне хватит семок — с третьей недели. Меняльная контора даёт кредит… под проценты.' },
    ],
    roads: [
      [[24, 35], [10, 41]],
      [[24, 35], [40, 27]],
      [[24, 35], [24, 20], [38, 9]],
    ],
  }),
  spec: {
    goals: [
      { id: 'debt', text: `Отдать долг Старшому (${DEBT.toLocaleString('ru')} семок с 3-й недели) — или отбиться от сборщиков`, cond: { t: 'any', of: [{ t: 'flag', id: 'paid' }, { t: 'gone', tags: ['col1', 'col2'] }] } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: 'Счёт', text: `«${DEBT.toLocaleString('ru')} семок. Срок — четыре недели. С процентами, как у вас на рынке». Печать — кастет.` }] },
      { id: 'bill1', when: { t: 'day', day: 7 }, do: [{ t: 'msg', title: 'Счёт', text: 'Чёрный всадник напомнил про долг. Три недели.' }] },
      { id: 'bill2', when: { t: 'day', day: 14 }, do: [{ t: 'msg', title: 'Счёт', text: 'Ещё напоминание. С этой недели долг можно отдать: хватит семок — отдашь.' }] },
      {
        id: 'pay', when: { t: 'all', of: [{ t: 'day', day: 14 }, { t: 'res', res: 'semki', n: DEBT }, { t: 'not', c: { t: 'flag', id: 'late' } }] }, do: [
          { t: 'res', player: 0, res: { semki: -DEBT } },
          { t: 'flag', id: 'paid' },
          { t: 'msg', title: 'Долг отдан', text: '— Всё до семечки, Валера. Расписку верни. — Чёрный всадник ухмыльнулся: Старшой запомнит.' },
        ],
      },
      {
        id: 'late', when: { t: 'all', of: [{ t: 'day', day: 27 }, { t: 'not', c: { t: 'flag', id: 'paid' } }] }, do: [
          { t: 'flag', id: 'late' },
          { t: 'hero', owner: 1, pick: { cls: 'kuznya-master', n: 1 }, at: [44, 4], army: [['kuznya-riveter', 24], ['bazar-cutpurse', 20], ['kuznya-steamhound', 8], ['kuznya-founder', 2]], level: 6, tag: 'col1' },
          { t: 'hero', owner: 1, pick: { cls: 'kuznya-ognelit', n: 2 }, at: [4, 4], army: [['zatonye-frog', 20], ['kuznya-wasp', 14], ['bazar-camel', 2]], level: 5, tag: 'col2' },
          { t: 'msg', title: 'Сборщики', text: 'Срок вышел. С севера идут сборщики Старшого — двое, с войском.' },
        ],
      },
    ],
  },
};

// ------------------------------------------------------------------ 5.3 «Ярмарка»

const DWELLS = ['d1', 'd2', 'd3', 'd4', 'd5'];

const s53: ScenarioDef = {
  id: 'c5-3',
  title: 'Ярмарка',
  brief: 'На перекрёсток трёх краёв съехалась ярмарка. Кто скупит больше жилищ — того и армия. Купец Старшого перебивает каждую цену. За три недели нужно взять три жилища чужих краёв.',
  before: ['c5-3a', 'c5-3b'],
  carry: true,
  sketch: () => ({
    name: 'Ярмарка',
    seed: 53,
    scale: 2,
    rows: paint(24, 24, 'g', [
      [12, 0, 12, 12, 'a'], [0, 0, 12, 10, 'p'], [12, 12, 12, 12, 'l'], [0, 0, 4, 4, 'P'], [19, 0, 5, 4, 'A'],
      [3, 14, 4, 4, 'G'], [18, 18, 4, 4, 'L'], [6, 6, 2, 2, '^'], [16, 6, 2, 2, '^'],
    ]),
    players: [
      { name: 'Жека', faction: 'bazar', res: { semki: 10000 } },
      { name: 'Купец Старшого', faction: 'bazar', bot: 'medium', res: { semki: 8000 } },
    ],
    towns: [
      { at: [10, 40], faction: 'bazar', owner: 0, name: 'Нахалов базар', tag: 'town', built: ['dwell2', 'dwell3', 'market'], garrison: [['bazar-pickpocket', 16]] },
      { at: [40, 40], faction: 'bazar', owner: 1, name: 'Чёрный ряд', tag: 'rivaltown', built: ['dwell2', 'dwell3', 'market'], garrison: [['bazar-pickpocket', 16]] },
    ],
    heroes: [
      { at: [12, 43], owner: 0, pick: ZHEKA, army: [['bazar-cutpurse', 24], ['bazar-peppermaster', 12], ['bazar-carpetrider', 6], ['bazar-mirrorman', 3]], tag: 'main' },
      { at: [38, 43], owner: 1, pick: { cls: 'bazar-kupets', n: 3 }, army: [['bazar-pickpocket', 16], ['bazar-pepperthrower', 8], ['bazar-carpetrider', 3]], level: 3, tag: 'rival' },
    ],
    objects: [
      { kind: 'dwell-bear', at: [8, 10], army: [['neutral-bear', 5]], tag: 'd1' },
      { kind: 'dwell-lynx', at: [18, 16], army: [['neutral-lynx', 7]], tag: 'd2' },
      { kind: 'dwell-salamander', at: [36, 8], army: [['neutral-salamander', 6]], tag: 'd3' },
      { kind: 'dwell-raven', at: [44, 20], army: [['neutral-raven', 9]], tag: 'd4' },
      { kind: 'dwell-griffin', at: [24, 26], army: [['neutral-griffin', 5]], tag: 'd5' },
      { kind: 'mine-wood', at: [4, 24] },
      { kind: 'mine-stone', at: [30, 4] },
      { kind: 'mine-semki', at: [24, 44] },
      { kind: 'stack', at: [24, 46], army: [['neutral-bandit', 10]] },
      { kind: 'mine-salt', at: [46, 30] },
      { kind: 'tradepost', at: [20, 34] },
      { kind: 'chest', at: [4, 4], n: 2000 },
      { kind: 'chest', at: [44, 4], n: 2000 },
      { kind: 'res-semki', at: [30, 30], n: 1000 },
      { kind: 'campfire', at: [14, 30], n: 600 },
      { kind: 'learnstone', at: [30, 18] },
      { kind: 'signpost', at: [13, 42], text: 'Жилища на ярмарке — медвежья берлога и рысье логово в бору, лавовая яма и вороний сухостой на пепелище, гнездо грифона на перекрёстке.' },
    ],
    roads: [
      [[10, 41], [24, 28], [40, 41]],
      [[24, 28], [10, 12]],
      [[24, 28], [36, 10]],
      [[24, 28], [44, 22]],
    ],
  }),
  spec: {
    goals: [{ id: 'dwells', text: 'Скупить три жилища чужих краёв за 3 недели', cond: { t: 'own', tags: DWELLS, n: 3 } }],
    lose: [
      MAIN_DEAD, NO_TOWNS,
      { text: 'Ярмарка закрылась — трёх жилищ нет.', cond: { t: 'all', of: [{ t: 'day', day: 21 }, { t: 'not', c: { t: 'own', tags: DWELLS, n: 3 } }] } },
    ],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Жилище твоё, когда над ним твой флаг: разгони охрану и встань на вход. Купец Старшого скупает те же жилища.' }] },
      { id: 'week2', when: { t: 'day', day: 7 }, do: [{ t: 'msg', title: 'Ярмарка', text: 'Купец Старшого поднял цены вдвое. Ну ладно. Перебивать я тоже умею.' }] },
      { id: 'week3', when: { t: 'day', day: 14 }, do: [{ t: 'msg', title: 'Ярмарка', text: 'Последняя неделя ярмарки.' }] },
      { id: 'two', when: { t: 'own', tags: DWELLS, n: 2 }, do: [{ t: 'msg', title: 'Навар', text: 'Два жилища есть. Осталось одно.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 5.4 «Кидок»

const s54: ScenarioDef = {
  id: 'c5-4',
  title: 'Кидок',
  brief: 'Осколок Жеки — в сокровищнице Старшого, за хребтом. Ворота стерегут, но ростовщик Старшого купит что угодно. Зеркальщики сделают подделку — продай её, и сторожа уйдут. Настоящий осколок нужно унести домой, на базар.',
  before: ['c5-4a'],
  carry: true,
  sketch: () => ({
    name: 'Кидок',
    seed: 54,
    scale: 2,
    rows: paint(30, 30, 'l', [
      [16, 0, 14, 30, 'a'], [0, 0, 5, 6, 'L'], [2, 22, 6, 6, 'L'], [22, 2, 6, 5, 'A'], [22, 22, 5, 5, 'A'],
      [14, 0, 2, 13, '^'], [14, 17, 2, 13, '^'],
    ]),
    players: [
      { name: 'Жека', faction: 'bazar', res: { semki: 12000 } },
      { name: 'Старшой', faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [{ at: [10, 30], faction: 'bazar', owner: 0, name: 'Нахалов базар', tag: 'town', built: ['dwell2', 'dwell3', 'dwell4', 'market', 'hall2'], garrison: [['bazar-cutpurse', 16]] }],
    heroes: [{ at: [12, 33], owner: 0, pick: ZHEKA, army: [['bazar-cutpurse', 26], ['bazar-peppermaster', 14], ['bazar-carpetace', 6], ['bazar-mirrorman', 5], ['bazar-camel', 2]], tag: 'main' }],
    objects: [
      { kind: 'garrison', at: [30, 30], owner: 1, army: [['kuznya-riveter', 24], ['kuznya-wasp', 12], ['kuznya-walkcannon', 1]], tag: 'gate' },
      { kind: 'artifact', at: [50, 30], art: 'art-59', army: [['kuznya-riveter', 20], ['kuznya-steamhound', 10], ['kuznya-founder', 3]], tag: 'vault' },
      { kind: 'seerhut', at: [22, 24], tag: 'fence', quest: { cre: 'bazar-mirrorman', count: 8, reward: { semki: 3000 }, xp: 2000 } },
      { kind: 'signpost', at: [20, 27], text: 'Ростовщик Старшого: «Осколок куплю. Любой. Принеси — проверю». Зеркальщики умеют делать такие вещи…' },
      { kind: 'mine-wood', at: [4, 14] },
      { kind: 'mine-semki', at: [8, 46] },
      { kind: 'mine-salt', at: [20, 8] },
      { kind: 'stack', at: [20, 10], army: [['neutral-scorpion', 10]] },
      { kind: 'mine-stariron', at: [44, 10] },
      { kind: 'stack', at: [44, 12], army: [['neutral-salamander', 8]] },
      { kind: 'treasury-ash', at: [48, 50], army: [['neutral-salamander', 12]], reward: { semki: 5000, stariron: 4 }, artRank: 2 },
      { kind: 'tradepost', at: [18, 40] },
      { kind: 'dwell-scorpion', at: [6, 52], army: [['neutral-scorpion', 10]] },
      { kind: 'chest', at: [4, 4], n: 2000 },
      { kind: 'chest', at: [56, 4], n: 2000 },
      { kind: 'res-semki', at: [22, 50], n: 1000 },
      { kind: 'campfire', at: [38, 40], n: 800 },
      { kind: 'learnstone', at: [24, 16] },
    ],
    roads: [
      [[10, 31], [22, 26], [29, 31]],
      [[31, 31], [50, 31]],
      [[10, 31], [8, 47]],
    ],
    walls: [[30, 26], [30, 27], [30, 28], [30, 29], [30, 31], [30, 32], [30, 33]],
  }),
  spec: {
    goals: [
      { id: 'fake', text: 'Продать ростовщику подделку — восемь зеркальщиков (сторожа у ворот перейдут к тебе)', cond: { t: 'quest', tag: 'fence' }, optional: true },
      { id: 'shard', text: 'Забрать осколок из сокровищницы Старшого', cond: { t: 'shard' } },
      { id: 'home', text: 'Унести осколок домой, в Нахалов базар', cond: { t: 'all', of: [{ t: 'shard' }, { t: 'near', at: 'town', r: 1 }] } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Сокровищница — за воротами в хребте. Ворота можно взять боем — а можно перекупить сторожей.' }] },
      {
        id: 'sold', when: { t: 'quest', tag: 'fence' }, do: [
          { t: 'give', tag: 'gate', player: 0 },
          { t: 'msg', title: 'Кидок', text: 'Ростовщик унёс «осколок» Старшому. Сторожа у ворот послушали звон семок и перешли к тебе.' },
        ],
      },
      {
        id: 'chase', when: { t: 'shard' }, do: [
          { t: 'hero', owner: 1, pick: STARSHOY, at: [52, 26], army: [['kuznya-riveter', 30], ['kuznya-wasp', 16], ['kuznya-steamhound', 8], ['bazar-goldserpent', 1]], level: 8, tag: 'starshoy' },
          { t: 'msg', title: 'Старшой', text: 'В сокровищнице подняли тревогу. Старшой сам гонится за тобой — беги на базар!' },
        ],
      },
    ],
  },
};

export const BAZAR: CampaignDef = {
  id: 'c5',
  title: 'Навар',
  hero: 'Жека «Барыга»',
  lad: 'zheka',
  text: 'Нахалов базар: торговля, кредит и наёмники. Жека в долгах у Старшого — и собирается его кинуть.',
  scenarios: [s51, s52, s53, s54],
  finale: ['c5-fin1', 'c5-fin2'],
  paid: true,
};
