import type { GameModule, GameView, ViewCtx } from '../../core/view';
import { def } from './def';
import { createShvView } from './shv/view';
import { createView as createSeaView } from './view';

/** Вид карточки: «Пираты» и «Колонии» рисует SeaView, «Швамбранию» — свой вид; выбирается по состоянию партии. */
class SwitchView implements GameView {
  private inner: GameView | null = null;
  private kind = '';
  private root!: HTMLElement;
  private ctx!: ViewCtx;
  private turn: [number[], number[]] | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.root = root;
    this.ctx = ctx;
  }

  private use(v: { game: string }): GameView {
    const k = v.game === 'shv' ? 'shv' : 'sea';
    if (k !== this.kind || !this.inner) {
      this.inner?.destroy?.();
      this.root.replaceChildren();
      this.ctx.controls.replaceChildren();
      this.inner = k === 'shv' ? createShvView() : createSeaView();
      this.inner.mount(this.root, this.ctx);
      this.kind = k;
      if (this.turn) this.inner.setTurn(...this.turn);
    }
    return this.inner;
  }

  setView(v: any) {
    this.use(v).setView(v);
  }
  play(events: any[], v: any) {
    return this.use(v).play(events, v);
  }
  setTurn(toAct: number[], interactive: number[]) {
    this.turn = [toAct, interactive];
    this.inner?.setTurn(toAct, interactive);
  }
  status(v: any, toAct: number[], interactive: number[]) {
    return this.use(v).status?.(v, toAct, interactive) ?? '';
  }
  playerStats(v: any, seat: number) {
    return this.use(v).playerStats?.(v, seat) ?? '';
  }
  destroy() {
    this.inner?.destroy?.();
  }
}

const mod: GameModule = { def, createView: () => new SwitchView() };
export default mod;
