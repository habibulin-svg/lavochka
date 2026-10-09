/* Сессии: локальная игра, хост P2P, хост на сервере, гость. Все сводятся к Room + RoomClient + Table. */
import { byId } from '../games/catalog';
import type { Snapshot } from './authority';
import { RoomClient } from './client';
import { p2pHost, p2pJoin, P2P_CODE_LEN, type P2PHost } from './net/p2p';
import { SERVER_CODE_LEN, wsCreate, wsJoin } from './net/ws';
import { localPair, type RoomMsg, type SeatStatus } from './protocol';
import { Room } from './room';
import { settings, store } from './settings';
import { Table, type NetMode } from './table';
import type { Options, SeatSpec } from './types';
import { closeAllModals, modal, mountScreen, removeScreen, showScreen, toast } from './ui';
import { esc, h, uid } from './util';
import type { GameModule } from './view';

const saveKey = (id: string) => 'save.' + id;

/** Комната, в которой сидит эта вкладка: после перезагрузки страницы можно вернуться. */
interface RoomMemo {
  code: string;
  ownerKey?: string;
  game: string;
}
const MEMO = 'lavochka.room';
function memo(m: RoomMemo | null) {
  try {
    if (m) sessionStorage.setItem(MEMO, JSON.stringify(m));
    else sessionStorage.removeItem(MEMO);
  } catch {
    /* ignore */
  }
}
function readMemo(): RoomMemo | null {
  try {
    return JSON.parse(sessionStorage.getItem(MEMO) || 'null');
  } catch {
    return null;
  }
}

/** Вызывается при запуске: если вкладку перезагрузили посреди сетевой партии — предложить вернуться. */
export function offerResume() {
  const m = readMemo();
  if (!m) return;
  const g = byId(m.game);
  modal(`<h2>Вернуться за стол?</h2><p>Вы были в комнате <b>${esc(m.code)}</b>${g ? ` (${esc(g.title)})` : ''}. Место за вами ещё держат — пока за вас ходит бот.</p>`, [
    { text: 'Нет', action: () => memo(null) },
    { text: 'Вернуться', primary: true, action: () => void (m.ownerKey ? rejoinOwner(m) : joinGame(m.code)) },
  ]);
}

async function rejoinOwner(m: RoomMemo) {
  closeActive();
  showLobbyLoading('server', m.code);
  try {
    const link = await wsJoin(m.code);
    const client = new RoomClient(link, { name: myName(), ownerKey: m.ownerKey });
    active = { close: () => client.leave() };
    const w = await client.waitWelcome();
    const entry = byId(w.game);
    if (!entry?.load) throw new Error('Игра не найдена.');
    const mod = (await entry.load()).default;
    attach(mod, client, 'server', m.code, true, () => void rejoinOwner(m), m.ownerKey);
  } catch (e: any) {
    memo(null);
    closeActive();
    showLobbyError(e?.message || String(e), () => nav.yard());
  }
}

export function loadSave(id: string): Snapshot | null {
  return store.get<Snapshot | null>(saveKey(id), null);
}
export function dropSave(id: string) {
  store.remove(saveKey(id));
}

/** Куда возвращаться после партии. Назначает main.ts. */
export const nav = {
  home: (_id: string) => {},
  yard: () => {},
};

interface Active {
  close(): void;
}
let active: Active | null = null;

function closeActive() {
  try {
    active?.close();
  } catch (e) {
    console.warn(e);
  }
  active = null;
}

function myName() {
  return settings.name || 'Игрок';
}

// ------------------------------------------------------------------ локально

export function startLocal(mod: GameModule, seats: SeatSpec[], options: Options, snapshot?: Snapshot) {
  closeActive();
  const def = mod.def;
  const ownerKey = uid();
  const room = new Room({
    def,
    options,
    seats,
    code: 'LOCAL',
    ownerKey,
    snapshot,
    onSnapshot: (snap) => (snap ? store.set(saveKey(def.id), snap) : dropSave(def.id)),
  });
  const [a, b] = localPair();
  room.connect(a);
  const client = new RoomClient(b, { name: myName(), ownerKey });
  active = { close: () => room.close() };
  new Table({
    mod,
    client,
    mode: 'local',
    code: null,
    owner: true,
    onLeave: () => {
      closeActive();
      nav.home(def.id);
    },
  });
  client.release();
  if (!snapshot) client.start(false);
}

// ------------------------------------------------------------------ хост

export async function hostGame(mod: GameModule, seats: SeatSpec[], options: Options) {
  closeActive();
  const def = mod.def;
  const mode: NetMode = settings.net;
  showLobbyLoading(mode);
  try {
    let client: RoomClient;
    let code: string;
    let ownerKey: string | undefined;
    if (mode === 'p2p') {
      const ownerKey = uid();
      let room: Room | null = null;
      const pending: any[] = [];
      let host: P2PHost;
      host = await p2pHost((link) => (room ? room.connect(link) : pending.push(link)));
      code = host.code;
      room = new Room({ def, options, seats, code, ownerKey });
      pending.forEach((l) => room!.connect(l));
      const [a, b] = localPair();
      room.connect(a);
      client = new RoomClient(b, { name: myName(), ownerKey });
      active = {
        close: () => {
          room!.close('Хозяин стола вышел из игры.');
          setTimeout(() => host.destroy(), 400);
        },
      };
      window.addEventListener('beforeunload', () => active && active.close(), { once: true });
    } else {
      const r = await wsCreate(def.id, options, seats);
      code = r.code;
      client = new RoomClient(r.link, { name: myName(), ownerKey: r.ownerKey });
      active = { close: () => client.leave() };
      ownerKey = r.ownerKey;
    }
    await client.waitWelcome();
    attach(mod, client, mode, code, true, ownerKey ? () => void rejoinOwner({ code, ownerKey: ownerKey!, game: def.id }) : undefined, ownerKey);
  } catch (e: any) {
    closeActive();
    showLobbyError(e?.message || String(e), () => nav.home(def.id));
  }
}

// ------------------------------------------------------------------ гость

export function codeKind(code: string): NetMode | null {
  const c = code.trim();
  if (c.length === P2P_CODE_LEN) return 'p2p';
  if (c.length === SERVER_CODE_LEN) return 'server';
  return null;
}

export async function joinGame(code: string) {
  closeActive();
  code = code.trim().toUpperCase();
  const mode = codeKind(code);
  if (!mode) return toast('Код комнаты — 5 знаков (напрямую) или 6 знаков (сервер).');
  store.set('lastCode', code);
  showLobbyLoading(mode, code);
  try {
    const link = mode === 'p2p' ? await p2pJoin(code) : await wsJoin(code);
    const client = new RoomClient(link, { name: myName() });
    active = { close: () => client.leave() };
    window.addEventListener('beforeunload', () => active && active.close(), { once: true });
    const w = await client.waitWelcome();
    const entry = byId(w.game);
    if (!entry?.load) throw new Error('У вас нет этой игры — обновите страницу.');
    const mod = (await entry.load()).default;
    attach(mod, client, mode, code, false, () => joinGame(code));
  } catch (e: any) {
    closeActive();
    showLobbyError(e?.message || String(e), () => nav.yard());
  }
}

// ------------------------------------------------------------------ лобби

function attach(mod: GameModule, client: RoomClient, mode: NetMode, code: string, owner: boolean, reconnect?: () => void, ownerKey?: string) {
  const def = mod.def;
  // P2P-хост после перезагрузки комнату не вернёт (партия жила в его вкладке), остальные — вернут
  if (!(owner && mode === 'p2p')) memo({ code, ownerKey, game: def.id });
  const back = () => {
    memo(null);
    closeActive();
    if (owner) nav.home(def.id);
    else nav.yard();
  };
  new Table({ mod, client, mode, code, owner, onLeave: back, onReconnect: reconnect });
  const lobby = buildLobby(mod, client, mode, code, owner, back);
  client.on((m) => {
    if (m.t === 'lobby') lobby.update(m.seats);
    else if (m.t === 'start') removeScreen('lobby');
    else if (m.t === 'closed' && document.querySelector('[data-screen=lobby]')) {
      removeScreen('lobby');
      modal(`<h2>Комната закрыта</h2><p>${esc(m.reason || 'Хозяин стола закрыл комнату.')}</p>`, [{ text: 'Ок', primary: true, action: back }]);
    } else if (m.t === 'info' && document.querySelector('[data-screen=lobby]')) lobby.info(m.text);
    else if (m.t === 'error' && document.querySelector('[data-screen=lobby]')) lobby.info(m.text);
  });
  client.onLost = () => {
    if (!document.querySelector('[data-screen=lobby]')) return;
    removeScreen('lobby');
    modal('<h2>Связь потеряна</h2>', reconnect ? [{ text: 'В меню', action: back }, { text: 'Ещё раз', primary: true, action: reconnect }] : [{ text: 'Ок', action: back }]);
  };
  client.release();
}

function lobbyShell(): HTMLElement {
  const el = h(`<section class="lobby-screen"><div class="sheet lobby-sheet"></div></section>`);
  mountScreen('lobby', el);
  showScreen('lobby');
  return el.querySelector('.lobby-sheet') as HTMLElement;
}

function showLobbyLoading(mode: NetMode, code?: string) {
  const s = lobbyShell();
  s.innerHTML = `<h2>${code ? 'Подключаемся…' : 'Создаём комнату…'}</h2>
    <p class="status-line">${mode === 'server' ? 'Связываемся с сервером. Бесплатный сервер иногда просыпается до минуты.' : 'Регистрируем комнату на сигнальном сервере PeerJS.'}</p>
    <div class="spinner"></div>`;
}

function showLobbyError(text: string, back: () => void) {
  const s = lobbyShell();
  s.innerHTML = `<h2>Не получилось</h2><p class="err">${esc(text)}</p><div class="row buttons"><button class="btn primary">Назад</button></div>`;
  (s.querySelector('button') as HTMLButtonElement).onclick = () => {
    removeScreen('lobby');
    back();
  };
}

function buildLobby(mod: GameModule, client: RoomClient, mode: NetMode, code: string, owner: boolean, back: () => void) {
  const def = mod.def;
  const s = lobbyShell();
  s.innerHTML = `<h2>${esc(def.title)}: комната</h2>
    <div class="code-box">
      <div class="lbl">${owner ? 'Код комнаты — скажите друзьям:' : 'Вы в комнате'}</div>
      <div class="code">${esc(code)}</div>
      <div class="row center"><button class="btn small" data-a="copy">Копировать</button>
        <span class="mode-tag">${mode === 'server' ? 'через сервер' : 'напрямую (P2P)'}</span></div>
    </div>
    <div class="status-line"></div>
    <ul class="lobby-seats"></ul>
    <div class="row buttons">
      <button class="btn" data-a="back">${owner ? 'Отмена' : 'Выйти'}</button>
      ${owner ? '<button class="btn" data-a="bots">Пустые места — ботам</button><button class="btn primary" data-a="start" disabled>Начать игру</button>' : ''}
    </div>`;
  const q = (sel: string) => s.querySelector(sel) as HTMLButtonElement;
  q('[data-a=copy]').onclick = () => navigator.clipboard?.writeText(code).then(() => toast('Код скопирован'), () => {});
  q('[data-a=back]').onclick = () => {
    removeScreen('lobby');
    closeAllModals();
    back();
  };
  if (owner) {
    q('[data-a=bots]').onclick = () => client.start(true);
    q('[data-a=start]').onclick = () => client.start(false);
  }
  const status = s.querySelector('.status-line') as HTMLElement;
  const list = s.querySelector('.lobby-seats') as HTMLElement;
  return {
    update(seats: SeatStatus[]) {
      list.innerHTML = seats
        .map((st) => {
          const look = def.seats[st.seat];
          let who: string;
          if (st.kind === 'remote') who = st.filled ? `<b>${esc(st.name)}</b> · подключился` : '<i>ждём игрока…</i>';
          else if (st.kind === 'bot') who = `${esc(st.name)} · бот (${esc(def.bot.levels[st.level] ?? '')})`;
          else who = `${esc(st.name)} · за экраном хозяина`;
          const me = client.welcome?.mySeats.includes(st.seat) ? ' <span class="you">вы</span>' : '';
          return `<li><span class="chip" style="--c:${look.color};--d:${look.dark}"></span>${who}${me}</li>`;
        })
        .join('');
      const waiting = seats.filter((x) => x.kind === 'remote' && !x.filled).length;
      status.textContent = waiting ? `Ждём игроков: ${waiting}` : owner ? 'Все на месте — можно начинать!' : 'Все на месте. Ждём, когда хозяин начнёт игру…';
      if (owner) q('[data-a=start]').disabled = waiting > 0;
    },
    info(text: string) {
      status.textContent = text;
    },
  };
}

export type { RoomMsg };
