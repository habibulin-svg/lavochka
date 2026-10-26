/* Общие типы сборника. Всё в этом файле — без DOM: движки игр работают и в браузере, и на сервере. */
import type { RecordsDef } from './records';

export type SeatKind = 'human' | 'bot' | 'remote';

/** Место за столом: кто играет и как его зовут. */
export interface SeatSpec {
  seat: number;
  kind: SeatKind;
  name: string;
  /** Уровень бота: индекс в bot.levels. */
  level: number;
  /** Аватар игрока (значок или адрес фото, см. core/avatars.ts). */
  avatar?: string | null;
  /** Персонаж, которого игрок выбрал себе (холдем 3D): id из GameModule.looks. */
  look?: string | null;
}

/** Детерминированный генератор случайных чисел — состояние можно сохранить и восстановить. */
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Целое в [0, n) */
  int(n: number): number;
  getState(): number;
}

export interface ApplyResult<S, E> {
  state: S;
  events: E[];
}

export type OptionValue = string | number | boolean;
export type Options = Record<string, OptionValue>;

/** Настройка правил — экран настройки строится из этих описаний. */
export interface OptionDef {
  key: string;
  label: string;
  hint?: string;
  type: 'select' | 'toggle' | 'number';
  /** showIf у варианта — показывать его только при этих правилах (иначе значение сбрасывается на первый видимый). */
  choices?: { value: string | number; label: string; showIf?: (o: Options) => boolean }[];
  min?: number;
  max?: number;
  step?: number;
  default: OptionValue;
  /** Показывать настройку, только если выполнено условие (зависимые настройки). */
  showIf?: (o: Options) => boolean;
}

/** Готовый набор правил («Подкидной», «Переводной» …). */
export interface Preset {
  id: string;
  label: string;
  hint?: string;
  options: Options;
}

export interface SeatLook {
  name: string;
  color: string;
  light: string;
  dark: string;
  /** Цвет имени в тексте, если основной слишком светлый для светлой панели (белые шашки). */
  ink?: string;
}

export interface BotDef<V, A> {
  /** Названия уровней по возрастанию сложности. */
  levels: string[];
  /** Бот видит только то, что видел бы человек на его месте (view для своего места). */
  choose(view: V, seat: number, level: number, rng: Rng): A | null | Promise<A | null>;
}

export interface GameResult {
  /** Места победителей. */
  winners: number[];
  /** Короткий текст итога: «Красный первым завёл все фишки в домик». */
  text: string;
  scores?: Record<number, number>;
}

/** Пошаговый показ правил: позиция + действия с подписями. Кубики и раздачи подкручиваются через rig. */
export interface DemoStep<A> {
  seat: number;
  action: A;
  /** Значения, которые вернёт rng.int() во время этого хода (подряд). */
  rig?: number[];
  caption?: string;
}

export interface DemoScript<S, A> {
  seats: SeatSpec[];
  options?: Options;
  /** Начальная позиция. По умолчанию — обычная расстановка setup(). */
  setup?(def: GameDef<S, A>, rng: Rng): S;
  intro?: string;
  steps: DemoStep<A>[];
}

export interface RulesSection {
  title: string;
  /** HTML с текстом раздела. */
  html: string;
  demo?: DemoScript<any, any>;
}

export interface RulesDoc {
  /** Цель игры одной-двумя фразами (HTML). */
  goal: string;
  sections: RulesSection[];
}

/**
 * Игра в реальном времени (настольный хоккей): ходов нет — комната сама крутит шаги симуляции,
 * игроки шлют ей своё управление (ввод), она рассылает снимки поля. Боты дают ввод на каждом шаге.
 */
export interface RealtimeDef<S = any, I = any, E = any, V = any> {
  /** Длина шага симуляции, мс. */
  tickMs: number;
  /** Рассылать снимок раз в столько шагов. */
  sendEvery: number;
  /** Ввод «ничего не трогаю» (место без связи, пока его ждут). */
  idle(): I;
  /** Проверить ввод, пришедший по сети; null — мусор. */
  input(raw: unknown): I | null;
  /** Шаг симуляции. Состояние меняется на месте (ради скорости); inputs[seat] — ввод места. Возвращает события шага. */
  tick(s: S, inputs: I[], rng: Rng): E[];
  /** Ввод бота по view его места; mem — его память между шагами. */
  bot(view: V, seat: number, level: number, mem: Record<string, any>, rng: Rng): I;
}

export interface GameDef<S = any, A = any, E = any, V = any> {
  id: string;
  title: string;
  players: { min: number; max: number; default: number };
  /** Какие числа игроков допустимы при этих настройках (по умолчанию — весь отрезок min…max).
   * «Шайба» в кинь-двинь: вдвоём (дуэль) или командами — только 2, 4 и 6. */
  countsFor?(opts: Options): number[];
  /** Подпись у выбора числа игроков при этих настройках: «вдвоём или командами: 2 на 2 / 3 на 3». */
  countsHint?(opts: Options): string | undefined;
  /** Строка «Играем: …» в лобби, если вариантов мало, чтобы её описать (покер: «Холдем · Sit&Go на 6, турбо»). */
  summary?(opts: Options, base: string): string;
  /** Имя места при этих правилах, если не такое, как в `seats` (асальто — «Повстанцы», солитёр — «Игрок»). */
  seatNameFor?(opts: Options, seat: number): string | undefined;
  /** Команды при этих настройках и этих местах (номера мест по возрастанию): кто с кем в паре. null — каждый сам за себя.
   * Лобби подписывает пары и даёт хозяину пересадить игроков; тест сверяет, что командный пресет и правда даёт команды. */
  teams?(opts: Options, seats: number[]): number[][] | null;
  /** Внешний вид мест (цвет, имя по умолчанию). Длина = максимальное число мест. */
  seats: SeatLook[];
  /** Какое место по умолчанию отдать человеку (остальные — боты). По умолчанию — первое. Ролевая игра: место 0 — ведущий-бот, 1 — герой. */
  defaultHuman?: number;
  /** Какие места занимать при N игроках. По умолчанию — первые N. */
  seatsFor?(n: number): number[];
  options?: OptionDef[];
  presets?: Preset[];
  setup(seats: SeatSpec[], opts: Options, rng: Rng): S;
  /** Настройки для «Сыграть ещё» — убрать одноразовое (сид, восстановленный ход). По умолчанию — те же. */
  again?(opts: Options): Options;
  /** Кто сейчас должен действовать (обычно один игрок). Пусто — партия окончена. */
  toAct(s: S): number[];
  /** Действие вне очереди (ролевая игра: выпить зелье, снарядиться, передать вещь), когда место не в toAct.
   * По умолчанию — нельзя. Сама допустимость всё равно проверяется в apply. Ботов вне очереди не спрашивают. */
  free?(s: S, seat: number, action: A): boolean;
  /** Применить действие. null — действие недопустимо. Состояние s не мутировать. */
  apply(s: S, seat: number, action: A, rng: Rng): ApplyResult<S, E> | null;
  /** Что видят игроки seats (скрытая информация убирается). 'all' — наблюдатель-хост для демо. */
  view(s: S, seats: number[] | 'all'): V;
  /** Скрыть детали события от тех, кому их видеть не положено. null — событие не показывать. */
  redact?(ev: E, seats: number[] | 'all'): E | null;
  result(s: S): GameResult | null;
  bot: BotDef<V, A>;
  /** Ход за человека, который потерял связь и не вернулся за время ожидания: «сидит вне игры» (покерный турнир — чек или пас).
   * null — ходит бот, как в остальных играх. awayText — как сказать об этом за столом (null — «за него будет ходить бот»). */
  away?(v: V, seat: number): A | null;
  awayText?(opts: Options): string | null;
  /** Строка журнала для события (HTML). name(seat) — имя игрока, уже экранированное. */
  describe?(ev: E, name: (seat: number) => string): string | null;
  /** Правило чата за сетевым столом (Король-говно: по имени не зовут — минута молчания). names — имена мест по номеру. */
  chatRule?(state: S, seat: number, text: string, names: string[]): { mute: number; note: string } | null;
  rules: RulesDoc;
  /** Красивая позиция «посреди партии» — для превью на карточке. */
  showcase?(): S;
  /** Игра в реальном времени: apply не используется, комната гоняет tick. */
  realtime?: RealtimeDef<S, any, E, V>;
  /** Таблицы рекордов (одиночные партии): что и как сравнивать. Сервер переигрывает запись партии этим же def. */
  records?: RecordsDef<S>;
}
