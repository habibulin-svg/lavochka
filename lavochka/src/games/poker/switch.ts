/* Покер — какой стол рисовать. Виды на две карты (холдем, Short Deck) — стол холдема с 3D-комнатой (holdem/view.ts, через
 * переходник), остальные — 2D-стол покера (view.ts). Вид партии известен по первому же снимку — тогда и собираем нужный стол. */
import type { GameView, ViewCtx } from '../../core/view';
import { createView as createHoldem } from '../holdem/view';
import type { Event, Mode, View } from './engine';
import { createView as createFlat } from './view';

export const holdemTable = (mode: Mode) => mode === 'holdem' || mode === 'shortdeck';

class SwitchView implements GameView<View, Event> {
  private root!: HTMLElement;
  private ctx!: ViewCtx;
  private inner: GameView<View, Event> | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.root = root;
    this.ctx = ctx;
  }

  private pick(v: View): GameView<View, Event> {
    if (!this.inner) {
      this.inner = holdemTable(v.cfg.mode) ? createHoldem() : createFlat();
      this.inner.mount(this.root, this.ctx);
    }
    return this.inner;
  }

  setView(v: View) {
    this.pick(v).setView(v);
  }
  play(events: Event[], v: View) {
    return this.pick(v).play(events, v);
  }
  setTurn(toAct: number[], interactive: number[]) {
    this.inner?.setTurn(toAct, interactive);
  }
  status(v: View, toAct: number[], interactive: number[]) {
    return this.pick(v).status?.(v, toAct, interactive) ?? '';
  }
  playerStats(v: View, seat: number) {
    return this.pick(v).playerStats?.(v, seat) ?? '';
  }
  destroy() {
    this.inner?.destroy?.();
  }
}

export function createView(): GameView<View, Event> {
  return new SwitchView();
}
