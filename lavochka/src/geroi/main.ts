/* Вход «Героев». Без параметров — заставка студии и меню. Для разработки: /geroi.html?a=zatulye&b=kuznya&p1=hard&p2=hard&seed=5&budget=20000&fast=1
 * (p1, p2: human|easy|medium|hard; fast — бой без показа); /geroi.html?map=1&a=zatulye&b=kuznya&seed=5 — сразу партия на карте;
 * ?map=1&gen=duel&size=m&water=lakes&guard=normal&seed=7&a=…&b=… — сразу на случайной карте, без map=1 — её настройка. */
import { type Release, mayPlay } from '../core/release';
import type { RightGrant } from '../core/rights';
import { Audio2 } from './audio';
import { Game, type Who } from './game';
import type { Save } from './save';
import { randomArmy } from './sim/army';
import { FACTIONS, type Faction } from './sim/creatures';
import { factionClasses } from './sim/heroes';
import { button, h } from './ui/common';
import { ArenaClient } from './net/client';
import type { NetClientMsg, NetServerMsg } from './net/protocol';
import { Arena } from './ui/arena';
import { AdvGame } from './ui/adv';
import { MapClient } from './net/mapclient';
import type { MapClientMsg, MapServerMsg } from './net/mapproto';
import { NetMap } from './ui/netmap';
import { ReplayClient, loadRecord } from './ui/replay';
import type { MapRecord } from './net/record';
import { type GameSpec, makeTestMap } from './sim/adv/testmap';
import { TEMPLATES, generateMap, parseGen } from './sim/adv/gen';
import type { TownFaction } from './sim/adv/town';
import { Menu, type QuickConfig } from './ui/menu';
import './ui/geroi.css';

const host = document.getElementById('geroi')!;
const q = new URLSearchParams(location.search);
const audio = new Audio2();
const menu = new Menu(host, audio);
let game: Game | null = null;
let adv: AdvGame | null = null;

function stop(): void {
  game?.destroy();
  game = null;
  adv?.destroy();
  adv = null;
}

/** Партия на карте: новая или из сохранения. */
async function startAdv(world: Save['adv'], battle?: Save['state']): Promise<void> {
  stop();
  menu.hide();
  const a = new AdvGame(host, audio, { world: world!, battle });
  adv = a;
  a.onQuit = () => {
    stop();
    menu.title();
  };
  a.onLoad = (s) => void resume(s);
  (window as unknown as { geroiMap: AdvGame }).geroiMap = a;
  await a.start();
}

function wire(g: Game): void {
  game = g;
  g.onQuit = () => {
    stop();
    menu.title();
  };
  g.onLoad = (s) => void resume(s);
  g.onRematch = () => {
    const c = menu.rematch();
    if (c) void quick(c);
    else {
      stop();
      menu.title();
    }
  };
  (window as unknown as { geroi: Game }).geroi = g;
}

async function quick(c: QuickConfig, fast = false): Promise<void> {
  stop();
  menu.hide();
  const g = new Game(host, audio, { who: c.who, setup: c.setup, fast });
  wire(g);
  await g.start();
}

async function resume(s: Save): Promise<void> {
  if (s.adv) return startAdv(s.adv, s.state);
  stop();
  menu.hide();
  const g = new Game(host, audio, { who: s.who, restore: s });
  wire(g);
  await g.start();
}

// ------------------------------------------------------------------ Арена

const arena = new Arena(menu);
let net: ArenaClient | null = null;
let netSeat: number | null = null;
/** Куда вернуться после обрыва и обновления страницы; у вкладки свой ключ игрока. */
const SESSION = 'geroi-net';

function token(): string {
  let t = sessionStorage.getItem('geroi-token');
  if (!t) {
    t = crypto.randomUUID();
    sessionStorage.setItem('geroi-token', t);
  }
  return t;
}

function leaveNet(): void {
  net?.close();
  net = null;
  netSeat = null;
  sessionStorage.removeItem(SESSION);
  stop();
}

function wireClient(c: ArenaClient, name: string): void {
  net = c;
  const remember = (code: string): void => sessionStorage.setItem(SESSION, JSON.stringify({ code, name }));
  if (c.code) remember(c.code);
  c.onJoined = remember;
  c.onLobby = (m) => {
    if (!game) arena.lobby(c, m);
  };
  c.onDraft = (m) => {
    netSeat = m.seat;
    if (!game) arena.draft(c, m);
  };
  c.onStart = (m) => {
    netSeat = m.seat;
    if (game) game.resync(c, m);
    else void startNet(c, m);
  };
  c.onResult = (m) => {
    // партия кончилась на драфте (у идущего боя свой обработчик)
    if (!game) arena.result(m.result, netSeat);
  };
  c.onClose = (why) => {
    if (net !== c) return;
    void reconnect(why);
  };
}

/** Связь пропала посреди партии: пробуем вернуться на своё место. */
async function reconnect(why: string): Promise<void> {
  const saved = sessionStorage.getItem(SESSION);
  if (!saved) {
    leaveNet();
    return arena.home(why);
  }
  const { code, name } = JSON.parse(saved) as { code: string; name: string };
  game?.showBanner('Связь пропала. Возвращаемся…');
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1000 + i * 1500));
    try {
      wireClient(await ArenaClient.open({ t: 'join', game: 'geroi', code, name, token: token() }), name);
      return;
    } catch {
      /* ещё раз */
    }
  }
  leaveNet();
  arena.home('Вернуться не вышло: связи нет или комната закрыта.');
}

async function connect(first: NetClientMsg, name: string): Promise<void> {
  leaveNet();
  try {
    const c = await ArenaClient.open(first);
    wireClient(c, name);
    if (first.t === 'queue' && !c.code) arena.searching();
  } catch (e) {
    arena.home(String((e as Error).message ?? e));
  }
}

async function startNet(c: ArenaClient, m: Extract<NetServerMsg, { t: 'start' }>): Promise<void> {
  arena.stopTimer();
  menu.hide();
  const who: [Who, Who] = [m.seat === 0 ? 'human' : 'remote', m.seat === 1 ? 'human' : 'remote'];
  const g = new Game(host, audio, { who, restore: { at: 0, title: '', state: m.state, who }, net: { client: c, seat: m.seat, names: m.names, clock: m.clock, result: m.result } });
  wire(g);
  g.onQuit = () => {
    leaveNet();
    arena.home();
  };
  await g.start();
}

arena.onQueue = (name) => void connect({ t: 'queue', game: 'geroi', name, token: token() }, name);
arena.onCreate = (name, budget) => void connect({ t: 'create', game: 'geroi', name, token: token(), budget }, name);
arena.onJoin = (name, code) => void connect({ t: 'join', game: 'geroi', code, name, token: token() }, name);
arena.onCancel = leaveNet;
arena.onLeave = () => {
  leaveNet();
  arena.home();
};
menu.onArena = () => arena.home();

// ------------------------------------------------------------------ карта по сети

const netMap = new NetMap(menu);
let mapNet: MapClient | null = null;
const MAP_SESSION = 'geroi-map';

function leaveMap(): void {
  const c = mapNet;
  mapNet = null;
  sessionStorage.removeItem(MAP_SESSION);
  c?.close();
}

function wireMap(c: MapClient, name: string): void {
  mapNet = c;
  if (c.code) sessionStorage.setItem(MAP_SESSION, JSON.stringify({ code: c.code, name }));
  c.onLobby = (m) => {
    if (!adv) netMap.lobby(c, m);
  };
  c.onDraft = (m) => {
    if (!adv) netMap.draft(c, m);
  };
  // начало партии и возврат после обрыва: мир целиком с сервера
  c.onStart = (m) => void startNetMap(c, m);
  c.onClose = (why) => {
    if (mapNet !== c) return;
    void reconnectMap(why);
  };
}

async function startNetMap(c: MapClient, m: Extract<MapServerMsg, { t: 'mstart' }>): Promise<void> {
  stop();
  menu.hide();
  const a = new AdvGame(host, audio, { world: m.world, net: { client: c, seat: m.seat, seats: m.seats, clock: m.clock, busy: m.busy, mail: m.mail } });
  adv = a;
  a.onQuit = () => {
    leaveMap();
    stop();
    menu.title();
  };
  (window as unknown as { geroiMap: AdvGame }).geroiMap = a;
  await a.start();
}

async function reconnectMap(why: string): Promise<void> {
  const saved = sessionStorage.getItem(MAP_SESSION);
  if (!saved) {
    leaveMap();
    stop();
    return netMap.home(why);
  }
  const { code, name } = JSON.parse(saved) as { code: string; name: string };
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1000 + i * 1500));
    try {
      wireMap(await MapClient.open({ t: 'join', game: 'geroi', code, name, token: token() }), name);
      return;
    } catch {
      /* ещё раз */
    }
  }
  leaveMap();
  stop();
  netMap.home('Вернуться не вышло: связи нет или комната закрыта.');
}

async function connectMap(first: MapClientMsg, name: string): Promise<void> {
  leaveMap();
  try {
    wireMap(await MapClient.open(first), name);
  } catch (e) {
    netMap.home(String((e as Error).message ?? e));
  }
}

menu.onNetMap = () => netMap.home();
netMap.onCreate = (name, gen) => void connectMap({ t: 'mcreate', game: 'geroi', name, token: token(), gen }, name);
netMap.onJoin = (name, code) => void connectMap({ t: 'join', game: 'geroi', code, name, token: token() }, name);
netMap.onReplay = (file) => void watchRecord(file);

/** Запись партии: AdvGame зрителем, шаги шлёт проигрыватель. */
async function watchRecord(file: File): Promise<void> {
  let rec: MapRecord;
  try {
    rec = await loadRecord(file);
  } catch (e) {
    return netMap.home(e instanceof SyntaxError ? 'Это не запись партии.' : String((e as Error).message ?? e));
  }
  leaveMap();
  stop();
  menu.hide();
  const r = new ReplayClient(rec);
  const { world, clock } = r.start;
  const a = new AdvGame(host, audio, { world, net: { client: r.asClient, seat: null, seats: rec.seats, clock, busy: '', replay: r } });
  adv = a;
  a.onQuit = r.onQuit = () => {
    r.close();
    stop();
    netMap.home();
  };
  await a.start();
  r.begin();
}

netMap.onLeave = () => {
  leaveMap();
  netMap.home();
};

menu.onQuick = (c) => void quick(c);
menu.onLoad = (s) => void resume(s);
menu.onMap = (spec: GameSpec) => void startAdv(makeTestMap(spec));
menu.onRandom = (spec, o) => void startAdv(generateMap(spec, o));

/** Заставка студии — раз за вкладку; браузер не дал звук — ждём щелчка. */
function splash(next: () => void): void {
  const box = h('div', 'g-splash');
  const v = h('video');
  v.src = '/gops/a/40-cutscenes/logo-anim.mp4';
  v.playsInline = true;
  const done = (): void => {
    box.remove();
    next();
  };
  v.onended = done;
  v.onerror = done;
  box.append(v, button('Пропустить', done, 'g-btn small g-skip'));
  host.append(box);
  v.play().catch(() => {
    const go = button('▶ Щёлкни', () => {
      go.remove();
      void v.play();
    }, 'g-btn g-tap');
    box.append(go);
  });
}

/** Ранний доступ — как у ГОПС: права из /api/auth/me, выход игр — /api/stats; нет связи — пускаем. В разработке не проверяем. */
async function access(): Promise<{ ok: boolean; signedIn: boolean }> {
  if (import.meta.env.DEV) return { ok: true, signedIn: true };
  const get = (url: string) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [me, stats] = await Promise.all([get('/api/auth/me'), get('/api/stats')]);
  const rights: RightGrant[] = me?.user?.rights ?? [];
  const release: Release = stats?.release ?? {};
  return { ok: mayPlay(release, 'geroi', rights), signedIn: !!me?.user };
}

const BOT_NAMES = { easy: 1, medium: 1, hard: 1 };
/** Бот из ссылки: wa=medium — первое место за Среднего. */
function botParam(key: string): { bot?: 'easy' | 'medium' | 'hard' } {
  const v = q.get(key);
  return v && v in BOT_NAMES ? { bot: v as 'easy' | 'medium' | 'hard' } : {};
}

async function main(): Promise<void> {
  const a = await access();
  if (!a.ok) return menu.locked(a.signedIn);
  const fa = q.get('a') as Faction | null;
  const gen = parseGen(q);
  if (gen && q.has('map')) {
    // ссылка на случайную карту: a, b, c, d — фракции игроков
    const def: TownFaction[] = ['zatulye', 'zatonye', 'kuznya', 'akademiya'];
    const names = ['Первый', 'Второй', 'Третий', 'Четвёртый'];
    const players = Array.from({ length: TEMPLATES[gen.template].players }, (_, i) => {
      const f = (q.get('abcd'[i]) ?? def[i]) as TownFaction;
      return { name: names[i], faction: f, hero: { cls: factionClasses(f)[i % 2].id, n: 1 + (i >> 1) }, ...botParam(`w${'abcd'[i]}`) };
    });
    return startAdv(generateMap({ seed: gen.seed, players }, gen));
  }
  if (gen) return menu.randomMap(gen);
  if (q.has('map')) {
    const f0 = (fa ?? 'zatulye') as TownFaction;
    const f1 = (q.get('b') ?? 'zatonye') as TownFaction;
    return startAdv(makeTestMap({
      seed: Number(q.get('seed') ?? 5),
      players: [
        { name: 'Первый', faction: f0, hero: { cls: factionClasses(f0)[0].id, n: 1 }, ...botParam('wa') },
        { name: 'Второй', faction: f1, hero: { cls: factionClasses(f1)[0].id, n: 2 }, ...botParam('wb') },
      ],
    }));
  }
  if (fa) {
    const fb = (q.get('b') ?? 'zatonye') as Faction;
    const seed = Number(q.get('seed') ?? Date.now() % 100000);
    const budget = Number(q.get('budget') ?? 20000);
    const cfg: QuickConfig = {
      who: [(q.get('p1') ?? 'human') as Who, (q.get('p2') ?? 'medium') as Who],
      setup: {
        seed,
        field: q.get('field') ?? FACTIONS.find((f) => f.id === fa)!.field,
        sides: [
          { hero: { cls: factionClasses(fa)[0].id, n: 1 }, army: randomArmy(fa, budget, seed + 1) },
          { hero: { cls: factionClasses(fb)[Number(q.get('c2') ?? 0)].id, n: 2 }, army: randomArmy(fb, budget, seed + 2) },
        ],
      },
    };
    menu.remember(cfg);
    return quick(cfg, q.has('fast'));
  }
  // обновили страницу посреди партии — на своё место
  const saved = sessionStorage.getItem(SESSION);
  if (saved) {
    const { code, name } = JSON.parse(saved) as { code: string; name: string };
    try {
      wireClient(await ArenaClient.open({ t: 'join', game: 'geroi', code, name, token: token() }), name);
      return;
    } catch {
      sessionStorage.removeItem(SESSION);
    }
  }
  const savedMap = sessionStorage.getItem(MAP_SESSION);
  if (savedMap) {
    const { code, name } = JSON.parse(savedMap) as { code: string; name: string };
    try {
      wireMap(await MapClient.open({ t: 'join', game: 'geroi', code, name, token: token() }), name);
      return;
    } catch {
      sessionStorage.removeItem(MAP_SESSION);
    }
  }
  if (sessionStorage.getItem('geroi-logo')) return menu.title();
  sessionStorage.setItem('geroi-logo', '1');
  splash(() => menu.title());
}

main().catch((e) => {
  document.body.textContent = `Игра не запустилась: ${e}`;
  console.error(e);
});
