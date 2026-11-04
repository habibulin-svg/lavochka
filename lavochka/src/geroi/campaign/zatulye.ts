/* Кампания 1 «За Тулой»: Серёга «Тула», Затулье. Учит игре по шагам: карта → замок → бой → герои (CAMPAIGNS.md). */
import type { HeroPick } from '../sim/heroes';
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

export const ZATULYE: CampaignDef = {
  id: 'c1',
  title: 'За Тулой',
  hero: 'Серёга «Тула»',
  lad: 'seryoga',
  text: 'Затулье: вольница у реки, ладьи и ополчение. Кампания учит игре по шагам.',
  scenarios: [s11],
  finale: ['c1-fin1', 'c1-fin2', 'c1-fin3'],
};
