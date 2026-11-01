/* Вход ГОПС. Пока — быстрый бой для разработки: /gops.html?level=m03&vs=medium&n=3
 * (vs: easy|medium|hard|human — второй стороной бот или человек за этим же экраном; p1 — то же для первой
 * стороны, p1=hard&vs=hard — смотреть бой ботов). Меню и кампания — дальше. */
import type { BotLevel } from './bot/bot';
import { Game } from './game';
import { loadLevel } from './level';
import './ui/hud.css';

const botLevel = (v: string): BotLevel | null => (v === 'easy' || v === 'medium' || v === 'hard' ? v : null);

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const id = q.get('level') ?? 'm03';
  const vs = q.get('vs') ?? 'medium';
  const n = Math.max(1, Math.min(8, Number(q.get('n') ?? 3)));
  const level = await loadLevel(id);
  const missions: { id: string; theme: string; time?: string }[] = await fetch('/gops/levels/missions-index.json')
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
  const m = missions.find((x) => x.id === id);
  const game = new Game(document.getElementById('gops')!, {
    level,
    theme: m?.theme ?? 'yard',
    time: m?.time,
    seed: Number(q.get('seed') ?? Date.now() % 100000),
    sides: [
      { brigade: q.get('me') ?? 'zatulinka', bot: botLevel(q.get('p1') ?? 'human'), count: n, hp: 100 },
      { brigade: q.get('them') ?? 'rastochka', bot: botLevel(vs), count: n, hp: 100 },
    ],
  });
  await game.start();
  (window as unknown as { gops: Game }).gops = game;
}

main().catch((e) => {
  document.body.textContent = `ГОПС не запустился: ${e}`;
  console.error(e);
});
