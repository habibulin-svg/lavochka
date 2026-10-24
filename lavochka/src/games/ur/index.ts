import type { GameView, GameModule, ViewCtx } from '../../core/view';
import { def } from './def';
import { createSkyrukView } from './skyruk-view';
import { createView as createFinkelView } from './view';

/** Вид выбирается по первому состоянию: правила Финкеля или Скирюка (у них разные фишки и путь). */
function createView(): GameView {
  let inner: GameView | null = null;
  let root: HTMLElement;
  let ctx: ViewCtx;
  const pick = (v: { mode?: string }) => {
    if (inner) return inner;
    inner = v.mode === 'skyruk' ? (createSkyrukView() as GameView) : (createFinkelView() as GameView);
    inner.mount(root, ctx);
    return inner;
  };
  return {
    mount(r, c) {
      root = r;
      ctx = c;
    },
    setView: (v) => pick(v).setView(v),
    play: (events, v) => pick(v).play(events, v),
    setTurn: (toAct, interactive) => inner?.setTurn(toAct, interactive),
    status: (v, toAct, interactive) => pick(v).status?.(v, toAct, interactive) ?? '',
    playerStats: (v, seat) => pick(v).playerStats?.(v, seat) ?? '',
    destroy: () => inner?.destroy?.(),
  };
}

const mod: GameModule = { def, createView };
export default mod;
