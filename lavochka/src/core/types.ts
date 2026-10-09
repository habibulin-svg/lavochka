/* Общие типы сборника. Всё в этом файле — без DOM: движки игр работают и в браузере, и на сервере. */

export type SeatKind = 'human' | 'bot' | 'remote';

/** Место за столом: кто играет и как его зовут. */
export interface SeatSpec {
  seat: number;
  kind: SeatKind;
  name: string;
  /** Уровень бота: индекс в bot.levels. */
  level: number;
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
  choices?: { value: string | number; label: string }[];
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

export interface GameDef<S = any, A = any, E = any, V = any> {
  id: string;
  title: string;
  players: { min: number; max: number; default: number };
  /** Внешний вид мест (цвет, имя по умолчанию). Длина = максимальное число мест. */
  seats: SeatLook[];
  /** Какие места занимать при N игроках. По умолчанию — первые N. */
  seatsFor?(n: number): number[];
  options?: OptionDef[];
  presets?: Preset[];
  setup(seats: SeatSpec[], opts: Options, rng: Rng): S;
  /** Кто сейчас должен действовать (обычно один игрок). Пусто — партия окончена. */
  toAct(s: S): number[];
  /** Применить действие. null — действие недопустимо. Состояние s не мутировать. */
  apply(s: S, seat: number, action: A, rng: Rng): ApplyResult<S, E> | null;
  /** Что видят игроки seats (скрытая информация убирается). 'all' — наблюдатель-хост для демо. */
  view(s: S, seats: number[] | 'all'): V;
  /** Скрыть детали события от тех, кому их видеть не положено. null — событие не показывать. */
  redact?(ev: E, seats: number[] | 'all'): E | null;
  result(s: S): GameResult | null;
  bot: BotDef<V, A>;
  /** Строка журнала для события (HTML). name(seat) — имя игрока, уже экранированное. */
  describe?(ev: E, name: (seat: number) => string): string | null;
  rules: RulesDoc;
  /** Красивая позиция «посреди партии» — для превью на карточке. */
  showcase?(): S;
}
