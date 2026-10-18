/* Состояние партии «Заколдованной страны»: отряд, мир (карта, замки, флаги), сцена, бой, рассказ. */
import type { Attack, Buffs, Hero } from './hero';
import type { FlagVal, Step } from './script';

/** Место 0 — ведущий, 1…5 — герои. */
export const GM = 0;

/** Опасность в бою. */
export interface FoeInst {
  uid: number;
  /** id карточки. */
  m: string;
  name: string;
  hp: number;
  hpMax: number;
  kd: number;
  attacks: { name: string | null; dmg: number[]; effect?: string }[];
  morale: number | 'am' | null;
  value: number;
  flee: number[] | 'never' | null;
  /** Группа одинаковых — для морали «убита половина равнозначных». */
  group: string;
  gold: number;
  fleeAt?: number;
  dead?: boolean;
  fled?: boolean;
  /** Отогнан (маг, крон, святая вода) — исчез без ИО. */
  gone?: boolean;
  /** Мораль уже бросали. */
  moraleDone?: boolean;
  /** Ослеплён, ослаблен (КД + 2), в паутине. */
  blind?: boolean;
  weak?: boolean;
  /** Атлант: попаданий за раунд. */
  hits?: number;
  /** Спит (белый дракон): просыпается от двух попаданий. */
  asleep?: boolean;
  sleepHits?: number;
  /** Сколько раз дышал (дракон — не больше 3). */
  breaths?: number;
  /** Кто ранил последним (ИО — добившему). */
  lastHit?: number;
}

/** Союзник в бою: спутник или фантом. */
export interface Ally {
  id: string;
  name: string;
  hp: number;
  hpMax: number;
  kd: number;
  dmg: number[];
  /** Фантом героя: ИО за его победы (50%) — хозяину. */
  owner?: number;
  m?: string;
  text?: string;
  dead?: boolean;
}

/** Бросок, которого ждём от героя (БУ, проверка сцены). */
export interface PendingRoll {
  seat: number;
  kind: 'save' | 'main' | 'd6' | 'd3' | 'hit' | 'init' | 'dice4';
  need: number | number[];
  label: string;
  /** Что будет при провале (для БУ в бою). */
  fail?: 'hp3d' | 'death' | 'stone';
  /** Чем вызван: сцена или бой. */
  from: 'scene' | 'combat';
  tries?: number;
}

export interface Combat {
  foes: FoeInst[];
  allies: Ally[];
  round: number;
  /** volley — залп метательным до схватки; init — жребий первенства; party — ходят герои; foes — ходят опасности. */
  phase: 'volley' | 'init' | 'party' | 'foes' | 'saves';
  first: 'roll' | 'foes' | 'party';
  /** Кто из героев ещё не походил в этой фазе. */
  queue: number[];
  init?: { party?: number; foes?: number };
  buffs: Record<number, Buffs>;
  /** Убежавшие герои. */
  fled: number[];
  noFlee: boolean;
  untilHit: boolean;
  capture: boolean;
  /** Пленённые (capture): связаны. */
  bound: number[];
  /** Броски удачи, которые ждут героев после ударов опасностей. */
  saves: PendingRoll[];
  /** Удар героя в процессе: ждём его следующего броска — попадания (ещё стрела) или урона. */
  strike?: { seat: number; uid: number; atk: Attack; left: number; stage: 'hit' | 'dmg'; v?: number };
  /** Ветки сцены по исходу боя: путь к спискам шагов. */
  ret: { win?: Path; fled?: Path; routed?: Path; lost?: Path };
  /** Счётчик uid. */
  uid: number;
}

/** Путь к списку шагов внутри сцены: ['steps'] или ['nodes', 'x', 3, 'opts', 1, 'do']. */
export type Path = (string | number)[];

export interface Frame {
  path: Path;
  i: number;
  /** Герой ветки (each / subject). */
  subj?: number;
  /** Ветка «каждый»: шаги [start, end) повторяются для каждого героя из each (subj — текущий). */
  start?: number;
  end?: number;
  each?: number[];
  /** Уже внутри «каждого» — шаг не разворачивать снова. */
  single?: boolean;
}

/** Где идёт сцена. */
export interface SceneRun {
  /** Ключ сцены: 'site:c1:5', 'road:17', 'camp:k1:tavern'. */
  key: string;
  stack: Frame[];
  /** Ждём ответа: вопрос, бросок, лавка, игра. */
  wait?: Wait;
  /** Число последнего броска (подстановка {n}). */
  lastN?: number;
  /** Чем закончилась сцена: done — комната пустеет, repeat — сыграть снова при новом входе. */
  ended?: 'done' | 'repeat';
  /** Сколько раз в этой сцене уже отвечали на вопросы (боты не ходят по кругу меню). */
  asks?: number;
  /** Куда перейти после сцены. */
  then?: { goto?: string; move?: string };
}

export type Wait =
  | { k: 'ask'; who: number[]; prompt: string; opts: { i: number; text: string }[]; answers: Record<number, number>; each: boolean; path: Path; subj?: number }
  | { k: 'roll'; roll: PendingRoll; spec: Path; left: number[] }
  | { k: 'fight' }
  | { k: 'shop'; spec: Path; done: number[] }
  | { k: 'gamble'; spec: Path; game: GambleState }
  | { k: 'next' };

export interface GambleState {
  game: 'dice' | 'cards' | 'hp';
  vs: string;
  /** Чей ход ставки/броска. */
  turn: number;
  bank: number;
  stakes: Record<number, number>;
  picks: Record<number, number[]>;
  rounds: number;
  last?: { who: string; dice: number[]; total: number }[];
  oppGold: number;
  /** Кто уже встал из-за стола. */
  done?: number[];
  /** Выигрыш (+) или проигрыш (−) каждого. */
  net?: Record<number, number>;
}

/** Запись рассказа (лента на экране и журнал). */
export interface Entry {
  /** say — рассказ, gm — заметка ведущему, sys — служебная (броски, деньги), talk — реплика ведущего-человека. */
  k: 'say' | 'gm' | 'sys' | 'talk' | 'title';
  text: string;
  img?: string;
  /** Видно только ведущему. */
  gmOnly?: boolean;
  day?: number;
  /** Номер записи (seq на момент записи) — для озвучки новых. */
  n?: number;
}

export type Where =
  | { k: 'map'; node: number }
  | { k: 'site'; site: string; room: string; node: number };

export interface World {
  /** Раскладка замков: место на карте (индекс castles в map.json) → id места ('c1'…'c15' или своё кампании). */
  slots: string[];
  /** Пройденные комнаты: 'c1:5'. */
  visited: string[];
  /** Сцены, которые закончились (комната пуста). */
  done: string[];
  /** Открытые потайные переходы: 'c2:13>14'. */
  opened: string[];
  /** Флаги приключений и кампании. */
  flags: Record<string, FlagVal>;
  /** Колода дорожных встреч «Прочее» (ключи сцен), верх — в конце. */
  deck: string[];
  /** Пройденные узлы карты (туман на карте). */
  seen: number[];
  day: number;
  /** Переходов с начала дня. */
  steps: number;
  night: boolean;
  /** Отложенные шаги сцен «в первую ночь»: ключ сцены, путь к шагам, герой ветки. */
  later?: { key: string; path: Path; subj?: number }[];
  /** Дневник кампании. */
  quests: { id: string; text: string; done?: boolean }[];
}

export interface Party {
  /** Вожак: решает за отряд, ведёт фишку. */
  leader: number;
  /** Спутники (NPC). */
  allies: Ally[];
}

export type Phase = 'create' | 'travel' | 'scene' | 'over';

export interface State {
  mode: string;
  opts: {
    /** Раскладка замков: book | shuffle. */
    layout: 'book' | 'shuffle';
    /** Ночлег лечит: off (по книге) | inn (в трактире и городе) | always. */
    rest: 'off' | 'inn' | 'always';
    /** Заклинания восстанавливаются: never (по книге) | rest. */
    spells: 'never' | 'rest';
    /** Павший герой: dead (по книге) | forpost (воскрешают в Форпосте за плату). */
    death: 'dead' | 'forpost';
    /** Игрокам видны числа карточек опасностей. */
    stats: boolean;
    /** Встречи на дорогах: шанс на переход, %. */
    road: number;
  };
  phase: Phase;
  heroes: Hero[];
  party: Party;
  world: World;
  where: Where;
  scene: SceneRun | null;
  combat: Combat | null;
  story: Entry[];
  /** Последовательность событий (для «ещё не показано»). */
  seq: number;
  result: { win: boolean; text: string } | null;
  /** Ведущий-человек: свободная сцена (его рассказ без книги) — шаги, которые он собрал. */
  custom?: Step[];
}
