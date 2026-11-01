/* Вход ГОПС. Без параметров — меню (кампания, обучение, испытания, быстрый бой).
 * Для разработки: /gops.html?mission=m06 — сразу миссия; /gops.html?level=m03&vs=medium&n=3 — быстрый бой
 * (vs: easy|medium|hard|human — второй стороной бот или человек за этим же экраном; p1 — то же для первой
 * стороны, p1=hard&vs=hard — смотреть бой ботов). */
import missionsJson from '../../../docs/gops/levels/missions.json';
import type { BotLevel } from './bot/bot';
import { Game } from './game';
import { loadLevel } from './level';
import type { MissionDef } from './sim/mission';
import './ui/hud.css';
import { CORE_AMMO } from './sim/weapons';
import { DEFAULT_SCHEME } from './sim/world';
import { Menu, type QuickConfig } from './ui/menu';

const MISSIONS = missionsJson as unknown as MissionDef[];
const botLevel = (v: string): BotLevel | null => (v === 'easy' || v === 'medium' || v === 'hard' ? v : null);
const host = document.getElementById('gops')!;
const q = new URLSearchParams(location.search);
let game: Game | null = null;
const menu = new Menu(host, MISSIONS);

function stop(): void {
  game?.destroy();
  game = null;
}

/** Миссия: бой, итог, ролик после победы, следующая миссия списка. */
async function play(def: MissionDef): Promise<void> {
  stop();
  menu.hide();
  const level = await loadLevel(def.id);
  const g = new Game(host, {
    level, theme: def.theme, time: def.time, seed: (def.terrain.seed * 31 + Date.now()) % 100000,
    sides: [{ brigade: q.get('me') ?? 'zatulinka', bot: null, count: def.player.count, hp: def.player.hp }],
    mission: def,
  });
  game = g;
  g.onEnd = (run, stars) => {
    if (game !== g) return;
    const list = MISSIONS.filter((m) => m.mode === def.mode);
    const nextDef = list[list.indexOf(def) + 1];
    menu.result(run, stars, {
      retry: () => void play(def),
      menu: () => {
        stop();
        menu.list(def.mode);
      },
      next: nextDef
        ? () => {
            stop();
            const go = () => menu.briefing(nextDef);
            if (def.cutscene_after) menu.cutscene(def.cutscene_after, go);
            else go();
          }
        : null,
    });
  };
  await g.start();
  (window as unknown as { gops: Game }).gops = g;
}

/** Быстрый бой: из экрана настройки (cfg) или из адреса (разработка). */
async function quick(cfg?: QuickConfig): Promise<void> {
  stop();
  menu.hide();
  const battles = MISSIONS.filter((m) => m.mode === 'mission');
  const pick = cfg?.map && cfg.map !== 'random' ? cfg.map : q.get('level');
  const id = pick ?? battles[Math.floor(Math.random() * battles.length)].id;
  const n = Math.max(1, Math.min(8, Number(q.get('n') ?? 3)));
  const level = await loadLevel(id);
  const m = MISSIONS.find((x) => x.id === id);
  const sides = cfg
    ? cfg.sides.map((sd) => ({ brigade: sd.brigade, bot: botLevel(sd.who), count: sd.count, hp: cfg.hp }))
    : [
        { brigade: q.get('me') ?? 'zatulinka', bot: botLevel(q.get('p1') ?? 'human'), count: n, hp: 100 },
        { brigade: q.get('them') ?? 'rastochka', bot: botLevel(q.get('vs') ?? 'medium'), count: n, hp: 100 },
      ];
  const g = new Game(host, {
    level,
    theme: m?.theme ?? 'yard',
    time: m?.time,
    seed: Number(q.get('seed') ?? Date.now() % 100000),
    sides,
    ammo: cfg?.arsenal === 'core' ? CORE_AMMO : undefined,
    scheme: cfg
      ? { ...DEFAULT_SCHEME, turnTime: cfg.turn, wind: cfg.wind, riseStep: cfg.sudden ? 24 : 0, crates: cfg.crates ? 60 : 0 }
      : undefined,
  });
  game = g;
  await g.start();
  (window as unknown as { gops: Game }).gops = g;
}

// Esc в бою — выйти в меню (из миссии — к её списку)
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || !game) return;
  const mode = game.run?.def.mode;
  stop();
  if (mode) menu.list(mode);
  else menu.title();
});

menu.onPlay = (def) => void play(def);
menu.onQuick = (c) => void quick(c);

async function main(): Promise<void> {
  const mission = q.get('mission');
  if (mission) {
    const def = MISSIONS.find((m) => m.id === mission);
    if (!def) throw new Error(`нет миссии ${mission}`);
    await play(def);
  } else if (q.get('level')) await quick();
  else menu.title();
}

main().catch((e) => {
  document.body.textContent = `ГОПС не запустился: ${e}`;
  console.error(e);
});
