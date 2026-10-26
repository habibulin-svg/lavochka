import type { GameModule, GameView, ViewCtx } from '../../core/view';
import { isC } from '../chaupar/engine';
import { ChauparView } from '../chaupar/view';
import { isL } from '../ludo/engine';
import { LudoView } from '../ludo/view';
import { def } from './def';
import { createView as createShish } from './view';

/** Людо и парчис, чаупар и пачиси — свой вид на своих досках; переключаемся по состоянию партии. */
class SwitchView implements GameView {
  private root!: HTMLElement;
  private ctx!: ViewCtx;
  private cur: GameView | null = null;
  private kind = '';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.root = root;
    this.ctx = ctx;
  }

  private pick(v: unknown): GameView {
    const kind = isL(v) ? 'ludo' : isC(v) ? 'chaupar' : 'shish';
    if (kind !== this.kind || !this.cur) {
      this.cur?.destroy?.();
      this.root.innerHTML = '';
      this.ctx.controls.innerHTML = '';
      this.kind = kind;
      this.cur = kind === 'ludo' ? new LudoView() : kind === 'chaupar' ? new ChauparView() : createShish();
      this.cur.mount(this.root, this.ctx);
    }
    return this.cur;
  }

  setView(v: unknown) {
    this.pick(v).setView(v);
  }
  play(events: unknown[], v: unknown) {
    return this.pick(v).play(events, v);
  }
  setTurn(toAct: number[], interactive: number[]) {
    this.cur?.setTurn(toAct, interactive);
  }
  status(v: unknown, toAct: number[], interactive: number[]) {
    return this.pick(v).status?.(v, toAct, interactive) ?? '';
  }
  playerStats(v: unknown, seat: number) {
    return this.pick(v).playerStats?.(v, seat) ?? '';
  }
  destroy() {
    this.cur?.destroy?.();
  }
}

const mod: GameModule = { def, createView: () => new SwitchView() };
export default mod;
