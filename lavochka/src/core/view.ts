/* Интерфейс отрисовки игры (DOM). Стол сборника — общий, а поле и анимации у каждой игры свои. */
import type { GameDef } from './types';

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
}

export interface GameView<V = any, E = any> {
  mount(root: HTMLElement, ctx: ViewCtx): void;
  /** Отрисовать состояние сразу, без анимации. */
  setView(view: V): void;
  /** Проиграть события и прийти к состоянию view. */
  play(events: E[], view: V): Promise<void>;
  /** toAct — кто ходит; interactive — места этого экрана, которые могут действовать прямо сейчас. */
  setTurn(toAct: number[], interactive: number[]): void;
  /** Строка статуса под полем («Красный: бросайте кости»). */
  status?(view: V, toAct: number[], interactive: number[]): string;
  /** Короткая сводка по игроку для боковой панели (HTML). */
  playerStats?(view: V, seat: number): string;
  destroy?(): void;
}

export interface GameModule {
  def: GameDef;
  createView(): GameView;
}
