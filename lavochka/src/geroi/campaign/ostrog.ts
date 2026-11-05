/* Кампания 4 «Устав»: Андрюха «Прапор», Северный острог. Про опыт отрядов и долгую игру (CAMPAIGNS2.md). */
import type { HeroPick } from '../sim/heroes';
import type { ScnAct } from '../sim/adv/scenario';
import type { CampaignDef, ScenarioDef } from './types';
import { HINT, NOTHING, STARSHOY, mainDead, noTowns, paint } from './common';

const ANDRYUKHA: HeroPick = { cls: 'ostrog-voevoda', n: 0, lad: 'andryukha' };
const TYOMA: HeroPick = { cls: 'kurgany-veshchun', n: 0, lad: 'tyoma' };
const MAIN_DEAD = mainDead('Андрюха');
const NO_TOWNS = noTowns('Острог');
const SPIRITS = 'Духи курганов';

// ------------------------------------------------------------------ 4.1 «Учебка»

const s41: ScenarioDef = {
  id: 'c4-1',
  title: 'Учебка',
  brief: 'Андрюха проснулся в бревенчатом остроге посреди тайги. Воевода отдал ему рог и острог, но в строю одни новобранцы, а по ночам к частоколу подходят волки. Пора наводить устав.',
  before: ['c4-1a', 'c4-1b'],
  sketch: () => ({
    name: 'Учебка',
    seed: 41,
    scale: 2,
    rows: paint(18, 18, 'p', [
      [0, 0, 18, 4, 'n'], [0, 0, 4, 3, 'N'], [12, 0, 6, 3, 'N'], [4, 6, 3, 3, 'P'], [12, 7, 4, 3, 'P'],
      [0, 12, 4, 6, 'P'], [13, 13, 5, 5, 'P'], [7, 1, 3, 2, '^'],
    ]),
    players: [{ name: 'Андрюха', faction: 'ostrog', res: { semki: 7000 } }],
    towns: [{ at: [18, 24], faction: 'ostrog', owner: 0, name: 'Острог', tag: 'town' }],
    heroes: [{ at: [20, 27], owner: 0, pick: ANDRYUKHA, army: [['ostrog-recruit', 16], ['ostrog-skiarcher', 6]], tag: 'main' }],
    objects: [
      { kind: 'stack', at: [10, 20], army: [['neutral-wolf', 6]], tag: 'w1' },
      { kind: 'stack', at: [28, 18], army: [['neutral-wolf', 8]], tag: 'w2' },
      { kind: 'stack', at: [16, 9], army: [['neutral-wolf', 10]], tag: 'w3' },
      { kind: 'dwell-wolf', at: [26, 6], army: [['neutral-wolf', 8]] },
      { kind: 'mine-wood', at: [6, 30] },
      { kind: 'mine-stone', at: [30, 30] },
      { kind: 'stack', at: [30, 32], army: [['neutral-lynx', 4]] },
      { kind: 'res-wood', at: [14, 30], n: 8 },
      { kind: 'res-semki', at: [24, 14], n: 800 },
      { kind: 'chest', at: [4, 10], n: 1500 },
      { kind: 'campfire', at: [32, 10], n: 500 },
      { kind: 'learnstone', at: [8, 4] },
      { kind: 'artifact', at: [32, 4], artRank: 1, army: [['neutral-lynx', 6]] },
      { kind: 'windmill', at: [4, 22] },
      { kind: 'signpost', at: [21, 26], text: 'Отряд Острога набирается опыта в каждом выигранном бою, а на Плацу — каждую неделю. Ранг виден значком ★ на отряде.' },
    ],
    roads: [
      [[18, 25], [10, 22], [6, 31]],
      [[18, 25], [28, 20], [30, 31]],
      [[18, 25], [16, 11], [26, 7]],
    ],
  }),
  spec: {
    goals: [
      { id: 'rank', text: 'Вырастить отряд до 3-го ранга (★3)', cond: { t: 'rank', n: 3 } },
      { id: 'drill', text: 'Поставить Плац: отряды в гарнизоне набираются опыта', cond: { t: 'built', b: 'drill' }, optional: true },
      { id: 'wolves', text: 'Отбить волков от острога', cond: { t: 'gone', tags: ['w1', 'w2', 'w3'] } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Волки стоят на трёх тропах к острогу. Каждый выигранный бой — опыт отрядам. Новобранцы слабы: сначала найми лыжников.' }] },
      { id: 'drill-up', when: { t: 'built', b: 'drill' }, do: [{ t: 'msg', title: 'Плац', text: '— Равняйсь! Смирно! — Отряды в гарнизоне острога каждую неделю набираются опыта.' }] },
      { id: 'howl', when: { t: 'day', day: 5 }, do: [{ t: 'stack', at: 'town', cre: 'neutral-wolf', n: 5 }, { t: 'msg', title: 'Ночью', text: 'Волки подошли к самому частоколу.' }] },
      { id: 'clear', when: { t: 'gone', tags: ['w1', 'w2', 'w3'] }, do: [{ t: 'msg', title: 'Тропы чисты', text: 'Воевода кивает: — Устав — дело. Волки тоже поняли.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 4.2 «Зимовка»

const wave = (n: number, day: number, at: [number, number], army: [string, number][]): ScnAct[] => [
  { t: 'hero', owner: 1, pick: { cls: n % 2 ? 'kurgany-khan' : 'kurgany-veshchun', n: 1 + (n % 4) }, at, army, level: 2 + n, tag: `wave${n}` },
  { t: 'msg', title: SPIRITS, text: day < 30 ? 'Из метели вышли бледные всадники. Идут к острогу.' : 'Последний набег зимы — самый большой.' },
];

const s42: ScenarioDef = {
  id: 'c4-2',
  title: 'Зимовка',
  brief: 'Зима здесь не кончается. Снег закрыл перевалы, обозы не ходят, семок мало. С курганов за тайгой приходят духи — кто-то их ведёт. Острогу нужно продержаться шесть недель.',
  before: ['c4-2a'],
  carry: true,
  sketch: () => ({
    name: 'Зимовка',
    seed: 42,
    scale: 2,
    rows: paint(24, 24, 'n', [
      [0, 12, 24, 12, 'p'], [0, 14, 5, 10, 'P'], [17, 16, 7, 8, 'P'], [8, 4, 3, 3, '^'], [15, 2, 3, 3, '^'],
      [2, 2, 4, 4, 'N'], [10, 18, 4, 3, 'P'], [19, 7, 3, 3, 'N'],
    ]),
    players: [
      { name: 'Андрюха', faction: 'ostrog', res: { semki: 4000, wood: 8, stone: 8 } },
      { name: SPIRITS, faction: 'kurgany', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [{ at: [24, 32], faction: 'ostrog', owner: 0, name: 'Острог', tag: 'town', built: ['dwell2', 'dwell3', 'drill'], garrison: [['ostrog-recruit', 20]] }],
    heroes: [{ at: [26, 35], owner: 0, pick: ANDRYUKHA, army: [['ostrog-druzhinnik', 26], ['ostrog-snowarcher', 12], ['ostrog-wolfrider', 5]], tag: 'main' }],
    objects: [
      { kind: 'mine-wood', at: [8, 36] },
      { kind: 'mine-stone', at: [40, 40] },
      { kind: 'stack', at: [40, 42], army: [['neutral-bear', 4]] },
      { kind: 'mine-semki', at: [14, 22] },
      { kind: 'stack', at: [14, 24], army: [['neutral-wolf', 10]] },
      { kind: 'mine-amber', at: [40, 18] },
      { kind: 'stack', at: [40, 20], army: [['neutral-lynx', 8]] },
      { kind: 'dwell-bear', at: [6, 12], army: [['neutral-bear', 5]] },
      { kind: 'treasury-snow', at: [32, 6], army: [['neutral-bear', 8], ['neutral-wolf', 12]], reward: { semki: 5000, amber: 4 }, artRank: 2 },
      { kind: 'chest', at: [20, 12], n: 1500 },
      { kind: 'chest', at: [44, 30], n: 1500 },
      { kind: 'campfire', at: [4, 28], n: 600 },
      { kind: 'campfire', at: [30, 44], n: 600 },
      { kind: 'res-wood', at: [18, 40], n: 8 },
      { kind: 'res-semki', at: [34, 28], n: 1000 },
      { kind: 'learnstone', at: [10, 44] },
      { kind: 'watchtower', at: [26, 18] },
      { kind: 'signpost', at: [27, 34], text: 'Набеги идут с севера раз в неделю. Острог — главное: потерять его — проиграть зимовку.' },
    ],
    roads: [
      [[24, 33], [24, 20], [24, 4]],
      [[24, 33], [10, 36]],
      [[24, 33], [40, 40]],
    ],
  }),
  spec: {
    goals: [
      { id: 'hold', text: 'Продержаться шесть недель', cond: { t: 'all', of: [{ t: 'day', day: 41 }, { t: 'own', tags: ['town'] }] } },
      { id: 'fort', text: 'Поставить Крепость', cond: { t: 'built', b: 'fort2' }, optional: true },
      { id: 'waves', text: 'Разбить все набеги', cond: { t: 'gone', tags: ['wave1', 'wave2', 'wave3', 'wave4', 'wave5'] }, optional: true },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: 'Зимовка', text: 'Перевалы под снегом, семок мало — каждая мельница на счету. Набеги — раз в неделю, с севера.' }] },
      { id: 'w1', when: { t: 'day', day: 6 }, do: wave(1, 6, [24, 2], [['kurgany-shadowherd', 18], ['kurgany-stonebaba', 5]]) },
      { id: 'w2', when: { t: 'day', day: 13 }, do: wave(2, 13, [44, 4], [['kurgany-shadowherd', 24], ['kurgany-ghosthorse', 6], ['kurgany-stonebaba', 6]]) },
      { id: 'w3', when: { t: 'day', day: 20 }, do: wave(3, 20, [4, 4], [['kurgany-shadowherd', 28], ['kurgany-ghosthorse', 8], ['kurgany-barrowknight', 5], ['kurgany-stonebaba', 6]]) },
      { id: 'w4', when: { t: 'day', day: 27 }, do: wave(4, 27, [24, 2], [['kurgany-shadowwanderer', 28], ['kurgany-riderless', 8], ['kurgany-barrowknight', 7], ['kurgany-seeress', 4]]) },
      { id: 'w5', when: { t: 'day', day: 34 }, do: wave(5, 34, [44, 4], [['kurgany-shadowwanderer', 34], ['kurgany-riderless', 10], ['kurgany-bronzeknight', 8], ['kurgany-seeress', 5], ['kurgany-boneeagle', 2]]) },
      {
        id: 'blizzard', when: { t: 'day', day: 3 }, every: 7, do: [
          { t: 'msg', title: 'Метель', text: 'Метель замела тропы. Из снега вышли голодные волки.' },
          { t: 'ambush', cre: 'neutral-wolf', n: 8, r: 3 },
        ],
      },
      { id: 'spring', when: { t: 'day', day: 41 }, do: [{ t: 'msg', title: 'Оттепель', text: 'Впервые за шесть недель с крыши закапало.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 4.3 «Курганы»

const s43: ScenarioDef = {
  id: 'c4-3',
  title: 'Курганы',
  brief: 'Духов на острог водил кто-то с курганов за тайгой. Местные туда не суются: ночью над курганами ходят огни. Андрюха идёт сам — и, кажется, знает, кого там найдёт.',
  before: ['c4-3a', 'c4-3b'],
  carry: true,
  sketch: () => ({
    name: 'Курганы',
    seed: 43,
    scale: 2,
    rows: paint(24, 24, 'p', [
      [12, 0, 12, 24, 'h'], [0, 0, 5, 6, 'P'], [5, 16, 4, 4, 'P'], [14, 4, 3, 3, 'H'], [18, 15, 3, 3, 'H'],
      [10, 8, 2, 3, '^'], [11, 17, 2, 3, '^'],
    ]),
    players: [
      { name: 'Андрюха', faction: 'ostrog', res: { semki: 10000 } },
      { name: 'Тёма', faction: 'kurgany', bot: 'medium', res: { semki: 5000 } },
      { name: 'Старшой', faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [
      { at: [10, 38], faction: 'ostrog', owner: 0, name: 'Острог', tag: 'town', built: ['dwell2', 'dwell3', 'drill', 'smithy'], garrison: [['ostrog-druzhinnik', 16]] },
      { at: [38, 12], faction: 'kurgany', owner: 1, name: 'Курган', tag: 'barrow', built: ['dwell2', 'dwell3', 'memory'], garrison: [['kurgany-shadowherd', 20], ['kurgany-stonebaba', 6]] },
    ],
    heroes: [
      { at: [12, 41], owner: 0, pick: ANDRYUKHA, army: [['ostrog-druzhinnik', 30], ['ostrog-snowarcher', 14], ['ostrog-wolfrider', 7], ['ostrog-bearguard', 3]], tag: 'main' },
      { at: [36, 15], owner: 1, pick: TYOMA, army: [['kurgany-shadowherd', 24], ['kurgany-stonebaba', 8], ['kurgany-ghosthorse', 6]], level: 4, tag: 'tyoma' },
    ],
    objects: [
      { kind: 'mine-wood', at: [4, 30] },
      { kind: 'mine-stone', at: [18, 46] },
      { kind: 'mine-amber', at: [30, 30] },
      { kind: 'stack', at: [30, 32], army: [['kurgany-shadowherd', 14]] },
      { kind: 'mine-salt', at: [44, 40] },
      { kind: 'stack', at: [44, 42], army: [['neutral-raven', 8]] },
      { kind: 'treasury-heath', at: [44, 26], army: [['kurgany-barrowknight', 8], ['kurgany-shadowherd', 16]], reward: { semki: 5000, amber: 4 }, artRank: 2 },
      { kind: 'dwell-raven', at: [26, 44], army: [['neutral-raven', 8]] },
      { kind: 'gloryhill', at: [20, 26], army: [['neutral-wolf', 10]] },
      { kind: 'chest', at: [6, 6], n: 2000 },
      { kind: 'chest', at: [46, 4], n: 2000 },
      { kind: 'campfire', at: [16, 30], n: 600 },
      { kind: 'res-amber', at: [34, 38], n: 4 },
      { kind: 'learnstone', at: [6, 20] },
      { kind: 'watchtower', at: [22, 12] },
      { kind: 'signpost', at: [13, 40], text: 'Курганы — на северо-востоке. Огни над ними видно даже отсюда.' },
    ],
    roads: [
      [[10, 39], [20, 30], [28, 20], [38, 13]],
      [[10, 39], [4, 31]],
    ],
  }),
  spec: {
    goals: [
      { id: 'meet', text: 'Дойти до кургана Тёмы', cond: { t: 'near', at: 'barrow', r: 5 } },
      { id: 'choice', text: 'Разбить духов Тёмы — или вместе с ним дать бой Старшому', cond: { t: 'any', of: [{ t: 'gone', tags: ['tyoma'] }, { t: 'gone', tags: ['starshoy'] }] } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: HINT, text: 'Курганный хан — враг, пока не поговоришь. Дойди до его кургана: там решится, драться с ним или встать вместе против Старшого.' }] },
      { id: 'lights', when: { t: 'day', day: 3 }, do: [{ t: 'msg', title: 'Огни', text: 'Над курганами всю ночь ходили огни. Разведчики говорят: хан там — пацан, бледный, с чёлкой.' }] },
      {
        id: 'talk', when: { t: 'all', of: [{ t: 'near', at: 'barrow', r: 5 }, { t: 'not', c: { t: 'gone', tags: ['tyoma'] } }] }, do: [
          { t: 'team', player: 0, team: 1 }, { t: 'team', player: 1, team: 1 },
          { t: 'msg', title: 'Тёма', text: '— Тише, Прапор. Духи на острог ходили сами — их Старшой гонит. Он идёт за нами обоими. Встанем вместе?' },
        ],
      },
      {
        id: 'starshoy-in', when: { t: 'any', of: [{ t: 'day', day: 18 }, { t: 'near', at: 'barrow', r: 5 }] }, do: [
          { t: 'hero', owner: 2, pick: STARSHOY, at: [44, 44], army: [['kuznya-riveter', 20], ['kuznya-wasp', 14], ['kuznya-steamhound', 8], ['zatonye-willow', 4], ['kuznya-founder', 3]], level: 6, tag: 'starshoy' },
          { t: 'msg', title: 'Старшой', text: 'С юго-востока, из-за курганов, вышло войско под чёрными знамёнами.' },
        ],
      },
      { id: 'tyoma-out', when: { t: 'gone', tags: ['tyoma'] }, do: [{ t: 'msg', title: 'Курганы', text: 'Духи Тёмы рассеялись. Сам он ушёл в туман над курганами — живой.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 4.4 «Перевал»

const push = (n: number, at: [number, number], army: [string, number][]): ScnAct => ({ t: 'hero', owner: 2, pick: { cls: 'kuznya-master', n: 1 + (n % 4) }, at, army, level: 4 + n, tag: `push${n}` });

const s44: ScenarioDef = {
  id: 'c4-4',
  title: 'Перевал',
  brief: 'Старшой встал на перевале. Знамён — как на параде. Тёма и его курганы с нами. Застава на перевале — последняя: держать четыре недели, а потом самим идти за перевал, в его лагерь.',
  before: ['c4-4a'],
  carry: true,
  sketch: () => ({
    name: 'Перевал',
    seed: 44,
    scale: 2,
    rows: paint(30, 30, 'n', [
      [0, 16, 30, 14, 'p'], [0, 18, 6, 6, 'P'], [22, 20, 8, 6, 'P'], [0, 12, 14, 3, '^'], [16, 12, 14, 3, '^'],
      [4, 2, 4, 3, 'N'], [22, 3, 5, 4, 'N'],
    ]),
    players: [
      { name: 'Андрюха', faction: 'ostrog', team: 1, res: { semki: 12000 } },
      { name: 'Тёма', faction: 'kurgany', bot: 'medium', team: 1 },
      { name: 'Старшой', faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [
      { at: [14, 48], faction: 'ostrog', owner: 0, name: 'Острог', tag: 'town', built: ['dwell2', 'dwell3', 'dwell4', 'drill', 'smithy', 'hall2'], garrison: [['ostrog-druzhinnik', 20]] },
      { at: [46, 50], faction: 'kurgany', owner: 1, name: 'Курган', tag: 'barrow', built: ['dwell2', 'dwell3', 'memory'] },
    ],
    heroes: [
      { at: [16, 51], owner: 0, pick: ANDRYUKHA, army: [['ostrog-druzhinnik', 36], ['ostrog-snowarcher', 16], ['ostrog-wolfrider', 9], ['ostrog-bearguard', 5], ['ostrog-shaman', 3]], tag: 'main' },
      { at: [44, 53], owner: 1, pick: TYOMA, army: [['kurgany-shadowwanderer', 28], ['kurgany-stonebaba', 10], ['kurgany-ghosthorse', 8], ['kurgany-barrowknight', 4]], level: 6, tag: 'tyoma' },
    ],
    objects: [
      { kind: 'garrison', at: [30, 27], owner: 0, army: [['ostrog-druzhinnik', 20], ['ostrog-snowarcher', 10]], tag: 'pass' },
      { kind: 'garrison', at: [30, 8], owner: 2, army: [['kuznya-riveter', 30], ['kuznya-steamhound', 12], ['ostrog-wolfrider', 8], ['kuznya-founder', 4], ['kuznya-walkcannon', 2]], tag: 'camp' },
      { kind: 'mine-wood', at: [6, 40] },
      { kind: 'mine-stone', at: [24, 54] },
      { kind: 'mine-amber', at: [52, 40] },
      { kind: 'stack', at: [52, 42], army: [['neutral-bear', 6]] },
      { kind: 'mine-stariron', at: [10, 8] },
      { kind: 'stack', at: [10, 10], army: [['neutral-wolf', 14]] },
      { kind: 'treasury-snow', at: [48, 8], army: [['neutral-bear', 10], ['neutral-wolf', 16]], reward: { semki: 6000, stariron: 4 }, artRank: 2 },
      { kind: 'dwell-bear', at: [8, 32], army: [['neutral-bear', 6]] },
      { kind: 'chest', at: [36, 36], n: 2000 },
      { kind: 'chest', at: [4, 56], n: 2000 },
      { kind: 'campfire', at: [26, 40], n: 600 },
      { kind: 'res-wood', at: [20, 36], n: 8 },
      { kind: 'learnstone', at: [36, 46] },
      { kind: 'gloryhill', at: [18, 4], army: [['neutral-wolf', 12]] },
      { kind: 'watchtower', at: [34, 32] },
      { kind: 'signpost', at: [17, 50], text: 'Застава на перевале — единственная дорога через хребет. Лагерь Старшого — сразу за ней.' },
    ],
    roads: [
      [[14, 49], [30, 36], [30, 28]],
      [[30, 26], [30, 9]],
      [[30, 36], [46, 51]],
      [[14, 49], [6, 41]],
    ],
    walls: [[28, 27], [29, 26], [31, 26], [32, 27], [28, 26], [32, 26]],
  }),
  spec: {
    goals: [
      { id: 'hold', text: 'Удержать заставу на перевале до конца 4-й недели', cond: { t: 'all', of: [{ t: 'day', day: 27 }, { t: 'own', tags: ['pass'] }] } },
      { id: 'camp', text: 'Взять лагерь Старшого за перевалом', cond: { t: 'own', tags: ['camp'] } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: 'Союз', text: 'Тёма — союзник. Застава на перевале твоя: переложи туда отряды. Войско Старшого будет ломиться раз в неделю.' }] },
      { id: 'p1', when: { t: 'day', day: 4 }, do: [push(1, [30, 4], [['kuznya-riveter', 20], ['kuznya-wasp', 10], ['zatonye-frog', 12]]), { t: 'msg', title: 'Перевал', text: 'Первый натиск на заставу.' }] },
      { id: 'p2', when: { t: 'day', day: 11 }, do: [push(2, [30, 4], [['kuznya-riveter', 26], ['kuznya-wasp', 14], ['kuznya-steamhound', 6], ['ostrog-wolfrider', 6]]), { t: 'msg', title: 'Перевал', text: 'Под чёрными знамёнами — снова на заставу.' }] },
      { id: 'p3', when: { t: 'day', day: 18 }, do: [push(3, [30, 4], [['kuznya-riveter', 30], ['kuznya-steamhound', 10], ['ostrog-bearguard', 6], ['kuznya-founder', 3]]), { t: 'msg', title: 'Перевал', text: 'Большой натиск: медвежья гвардия Старшого.' }] },
      { id: 'p4', when: { t: 'day', day: 25 }, do: [push(4, [30, 4], [['kuznya-riveter', 34], ['kuznya-steamhound', 12], ['ostrog-bearguard', 8], ['kuznya-founder', 4], ['kuznya-walkcannon', 2]]), { t: 'msg', title: 'Перевал', text: 'Последний натиск. Если устоять — лагерь Старшого останется без войска.' }] },
      { id: 'lost', when: { t: 'not', c: { t: 'own', tags: ['pass'] } }, do: [{ t: 'msg', title: 'Застава пала', text: 'Отбей заставу: к концу 4-й недели она должна быть твоей.' }] },
      { id: 'camp-taken', when: { t: 'own', tags: ['camp'] }, do: [{ t: 'msg', title: 'Лагерь', text: 'Лагерь Старшого взят. На самой вершине во льду светится осколок.' }] },
    ],
  },
};

export const OSTROG: CampaignDef = {
  id: 'c4',
  title: 'Устав',
  hero: 'Андрюха «Прапор»',
  lad: 'andryukha',
  text: 'Северный острог: строй, плац и долгая зима. Андрюха наводит устав — и находит Тёму.',
  scenarios: [s41, s42, s43, s44],
  finale: ['c4-fin1', 'c4-fin2'],
  paid: true,
};
