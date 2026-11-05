/* Кампания 6 «Голоса»: Тёма «Тихий», Курганы предков. Про память и духов (CAMPAIGNS2.md). */
import type { HeroPick } from '../sim/heroes';
import type { Trigger } from '../sim/adv/scenario';
import type { CampaignDef, ScenarioDef } from './types';
import { HINT, NOTHING, STARSHOY, mainDead, noTowns, paint } from './common';

const TYOMA: HeroPick = { cls: 'kurgany-veshchun', n: 0, lad: 'tyoma' };
const ANDRYUKHA: HeroPick = { cls: 'ostrog-voevoda', n: 0, lad: 'andryukha' };
const MAIN_DEAD = mainDead('Тёма');
const NO_TOWNS = noTowns('Курган');
const SHADOWS = 'Тени Старшого';

// ------------------------------------------------------------------ 6.1 «Курган»

const s61: ScenarioDef = {
  id: 'c6-1',
  title: 'Курган',
  brief: 'Тёма очнулся на кургане, а кругом шептали. Дома тоже шептали — у кладбища, только тут он понимает слова. Предки в бронзе ждали долго: память павших — их сила. Выиграй два боя, собери память и привяжи первого духа.',
  before: ['c6-1a', 'c6-1b'],
  sketch: () => ({
    name: 'Курган',
    seed: 61,
    scale: 2,
    rows: paint(18, 18, 'h', [[0, 0, 5, 5, 'H'], [13, 12, 5, 6, 'H'], [7, 2, 3, 2, '^'], [0, 12, 4, 3, 'p'], [12, 0, 6, 4, 'h'], [1, 15, 3, 3, 'P']]),
    players: [{ name: 'Тёма', faction: 'kurgany', res: { semki: 8000, amber: 8 } }],
    towns: [{ at: [18, 22], faction: 'kurgany', owner: 0, name: 'Курган', tag: 'town' }],
    heroes: [{ at: [20, 25], owner: 0, pick: TYOMA, army: [['kurgany-shadowherd', 16], ['kurgany-stonebaba', 4]], tag: 'main' }],
    objects: [
      { kind: 'stack', at: [8, 14], army: [['neutral-raven', 10]], tag: 'b1' },
      { kind: 'stack', at: [28, 12], army: [['neutral-bandit', 16]], tag: 'b2' },
      { kind: 'mine-amber', at: [30, 30] },
      { kind: 'stack', at: [30, 32], army: [['neutral-wolf', 7]] },
      { kind: 'mine-wood', at: [6, 26] },
      { kind: 'res-amber', at: [12, 6], n: 3 },
      { kind: 'res-semki', at: [24, 16], n: 800 },
      { kind: 'chest', at: [4, 4], n: 1500 },
      { kind: 'campfire', at: [32, 4], n: 500 },
      { kind: 'treasury-heath', at: [10, 32], army: [['kurgany-shadowherd', 14]], reward: { semki: 3000, amber: 3 }, artRank: 1 },
      { kind: 'learnstone', at: [26, 26] },
      { kind: 'windmill', at: [14, 28] },
      { kind: 'signpost', at: [21, 24], text: 'Память копится после каждого боя, где бьются Курганы. Круг памяти зовёт духов, Камень привязки — оставляет навсегда.' },
    ],
    roads: [
      [[18, 23], [8, 16]],
      [[18, 23], [28, 14]],
      [[18, 23], [30, 31]],
    ],
  }),
  spec: {
    goals: [
      { id: 'fights', text: 'Выиграть два боя — у Вороньего сухостоя и у разбойничьей стоянки', cond: { t: 'gone', tags: ['b1', 'b2'] } },
      { id: 'mem', text: 'Накопить 50 памяти (не трать её до срока)', cond: { t: 'memory', n: 50 } },
      { id: 'bind', text: 'Поставить Камень привязки — привязать первого духа', cond: { t: 'built', b: 'bindstone' } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Сначала Круг памяти, потом Камень привязки — оба в Кургане, нужен янтарь. Память растёт с каждым боем.' }] },
      { id: 'first', when: { t: 'gone', tags: ['b1'] }, do: [{ t: 'msg', title: 'Шёпот', text: '— Ты слышишь нас, — шепчут павшие. — Запомни их. Память — это сила.' }] },
      { id: 'bound', when: { t: 'built', b: 'bindstone' }, do: [{ t: 'msg', title: 'Предки', text: '— Теперь слушай внимательно, Тихий. Мы ждали долго.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 6.2 «Тризна»

const BARROWS = ['k1', 'k2', 'k3', 'k4', 'k5'];
const barrowTrig = (tag: string, i: number): Trigger => ({
  id: `visit-${tag}`, when: { t: 'near', at: tag, r: 1 }, do: [
    { t: 'flag', id: tag },
    { t: 'msg', title: 'Тризна', text: i < 4 ? 'На кургане вспыхнул костёр. Духи пропустили дальше.' : 'Пятый костёр. Огненная цепочка дошла до горизонта.' },
  ],
});

const s62: ScenarioDef = {
  id: 'c6-2',
  title: 'Тризна',
  brief: 'Чтобы духи заговорили всерьёз, нужна тризна: зажечь костры на пяти курганах за четыре недели. Каждую ночь духи меняют дороги — чтобы чужой не нашёл. И свой — тоже.',
  before: ['c6-2a'],
  carry: true,
  sketch: () => ({
    name: 'Тризна',
    seed: 62,
    scale: 2,
    rows: paint(24, 24, 'h', [
      [0, 0, 10, 10, 'p'], [0, 0, 4, 4, 'P'], [16, 16, 8, 8, 'p'], [19, 19, 5, 5, 'P'], [10, 10, 3, 3, '^'],
      [5, 15, 3, 3, 'H'], [15, 4, 3, 3, 'H'],
    ]),
    players: [{ name: 'Тёма', faction: 'kurgany', res: { semki: 9000, amber: 6 } }],
    towns: [{ at: [24, 44], faction: 'kurgany', owner: 0, name: 'Курган', tag: 'town', built: ['dwell2', 'memory'] }],
    heroes: [{ at: [26, 46], owner: 0, pick: TYOMA, army: [['kurgany-shadowherd', 24], ['kurgany-stonebaba', 8], ['kurgany-ghosthorse', 4]], tag: 'main' }],
    objects: [
      { kind: 'gloryhill', at: [10, 34], tag: 'k1' },
      { kind: 'gloryhill', at: [8, 10], army: [['neutral-lynx', 7]], tag: 'k2' },
      { kind: 'gloryhill', at: [24, 14], tag: 'k3' },
      { kind: 'gloryhill', at: [40, 8], army: [['neutral-raven', 10]], tag: 'k4' },
      { kind: 'gloryhill', at: [40, 30], army: [['neutral-wolf', 10]], tag: 'k5' },
      { kind: 'mine-amber', at: [34, 20] },
      { kind: 'stack', at: [34, 22], army: [['kurgany-shadowherd', 12]] },
      { kind: 'mine-wood', at: [6, 22] },
      { kind: 'mine-semki', at: [40, 42] },
      { kind: 'dwell-raven', at: [16, 4], army: [['neutral-raven', 8]] },
      { kind: 'chest', at: [4, 44], n: 1500 },
      { kind: 'chest', at: [46, 4], n: 2000 },
      { kind: 'campfire', at: [30, 32], n: 600 },
      { kind: 'res-amber', at: [18, 26], n: 3 },
      { kind: 'learnstone', at: [16, 40] },
      { kind: 'watchtower', at: [30, 4] },
      { kind: 'signpost', at: [27, 45], text: 'Пять курганов: подойди к каждому вплотную — духи зажгут костёр.' },
    ],
    roads: [
      [[24, 45], [10, 36], [8, 12]],
      [[24, 45], [24, 16], [40, 10]],
      [[24, 45], [40, 32]],
    ],
  }),
  spec: {
    goals: [{ id: 'trizna', text: 'Зажечь костры на пяти курганах за 4 недели', cond: { t: 'all', of: BARROWS.map((id) => ({ t: 'flag' as const, id })) } }],
    lose: [
      MAIN_DEAD, NO_TOWNS,
      { text: 'Тризна не состоялась: четыре недели прошли.', cond: { t: 'all', of: [{ t: 'day', day: 27 }, { t: 'not', c: { t: 'all', of: BARROWS.map((id) => ({ t: 'flag' as const, id })) } }] } },
    ],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Курганы — по всей пустоши. Подойди к каждому вплотную. Ночами из тумана выходят тени: дороги будто меняются.' }] },
      ...BARROWS.map(barrowTrig),
      { id: 'night-first', when: { t: 'day', day: 2 }, do: [{ t: 'msg', title: 'Ночь', text: 'Туман лёг на дороги. Утром тропа вела не туда, куда вчера.' }] },
      { id: 'night', when: { t: 'day', day: 2 }, every: 3, do: [{ t: 'ambush', cre: 'kurgany-shadowherd', n: 8, r: 3 }] },
    ],
  },
};

// ------------------------------------------------------------------ 6.3 «Дед»

const s63: ScenarioDef = {
  id: 'c6-3',
  title: 'Дед',
  brief: 'На дальнем кургане за болотом сидит дух в телогрейке и кепке сторожа. Тёма узнал его сразу: дед, который сторожил ту стройку в восемьдесят третьем. Курган стерегут тени — и служат они Старшому.',
  before: ['c6-3a', 'c6-3b'],
  carry: true,
  sketch: () => ({
    name: 'Дед',
    seed: 63,
    scale: 2,
    rows: paint(24, 24, 'h', [[0, 12, 24, 12, 's'], [0, 16, 6, 8, 'S'], [14, 18, 6, 6, 'S'], [16, 0, 8, 8, 'H'], [8, 6, 3, 3, '^'], [2, 2, 4, 3, 'H']]),
    players: [
      { name: 'Тёма', faction: 'kurgany', res: { semki: 10000, amber: 6 } },
      { name: SHADOWS, faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [{ at: [10, 40], faction: 'kurgany', owner: 0, name: 'Курган', tag: 'town', built: ['dwell2', 'dwell3', 'memory'], garrison: [['kurgany-shadowherd', 16]] }],
    heroes: [{ at: [12, 43], owner: 0, pick: TYOMA, army: [['kurgany-shadowherd', 28], ['kurgany-stonebaba', 10], ['kurgany-ghosthorse', 6], ['kurgany-barrowknight', 3]], tag: 'main' }],
    objects: [
      { kind: 'learnstone', at: [42, 6], tag: 'ded' },
      { kind: 'stack', at: [41, 9], army: [['kurgany-barrowknight', 10], ['kurgany-shadowwanderer', 20], ['kurgany-mourner', 3]], tag: 'guard' },
      { kind: 'mine-amber', at: [24, 30] },
      { kind: 'stack', at: [24, 32], army: [['neutral-kikimora', 10]] },
      { kind: 'mine-resin', at: [36, 40] },
      { kind: 'mine-wood', at: [4, 30] },
      { kind: 'mine-semki', at: [8, 14] },
      { kind: 'stack', at: [8, 16], army: [['neutral-raven', 9]] },
      { kind: 'treasury-swamp', at: [40, 26], army: [['neutral-kikimora', 14]], reward: { semki: 5000, resin: 4 }, artRank: 2 },
      { kind: 'dwell-kikimora', at: [18, 44], army: [['neutral-kikimora', 8]] },
      { kind: 'chest', at: [4, 4], n: 2000 },
      { kind: 'chest', at: [46, 44], n: 2000 },
      { kind: 'campfire', at: [30, 18], n: 600 },
      { kind: 'res-amber', at: [16, 22], n: 4 },
      { kind: 'gloryhill', at: [28, 8], army: [['kurgany-shadowherd', 12]] },
      { kind: 'luckfountain', at: [20, 36] },
      { kind: 'signpost', at: [13, 42], text: 'Дальний курган — на северо-востоке, за болотом и вересковым лесом.' },
    ],
    roads: [
      [[10, 41], [24, 28], [36, 16], [41, 10]],
      [[10, 41], [8, 18]],
    ],
  }),
  spec: {
    goals: [
      { id: 'guard', text: 'Разогнать тени у дальнего кургана', cond: { t: 'gone', tags: ['guard'] } },
      { id: 'ded', text: 'Найти деда на дальнем кургане', cond: { t: 'near', at: 'ded', r: 1 } },
      { id: 'shade', text: 'Разбить проводника теней', cond: { t: 'gone', tags: ['shade'] }, optional: true, hidden: true },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Тени у кургана — сильный отряд. Собери память в боях по дороге и позови предков в Круге памяти.' }, { t: 'reveal', at: 'ded', r: 3 }] },
      {
        id: 'shade-in', when: { t: 'day', day: 6 }, do: [
          { t: 'hero', owner: 1, pick: { cls: 'kuznya-ognelit', n: 4 }, at: [40, 14], army: [['kurgany-shadowherd', 24], ['kurgany-ghosthorse', 6], ['kuznya-riveter', 10]], level: 5, tag: 'shade' },
          { t: 'show', goal: 'shade' },
          { t: 'msg', title: SHADOWS, text: 'С дальнего кургана спустился проводник теней. На нём кепка — как у нас во дворе.' },
        ],
      },
      { id: 'found', when: { t: 'near', at: 'ded', r: 1 }, do: [{ t: 'msg', title: 'Дед', text: '— Тёмка. Вырос-то как. — Дед… — Кастет надо собрать там, где нашли. В Котловане. Иначе не вернётесь.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 6.4 «Восемьдесят третий»

const s64: ScenarioDef = {
  id: 'c6-4',
  title: 'Восемьдесят третий',
  brief: 'У этого кургана Валерка нашёл свой осколок в восемьдесят третьем — и остался один. Теперь там стоит его войско в чёрном. Андрюха с острогом пришёл на помощь. Разбей Старшого у древнего кургана.',
  before: ['c6-4a'],
  carry: true,
  sketch: () => ({
    name: 'Восемьдесят третий',
    seed: 64,
    scale: 2,
    rows: paint(30, 30, 'h', [[15, 0, 15, 14, 'a'], [0, 16, 14, 14, 'g'], [0, 18, 5, 6, 'G'], [20, 2, 5, 4, 'A'], [22, 18, 6, 6, 'H'], [12, 12, 4, 3, '^']]),
    players: [
      { name: 'Тёма', faction: 'kurgany', team: 1, res: { semki: 12000, amber: 8 } },
      { name: 'Андрюха', faction: 'ostrog', bot: 'medium', team: 1 },
      { name: 'Старшой', faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [
      { at: [12, 46], faction: 'kurgany', owner: 0, name: 'Курган', tag: 'town', built: ['dwell2', 'dwell3', 'dwell4', 'memory', 'bindstone', 'hall2'], garrison: [['kurgany-shadowherd', 20]] },
      { at: [46, 52], faction: 'ostrog', owner: 1, name: 'Острог', tag: 'ostrog', built: ['dwell2', 'dwell3', 'drill'] },
    ],
    heroes: [
      { at: [14, 49], owner: 0, pick: TYOMA, army: [['kurgany-shadowwanderer', 34], ['kurgany-barrowidol', 12], ['kurgany-riderless', 9], ['kurgany-bronzeknight', 6], ['kurgany-seeress', 4]], tag: 'main' },
      { at: [44, 55], owner: 1, pick: ANDRYUKHA, army: [['ostrog-druzhinnik', 30], ['ostrog-snowarcher', 14], ['ostrog-wolfrider', 7], ['ostrog-bearguard', 4]], level: 7, tag: 'andryukha' },
      { at: [44, 14], owner: 2, pick: STARSHOY, army: [['kuznya-riveter', 28], ['kurgany-barrowknight', 10], ['kuznya-steamhound', 10], ['ostrog-bearguard', 5], ['kuznya-founder', 3], ['plotina-stormbull', 2]], level: 9, tag: 'starshoy' },
    ],
    objects: [
      { kind: 'treasury-heath', at: [44, 8], army: [['kurgany-greatancestor', 2], ['kurgany-barrowknight', 10]], reward: { semki: 8000, amber: 6 }, artRank: 3 },
      { kind: 'mine-amber', at: [30, 36] },
      { kind: 'stack', at: [30, 38], army: [['kurgany-shadowherd', 16]] },
      { kind: 'mine-wood', at: [4, 34] },
      { kind: 'mine-stone', at: [20, 56] },
      { kind: 'mine-stariron', at: [52, 26] },
      { kind: 'stack', at: [52, 28], army: [['neutral-salamander', 10]] },
      { kind: 'mine-semki', at: [8, 10] },
      { kind: 'stack', at: [8, 12], army: [['neutral-raven', 12]] },
      { kind: 'treasury-ash', at: [36, 4], army: [['neutral-salamander', 14]], reward: { semki: 6000, stariron: 5 }, artRank: 2 },
      { kind: 'dwell-raven', at: [20, 20], army: [['neutral-raven', 10]] },
      { kind: 'chest', at: [4, 56], n: 2000 },
      { kind: 'chest', at: [56, 40], n: 2000 },
      { kind: 'campfire', at: [26, 46], n: 800 },
      { kind: 'res-amber', at: [38, 44], n: 4 },
      { kind: 'learnstone', at: [24, 30] },
      { kind: 'gloryhill', at: [6, 24], army: [['neutral-wolf', 14]] },
      { kind: 'watchtower', at: [32, 22] },
      { kind: 'signpost', at: [15, 48], text: 'Древний курган — на северо-востоке, за пепелищем. Старшой там.' },
    ],
    roads: [
      [[12, 47], [24, 32], [36, 20], [44, 10]],
      [[24, 32], [46, 53]],
      [[12, 47], [4, 35]],
    ],
  }),
  spec: {
    goals: [{ id: 'starshoy', text: 'Разбить Старшого у древнего кургана', cond: { t: 'gone', tags: ['starshoy'] } }],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: 'Союз', text: 'Андрюха — союзник. Старшой стоит у древнего кургана на северо-востоке.' }, { t: 'reveal', at: 'starshoy', r: 4 }] },
      { id: 'taunt', when: { t: 'day', day: 4 }, do: [{ t: 'msg', title: 'Старшой', text: '— Тихий, а дед твой знал, что я тут. Он всё знал. Только никому не сказал.' }] },
      {
        id: 'riders', when: { t: 'day', day: 7 }, every: 7, do: [
          { t: 'stack', at: 'town', cre: 'kuznya-steamhound', n: 8 },
          { t: 'msg', title: 'Чёрные всадники', text: 'Отряд Старшого вышел к Кургану.' },
        ],
      },
      { id: 'beaten', when: { t: 'gone', tags: ['starshoy'] }, do: [{ t: 'msg', title: 'Курган', text: 'Войско в чёрном разбито. Старшой опять ушёл — на восток, к своей крепости. Но осколок у кургана остался.' }] },
    ],
  },
};

export const KURGANY: CampaignDef = {
  id: 'c6',
  title: 'Голоса',
  hero: 'Тёма «Тихий»',
  lad: 'tyoma',
  text: 'Курганы предков: память павших и духи. Тёма говорит с дедом — и узнаёт, как вернуться домой.',
  scenarios: [s61, s62, s63, s64],
  finale: ['c6-fin1', 'c6-fin2'],
  paid: true,
};
