/* Игровой стол — общий для всех игр: поле игры, панель игроков, статус, журнал и чат. */
import { avatarHtml } from './avatars';
import { Sound } from './audio';
import type { RoomClient } from './client';
import type { RoomMsg, SeatStatus } from './protocol';
import { offerBlock, openRecords, type Offer } from './records-ui';
import { openRules } from './rules';
import { openSettings } from './settings-ui';
import { saveSettings, settings } from './settings';
import type { GameResult, Options } from './types';
import { closeAllModals, modal, mountScreen, removeScreen, showScreen, toast } from './ui';
import { esc, h, sleep } from './util';
import { assignLooks, type GameModule, type GameView, type ViewCtx } from './view';
import { Voice, type VoiceTile } from './voice';
import { SeatCams } from './seatcams';
import { setErrorGame } from '../site/errors';
import { mayVideo, plusNote } from '../site/plus';

export type NetMode = 'local' | 'p2p' | 'server';

export interface TableOpts {
  mod: GameModule;
  client: RoomClient;
  mode: NetMode;
  code: string | null;
  owner: boolean;
  /** Выйти из партии (сессия сама закроет комнату/соединения). */
  onLeave(): void;
  /** Переподключиться после обрыва (только для гостя). */
  onReconnect?(): void;
  /** Локальная партия: итог для таблицы рекордов (если партия одиночная и честно доиграна). */
  record?(): Offer | null;
  /** Настройки партии (для таблицы рекордов в меню). */
  options?(): Options;
}

type StepMsg = Extract<RoomMsg, { t: 'step' }>;

/** Партия доиграна у этого экрана (для истории партий игрока). */
export interface Finished {
  game: string;
  options: Options | null;
  /** Пресеты игры — чтобы назвать вариант правил. */
  presets: { id: string; options: Options }[];
  result: GameResult;
  mySeats: number[];
  seats: SeatStatus[];
  network: boolean;
  seconds: number;
}

/** Крючки для сайта (история партий): ядро стола о сайте не знает. */
export const tableHooks: { finished?: (f: Finished) => void } = {};

export class Table {
  el: HTMLElement;
  private view: GameView;
  private seats: SeatStatus[] = [];
  private mySeats: number[] = [];
  private current: unknown = null;
  private toAct: number[] = [];
  private seq = 0;
  private result: GameResult | null = null;
  private resultShown = false;
  /** Когда началась партия, которую этот экран видел с начала (вернулись к доигранной — null: в историю не пишем). */
  private liveSince: number | null = null;
  private queue: Promise<void> = Promise.resolve();
  /** Игра попросила «пропустить» — боты без пауз. */
  private fast = false;
  private pending = 0;
  private gen = 0;
  private lastTurnKey = '';
  private started = false;
  private unsub: () => void;
  closed = false;
  private voice: Voice | null = null;
  private voiceEls = new Map<string, HTMLElement>();
  /** Крупное видео главного игрока (GameView.spotlight). */
  private spotEl: HTMLElement | null = null;
  /** Камеры игроков над аватарами на поле (пати-игры). */
  private cams: SeatCams | null = null;
  /** Сторож хода: свой ход отправлен, а стол не сдвинулся — попросить комнату прислать его заново. */
  private actTimer: ReturnType<typeof setTimeout> | undefined;
  private actTries = 0;

  /** Как сидим: за этим экраном, напрямую или через сервер. */
  get netMode() {
    return this.o.mode;
  }
  get roomCode() {
    return this.o.code;
  }

  constructor(private o: TableOpts) {
    const def = o.mod.def;
    this.el = h(`<section class="table table--${def.id}">
      <div class="table-main"><div class="table-board"></div></div>
      <aside class="table-panel sheet">
        <div class="panel-top">
          <button class="icon-btn" data-act="menu" title="Меню">☰</button>
          <div class="panel-title">${esc(def.title)}</div>
          <button class="icon-btn" data-act="sound" title="Звук"></button>
        </div>
        <div class="room-badge" hidden></div>
        <div class="voice" hidden></div>
        <ul class="players"></ul>
        <div class="game-controls"></div>
        <div class="table-status">—</div>
        <div class="tabs"><button class="on" data-tab="log">Журнал</button><button data-tab="chat">Чат<span class="badge" hidden></span></button></div>
        <ol class="log"></ol>
        <div class="chat" hidden>
          <ol class="chat-list"></ol>
          <form class="chat-form"><input maxlength="300" placeholder="Сообщение…" autocomplete="off"><button class="btn small">➤</button></form>
        </div>
        <div class="speed-row"><span>Скорость</span><input type="range" min="0.5" max="3" step="0.25"></div>
      </aside>
    </section>`);
    mountScreen('table', this.el);
    setErrorGame(def.id);

    const q = <T extends HTMLElement>(s: string) => this.el.querySelector(s) as T;
    q('[data-act=menu]').onclick = () => this.menu();
    const sb = q<HTMLButtonElement>('[data-act=sound]');
    const upd = () => (sb.textContent = settings.sound ? '🔊' : '🔇');
    upd();
    sb.onclick = () => {
      settings.sound = !settings.sound;
      saveSettings();
      upd();
    };
    const sp = q<HTMLInputElement>('.speed-row input');
    sp.value = String(settings.speed);
    sp.oninput = () => {
      settings.speed = +sp.value;
      saveSettings();
    };
    // у игр реального времени анимаций нет — скорость выбирают в настройках партии
    if (o.mod.def.realtime) q('.speed-row').hidden = true;
    if (o.code && o.mode !== 'local') {
      const badge = q('.room-badge');
      badge.hidden = false;
      badge.innerHTML = `${o.mode === 'server' ? 'Сервер' : 'Комната'}: <b>${esc(o.code)}</b> <button class="btn small">Копировать</button>`;
      (badge.querySelector('button') as HTMLButtonElement).onclick = () => {
        navigator.clipboard?.writeText(o.code!).then(() => toast('Код скопирован'), () => {});
      };
    }
    this.el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => (b.onclick = () => this.tab(b.dataset.tab!)));
    if (o.mode === 'local') (q('.tabs [data-tab=chat]') as HTMLElement).hidden = true;
    q<HTMLFormElement>('.chat-form').onsubmit = (e) => {
      e.preventDefault();
      const inp = q<HTMLInputElement>('.chat-form input');
      const t = inp.value.trim();
      if (t) o.client.chat(t);
      inp.value = '';
    };

    this.view = o.mod.createView();
    const ctx: ViewCtx = {
      act: (seat, action) => {
        o.client.act(seat, action);
        this.watchAct();
      },
      get mySeats() {
        return self.mySeats;
      },
      demo: false,
      controls: q('.game-controls'),
      name: (seat) => this.name(seat),
      speed: () => settings.speed,
      autoSingle: () => settings.autoSingle,
      hurry: (on) => {
        if (on === this.fast) return;
        this.fast = on;
        if (this.pending === 0) o.client.idle(this.seq, on);
      },
      hold: (ms) => o.client.hold(ms),
      input: (seat, input) => o.client.input(seat, input),
      online: o.mode !== 'local',
      read: (ms) => this.read(ms),
      look: (seat) => (o.mod.looks?.length ? assignLooks(o.mod.looks, this.seats).get(seat) ?? null : null),
    };
    const self = this;
    this.view.mount(q('.table-board'), ctx);
    // тап по свободному месту доски — главная кнопка хода (бросок кубиков): на телефоне кнопка бывает под краем экрана
    q('.table-board').addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || t.closest('button, a, input, select, textarea, label')) return;
      const b = this.el.querySelector<HTMLButtonElement>('.game-controls [data-tap]');
      if (b && !b.disabled && !b.hidden && b.offsetParent) b.click();
    });
    // пробел — та же главная кнопка хода (бросок), как в кинь-двинь и нардах; игры со своим пробелом гасят событие сами
    window.addEventListener('keydown', this.onSpace);

    this.unsub = o.client.on((m) => this.onMsg(m));
    o.client.onLost = () => this.lost();
    if (o.mode !== 'local' && Voice.supported()) {
      this.voice = new Voice(o.client);
      this.voice.onChange = () => this.renderVoice();
      this.voice.onFail = (name) => {
        const why = this.voice?.turn
          ? 'связь не устанавливается даже через промежуточный сервер'
          : 'напрямую не соединиться (строгий NAT — мобильный интернет, роутер провайдера), а промежуточный TURN-сервер не настроен';
        this.log(`🎤 Нет связи с ${esc(name.replace(/<[^>]+>/g, ''))}: ${why}.`, 'muted');
        toast(`Голос: нет связи с ${name.replace(/<[^>]+>/g, '')}`, 4000);
      };
      this.renderVoice();
    }
  }

  // ---------------------------------------------------------------- голосовой чат

  private renderVoice() {
    const v = this.voice;
    const box = this.el.querySelector('.voice') as HTMLElement;
    if (!v || this.closed) return;
    box.hidden = false;
    this.renderSpot();
    const tiles = v.tiles();
    if (!v.joined) {
      this.voiceEls.clear();
      const who = tiles.map((t) => esc(t.name)).join(', ');
      if (box.dataset.mode !== 'out' || box.dataset.who !== who) {
        box.dataset.mode = 'out';
        box.dataset.who = who;
        // камера — по подписке «Лавочка+» (сервер проверяет сам), голос — всем
        const cam = mayVideo();
        box.innerHTML = `<div class="voice-row"><button class="btn small" data-v="join">🎤 Голос</button><button class="btn small" data-v="cam"${cam ? '' : ' title="Видео за столом — в подписке «Лавочка+»"'}>📷 С камерой${cam ? '' : ' ⭐'}</button></div>${who ? `<div class="voice-who">В разговоре: ${who}</div>` : ''}`;
        const join = (video: boolean) => {
          if (video && !mayVideo()) return plusNote('video');
          v.join(video, !!this.view.spotlight).catch((e) => toast(e?.name === 'NotAllowedError' ? 'Нет доступа к микрофону или камере' : 'Не удалось включить микрофон', 4000));
        };
        (box.querySelector('[data-v=join]') as HTMLButtonElement).onclick = () => join(false);
        (box.querySelector('[data-v=cam]') as HTMLButtonElement).onclick = () => join(true);
      }
      return;
    }
    if (box.dataset.mode !== 'in') {
      box.dataset.mode = 'in';
      box.innerHTML = `<div class="voice-tiles"></div><div class="voice-quiet" hidden></div><div class="voice-row"><button class="btn small" data-v="mic"></button><button class="btn small" data-v="camt"></button><button class="btn small" data-v="leave">Выйти</button></div>`;
      (box.querySelector('[data-v=mic]') as HTMLButtonElement).onclick = () => v.setMic(!v.micOn);
      (box.querySelector('[data-v=camt]') as HTMLButtonElement).onclick = () => v.setCam(!v.camOn);
      (box.querySelector('[data-v=leave]') as HTMLButtonElement).onclick = () => v.leave();
      this.voiceEls.clear();
    }
    (box.querySelector('[data-v=mic]') as HTMLButtonElement).textContent = v.micOn ? '🎤 Вкл' : '🔇 Выкл';
    const camBtn = box.querySelector('[data-v=camt]') as HTMLButtonElement;
    camBtn.hidden = !tiles.find((t) => t.me)?.stream?.getVideoTracks().length;
    camBtn.textContent = v.camOn ? '📷 Вкл' : '📷 Выкл';
    const q = box.querySelector('.voice-quiet') as HTMLElement;
    q.hidden = !v.quiet;
    q.textContent = v.quiet ?? '';
    const wrap = box.querySelector('.voice-tiles') as HTMLElement;
    const seen = new Set<string>();
    for (const t of tiles) {
      seen.add(t.id);
      let el = this.voiceEls.get(t.id);
      if (!el) {
        el = h(`<div class="voice-tile"><div class="voice-face"></div><span class="voice-name"></span></div>`);
        this.voiceEls.set(t.id, el);
        wrap.appendChild(el);
      }
      this.voiceTile(el, t);
    }
    for (const [id, el] of [...this.voiceEls]) {
      if (seen.has(id)) continue;
      el.remove();
      this.voiceEls.delete(id);
    }
  }

  private voiceTile(el: HTMLElement, t: VoiceTile) {
    const look = t.seat != null ? this.o.mod.def.seats[t.seat] : null;
    el.style.setProperty('--c', look?.color ?? '#888');
    el.style.setProperty('--lv', t.level.toFixed(2));
    el.classList.toggle('talk', t.level > 0.08 && !t.muted);
    el.classList.toggle('muted', t.muted);
    el.classList.toggle('me', t.me);
    el.classList.toggle('wait', t.link === 'wait');
    el.classList.toggle('fail', t.link === 'fail');
    el.title = t.link === 'wait' ? 'Соединяемся…' : t.link === 'fail' ? 'Нет связи' : '';
    (el.querySelector('.voice-name') as HTMLElement).textContent =
      (t.me ? 'вы' : t.name) + (t.muted ? ' 🔇' : '') + (t.link === 'wait' ? ' …' : t.link === 'fail' ? ' ✕' : '');
    const face = el.querySelector('.voice-face') as HTMLElement;
    // видео — только когда есть картинка; звук чужих — отдельным <audio>
    let vid = face.querySelector('video');
    if (t.video && t.stream?.getVideoTracks().length) {
      if (!vid) {
        vid = document.createElement('video');
        vid.autoplay = true;
        vid.playsInline = true;
        vid.muted = true;
        face.innerHTML = '';
        face.appendChild(vid);
      }
      if (vid.srcObject !== t.stream) {
        vid.srcObject = t.stream;
        void vid.play().catch(() => {});
      }
    } else if (vid || !face.textContent) {
      face.innerHTML = '';
      face.textContent = (t.me ? 'Я' : t.name.replace(/<[^>]+>/g, '').trim()[0] ?? '?').toUpperCase();
    }
    if (!t.me && t.stream) {
      let au = el.querySelector('audio');
      if (!au) {
        au = document.createElement('audio');
        au.autoplay = true;
        el.appendChild(au);
      }
      if (au.srcObject !== t.stream) {
        au.srcObject = t.stream;
        void au.play().catch(() => {});
      }
    }
  }

  /** Игра может потребовать тишины (ночь в мафии). */
  private applyQuiet() {
    if (!this.voice || !this.current) return;
    this.voice.setQuiet(this.view.quiet ? this.view.quiet(this.current) : null);
    this.renderSpot();
  }

  /** Камеры над аватарами: только у игр, что помечают аватары [data-cam], и когда в голосе есть видео. */
  private renderCams() {
    const v = this.voice;
    const board = this.el.querySelector('.table-board') as HTMLElement;
    if (!v || this.closed || !this.current || !board.querySelector('[data-cam]')) {
      this.cams?.destroy();
      this.cams = null;
      return;
    }
    this.cams ??= new SeatCams(board);
    const spot = this.view.spotlight ? this.view.spotlight(this.current) : null;
    this.cams.update(v.tiles(), this.view.focusSeat ? this.view.focusSeat(this.current) : null, spot);
  }

  /** Видео главного игрока крупно (крокодил: показывающий) — в [data-spot] доски или поверх неё. */
  private renderSpot() {
    this.renderCams();
    const v = this.voice;
    const seat = v && this.current && this.view.spotlight ? this.view.spotlight(this.current) : null;
    if (!v || seat == null || this.closed) {
      this.spotEl?.remove();
      this.spotEl = null;
      return;
    }
    if (!this.spotEl) {
      this.spotEl = h('<div class="voice-spot"><video autoplay playsinline muted></video><div class="voice-spot-cap"></div></div>');
      this.spotEl.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('[data-v=spotcam]');
        if (!b || !this.voice) return;
        e.stopPropagation();
        if (!mayVideo()) return plusNote('video');
        this.voice.join(true, true).catch(() => toast('Нет доступа к камере', 4000));
      });
    }
    const slot = this.el.querySelector<HTMLElement>('.table-board [data-spot]') ?? (this.el.querySelector('.table-board') as HTMLElement);
    if (this.spotEl.parentElement !== slot) slot.appendChild(this.spotEl);
    this.spotEl.classList.toggle('voice-spot-float', !slot.matches('[data-spot]'));
    const tile = v.tiles().find((t) => t.seat === seat);
    const mine = this.mySeats.includes(seat);
    const nm = esc(this.name(seat).replace(/<[^>]+>/g, ''));
    const vid = this.spotEl.querySelector('video') as HTMLVideoElement;
    const cap = this.spotEl.querySelector('.voice-spot-cap') as HTMLElement;
    const live = !!(tile?.video && tile.stream?.getVideoTracks().length);
    this.spotEl.classList.toggle('empty', !live);
    this.spotEl.classList.toggle('me', !!tile?.me);
    vid.hidden = !live;
    if (live && vid.srcObject !== tile!.stream) {
      vid.srcObject = tile!.stream;
      void vid.play().catch(() => {});
    } else if (!live && vid.srcObject) vid.srcObject = null;
    const html = live
      ? `📷 ${tile!.me ? 'вас видят все' : nm}`
      : mine
        ? v.joined
          ? 'Вас не видно: выйдите из голоса и войдите «📷 С камерой»'
          : 'Вас должны видеть! <button class="btn small" data-v="spotcam">📷 Включить камеру</button>'
        : `📷 ${nm}: камера выключена${v.joined ? '' : ' — войдите в голос, чтобы видеть'}`;
    if (cap.innerHTML !== html) cap.innerHTML = html;
  }

  private watchAct(since = Date.now()) {
    if (this.o.mode === 'local' || this.actTimer) return;
    const seq = this.seq;
    this.actTimer = setTimeout(() => {
      this.actTimer = undefined;
      if (this.closed || this.seq !== seq || this.result) return;
      // ещё доигрываются анимации — подождать (но не бесконечно: анимация могла встать)
      if (this.pending > 0 && Date.now() - since < 24000) return this.watchAct(since);
      // ход ушёл, а стол не сдвинулся — просим комнату прислать его заново (совсем мёртвую связь заметит сторож клиента)
      if (++this.actTries <= 2) {
        console.warn('Нет ответа на ход — запрашиваем стол заново');
        this.o.client.sync();
        this.watchAct(since);
      } else this.actTries = 0;
    }, 8000);
  }

  // ---------------------------------------------------------------- сообщения комнаты

  private onMsg(m: RoomMsg) {
    if (this.closed) return;
    switch (m.t) {
      case 'start':
        return this.start(m);
      case 'step':
        return this.enqueue(m);
      case 'rt':
        return this.realtime(m);
      case 'seats':
        this.seats = m.seats;
        return this.renderPlayers();
      case 'info':
        return this.log(esc(m.text), 'muted');
      case 'chat':
        return this.chatMsg(m.name, m.seat, m.text);
      case 'error':
        return toast(m.text, 4000);
      case 'closed':
        if (!this.o.client.leaving)
          modal(`<h2>Игра закончена</h2><p>${m.reason ? esc(m.reason) : 'Хозяин стола закрыл комнату.'}</p>`, [{ text: 'В меню', primary: true, action: () => this.leave() }], {
            dismiss: false,
          });
        return;
      default:
        return;
    }
  }

  private start(m: Extract<RoomMsg, { t: 'start' }>) {
    clearTimeout(this.actTimer);
    this.actTimer = undefined;
    this.actTries = 0;
    if (m.resync && this.started) {
      // тот же стол: без «новой партии» и без очистки журнала
      if (m.seq === this.seq && this.pending === 0) return this.afterIdle();
      this.log('<i>Стол обновлён.</i>', 'muted');
    }
    this.gen++;
    this.queue = Promise.resolve();
    this.pending = 0;
    this.seats = m.seats;
    this.mySeats = m.mySeats;
    this.current = m.view;
    this.toAct = m.toAct;
    this.seq = m.seq;
    this.result = m.result;
    this.resultShown = false;
    if (!m.resync) this.liveSince = m.result ? null : Date.now();
    this.lastTurnKey = '';
    if (!m.resync) {
      closeAllModals();
      (this.el.querySelector('.log') as HTMLElement).innerHTML = '';
    }
    this.view.setView(m.view);
    this.applyQuiet();
    if (!m.resync) this.log(this.started ? '<b>Новая партия.</b>' : '<b>Партия началась.</b>');
    this.started = true;
    this.renderPlayers();
    showScreen('table');
    this.afterIdle();
  }

  /** Снимок игры реального времени: сразу в поле, события — в журнал. */
  private realtime(m: Extract<RoomMsg, { t: 'rt' }>) {
    if (!this.started) return;
    this.current = m.view;
    this.view.realtime?.(m.view, m.events);
    if (!m.events.length) return;
    const d = this.o.mod.def.describe;
    if (d) for (const ev of m.events) {
      const line = d(ev, (s) => this.name(s));
      if (line) this.log(line);
    }
    this.renderPlayers();
    this.setStatus(this.view.status ? this.view.status(this.current, this.toAct, this.toAct.filter((s) => this.mySeats.includes(s))) : '');
  }

  private enqueue(m: StepMsg) {
    const gen = this.gen;
    this.pending++;
    this.view.setTurn(m.toAct, []);
    this.queue = this.queue
      .then(async () => {
        if (gen !== this.gen) return;
        await this.view.play(m.events, m.view);
        if (gen !== this.gen) return;
        const d = this.o.mod.def.describe;
        if (d) for (const ev of m.events) {
          const line = d(ev, (s) => this.name(s));
          if (line) this.log(line);
        }
        this.current = m.view;
        this.toAct = m.toAct;
        this.seq = m.seq;
        this.result = m.result;
        if (this.actTimer) {
          clearTimeout(this.actTimer);
          this.actTimer = undefined;
          this.actTries = 0;
        }
        this.renderPlayers();
        this.applyQuiet();
      })
      .catch((e) => console.error(e))
      .then(() => {
        if (gen !== this.gen) return;
        if (--this.pending === 0) this.afterIdle();
      });
  }

  /** Все анимации доиграны: сообщаем комнате и включаем управление. */
  private afterIdle() {
    this.o.client.idle(this.seq, this.fast);
    const interactive = this.toAct.filter((s) => this.mySeats.includes(s) && this.isOnlineMine(s));
    this.view.setTurn(this.toAct, interactive);
    this.setStatus(this.view.status ? this.view.status(this.current, this.toAct, interactive) : '');
    const key = interactive.join(',');
    if (key && key !== this.lastTurnKey && this.mySeats.length < this.seats.length) Sound.turn();
    this.lastTurnKey = key;
    if (this.result && !this.resultShown) {
      this.resultShown = true;
      if (this.liveSince != null) {
        const f: Finished = {
          game: this.o.mod.def.id,
          options: this.o.options?.() ?? null,
          presets: this.o.mod.def.presets ?? [],
          result: this.result,
          mySeats: [...this.mySeats],
          seats: this.seats,
          network: this.o.mode !== 'local',
          seconds: Math.round((Date.now() - this.liveSince) / 1000),
        };
        this.liveSince = null;
        try {
          tableHooks.finished?.(f);
        } catch (e) {
          console.warn(e);
        }
      }
      Sound.win();
      setTimeout(() => this.showResult(this.result!), 500);
    }
  }

  /** «Прочитай и нажми»: за экраном человек — подсказка над полем, ждём касания поля (или пробела/Enter); ход стола стоит.
   * Включили «Пропустить», началась новая партия или за экраном одни боты — просто пауза. */
  private read(ms: number): Promise<void> {
    const speed = settings.speed || 1;
    if (this.fast || this.closed || !this.mySeats.length) return sleep(ms / speed);
    const board = this.el.querySelector('.table-board') as HTMLElement;
    const gen = this.gen;
    return new Promise((done) => {
      const hint = h('<div class="read-hint">Нажмите, чтобы продолжить ▸</div>');
      board.appendChild(hint);
      const t0 = performance.now();
      let over = false;
      const finish = () => {
        if (over) return;
        over = true;
        hint.remove();
        board.removeEventListener('pointerdown', down, true);
        document.removeEventListener('keydown', key, true);
        clearInterval(poll);
        done();
      };
      // касание продолжает игру и не доходит до поля (не бросает кубик, не двигает карту)
      const eatClick = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };
      const down = (e: PointerEvent) => {
        if (performance.now() - t0 < 350) return; // случайное касание во время анимации
        e.preventDefault();
        e.stopPropagation();
        board.addEventListener('click', eatClick, { capture: true, once: true });
        setTimeout(() => board.removeEventListener('click', eatClick, true), 600);
        finish();
      };
      const key = (e: KeyboardEvent) => {
        const tg = e.target as HTMLElement;
        if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable)) return;
        if (e.code !== 'Space' && e.key !== 'Enter') return;
        e.preventDefault();
        e.stopPropagation();
        finish();
      };
      const poll = setInterval(() => {
        if (this.fast || this.closed || gen !== this.gen) finish();
      }, 200);
      board.addEventListener('pointerdown', down, true);
      document.addEventListener('keydown', key, true);
    });
  }

  private isOnlineMine(_seat: number) {
    return true;
  }

  // ---------------------------------------------------------------- панель

  name(seat: number): string {
    const look = this.o.mod.def.seats[seat];
    const st = this.seats.find((s) => s.seat === seat);
    const own = this.current && this.view.seatName ? this.view.seatName(this.current, seat) : null;
    return `<span class="nm" style="--c:${look?.ink ?? look?.color ?? '#333'}">${esc(own || st?.name || look?.name || 'Игрок')}</span>`;
  }

  private kindLabel(s: SeatStatus) {
    if (s.kind === 'bot') return 'Бот · ' + (this.o.mod.def.bot.levels[s.level] ?? '');
    if (s.kind === 'remote') return 'По сети';
    return this.o.mode === 'local' ? 'Человек' : 'Хозяин стола';
  }

  private renderPlayers() {
    const ul = this.el.querySelector('.players') as HTMLElement;
    const def = this.o.mod.def;
    ul.innerHTML = '';
    for (const s of this.seats) {
      const look = def.seats[s.seat];
      const active = this.toAct.includes(s.seat) && !this.result;
      const win = this.result?.winners.includes(s.seat);
      const me = this.mySeats.includes(s.seat) && this.mySeats.length < this.seats.length ? '<span class="you">вы</span>' : '';
      const off = !s.online && s.kind !== 'bot' ? ' · <b class="off">нет связи</b>' : '';
      const stats = this.view.playerStats && this.current ? this.view.playerStats(this.current, s.seat) : '';
      ul.appendChild(
        h(`<li class="player${active ? ' active' : ''}${win ? ' winner' : ''}">
          <span class="chip" style="--c:${look.color};--d:${look.dark}"></span>${s.avatar ? avatarHtml(s.avatar, 'p-ava') : ''}
          <span class="pinfo"><span class="pname">${esc((this.current && this.view.seatName?.(this.current, s.seat)) || s.name)}${me}</span><span class="pkind">${this.kindLabel(s)}${off}</span></span>
          <span class="pstat">${stats}</span></li>`)
      );
    }
  }

  private setStatus(html: string) {
    (this.el.querySelector('.table-status') as HTMLElement).innerHTML = html || '&nbsp;';
  }

  log(html: string, cls = '') {
    const ol = this.el.querySelector('.log') as HTMLElement;
    const li = document.createElement('li');
    li.innerHTML = html;
    if (cls) li.className = cls;
    ol.prepend(li);
    while (ol.children.length > 120) ol.lastChild!.remove();
  }

  private tab(name: string) {
    this.el.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    (this.el.querySelector('.log') as HTMLElement).hidden = name !== 'log';
    (this.el.querySelector('.chat') as HTMLElement).hidden = name !== 'chat';
    if (name === 'chat') {
      (this.el.querySelector('.tabs .badge') as HTMLElement).hidden = true;
      (this.el.querySelector('.chat-form input') as HTMLInputElement).focus();
    }
  }

  private chatMsg(name: string, seat: number | null, text: string) {
    const look = seat != null ? this.o.mod.def.seats[seat] : null;
    const ol = this.el.querySelector('.chat-list') as HTMLElement;
    ol.appendChild(h(`<li><b style="color:${look?.dark ?? 'inherit'}">${esc(name)}:</b> ${esc(text)}</li>`));
    ol.scrollTop = ol.scrollHeight;
    const chatHidden = (this.el.querySelector('.chat') as HTMLElement).hidden;
    if (chatHidden) {
      const b = this.el.querySelector('.tabs .badge') as HTMLElement;
      b.hidden = false;
      this.log(`💬 <b>${esc(name)}:</b> ${esc(text)}`, 'chatline');
    }
    Sound.chat();
  }

  // ---------------------------------------------------------------- окна

  private showResult(r: GameResult) {
    const names = r.winners.map((s) => this.name(s)).join(', ');
    const look = this.o.mod.def.seats[r.winners[0]];
    const btns = [{ text: 'В меню', action: () => this.leave() }];
    if (this.o.owner) btns.push({ text: 'Сыграть ещё', primary: true, action: () => this.o.client.restart() } as any);
    else btns.push({ text: 'Ждать реванша', primary: true } as any);
    const body = h(`<div><div class="win-box"><div class="win-chip" style="--c:${look?.color};--d:${look?.dark}"></div>
       <h2>${r.winners.length > 1 ? 'Победители' : r.winners.length ? 'Победа!' : 'Партия окончена'}</h2><p>${names ? `<b>${names}</b> — ` : ''}${esc(r.text)}.</p></div></div>`);
    const offer = this.o.record?.();
    if (offer) body.appendChild(offerBlock(offer));
    modal(body, btns, offer ? { cls: 'recs-modal' } : {});
  }

  private menu() {
    const net = this.o.mode !== 'local';
    modal(
      `<h2>Пауза</h2><p>${net ? 'Пока вы в меню, партия идёт дальше.' : 'Партия сохраняется автоматически — её можно продолжить позже.'}</p>`,
      [
        { text: 'Правила', action: () => void openRules(this.o.mod) },
        ...(this.o.mod.def.records ? [{ text: 'Рекорды', action: () => openRecords(this.o.mod.def.id, this.o.mod.def.title, this.recTable()) }] : []),
        { text: 'Настройки', action: () => openSettings() },
        { text: 'Ошибка?', action: () => this.reportBug() },
        { text: 'Выйти', action: () => this.confirmLeave() },
        { text: 'Продолжить', primary: true },
      ]
    );
  }

  /** «Сообщить об ошибке» из меню стола: приложить игру, режим, настройки партии. */
  private reportBug() {
    const def = this.o.mod.def;
    let opts = '';
    try {
      opts = JSON.stringify(this.o.options?.() ?? null).slice(0, 300);
    } catch {}
    void import('../site/support').then((s) =>
      s.openSupport({ kind: 'bug', context: { игра: `${def.title} (${def.id})`, режим: this.o.mode + (this.o.code ? ' ' + this.o.code : ''), ...(opts && opts !== 'null' ? { настройки: opts } : {}) } })
    );
  }

  /** Таблица рекордов для текущих настроек партии (если известны). */
  private recTable(): { table?: string; label?: string; columns?: Offer['columns'] } {
    const rec = this.o.mod.def.records;
    const o = this.o.options?.();
    const t = rec && o ? rec.table(o) : null;
    return { table: t?.id, label: t?.label, columns: rec?.columns };
  }

  confirmLeave() {
    if (this.o.mode === 'local' || this.result) return this.leave();
    const txt = this.o.owner && this.o.mode === 'p2p' ? 'Вы хозяин стола: если выйти, партия закончится у всех.' : 'Ваше место займёт бот. Вернуться можно по тому же коду.';
    modal(`<h2>Выйти из партии?</h2><p>${txt}</p>`, [{ text: 'Остаться' }, { text: 'Выйти', primary: true, action: () => this.leave() }]);
  }

  private lost() {
    if (this.closed) return;
    const btns = [{ text: 'В меню', action: () => this.leave() }];
    if (this.o.onReconnect)
      btns.push({
        text: 'Переподключиться',
        primary: true,
        action: () => {
          this.destroy();
          this.o.onReconnect!();
        },
      } as any);
    modal('<h2>Связь потеряна</h2><p>Место за вами сохранится — пока за вас ходит бот.</p>', btns, { dismiss: false });
  }

  leave() {
    if (this.closed) return;
    this.o.client.leaving = true;
    this.destroy();
    this.o.onLeave();
  }

  private onSpace = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || e.defaultPrevented || e.repeat) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    // главная кнопка в панели, иначе — на поле (казино и рулетка менеджера)
    const ok = (x: HTMLButtonElement | null) => !!x && !x.disabled && !x.hidden && !!x.offsetParent;
    const c = this.el.querySelector<HTMLButtonElement>('.game-controls [data-tap]');
    const b = ok(c) ? c : [...this.el.querySelectorAll<HTMLButtonElement>('.table-board [data-tap]')].find(ok);
    if (!b) return;
    // не нажимать заодно кнопку, на которой фокус
    e.preventDefault();
    b.click();
  };

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.gen++;
    clearTimeout(this.actTimer);
    this.unsub();
    this.voice?.destroy();
    this.voice = null;
    this.cams?.destroy();
    this.cams = null;
    this.view.destroy?.();
    window.removeEventListener('keydown', this.onSpace);
    closeAllModals();
    removeScreen('table');
    setErrorGame(null);
  }
}
