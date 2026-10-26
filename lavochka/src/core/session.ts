/* Сессии: локальная игра, хост P2P, хост на сервере, гость. Все сводятся к Room + RoomClient + Table. */
import { isArcade, type ArcadeModule } from './arcade';
import { AVATARS, avatarHtml } from './avatars';
import { byId } from '../games/catalog';
import type { Snapshot } from './authority';
import { RoomClient } from './client';
import { p2pHost, p2pJoin, P2P_CODE_LEN, type P2PHost } from './net/p2p';
import { SERVER_CODE_LEN, wsCreate, wsJoin } from './net/ws';
import { localPair, type RoomMsg, type SeatStatus } from './protocol';
import { offerFrom } from './records-ui';
import { Room } from './room';
import { allowedCounts, optionsEditor, optionsSummary } from './optsui';
import { saveSettings, settings, store } from './settings';
import { teamIndex } from './teams';
import { Table, type NetMode } from './table';
import type { Options, SeatKind, SeatSpec } from './types';
import { closeAllModals, modal, mountScreen, removeScreen, showScreen, toast } from './ui';
import { esc, h, uid } from './util';
import type { GameModule } from './view';
import { countPlay } from '../site/stats';

const saveKey = (id: string) => 'save.' + id;
const saveAtKey = (id: string) => 'save-at.' + id;

/** Крючки для сайта: сохранение партии изменилось (вошедшему — копия в базе). Ядро о сайте не знает. */
export const saveHooks: { changed?: (game: string, snap: Snapshot | null, at: number) => void } = {};

/** Когда сохранение этой игры менялось в последний раз (0 — неизвестно). */
export const saveAt = (id: string) => store.get<number>(saveAtKey(id), 0);

/** Записать сохранение, пришедшее из базы (без отправки обратно). */
export function putSave(id: string, snap: Snapshot | null, at: number) {
  if (snap) store.set(saveKey(id), snap);
  else store.remove(saveKey(id));
  store.set(saveAtKey(id), at);
}

function writeSave(id: string, snap: Snapshot | null) {
  const at = Date.now();
  putSave(id, snap, at);
  saveHooks.changed?.(id, snap, at);
}

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
  if (location.pathname.startsWith('/stol/')) return; // адрес стола сам вернёт за стол (resumeTable)
  const g = byId(m.game);
  modal(`<h2>Вернуться за стол?</h2><p>Вы были в комнате <b>${esc(m.code)}</b>${g ? ` (${esc(g.title)})` : ''}. Место за вами ещё держат — пока за вас ходит бот.</p>`, [
    { text: 'Нет', action: () => memo(null) },
    { text: 'Вернуться', primary: true, action: () => void (m.ownerKey ? rejoinOwner(m) : joinGame(m.code)) },
  ]);
}

/** Открыли адрес стола (/stol/<код>) — обновили страницу или пришли по ссылке: хозяин возвращается по своему ключу, остальные — по коду. */
export function resumeTable(code: string) {
  const m = readMemo();
  if (m?.code === code && m.ownerKey) void rejoinOwner(m);
  else void joinGame(code);
}

async function rejoinOwner(m: RoomMemo) {
  closeActive();
  showLobbyLoading('server', m.code);
  try {
    const link = await wsJoin(m.code);
    const client = new RoomClient(link, { ...me(m.game), ownerKey: m.ownerKey });
    active = { close: () => client.leave() };
    const w = await client.waitWelcome();
    const entry = byId(w.game);
    if (!entry?.load) throw new Error('Игра не найдена.');
    const mod = await tableModule((await entry.load()).default);
    attach(mod, client, 'server', m.code, true, () => void rejoinOwner(m), m.ownerKey);
  } catch (e: any) {
    memo(null);
    closeActive();
    showLobbyError(e?.message || String(e), () => nav.yard());
  }
}

/** Модуль для стола: у аркады — её сетевой режим (дуэль, битва), если он есть. */
async function tableModule(mod: GameModule | ArcadeModule): Promise<GameModule> {
  if (!isArcade(mod)) return mod;
  if (!mod.net) throw new Error('В эту игру по сети не играют.');
  return mod.net.load();
}

export function loadSave(id: string): Snapshot | null {
  return store.get<Snapshot | null>(saveKey(id), null);
}
export function dropSave(id: string) {
  writeSave(id, null);
}

/** Куда возвращаться после партии. Назначает main.ts. */
export const nav = {
  home: (_id: string) => {},
  yard: () => {},
  /** Вкладка села за стол: code — сетевой стол, null — партия за этим экраном (для адреса в строке браузера). */
  table: (_code: string | null, _game: string) => {},
};

let table: Table | null = null;
/** Стол, за которым сидит вкладка (для «назад» в браузере). */
export const currentTable = () => (table && !table.closed ? table : null);

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

/** Кто я за столом: имя, аватар и персонаж (его выбирают в игре со своими персонажами). */
function me(game?: string) {
  return { name: myName(), avatar: settings.avatar || null, look: game ? store.get<string>('look.' + game, '') || null : null };
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
    onSnapshot: (snap) => (mod.ownSaves ? undefined : writeSave(def.id, snap)),
  });
  const [a, b] = localPair();
  room.connect(a);
  const client = new RoomClient(b, { ...me(def.id), ownerKey });
  client.onBegin = () => countPlay(def.id, 'local');
  active = { close: () => room.close() };
  nav.table(null, def.id);
  table = new Table({
    mod,
    client,
    mode: 'local',
    code: null,
    owner: true,
    record: () => (room.auth ? offerFrom(room.auth) : null),
    options: () => room.auth?.options ?? room.options,
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
      client = new RoomClient(b, { ...me(def.id), ownerKey });
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
      client = new RoomClient(r.link, { ...me(def.id), ownerKey: r.ownerKey });
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
    const client = new RoomClient(link, me());
    active = { close: () => client.leave() };
    window.addEventListener('beforeunload', () => active && active.close(), { once: true });
    const w = await client.waitWelcome();
    const entry = byId(w.game);
    if (!entry?.load) throw new Error('У вас нет этой игры — обновите страницу.');
    const mod = await tableModule((await entry.load()).default);
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
    currentTable()?.destroy(); // ушли из лобби — стол под ним тоже убрать
    if (owner) nav.home(def.id);
    else nav.yard();
  };
  nav.table(code, def.id);
  if (owner) client.onBegin = () => countPlay(def.id, 'net');
  // гость узнал игру только сейчас — сообщить своего персонажа
  const look = store.get<string>('look.' + def.id, '');
  if (!owner && mod.looks && look) client.me({ look });
  table = new Table({ mod, client, mode, code, owner, onLeave: back, onReconnect: reconnect });
  let lobby = buildLobby(mod, client, mode, code, owner, back);
  client.on((m) => {
    // после партии хозяин вернул всех в лобби — экран лобби снова поверх стола
    if (m.t === 'lobby' && !document.querySelector('[data-screen=lobby]')) lobby = buildLobby(mod, client, mode, code, owner, back);
    if (m.t === 'lobby') lobby.update(m);
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
    <div class="lobby-rules"><span><b>Играем:</b> <span class="sum"></span></span>${owner && (def.options?.length || def.players.min < def.players.max) ? '<button class="btn small" data-a="opts">Изменить</button>' : ''}</div>
    <div class="lobby-opts" hidden>
      <div class="row count-row"><span class="lbl">Мест:</span><div class="seg count-seg"></div><small class="count-hint" hidden></small></div>
      <div class="presets seg-wrap"></div>
      <div class="opts"></div>
    </div>
    <div class="status-line"></div>
    <ul class="lobby-seats"></ul>
    ${owner ? '<div class="row lobby-host"><button class="btn small" data-a="shuffle">🎲 Рассадить случайно</button><small class="swap-hint">⇅ — поменять двух игроков местами</small></div>' : ''}
    <details class="lobby-me" open><summary>Вы за столом</summary>
      <label class="row"><span class="lbl">Имя:</span><input class="me-name" maxlength="16" placeholder="Игрок"></label>
      <div class="lobby-ava-pick" role="radiogroup" aria-label="Аватар"></div>
      ${mod.looks?.length ? '<div class="lbl">Персонаж:</div><div class="lobby-look-pick seg-wrap"></div>' : ''}
    </details>
    <div class="row buttons">
      <button class="btn" data-a="back">${owner ? 'Отмена' : 'Выйти'}</button>
      ${owner ? '<button class="btn" data-a="bots">Пустые места — ботам</button><button class="btn primary" data-a="start" disabled>Начать игру</button>' : ''}
    </div>`;
  const q = <T extends HTMLElement = HTMLButtonElement>(sel: string) => s.querySelector(sel) as T;
  q('[data-a=copy]').onclick = () => navigator.clipboard?.writeText(code).then(() => toast('Код скопирован'), () => {});
  q('[data-a=back]').onclick = () => {
    removeScreen('lobby');
    closeAllModals();
    back();
  };
  if (owner) {
    q('[data-a=bots]').onclick = () => client.start(true);
    q('[data-a=start]').onclick = () => client.start(false);
    q('[data-a=shuffle]').onclick = () => client.host({ op: 'shuffle' });
  }
  const status = q<HTMLElement>('.status-line');
  const list = q<HTMLElement>('.lobby-seats');
  let seats: SeatStatus[] = [];
  let options: Options = { ...(client.welcome?.options ?? {}) };
  let mine: number[] = client.welcome?.mySeats ?? [];
  /** Хозяин выбрал первое место для обмена. */
  let picked: number | null = null;

  // ---------- варианты и число мест (хозяин)
  const draft: Options = { ...options };
  let editor: { render(): void } | null = null;
  const sendSetup = (count: number) => client.host({ op: 'setup', options: { ...draft }, count });
  const fitCount = () => {
    const ok = allowedCounts(def, draft);
    const n = seats.length;
    return ok.includes(n) ? n : ok.find((x) => x >= n) ?? ok[ok.length - 1];
  };
  function renderCounts() {
    const seg = q<HTMLElement>('.count-seg');
    seg.replaceChildren();
    const ok = allowedCounts(def, draft);
    for (const n of ok) {
      const b = h<HTMLButtonElement>(`<button data-n="${n}" class="${n === seats.length ? 'on' : ''}">${n}</button>`);
      b.onclick = () => sendSetup(n);
      seg.appendChild(b);
    }
    q<HTMLElement>('.count-row').hidden = ok.length === 1;
    const hint = def.countsHint?.(draft);
    const hb = q<HTMLElement>('.count-hint');
    hb.textContent = hint ?? '';
    hb.hidden = !hint;
  }
  const optsBtn = s.querySelector('[data-a=opts]') as HTMLButtonElement | null;
  if (optsBtn)
    optsBtn.onclick = () => {
      const box = q<HTMLElement>('.lobby-opts');
      box.hidden = !box.hidden;
      optsBtn.textContent = box.hidden ? 'Изменить' : 'Скрыть';
      if (!box.hidden && !editor && def.options?.length) editor = optionsEditor(def, draft, q('.presets'), q('.opts'), () => sendSetup(fitCount()));
      renderCounts();
    };

  // ---------- кто я: имя, аватар, персонаж
  const nameIn = q<HTMLInputElement>('.me-name');
  nameIn.value = settings.name;
  let nameTimer = 0;
  nameIn.oninput = () => {
    clearTimeout(nameTimer);
    nameTimer = window.setTimeout(() => {
      const name = nameIn.value.trim();
      if (!name || name === settings.name) return;
      settings.name = name;
      saveSettings();
      client.me({ name });
    }, 600);
  };
  const avaBox = q<HTMLElement>('.lobby-ava-pick');
  function renderAvatars() {
    const cur = settings.avatar;
    const photo = cur.startsWith('https://') ? cur : '';
    avaBox.innerHTML = [...(photo ? [photo] : []), ...AVATARS]
      .map((a) => `<button type="button" data-ava="${esc(a)}" class="${a === cur ? 'on' : ''}" title="${a === photo ? 'Фото из профиля' : ''}">${a === photo ? avatarHtml(a, 'lobby-ava') : a}</button>`)
      .join('');
    avaBox.querySelectorAll<HTMLButtonElement>('[data-ava]').forEach(
      (b) =>
        (b.onclick = () => {
          settings.avatar = b.dataset.ava!;
          saveSettings();
          client.me({ avatar: settings.avatar });
          renderAvatars();
        })
    );
  }
  renderAvatars();
  const lookBox = s.querySelector('.lobby-look-pick') as HTMLElement | null;
  function renderLooks() {
    if (!lookBox || !mod.looks) return;
    const cur = store.get<string>('look.' + def.id, '');
    const taken = new Set(seats.filter((x) => !mine.includes(x.seat) && x.look).map((x) => x.look!));
    lookBox.innerHTML = mod.looks
      .map((l) => `<button class="preset${l.id === cur ? ' on' : ''}" data-look="${l.id}" ${taken.has(l.id) ? 'disabled title="Уже выбрал другой игрок"' : ''}>${l.img ? `<img src="${esc(l.img)}" alt="">` : ''}${esc(l.label)}</button>`)
      .join('');
    lookBox.querySelectorAll<HTMLButtonElement>('[data-look]').forEach(
      (b) =>
        (b.onclick = () => {
          store.set('look.' + def.id, b.dataset.look);
          client.me({ look: b.dataset.look! });
          renderLooks();
        })
    );
  }

  // ---------- места
  const TEAM = ['А', 'Б', 'В', 'Г', 'Д'];
  function row(st: SeatStatus, teams: number[][] | null): HTMLElement {
    const look = def.seats[st.seat];
    let who: string;
    if (st.kind === 'remote') who = st.filled ? `<b>${esc(st.name)}</b>${st.online ? '' : ' · <i>нет связи</i>'}` : '<i>ждём игрока…</i>';
    else if (st.kind === 'bot') who = `${esc(st.name)} · бот`;
    else who = `<b>${esc(st.name)}</b> · ${owner ? 'за этим экраном' : 'хозяин стола'}`;
    const me = mine.includes(st.seat) ? ' <span class="you">вы</span>' : '';
    const t = teamIndex(teams, st.seat);
    const team = t >= 0 ? `<span class="team-tag t${t}" title="Команда ${TEAM[t]}">${TEAM[t]}</span>` : '';
    const ava = st.kind === 'bot' ? '<span class="lobby-ava">🤖</span>' : st.kind === 'remote' && !st.filled ? '<span class="lobby-ava ava-none">·</span>' : avatarHtml(st.avatar, 'lobby-ava');
    const li = h(`<li class="${picked === st.seat ? 'picked' : ''}">${team}<span class="chip" style="--c:${look.color};--d:${look.dark}"></span>${ava}<span class="who">${who}${me}</span><span class="seat-ctl"></span></li>`);
    const ctl = li.querySelector('.seat-ctl') as HTMLElement;
    if (owner) {
      const kind = h<HTMLSelectElement>(
        `<select class="kind" aria-label="Кто на месте">${[
          ['remote', 'Сеть'],
          ['bot', 'Бот'],
          ['human', 'Здесь'],
        ]
          .map(([v, l]) => `<option value="${v}">${l}</option>`)
          .join('')}</select>`
      );
      kind.value = st.kind;
      kind.onchange = () => client.host({ op: 'kind', seat: st.seat, kind: kind.value as SeatKind });
      ctl.appendChild(kind);
      if (st.kind === 'bot') {
        const lvl = h<HTMLSelectElement>(`<select class="level" aria-label="Уровень бота">${def.bot.levels.map((l, i) => `<option value="${i}">${esc(l)}</option>`).join('')}</select>`);
        lvl.value = String(st.level);
        lvl.onchange = () => client.host({ op: 'kind', seat: st.seat, kind: 'bot', level: +lvl.value });
        ctl.appendChild(lvl);
      }
      if (st.kind === 'remote' && st.filled) {
        const kick = h<HTMLButtonElement>('<button class="btn small" title="Выгнать из комнаты">✕</button>');
        kick.onclick = () =>
          modal(`<h2>Выгнать ${esc(st.name)}?</h2><p>Вернуться за этот стол он уже не сможет.</p>`, [
            { text: 'Нет' },
            { text: 'Выгнать', primary: true, action: () => client.host({ op: 'kick', seat: st.seat }) },
          ]);
        ctl.appendChild(kick);
      }
      if (seats.length > 1) {
        const sw = h<HTMLButtonElement>(`<button class="btn small swap" title="Поменять местами">⇅</button>`);
        sw.onclick = () => {
          if (picked == null) picked = st.seat;
          else if (picked === st.seat) picked = null;
          else {
            client.host({ op: 'swap', a: picked, b: st.seat });
            picked = null;
          }
          render();
        };
        ctl.appendChild(sw);
      }
    } else if (st.kind === 'remote' && !st.filled) {
      const sit = h<HTMLButtonElement>('<button class="btn small">Сесть сюда</button>');
      sit.onclick = () => client.sit(st.seat);
      ctl.appendChild(sit);
    }
    return li;
  }

  function render() {
    const nums = seats.map((x) => x.seat).sort((a, b) => a - b);
    const teams = def.teams?.(options, nums) ?? null;
    list.replaceChildren(...seats.map((st) => row(st, teams)));
    q<HTMLElement>('.sum').textContent = optionsSummary(def, options) + (teams ? ` · команды ${teams.map((_, i) => TEAM[i]).join(' против ')}` : '');
    const hint = s.querySelector('.swap-hint') as HTMLElement | null;
    if (hint) hint.textContent = picked != null ? 'Теперь ⇅ у второго игрока — поменяются местами' : teams ? '⇅ — поменять местами: так вы выбираете, кто с кем в паре' : '⇅ — поменять двух игроков местами';
    const waiting = seats.filter((x) => x.kind === 'remote' && !x.filled).length;
    status.textContent = waiting
      ? `Ждём игроков: ${waiting}`
      : owner
        ? 'Все на месте — можно начинать!'
        : mine.length
          ? 'Все на месте. Ждём, когда хозяин начнёт игру…'
          : 'Вы зритель: свободных мест нет.';
    if (owner) q('[data-a=start]').disabled = waiting > 0;
    renderLooks();
  }

  return {
    update(m: Extract<RoomMsg, { t: 'lobby' }>) {
      seats = m.seats;
      mine = m.mySeats;
      const changed = JSON.stringify(m.options) !== JSON.stringify(options);
      options = { ...m.options };
      if (changed) {
        for (const k of Object.keys(draft)) delete draft[k];
        Object.assign(draft, options);
        editor?.render();
      }
      if (picked != null && !seats.some((x) => x.seat === picked)) picked = null;
      if (!q<HTMLElement>('.lobby-opts').hidden) renderCounts();
      render();
    },
    info(text: string) {
      status.textContent = text;
    },
  };
}

export type { RoomMsg };
