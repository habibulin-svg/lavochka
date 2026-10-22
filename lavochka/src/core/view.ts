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
  /** Персонаж места (GameModule.looks): выбранный игроком, а у остальных — свободные по порядку. */
  look?(seat: number): string | null;
}

/** Свой запуск из блока home (турнир покера): сколько мест и боты какого уровня — человек один (первый «человек» из лобби
 * или место 0), остальные места — боты. */
export interface LaunchTable {
  count: number;
  /** Уровень бота по месту (по умолчанию — как выбран в лобби). */
  levels?: number[];
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
  /** Чьё видео на поле крупнее остальных (шляпа: объясняющий; данетки: кто спрашивает). Камеры на поле стол ставит над аватарами
   * с [data-cam="<место>"] (см. core/seatcams.ts); без главного по игре крупным становится тот, кто говорит. */
  focusSeat?(view: V): number | null;
  /** Имя места по ходу партии (турнир: за стол пересаживают других игроков); null — имя из лобби. */
  seatName?(view: V, seat: number): string | null;
  destroy?(): void;
}

/** Настройка вида на этом экране (не правило партии — у каждого игрока своя): выбор на экране игры, хранится в store под key. */
export interface ViewPref {
  key: string;
  label: string;
  hint?: string;
  choices: { value: string; label: string }[];
  default: string;
  /** Показывать выбор только при таких правилах партии (3D-комната покера — только у холдема). */
  showIf?: (o: Options) => boolean;
}

export interface GameModule {
  def: GameDef;
  createView(): GameView;
  prefs?: ViewPref[];
  /** Игра сама хранит свои незаконченные партии (головоломки — по штуке на каждую): общий «Продолжить» не нужен. */
  ownSaves?: boolean;
  /** Свой блок в начале карточки «Новая партия» (список недорешённого); launch — начать с этими настройками и текущими местами. */
  home?(box: HTMLElement, launch: (options: Options, table?: LaunchTable) => void): void;
  /** Персонажи, которых игрок выбирает себе в лобби (холдем 3D). По умолчанию место i — looks[i]. */
  looks?: Look[];
}

export interface Look {
  id: string;
  label: string;
  /** Картинка-превью (адрес). */
  img?: string;
}

/** Персонажи за столом: выбранные игроками (кто раньше сел — того и персонаж), остальным — свободные, начиная со «своего» по номеру места. */
export function assignLooks(looks: Look[], seats: { seat: number; look?: string | null }[]): Map<number, string> {
  const out = new Map<number, string>();
  const used = new Set<string>();
  const ids = looks.map((l) => l.id);
  for (const s of seats)
    if (s.look && ids.includes(s.look) && !used.has(s.look)) {
      out.set(s.seat, s.look);
      used.add(s.look);
    }
  for (const s of seats) {
    if (out.has(s.seat) || !ids.length) continue;
    let id = ids[s.seat % ids.length];
    for (let k = 0; used.has(id) && k < ids.length; k++) id = ids[(s.seat + k + 1) % ids.length];
    out.set(s.seat, id);
    used.add(id);
  }
  return out;
}
