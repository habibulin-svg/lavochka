/* Web Worker бота карты: ход бота и автобой считаются здесь, чтобы интерфейс не замирал. Мир и память — JSON туда и обратно. */
import { botStep } from './advbot';
import { fightOut } from './advplay';
import type { BotRequest, BotReply } from './remote';

self.onmessage = (e: MessageEvent<BotRequest>) => {
  const m = e.data;
  let reply: BotReply;
  if (m.kind === 'step') reply = { id: m.id, kind: 'step', action: botStep(m.world, m.level, m.mem), mem: m.mem };
  else reply = { id: m.id, kind: 'fight', state: fightOut(m.setup, m.levels) };
  (self as unknown as Worker).postMessage(reply);
};
