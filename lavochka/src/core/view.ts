/* Интерфейс отрисовки игры (DOM). Стол сборника — общий, а поле и анимации у каждой игры свои. */
import type { GameDef, Options } from './types';

export interface ViewCtx<A = any> {
  /** Отправить действие от имени места. */
  act(seat: number, action: A): void;
  /** Места, за которые играет этот экран (хот-сит — несколько). */
  mySeats: number[];
  /** Показ правил: без взаимодействия. */
  demo: boolean;
  /** Слот в боковой панели под элементы игры: кубики, кнопки. */
  controls: HTMLElement;
  /** Имя игрока как HTML (цвет места, экранировано). */
  name(seat: number): string;
  speed(): number;
  autoSingle(): boolean;
  /** «Пропустить»: боты ходят без пауз, пока не выключат. */
  hurry?(on: boolean): void;
  /** Стол ещё грузится — боты ждут ms (не дольше 30 с); 0 — готово. */
  hold?(ms: number): void;
  /** Игра реального времени: отправить текущее управление места. */
  input?(seat: number, input: unknown): void;
  /** Игра идёт по сети (не локально): снимки приходят с задержкой. */
  online?: boolean;
  /** Дать прочитать (карточка, событие клетки): если за экраном человек — ждать его касания, иначе пауза ms.
   * Сам текст игра показывает своей карточкой; в журнал он попадает строкой describe. */
  read?(ms: number): Promise<void>;
}

export interface GameView<V = any, E = any> {
  mount(root: HTMLElement, ctx: ViewCtx): void;
  /** Отрисовать состояние сразу, без анимации. */
  setView(view: V): void;
  /** Проиграть события и прийти к состоянию view. */
  play(events: E[], view: V): Promise<void>;
  /** Игра реального времени: свежий снимок поля и события с прошлого снимка (идут мимо очереди play). */
  realtime?(view: V, events: E[]): void;
  /** toAct — кто ходит; interactive — места этого экрана, которые могут действовать прямо сейчас. */
  setTurn(toAct: number[], interactive: number[]): void;
  /** Строка статуса под полем («Красный: бросайте кости»). */
  status?(view: V, toAct: number[], interactive: number[]): string;
  /** Короткая сводка по игроку для боковой панели (HTML). */
  playerStats?(view: V, seat: number): string;
  /** Тишина в голосовом чате (ночь в мафии): причина — микрофоны и камеры выключаются; null — можно говорить. */
  quiet?(view: V): string | null;
  /** Чья камера сейчас главная (крокодил: показывающий) — стол показывает её видео крупно: в элементе доски с атрибутом [data-spot]
   * (игра держит его постоянным, не перерисовывает), а без него — поверх доски; null — не показывать. Панель стола не трогается. */
  spotlight?(view: V): number | null;
  destroy?(): void;
}

/** Настройка вида на этом экране (не правило партии — у каждого игрока своя): выбор на экране игры, хранится в store под key. */
export interface ViewPref {
  key: string;
  label: string;
  hint?: string;
  choices: { value: string; label: string }[];
  default: string;
}

export interface GameModule {
  def: GameDef;
  createView(): GameView;
  prefs?: ViewPref[];
  /** Игра сама хранит свои незаконченные партии (головоломки — по штуке на каждую): общий «Продолжить» не нужен. */
  ownSaves?: boolean;
  /** Свой блок в начале карточки «Новая партия» (список недорешённого); launch — начать с этими настройками и текущими местами. */
  home?(box: HTMLElement, launch: (options: Options) => void): void;
}
