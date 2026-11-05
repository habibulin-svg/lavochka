/* Кампания 1 «За Тулой»: Серёга «Тула», Затулье. Учит игре по шагам: карта → замок → бой → герои (CAMPAIGNS.md). */
import type { HeroPick } from '../sim/heroes';
import type { ScnAct } from '../sim/adv/scenario';
import type { CampaignDef, ScenarioDef } from './types';

const SERYOGA: HeroPick = { cls: 'zatulye-sotnik', n: 0, lad: 'seryoga' };
const HINT = 'Подсказка';
const MAIN_DEAD = { text: 'Серёга пал.', cond: { t: 'heroDead' as const, tag: 'main' } };

// ------------------------------------------------------------------ 1.1 «Сход»

const s11: ScenarioDef = {
  id: 'c1-1',
  title: 'Сход',
  brief: 'Вольница у Тулы встретила Серёгу как своего. Старый перевозчик просит навести порядок: лесопилка и каменоломня стоят без хозяина, а у брода засели разбойники. Дружине нужно ополчение.',
  before: ['c1-1a'],
  sketch: () => ({
    name: 'Сход',
    seed: 11,
    scale: 2,
    rows: [
      'GGGGGGgggggg~gggGG',
      'GGGGGggggggg~ggGGG',
      'GGGGgggggggg~~gggG',
      'GGGgggggggGgg~gggg',
      'GGgggggggGGgg~gggg',
      'GGgggggggGggg~ggGG',
      'GgggggggggggG~gGGG',
      'ggggggggggggg~gggG',
      'ggggggggggggg~gggg',
      'ggggggggggggg~gggg',
      'ggggggggggggg~gggg',
      'ggggggggggggg~gggg',
      'GgggggggggggG~gGGg',
      'GGggggggggGGg~gGGG',
      'GGGggggggGGgg~ggGG',
      'GGGGgggggggg~~gggG',
      'GGGGGggggggg~ggGGG',
      'GGGGGGgggggg~gGGGG',
    ],
    players: [{ name: 'Серёга', faction: 'zatulye', res: { semki: 6000 } }],
    towns: [{ at: [10, 22], faction: 'zatulye', owner: 0, name: 'Заречье', tag: 'town' }],
    heroes: [{ at: [13, 24], owner: 0, pick: SERYOGA, army: [['zatulye-militia', 12], ['zatulye-slinger', 6]], tag: 'main' }],
    objects: [
      { kind: 'mine-wood', at: [5, 12], tag: 'mill' },
      { kind: 'mine-stone', at: [31, 13], tag: 'quarry' },
      { kind: 'stack', at: [31, 16], army: [['neutral-wolf', 5]] },
      { kind: 'stack', at: [29, 23], army: [['neutral-bandit', 8]], tag: 'bandits' },
      { kind: 'signpost', at: [14, 25], text: 'На восток — брод через Тулу. На север — лесопилка.' },
      { kind: 'res-wood', at: [16, 18], n: 6 },
      { kind: 'res-semki', at: [7, 28], n: 800 },
      { kind: 'chest', at: [3, 20], n: 1500 },
      { kind: 'campfire', at: [33, 28], n: 500 },
      { kind: 'res-stone', at: [30, 31], n: 6 },
      { kind: 'artifact', at: [33, 5], artRank: 1, army: [['neutral-wolf', 7]] },
      { kind: 'learnstone', at: [30, 4] },
      { kind: 'windmill', at: [5, 31] },
      { kind: 'watchtower', at: [19, 8] },
      { kind: 'luckfountain', at: [18, 29] },
    ],
    roads: [
      [[10, 23], [22, 23], [32, 23], [31, 14]],
      [[10, 23], [6, 17], [5, 13]],
    ],
  }),
  spec: {
    goals: [
      { id: 'mill', text: 'Захватить лесопилку', cond: { t: 'own', tags: ['mill'] } },
      { id: 'quarry', text: 'Захватить каменоломню за рекой', cond: { t: 'own', tags: ['quarry'] } },
      { id: 'bandits', text: 'Разбить разбойников у брода', cond: { t: 'gone', tags: ['bandits'] } },
      { id: 'militia', text: 'Собрать дружину: 20 ополченцев', cond: { t: 'army', cre: ['zatulye-militia', 'zatulye-spearman'], n: 20 } },
    ],
    lose: [MAIN_DEAD],
    triggers: [
      {
        id: 'hello', when: { t: 'day', day: 0 }, do: [{
          t: 'msg', title: HINT,
          text: 'Щёлкни по клетке — Серёга проложит путь, щёлкни ещё раз — пойдёт. Запас хода на день — полоска у портрета справа. Задания — кнопка 📜.',
        }],
      },
      { id: 'mill-near', when: { t: 'near', at: 'mill', r: 6 }, do: [{ t: 'msg', title: HINT, text: 'Лесопилка. Встань на вход — над ней поднимется твой флаг, и каждый день она даст два бревна.' }] },
      { id: 'town-in', when: { t: 'near', at: 'town', r: 0 }, do: [{ t: 'msg', title: HINT, text: 'Это Заречье. В избе ополчения нанимают отряды, строить можно раз в день. Наём пополняется в начале каждой недели.' }] },
      { id: 'bandits-near', when: { t: 'near', at: 'bandits', r: 5 }, do: [{ t: 'msg', title: HINT, text: 'Разбойники стерегут брод: шагнёшь на соседнюю клетку — будет бой. Сначала можно зайти в Заречье за ополчением. В бою пращники бьют издалека, пусть стоят за пехотой.' }] },
      { id: 'day1', when: { t: 'day', day: 1 }, do: [{ t: 'msg', title: HINT, text: 'Новый день: запас хода снова полный. Конец хода — кнопка внизу справа.' }] },
      { id: 'ford', when: { t: 'gone', tags: ['bandits'] }, do: [{ t: 'msg', title: 'Брод свободен', text: 'За рекой — каменоломня. Её стерегут волки.' }] },
      { id: 'week', when: { t: 'day', day: 7 }, do: [{ t: 'msg', title: HINT, text: 'Новая неделя: в жилищах подросли отряды. Загляни в Заречье.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 1.2 «Броды»

const FOG = 'Туман';
const raider = (n: number, at: [number, number], army: [string, number][]): ScnAct => ({ t: 'hero', owner: 1, pick: { cls: 'zatonye-bolotnik', n }, at, army, tag: `wave${n}` });
const FORDS = ['ford-n', 'ford-m', 'ford-s'];

const s12: ScenarioDef = {
  id: 'c1-2',
  title: 'Броды',
  brief: 'Вольница признала Серёгу. Но с того берега Тулы, из болотного тумана, всё чаще выходят лягушатники. Три брода держат малые заставы — их нужно удержать, пока Заречье не отстроится.',
  before: ['c1-2a', 'c1-2b'],
  carry: true,
  sketch: () => ({
    name: 'Броды',
    seed: 12,
    scale: 2,
    rows: [
      'GGGGGgggGGGGGg~ssssSSSSS',
      'GGGGGgggGGGGGg~ssssSSSSS',
      'GGGGGggggggggg~ssssSSSSS',
      'GGGGGggggggggg~ssssSSSSS',
      'gggggggggggggg~ssssSSSSS',
      'gggggggggggggg~sssssssss',
      'ggggggggGGGGgg~sssssssss',
      'ggggggggGGGGgg~sSSSsssss',
      'GGGgggggGGGGgg~sSSSssSSS',
      'GGGggggggggggg~sSSSssSSS',
      'GGGggggggggggg~ssssssSSS',
      'gggggggggggggg~sssssssss',
      'gggggggggggggg~sssssssss',
      'gg^^^ggggggggg~sssssssss',
      'gg^^^ggggggggg~sssssSSSS',
      'gggggggggggggg~sssssSSSS',
      'ggggGGGGgggggg~sssssSSSS',
      'ggggGGGGgggggg~sssssSSSS',
      'ggggGGGGgggggg~sssssSSSS',
      'gggggggggggggg~sssssssss',
      'GGGGGGgggGGGGg~ssSSSssss',
      'GGGGGGgggGGGGg~ssSSSssss',
      'GGGGGGgggGGGGg~ssSSSssss',
      'GGGGGGgggGGGGg~ssSSSssss',
    ],
    players: [
      { name: 'Серёга', faction: 'zatulye', res: { semki: 8000 } },
      { name: FOG, faction: 'zatonye', bot: 'medium', keep: true },
    ],
    towns: [{ at: [12, 25], faction: 'zatulye', owner: 0, name: 'Заречье', tag: 'town', built: ['dwell2'] }],
    heroes: [{ at: [15, 27], owner: 0, pick: SERYOGA, army: [['zatulye-militia', 20], ['zatulye-slinger', 8], ['zatulye-vataga', 3]], tag: 'main' }],
    objects: [
      { kind: 'garrison', at: [27, 11], owner: 0, army: [['zatulye-militia', 8], ['zatulye-slinger', 4]], tag: 'ford-n' },
      { kind: 'garrison', at: [27, 25], owner: 0, army: [['zatulye-militia', 8], ['zatulye-slinger', 4]], tag: 'ford-m' },
      { kind: 'garrison', at: [27, 39], owner: 0, army: [['zatulye-militia', 8], ['zatulye-slinger', 4]], tag: 'ford-s' },
      { kind: 'mine-wood', at: [7, 7], owner: 0 },
      { kind: 'mine-stone', at: [20, 35] },
      { kind: 'stack', at: [20, 37], army: [['neutral-boar', 6]] },
      { kind: 'watermill', at: [24, 18] },
      { kind: 'windmill', at: [4, 33] },
      { kind: 'chest', at: [10, 15], n: 1500 },
      { kind: 'res-semki', at: [17, 31], n: 1000 },
      { kind: 'res-wood', at: [8, 22], n: 8 },
      { kind: 'res-stone', at: [22, 6], n: 8 },
      { kind: 'shrine1', at: [16, 4], spell: 'bloodlust' },
      { kind: 'learnstone', at: [2, 24] },
      { kind: 'dwell-wolf', at: [9, 45], n: 6, army: [['neutral-wolf', 9]] },
      { kind: 'signpost', at: [16, 28], text: 'Три брода — три заставы. Отряды в заставу кладут, встав на её вход.' },
      { kind: 'chest', at: [36, 6], n: 2000 },
      { kind: 'artifact', at: [44, 20], artRank: 1, army: [['neutral-kikimora', 6]] },
      { kind: 'dwell-kikimora', at: [38, 32], n: 4, army: [['neutral-kikimora', 8]] },
      { kind: 'res-resin', at: [34, 45], n: 4 },
      { kind: 'campfire', at: [40, 16], n: 600 },
    ],
    roads: [
      [[12, 26], [20, 26], [22, 25], [27, 25], [44, 25]],
      [[12, 26], [16, 14], [22, 11], [27, 11], [44, 11]],
      [[12, 26], [16, 36], [22, 39], [27, 39], [44, 39]],
      [[12, 26], [7, 8]],
    ],
    walls: [[27, 10], [27, 12], [27, 24], [27, 26], [27, 38], [27, 40]],
  }),
  spec: {
    goals: [
      { id: 'hold', text: 'Удержать три брода до конца 4-й недели', cond: { t: 'all', of: [{ t: 'day', day: 27 }, { t: 'own', tags: FORDS }] } },
      { id: 'vataga', text: 'Поставить в Заречье Двор ватаги', cond: { t: 'built', b: 'dwell3' } },
      { id: 'waves', text: 'Разбить все набеги из тумана', cond: { t: 'gone', tags: ['wave1', 'wave2', 'wave3', 'wave4'] }, optional: true },
    ],
    lose: [MAIN_DEAD, { text: 'Заречье пало.', cond: { t: 'noTowns' } }],
    triggers: [
      { id: 'hello', when: { t: 'day', day: 0 }, do: [{ t: 'msg', title: 'Броды', text: 'Заставы у бродов — твои. Зайди на заставу, чтобы переложить в неё отряды. Набеги идут из тумана раз в неделю.' }] },
      { id: 'w1', when: { t: 'day', day: 2 }, do: [raider(1, [44, 11], [['zatonye-frog', 8], ['zatonye-reedling', 16]]), { t: 'msg', title: 'Из тумана', text: 'Лягушатники вышли к северному броду.' }] },
      { id: 'w2', when: { t: 'day', day: 9 }, do: [raider(2, [44, 39], [['zatonye-frog', 12], ['zatonye-reedling', 24], ['zatonye-wisp', 4]]), { t: 'msg', title: 'Из тумана', text: 'Набег идёт к южному броду.' }] },
      { id: 'w3', when: { t: 'day', day: 16 }, do: [raider(3, [44, 25], [['zatonye-frog', 14], ['zatonye-reedling', 30], ['zatonye-wisp', 6], ['zatonye-willow', 2]]), { t: 'msg', title: 'Из тумана', text: 'Большой набег — прямо на средний брод.' }] },
      {
        id: 'w4', when: { t: 'day', day: 23 }, do: [
          raider(4, [44, 11], [['zatonye-frog', 16], ['zatonye-reedling', 30], ['zatonye-wisp', 8], ['zatonye-willow', 4], ['zatonye-troll', 1]]),
          { t: 'msg', title: 'Из тумана', text: 'Последний набег. Впереди идёт болотный тролль.' },
        ],
      },
      { id: 'lost-ford', when: { t: 'not', c: { t: 'own', tags: FORDS } }, do: [{ t: 'msg', title: 'Брод потерян', text: 'Туман взял заставу. Отбей её — к концу 4-й недели все три брода должны быть твоими.' }] },
    ],
  },
};

// ------------------------------------------------------------------ 1.3 «Туман над Тулой»

const DIMON: HeroPick = { cls: 'zatonye-bolotnik', n: 0, lad: 'dimon' };
const STARSHOY: HeroPick = { cls: 'kuznya-master', n: 0, lad: 'starshoy' };
/** У Старшого нет хозяйства: только войско, что вышло с ним. */
const NOTHING = { semki: 0, wood: 0, stone: 0, amber: 0, salt: 0, stariron: 0, resin: 0 };
const NO_TOWNS = { text: 'Заречье пало.', cond: { t: 'noTowns' as const } };

const s13: ScenarioDef = {
  id: 'c1-3',
  title: 'Туман над Тулой',
  brief: 'На том берегу сидит болотный князь — Димон с Затона. Домой он не хочет: здесь рыба клюёт без перерыва. Дойди до Сомова омута. Можно взять город силой, а можно договориться — у Димона есть провидец, и у провидца есть просьба.',
  before: ['c1-3a'],
  carry: true,
  sketch: () => ({
    name: 'Туман над Тулой',
    seed: 13,
    scale: 2,
    rows: [
      'GGGGgggg~sssssssssSSSSSsssss',
      'GGGGgggg~sssssssssSSSSSsssss',
      'GGGGgggg~ssSSSSsssSSSSSsssss',
      'GGGGgggg~ssSSSSsssSSSSSsssss',
      'GGGGgggg~ssSSSSssssssss~~sss',
      'gggggggg~ssSSSSssssssss~~SSS',
      'gggggggg~ssssssssssssssssSSS',
      'gggggggg~ssssssssssssssssSSS',
      'gggggggg~ssssssssssSSSsssSSS',
      'gggggggg~ssssssssssSSSsssSSS',
      'ggggGGGg~sssSSSSsssSSSsssSSS',
      'ggggGGGg~sssSSSSsssSSSssssss',
      'ggggGGGg~sssSSSSssssssssssss',
      'gggggggg~sssSSSSssssssssssss',
      'gggggggg~sssssssssssssssssss',
      'g^^^gggg~ssssss~~sssssssssss',
      'g^^^gggg~ssssss~~sssssssssss',
      'gggggggg~ssssssssSSSSsssssss',
      'gggggggg~ssssssssSSSSsssssss',
      'gggggggg~ssssssssSSSSsssssss',
      'gggggggg~ssssssssSSSSsssSSSS',
      'gggggggg~sssssssssssssssSSSS',
      'GGGGGggg~sSSSSSsssssssssSSSS',
      'GGGGGggg~sSSSSSsssssssssSSSS',
      'GGGGGggg~sSSSSSsssssssssSSSS',
      'GGGGGggg~sSSSSSsssssssssSSSS',
      'GGGGGggg~sSSSSSsssssssssSSSS',
      'GGGGGggg~sSSSSSsssssssssSSSS',
    ],
    players: [
      { name: 'Серёга', faction: 'zatulye', res: { semki: 10000 } },
      { name: 'Димон', faction: 'zatonye', bot: 'easy', res: { semki: 4000 } },
      { name: 'Чёрные всадники', faction: 'kuznya', bot: 'medium', keep: true },
    ],
    towns: [
      { at: [8, 29], faction: 'zatulye', owner: 0, name: 'Заречье', tag: 'town', built: ['dwell2', 'dwell3', 'smithy'] },
      { at: [44, 29], faction: 'zatonye', owner: 1, name: 'Сомов омут', tag: 'som', built: ['dwell2', 'dwell3'], garrison: [['zatonye-reedling', 20], ['zatonye-frog', 10]] },
    ],
    heroes: [
      { at: [11, 31], owner: 0, pick: SERYOGA, army: [['zatulye-militia', 30], ['zatulye-slinger', 14], ['zatulye-vataga', 8], ['zatulye-boatman', 2]], tag: 'main' },
      { at: [41, 31], owner: 1, pick: DIMON, army: [['zatonye-frog', 10], ['zatonye-reedling', 24], ['zatonye-wisp', 4]], level: 3, tag: 'dimon' },
    ],
    objects: [
      { kind: 'seerhut', at: [30, 24], tag: 'seer', quest: { cre: 'zatulye-boatman', count: 6, reward: { resin: 5, semki: 3000 }, xp: 2000 } },
      { kind: 'signpost', at: [27, 27], text: 'Провидец служит Димону. Говорят, Димон давно мечтает о ладье с гребцами.' },
      { kind: 'mine-wood', at: [4, 9], owner: 0 },
      { kind: 'mine-stone', at: [12, 38] },
      { kind: 'stack', at: [13, 40], army: [['neutral-wolf', 10]] },
      { kind: 'mine-resin', at: [36, 10] },
      { kind: 'stack', at: [36, 12], army: [['neutral-kikimora', 8]] },
      { kind: 'mine-semki', at: [24, 50] },
      { kind: 'stack', at: [24, 52], army: [['neutral-leshak', 6]] },
      { kind: 'dwell-kikimora', at: [50, 44], n: 4, army: [['neutral-kikimora', 10]] },
      { kind: 'treasury-swamp', at: [40, 47], army: [['zatonye-troll', 3]], reward: { semki: 5000, resin: 4 }, artRank: 2 },
      { kind: 'chest', at: [22, 8], n: 2000 },
      { kind: 'chest', at: [48, 18], n: 2000 },
      { kind: 'res-resin', at: [26, 36], n: 5 },
      { kind: 'res-salt', at: [5, 46], n: 4 },
      { kind: 'campfire', at: [34, 31], n: 600 },
      { kind: 'luckfountain', at: [20, 20] },
      { kind: 'learnstone', at: [4, 21] },
      { kind: 'shrine2', at: [52, 24], spell: 'slow', army: [['zatonye-wisp', 8]] },
      { kind: 'watchtower', at: [30, 5] },
    ],
    roads: [
      [[8, 30], [13, 24], [14, 13], [22, 13], [34, 18], [44, 30]],
      [[8, 30], [12, 41], [22, 41], [36, 38], [44, 30]],
      [[8, 30], [5, 10]],
    ],
  }),
  spec: {
    goals: [
      { id: 'som', text: 'Дойти до Сомова омута: взять город или выполнить просьбу провидца', cond: { t: 'any', of: [{ t: 'own', tags: ['som'] }, { t: 'quest', tag: 'seer' }] } },
      { id: 'riders', text: 'Разбить чёрных всадников', cond: { t: 'gone', tags: ['riders'] }, optional: true, hidden: true },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      { id: 'seer-near', when: { t: 'near', at: 'seer', r: 5 }, do: [{ t: 'msg', title: 'Хижина провидца', text: 'Провидец Димона просит шесть ладейщиков. Ладейный сарай строится в Заречье после Двора ватаги и кузницы.' }] },
      {
        id: 'deal', when: { t: 'quest', tag: 'seer' }, do: [
          { t: 'team', player: 0, team: 1 }, { t: 'team', player: 1, team: 1 },
          { t: 'msg', title: 'Димон', text: '— Ладейщики! С гребцами! Ладно, Серёга, твоя взяла. Только рыбалку я не брошу.' },
        ],
      },
      { id: 'taken', when: { t: 'own', tags: ['som'] }, do: [{ t: 'msg', title: 'Сомов омут', text: 'Город твой. Димон ушёл в камыши, но зла не держит.' }] },
      {
        id: 'riders-come', when: { t: 'day', day: 8 }, do: [
          { t: 'hero', owner: 2, pick: { cls: 'kuznya-master', n: 3 }, at: [50, 6], army: [['zatulye-rider', 2], ['kuznya-steamhound', 4], ['kuznya-wasp', 6]], level: 3, tag: 'riders' },
          { t: 'show', goal: 'riders' },
          { t: 'msg', title: 'Чёрные всадники', text: 'На гребне холма — всадники на вороных конях. Они ищут то же, что и ты.' },
        ],
      },
    ],
  },
};

// ------------------------------------------------------------------ 1.4 «Первый осколок»

const s14: ScenarioDef = {
  id: 'c1-4',
  title: 'Первый осколок',
  brief: 'Обелиск в холмах гудит, как трансформатор на Затулинке: под ним лежит осколок кастета. Перед ним стоит войско Старшого. Димон — с нами: Сомов омут прикроет юг.',
  before: ['c1-3b', 'c1-4a'],
  carry: true,
  sketch: () => ({
    name: 'Первый осколок',
    seed: 14,
    scale: 2,
    rows: [
      'GGGGggggggrrrrRRRraaaaaaaAAA',
      'GGGGggggggrrrrRRRraaaaaaaAAA',
      'GGGGggggggrrrrRRRraaaaaaaAAA',
      'GGGGggggggrrrrrrrraaaaaaaAAA',
      'ggggggggggr^^^rrrraaaaaaaaaa',
      'ggggggggggr^^^rrrraaaaaaaaaa',
      'ggggggggggr^^^rrrraaaaaaaaaa',
      'ggggggggggr^^^rrrraaaaaaaaaa',
      'gggggGGGggrrrrrrrraaaaaaaaaa',
      'gggggGGGggrrrrrrrraaaaaaaaaa',
      'gggggGGGggrrrrrrrraaaaaaaaaa',
      'ggggggggggrrrrrrrraaaaaaaaaa',
      'ggggggggggrrrrrrrrrrrrrrrrrr',
      'ggggggggggrrrrrrrrrrrrrrrrrr',
      'GGGgggggggssssssssss^^^^ssss',
      'GGGgggggggssssssssss^^^^SSSS',
      'GGGgggggggssssss~~ssssssSSSS',
      'GGGgggggggssssss~~ssssssSSSS',
      'GGGgggggggssSSSsssssssssSSSS',
      'ggggggggggssSSSsssssssssssss',
      'gggggggg~~ssSSSsssssssssssss',
      'gggggggg~~ssSSSsssssssssssss',
      'gggggggg~~ssssssssssSSSSssss',
      'ggggggggggssssssssssSSSSssss',
      'gggGGGGGggssssssssssSSSSssss',
      'gggGGGGGggssssssssssSSSSssss',
      'gggGGGGGggssssssssssssssssss',
      'gggGGGGGggssssssssssssssssss',
    ],
    players: [
      { name: 'Серёга', faction: 'zatulye', team: 1, res: { semki: 12000 } },
      { name: 'Димон', faction: 'zatonye', bot: 'medium', team: 1 },
      { name: 'Старшой', faction: 'kuznya', bot: 'medium', keep: true, res: NOTHING },
    ],
    towns: [
      { at: [10, 46], faction: 'zatulye', owner: 0, name: 'Заречье', tag: 'town', built: ['dwell2', 'dwell3', 'smithy', 'dwell4', 'hall2'] },
      { at: [32, 48], faction: 'zatonye', owner: 1, name: 'Сомов омут', tag: 'som', built: ['dwell2', 'dwell3', 'hall2'] },
    ],
    heroes: [
      { at: [13, 48], owner: 0, pick: SERYOGA, army: [['zatulye-militia', 40], ['zatulye-slinger', 18], ['zatulye-vataga', 10], ['zatulye-boatman', 5], ['zatulye-herbalist', 2]], tag: 'main' },
      { at: [35, 50], owner: 1, pick: DIMON, army: [['zatonye-frog', 16], ['zatonye-reedling', 30], ['zatonye-wisp', 6], ['zatonye-willow', 3]], level: 6, tag: 'dimon' },
    ],
    objects: [
      { kind: 'obelisk', at: [8, 24] },
      { kind: 'obelisk', at: [40, 40] },
      { kind: 'stack', at: [28, 22], army: [['kuznya-steamhound', 8]] },
      { kind: 'stack', at: [32, 22], army: [['kuznya-riveter', 14]] },
      { kind: 'mine-wood', at: [4, 40], owner: 0 },
      { kind: 'mine-stone', at: [16, 52], owner: 0 },
      { kind: 'mine-salt', at: [20, 30] },
      { kind: 'stack', at: [20, 32], army: [['neutral-bandit', 12]] },
      { kind: 'mine-stariron', at: [36, 26] },
      { kind: 'stack', at: [36, 28], army: [['neutral-salamander', 6]] },
      { kind: 'treasury-ash', at: [46, 12], army: [['kuznya-riveter', 14], ['kuznya-steamhound', 6]], reward: { semki: 5000, stariron: 6 }, artRank: 2 },
      { kind: 'treasury-ash', at: [52, 6], army: [['neutral-salamander', 10]], reward: { semki: 6000, stariron: 5 }, artRank: 2 },
      { kind: 'chest', at: [24, 36], n: 2000 },
      { kind: 'chest', at: [6, 30], n: 1500 },
      { kind: 'res-salt', at: [14, 34], n: 5 },
      { kind: 'res-semki', at: [26, 44], n: 1000 },
      { kind: 'learnstone', at: [26, 41] },
      { kind: 'gloryhill', at: [14, 14], army: [['neutral-boar', 8]] },
      { kind: 'stables', at: [20, 41] },
      { kind: 'tradepost', at: [5, 52] },
      { kind: 'signpost', at: [16, 47], text: 'Обелиски показывают кусок карты к осколку. Встань туда, где он зарыт, и копай (⛏).' },
    ],
    roads: [
      [[10, 47], [20, 44], [32, 49]],
      [[10, 47], [14, 30], [22, 24], [30, 21]],
      [[30, 21], [38, 16], [48, 9]],
      [[32, 49], [40, 41], [36, 27]],
    ],
    shard: [30, 19],
  }),
  spec: {
    goals: [
      { id: 'starshoy', text: 'Разбить Старшого', cond: { t: 'gone', tags: ['starshoy'] } },
      { id: 'shard', text: 'Раскопать осколок у обелиска в холмах', cond: { t: 'shard' } },
    ],
    lose: [MAIN_DEAD, NO_TOWNS],
    triggers: [
      {
        id: 'hello', when: { t: 'day', day: 0 }, do: [
          { t: 'msg', title: 'Союз', text: 'Димон — союзник: его войска тебя не тронут, ресурсы можно передать кнопкой 🤝. Лагерь Старшого — у обелиска в холмах.' },
          { t: 'reveal', at: [30, 19], r: 4 },
        ],
      },
      { id: 'taunt', when: { t: 'day', day: 5 }, do: [{ t: 'msg', title: 'Старшой', text: '— Слышь, малой. Кастет не твой. Отдай по-хорошему, пока я добрый.' }] },
      {
        id: 'starshoy-out', when: { t: 'any', of: [{ t: 'day', day: 12 }, { t: 'near', at: [30, 19], r: 8 }] }, do: [
          { t: 'hero', owner: 2, pick: STARSHOY, at: [34, 16], army: [['kuznya-wasp', 14], ['kuznya-riveter', 10], ['kuznya-steamhound', 5], ['kuznya-founder', 2], ['kuznya-walkcannon', 1]], level: 7, tag: 'starshoy' },
          { t: 'msg', title: 'Старшой', text: 'Из лагеря у обелиска вышел сам Старшой.' },
        ],
      },
      { id: 'near-shard', when: { t: 'near', at: [30, 19], r: 4 }, do: [{ t: 'msg', title: 'Обелиск гудит', text: 'Осколок где-то здесь. Встань на клетку и копай: кнопка ⛏ или D.' }] },
      { id: 'beaten', when: { t: 'gone', tags: ['starshoy'] }, do: [{ t: 'msg', title: 'Старшой бежал', text: 'Войско разбито. Старшой ушёл в туман — но он ещё вернётся.' }] },
    ],
  },
};

export const ZATULYE: CampaignDef = {
  id: 'c1',
  title: 'За Тулой',
  hero: 'Серёга «Тула»',
  lad: 'seryoga',
  text: 'Затулье: вольница у реки, ладьи и ополчение. Кампания учит игре по шагам.',
  scenarios: [s11, s12, s13, s14],
  finale: ['c1-fin1', 'c1-fin2', 'c1-fin3'],
};
