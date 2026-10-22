/* Покер — какой стол рисовать. Виды на две карты (холдем, Short Deck) — стол холдема с 3D-комнатой (holdem/view.ts, через
 * переходник), китайский покер — свой стол раскладки (ofc/view.ts), остальные — 2D-стол покера (view.ts).
 * Вид партии известен по первому же снимку — тогда и собираем нужный стол. */
import type { GameView, ViewCtx } from '../../core/view';
import { createView as createHoldem } from '../holdem/view';
import type { AnyEvent, AnyView } from './def';
import type { Mode } from './engine';
import { createOfcView } from './ofc/view';
import { createView as createFlat } from './view';

export const holdemTable = (mode: Mode) => mode === 'holdem' || mode === 'shortdeck';

class SwitchView implements GameView<AnyView, AnyEvent> {
  private root!: HTMLElement;
  private ctx!: ViewCtx;
  private inner: GameView<any, any> | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.root = root;
    this.ctx = ctx;
  }

  private pick(v: AnyView): GameView<any, any> {
    if (!this.inner) {
      this.inner = 'ofc' in v ? createOfcView() : holdemTable(v.cfg.mode) ? createHoldem() : createFlat();
      this.inner.mount(this.root, this.ctx);
    }
    return this.inner;
  }

  setView(v: AnyView) {
    this.pick(v).setView(v);
  }
  play(events: AnyEvent[], v: AnyView) {
    return this.pick(v).play(events, v);
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
    this.inner?.destroy?.();
  }
}

export function createView(): GameView<AnyView, AnyEvent> {
  return new SwitchView();
}
