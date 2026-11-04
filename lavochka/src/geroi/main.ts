/* Вход «Героев». Без параметров — заставка студии и меню. Для разработки: /geroi.html?a=zatulye&b=kuznya&p1=hard&p2=hard&seed=5&budget=20000&fast=1
 * (p1, p2: human|easy|medium|hard; fast — бой без показа). */
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
import { Menu, type QuickConfig } from './ui/menu';
import './ui/geroi.css';

const host = document.getElementById('geroi')!;
const q = new URLSearchParams(location.search);
const audio = new Audio2();
const menu = new Menu(host, audio);
let game: Game | null = null;

function stop(): void {
  game?.destroy();
  game = null;
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

menu.onQuick = (c) => void quick(c);
menu.onLoad = (s) => void resume(s);

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

async function main(): Promise<void> {
  const a = await access();
  if (!a.ok) return menu.locked(a.signedIn);
  const fa = q.get('a') as Faction | null;
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
  if (sessionStorage.getItem('geroi-logo')) return menu.title();
  sessionStorage.setItem('geroi-logo', '1');
  splash(() => menu.title());
}

main().catch((e) => {
  document.body.textContent = `Игра не запустилась: ${e}`;
  console.error(e);
});
