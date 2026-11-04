/* Бот карты в Web Worker: обещания вместо сообщений. Нет воркера (старый браузер, тест) — считаем тут же. */
import type { BattleSetup, BattleState } from '../sim/battle';
import type { AdvAction, World } from '../sim/adv/world';
import { type BotMem, botStep } from './advbot';
import { fightOut } from './advplay';
import type { BotLevel } from './bot';

export type BotRequest =
  | { id: number; kind: 'step'; world: World; level: BotLevel; mem: BotMem }
  | { id: number; kind: 'fight'; setup: BattleSetup; levels: [BotLevel, BotLevel] };
export type BotReply =
  | { id: number; kind: 'step'; action: AdvAction; mem: BotMem }
  | { id: number; kind: 'fight'; state: BattleState };

export class MapBotClient {
  private worker: Worker | null = null;
  private seq = 0;
  private wait = new Map<number, (r: BotReply) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<BotReply>) => {
        const done = this.wait.get(e.data.id);
        this.wait.delete(e.data.id);
        done?.(e.data);
      };
      this.worker.onerror = () => {
        // воркер не поднялся: дальше — без него
        this.worker?.terminate();
        this.worker = null;
      };
    } catch {
      this.worker = null;
    }
  }

  private ask(req: BotRequest): Promise<BotReply> {
    return new Promise((resolve) => {
      this.wait.set(req.id, resolve);
      this.worker!.postMessage(req);
    });
  }

  /** Следующее действие бота и его память после него. */
  async step(world: World, level: BotLevel, mem: BotMem): Promise<{ action: AdvAction; mem: BotMem }> {
    if (!this.worker) return { action: botStep(world, level, mem), mem };
    const r = await this.ask({ id: ++this.seq, kind: 'step', world, level, mem });
    if (r.kind !== 'step') throw new Error('Бот ответил не тем');
    return { action: r.action, mem: r.mem };
  }

  /** Автобой без показа. */
  async fight(setup: BattleSetup, levels: [BotLevel, BotLevel]): Promise<BattleState> {
    if (!this.worker) return fightOut(setup, levels);
    const r = await this.ask({ id: ++this.seq, kind: 'fight', setup, levels });
    if (r.kind !== 'fight') throw new Error('Бот ответил не тем');
    return r.state;
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.wait.clear();
  }
}
