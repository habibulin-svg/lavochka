/* Школа покера — формат уроков (src/games/poker/school/lessons/NN-id.json). Урок: шаги на настоящем столе → задачи
 * «твой ход?» → игра-закрепление против ботов нужного стиля. Ответ каждой задачи считается (school/solve.ts): Нэш, ICM,
 * шансы, ауты, вскрытие движком; в файле записан заявленный ответ — тест и tools/poker/school-check.ts сверяют их. */
import type { AnteKind, Mode, Struct } from '../engine';
import type { ProfileId } from '../profiles';

/** Ход в сцене: [место, 'fold' | 'check' | 'call' | 'allin'] или [место, 'raise', до скольких]. */
export type ActSpec = [number, 'fold' | 'check' | 'call' | 'allin'] | [number, 'raise', number];

/** Стол: настоящая раздача движка (блайнды, анте) с заданными картами, затем ходы `pre` до нужного места. */
export interface Scene {
  /** Вид покера (по умолчанию холдем) и ставки (по умолчанию — как принято для вида). */
  mode?: Mode;
  struct?: Struct;
  hilo?: boolean;
  /** Игроков: места 0…n−1 (по умолчанию 6). */
  n?: number;
  /** Чьими глазами смотрим (по умолчанию 0). */
  hero?: number;
  /** Баттон (по умолчанию последнее место). */
  button?: number;
  /** Стеки на начало раздачи: одно число на всех или по местам. */
  stack?: number | number[];
  /** Малый и большой блайнд (по умолчанию 10/20). */
  blinds?: [number, number];
  ante?: AnteKind;
  /** Карты по местам («AH KH»; 10 — «10H» или «TH»). Не названные — из колоды по порядку. */
  hands?: Record<string, string>;
  /** Открытые карты стада: номера карт руки (по умолчанию 3–6-я из семи, 2-я из трёх/пяти — как раздаёт движок). */
  up?: Record<string, number[]>;
  /** Общие карты вперёд по улицам (флоп, тёрн, ривер). Сжигаемые подставляются сами. */
  board?: string;
  /** Ходы до нужного места (не показываются). */
  pre?: ActSpec[];
  /** После `pre` все до героя пасуют (удобно для «открыть или пас» и пуш/фолда). */
  foldTo?: boolean;
  /** Только картинка (вскрытие в стаде/дро/Омахе): сразу открыть столько общих карт; ходов после — нет. */
  show?: number;
  /** Открыть карты всех (иначе видны только свои). */
  open?: boolean;
}

/** Ход показа с подписью. */
export interface PlayStep {
  act: ActSpec;
  caption?: string;
}

export interface LessonStep {
  /** Текст шага (простой HTML: <b>, <i>, <br>). */
  text: string;
  /** Новый стол; без него — стол прошлого шага (с уже сыгранными ходами). */
  scene?: Scene;
  /** Ходы по кнопке «Показать». */
  play?: PlayStep[];
}

/** Виды задач — каждая решается расчётом (solve.ts). */
export type TaskKind =
  /** Лучшая комбинация героя на доске (названия — hands.HIGH_NAMES). */
  | 'combo'
  /** Кто выиграет на вскрытии (место или 'split'); lo — кто заберёт низкую половину ('none' — никто). */
  | 'winner'
  | 'winlow'
  /** Ауты героя — число: с `villain` — карты, после которых герой впереди известной руки (точно); без — calc.outs
   * (любая карта, что поднимает комбинацию героя; при старшей карте — и пары). */
  | 'outs'
  /** Нужные шансы для колла: колл / (банк + колл), в процентах — ближайший вариант. */
  | 'potodds'
  /** Колл или пас: шансы против диапазона `vs` (розыгрыш с зерном) против шансов банка. */
  | 'callfold'
  /** Позиция героя: UTG, UTG+1, MP, HJ, CO, BTN, SB, BB. */
  | 'position'
  /** Открыть рейзом или пас, когда до героя все спасовали (ranges.openWidth по числу игроков позади). */
  | 'open'
  /** M Харрингтона героя — зона (calc.zoneOf): зелёная, жёлтая, оранжевая, красная, мёртвая. */
  | 'zone'
  /** Пуш/фолд по Нэшу (calc.solvePF): до героя все спасовали — push/fold; один ва-банк перед ним — call/fold.
   * С `prizes` — по ICM. */
  | 'pushfold'
  /** ICM: место с наибольшей / наименьшей долей призовых, или стоимость стека героя в % фонда (ближайший вариант). */
  | 'icm'
  /** Фактор пузыря героя против места `villain` (icm.bubbleFactor) — ближайший вариант. */
  | 'bubble'
  /** Шансы, которые ставка `bet` в банк `pot` даёт сопернику: bet / (pot + 2·bet), % — ближайший вариант. */
  | 'betodds'
  /** Блеф окупается, если соперник пасует чаще, чем bet / (pot + bet): bet / check. */
  | 'bluff'
  /** Стиль по цифрам HUD (hud.styleGuess). */
  | 'style';

export interface Task {
  id: string;
  /** Вопрос (HTML). */
  q: string;
  kind: TaskKind;
  scene?: Scene;
  /** Варианты ответа: значение → подпись. Без них — подставляются по виду задачи. */
  options?: [string, string][];
  /** Заявленный ответ (значение из options). */
  answer: string;
  /** Почему (HTML) — показывается после ответа вместе с расчётом. */
  why: string;
  // параметры видов
  /** callfold: диапазон соперника («QQ+, AKs, AQo»); potodds/callfold — колл и банк, если стол не задан. */
  vs?: string;
  call?: number;
  pot?: number;
  bet?: number;
  /** bluff: как часто соперник пасует (0…1). */
  fold?: number;
  /** pushfold/icm/bubble: выплаты по местам; stacks — для icm/bubble без стола. */
  prizes?: number[];
  stacks?: number[];
  villain?: number;
  /** icm: что спрашиваем. */
  ask?: 'max' | 'min' | 'value';
  /** style: цифры игрока. */
  hud?: { hands: number; vpip: number; pfr: number; af: number };
  /** zone: анте за круг вне стола. */
  antes?: number;
}

/** Игра-закрепление: быстрая игра против ботов нужных стилей или короткий Sit&Go. */
export interface LessonGame {
  text: string;
  kind: 'cash' | 'sng';
  mode?: Mode;
  /** Соперники по стилю (места подбираются под стиль). */
  bots: ProfileId[];
  /** Уровень ботов: 0 лёгкий, 1 средний, 2 сложный. */
  level?: number;
  /** cash: раздач (20/30/40) и стек; sng: формат и скорость турнира. */
  hands?: number;
  stack?: number;
  tour?: 'hu' | 'sng6' | 'sng9' | 'don';
  speed?: 'normal' | 'turbo' | 'hyper';
}

export interface Lesson {
  id: string;
  n: number;
  title: string;
  /** Что ученик вынесет из урока — одна строка. */
  goal: string;
  steps: LessonStep[];
  /** «Запомни» — короткие выводы. */
  remember: string[];
  tasks: Task[];
  game: LessonGame;
}
