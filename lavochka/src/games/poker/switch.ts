/* Покер — какой стол рисовать. Виды на две карты (холдем, Short Deck) — стол холдема с 3D-комнатой (holdem/view.ts, через
 * переходник), китайский покер — свой стол раскладки (ofc/view.ts), остальные — 2D-стол покера (view.ts).
 * Вид партии известен по первому же снимку — тогда и собираем нужный стол. Поверх — тренажёр (poker/trainer.ts) и
 * панель турнира (poker/tourui.ts). */
import type { GameView, ViewCtx } from '../../core/view';
import { createView as createHoldem } from '../holdem/view';
import type { AnyEvent, AnyView } from './def';
import type { Event, Mode } from './engine';
import { createOfcView } from './ofc/view';
import { finishPending } from './school/progress';
import { Trainer } from './trainer';
import { TourUI } from './tourui';
import { createView as createFlat } from './view';

export const holdemTable = (mode: Mode) => mode === 'holdem' || mode === 'shortdeck';

class SwitchView implements GameView<AnyView, AnyEvent> {
  private root!: HTMLElement;
  private ctx!: ViewCtx;
  private inner: GameView<any, any> | null = null;
  private tour: TourUI | null = null;
  private trainer: Trainer | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.root = root;
    this.ctx = ctx;
  }

  private pick(v: AnyView): GameView<any, any> {
    if (!this.inner) {
      // тренажёр (HUD, подсказки, разбор) — у покера со ставками; HUD рисуют 2D-столы
      if (!('ofc' in v)) this.trainer = new Trainer(this.root, this.ctx);
      const hud = this.trainer?.hud ?? null;
      this.inner = 'ofc' in v ? createOfcView() : holdemTable(v.cfg.mode) ? createHoldem(hud) : createFlat(hud);
      this.inner.mount(this.root, this.ctx);
      this.trainer?.placeBelow();
      if (this.trainer) this.trainer.redraw = () => this.last && this.inner?.setView(this.last);
      if ('tour' in v && v.tour) this.tour = new TourUI(this.root, this.ctx);
    }
    return this.inner;
  }

  private last: AnyView | null = null;

  setView(v: AnyView) {
    this.last = v;
    this.pick(v).setView(v);
    if (!('ofc' in v)) {
      this.tour?.update(v);
      this.trainer?.update(v);
    }
  }
  async play(events: AnyEvent[], v: AnyView) {
    this.last = v;
    const inner = this.pick(v);
    // раздача сыграна — статистика сразу, чтобы HUD на следующей уже её показывал
    if (!('ofc' in v)) this.trainer?.events(events as Event[], v);
    await inner.play(events, v);
    // партия доиграна — закрепление урока школы (если это оно) засчитано
    if (v.over && !this.ctx.demo) finishPending();
    if (!('ofc' in v)) {
      this.tour?.update(v);
      this.trainer?.update(v);
    }
  }
  seatName(v: AnyView, seat: number) {
    return 'ofc' in v ? null : TourUI.seatName(v, seat);
  }
  setTurn(toAct: number[], interactive: number[]) {
    this.inner?.setTurn(toAct, interactive);
  }
  status(v: AnyView, toAct: number[], interactive: number[]) {
    return this.pick(v).status?.(v, toAct, interactive) ?? '';
  }
  playerStats(v: AnyView, seat: number) {
    return this.pick(v).playerStats?.(v, seat) ?? '';
  }
  destroy() {
    this.trainer?.destroy();
    this.tour?.destroy();
    this.inner?.destroy?.();
  }
}

export function createView(): GameView<AnyView, AnyEvent> {
  return new SwitchView();
}
