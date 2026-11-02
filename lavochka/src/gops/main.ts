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
import { NetClient } from './net/client';
import type { NetClientMsg, NetSetup } from './net/protocol';
import { Menu, loadStars, type QuickConfig } from './ui/menu';
import type { Save } from './save';
import { MenuMusic } from './ui/menu-music';
import { mayPlay, type Release } from '../core/release';
import type { RightGrant } from '../core/rights';

const MISSIONS = missionsJson as unknown as MissionDef[];
const botLevel = (v: string): BotLevel | null => (v === 'easy' || v === 'medium' || v === 'hard' ? v : null);
const host = document.getElementById('gops')!;
const q = new URLSearchParams(location.search);
let game: Game | null = null;
const menu = new Menu(host, MISSIONS);
const music = new MenuMusic();
menu.onShow = () => music.start();

let net: NetClient | null = null;

function stop(): void {
  music.stop();
  game?.destroy();
  game = null;
  net?.close();
  net = null;
}

/** Сеть: создать комнату или войти; дальше — лобби, по «Начать» — партия у всех. */
async function connect(first: NetClientMsg): Promise<void> {
  stop();
  let c: NetClient;
  try {
    c = await NetClient.open(first);
  } catch (e) {
    menu.network(String((e as Error).message ?? e));
    return;
  }
  net = c;
  const leave = () => {
    stop();
    menu.network();
  };
  c.onLobby = () => {
    if (!game) menu.lobby(c, leave);
  };
  c.onStart = (setup, seed) => void startNet(c, setup, seed);
  c.onClose = (why) => {
    if (net !== c) return;
    stop();
    menu.network(why);
  };
  // рассинхрон партия чинит сама снимком мира (Game, onDesync/onSnapshot)
  c.onLeft = (name) => console.info(`${name} вышел — его бригада стоит`);
}

async function startNet(c: NetClient, setup: NetSetup, seed: number): Promise<void> {
  music.stop();
  menu.hide();
  const me = c.peers.find((p) => p.id === c.you);
  const level = await loadLevel(setup.level);
  const m = MISSIONS.find((x) => x.id === setup.level);
  const g = new Game(host, {
    level, theme: m?.theme ?? 'yard', time: m?.time, seed,
    sides: setup.sides.map((sd) => ({ brigade: sd.brigade, bot: botLevel(sd.who), count: sd.count, hp: setup.hp })),
    ammo: setup.arsenal === 'core' ? CORE_AMMO : undefined,
    scheme: { ...DEFAULT_SCHEME, turnTime: setup.turn, wind: setup.wind, riseStep: setup.sudden ? 24 : 0, crates: setup.crates ? 60 : 0 },
    net: { client: c, mine: setup.sides.flatMap((sd, i) => ((sd.who === 'host' && me?.host) || (sd.who === 'net' && me?.side === i) ? [i] : [])) },
  });
  game = g;
  g.onQuit = quit;
  g.onLoad = (sv) => void resume(sv);
  await g.start();
  (window as unknown as { gops: Game }).gops = g;
}

/** Миссия: бой, итог, ролик после победы, следующая миссия списка. */
async function play(def: MissionDef, sv?: Save): Promise<void> {
  stop();
  menu.hide();
  const level = await loadLevel(def.id);
  const g = new Game(host, {
    level, theme: def.theme, time: def.time, seed: sv?.setup.seed ?? (def.terrain.seed * 31 + Date.now()) % 100000,
    sides: [{ brigade: sv?.setup.sides[0]?.brigade ?? q.get('me') ?? 'zatulinka', bot: null, count: def.player.count, hp: def.player.hp }],
    mission: def, kind: 'mission', title: def.title, restore: sv,
  });
  game = g;
  g.onQuit = quit;
  g.onLoad = (sv) => void resume(sv);
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
    kind: 'quick',
    title: `Быстрый бой · ${m?.title ?? id}`,
    ammo: cfg?.arsenal === 'core' ? CORE_AMMO : undefined,
    scheme: cfg
      ? { ...DEFAULT_SCHEME, turnTime: cfg.turn, wind: cfg.wind, riseStep: cfg.sudden ? 24 : 0, crates: cfg.crates ? 60 : 0 }
      : undefined,
  });
  game = g;
  g.onQuit = quit;
  g.onLoad = (sv) => void resume(sv);
  await g.start();
  (window as unknown as { gops: Game }).gops = g;
}

/** Выйти из боя в меню (из миссии — к её списку). */
function quit(): void {
  if (!game) return;
  const mode = game.run?.def.mode;
  const wasNet = !!net;
  stop();
  if (mode) menu.list(mode);
  else if (wasNet) menu.network();
  else menu.title();
}

// Esc в бою — пауза и меню (☰), там же «Выйти в меню игры»
window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && game && menu.el.hidden) game.hud.togglePause();
});

// первая миссия, пока не пройдена, начинается вступительным роликом (docs/gops/LEVELS.md: s00-intro — кодом перед m01)
menu.onPlay = (def) => {
  if (def.id !== 'm01' || loadStars().m01) return void play(def);
  music.stop();
  menu.cutscene('s00-intro', () => void play(def));
};
menu.onMusic = () => music.toggle();
menu.onLoad = (sv) => void resume(sv);

/** Загрузить сохранение: миссия — со своим итогом и роликами; быстрый бой и Пустырь — как были (без таблицы дня). */
async function resume(sv: Save): Promise<void> {
  const def = sv.setup.mission ? MISSIONS.find((m) => m.id === sv.setup.mission) : undefined;
  if (def) return play(def, sv);
  stop();
  menu.hide();
  const { level, mission, ...rest } = sv.setup;
  void mission;
  const g = new Game(host, { ...rest, level: await loadLevel(level), kind: sv.kind, title: sv.title, restore: sv });
  game = g;
  g.onQuit = quit;
  g.onLoad = (s) => void resume(s);
  await g.start();
  g.hud.flash('Загружено', 1500);
  (window as unknown as { gops: Game }).gops = g;
}
menu.onQuick = (c) => void quick(c);
menu.onPustyr = (daily) => void pustyr(daily);

/** Пустырь: карта из pustyr-index.json; условия — от сида (у карты дня — от даты, одинаково у всех). */
async function pustyr(daily: boolean): Promise<void> {
  stop();
  menu.hide();
  const list: { id: string; theme: string; time: string }[] = await fetch('/gops/levels/pustyr-index.json').then((r) => r.json());
  const day = new Date().toISOString().slice(0, 10);
  let seed = daily ? [...day].reduce((h, ch) => (Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0), 0x811c9dc5) : (Date.now() * 2654435761) >>> 0;
  const rnd = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296);
  const map = list[Math.floor(rnd() * list.length)];
  const foes = 1 + Math.floor(rnd() * 3);
  const brigades = ['rastochka', 'zaton', 'pervomayka', 'chemskoy', 'leninsky'];
  const levels = ['medium', 'hard', 'medium'] as const;
  const g = new Game(host, {
    level: await loadLevel(map.id), theme: map.theme, time: map.time, seed: seed % 100000,
    kind: 'pustyr', title: daily ? `Пустырь · карта дня ${day}` : 'Пустырь',
    sides: [
      { brigade: q.get('me') ?? 'zatulinka', bot: null, count: 4, hp: 100 },
      ...Array.from({ length: foes }, (_, i) => ({ brigade: brigades[i], bot: levels[i], count: foes === 1 ? 4 : 3, hp: 100 })),
    ],
    scheme: { ...DEFAULT_SCHEME, wind: Math.round(rnd() * 10) / 10, riseStep: rnd() < 0.7 ? 24 : 0, crates: 40 + Math.floor(rnd() * 50) },
    mines: Math.floor(rnd() * 5),
    barrels: Math.floor(rnd() * 7),
  });
  game = g;
  g.onQuit = quit;
  g.onLoad = (sv) => void resume(sv);
  g.onOver = (winner) => {
    if (game !== g || !daily) return;
    // очки: победа 1000 + оставшееся здоровье ×2 + за быстроту (500 − 10 за ход)
    const w = g.world;
    const hp = w.teams[0].worms.reduce((sum, id) => sum + Math.max(0, w.worms.find((x) => x.id === id)!.hp), 0);
    const score = 1000 + hp * 2 + Math.max(0, 500 - w.teams[0].turns * 10);
    void menu.dayResult(winner === 0, score, () => {
      stop();
      menu.pustyr();
    }, () => void pustyr(true));
  };
  await g.start();
  g.hud.quietOver = daily; // у карты дня свой итог с очками
  g.hud.flash(daily ? `Карта дня · ${day}` : 'Пустырь', 2500);
  (window as unknown as { gops: Game }).gops = g;
}
menu.onNetCreate = (cfg, name) => {
  const battles = MISSIONS.filter((x) => x.mode === 'mission');
  const setup: NetSetup = {
    level: cfg.map !== 'random' ? cfg.map : battles[Math.floor(Math.random() * battles.length)].id,
    sides: cfg.sides.map((sd) => ({ brigade: sd.brigade, who: sd.who === 'human' ? 'host' : sd.who, count: sd.count })),
    arsenal: cfg.arsenal, hp: cfg.hp, turn: cfg.turn, wind: cfg.wind, sudden: cfg.sudden, crates: cfg.crates,
  };
  void connect({ t: 'create', game: 'gops', name, setup });
};
menu.onNetJoin = (code, name) => void connect({ t: 'join', game: 'gops', code, name });

/** Ранний доступ (как во дворе, src/core/release.ts): права — /api/auth/me, выход игр — /api/stats. Нет связи — пускаем,
 * как и двор. В разработке (npm run dev) не проверяем. */
async function access(): Promise<{ ok: boolean; signedIn: boolean }> {
  if (import.meta.env.DEV) return { ok: true, signedIn: true };
  const get = (url: string) =>
    fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  const [me, stats] = await Promise.all([get('/api/auth/me'), get('/api/stats')]);
  const rights: RightGrant[] = me?.user?.rights ?? [];
  const release: Release = stats?.release ?? {};
  return { ok: mayPlay(release, 'gops', rights), signedIn: !!me?.user };
}

async function main(): Promise<void> {
  const a = await access();
  if (!a.ok) return menu.locked(a.signedIn);
  const mission = q.get('mission');
  if (mission) {
    const def = MISSIONS.find((m) => m.id === mission);
    if (!def) throw new Error(`нет миссии ${mission}`);
    await play(def);
  } else if (q.get('level')) await quick();
  else if (sessionStorage.getItem('gops-logo')) menu.title();
  else {
    // заставка студии — раз за вкладку
    sessionStorage.setItem('gops-logo', '1');
    menu.cutscene('logo-anim', () => menu.title(), 'Lavochka Games');
  }
}

main().catch((e) => {
  document.body.textContent = `ГОПС не запустился: ${e}`;
  console.error(e);
});
