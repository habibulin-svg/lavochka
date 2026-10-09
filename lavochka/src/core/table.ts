/* Игровой стол — общий для всех игр: поле игры, панель игроков, статус, журнал и чат. */
import { Sound } from './audio';
import type { RoomClient } from './client';
import type { RoomMsg, SeatStatus } from './protocol';
import { openRules } from './rules';
import { openSettings } from './settings-ui';
import { saveSettings, settings } from './settings';
import type { GameResult } from './types';
import { closeAllModals, modal, mountScreen, removeScreen, showScreen, toast } from './ui';
import { esc, h } from './util';
import type { GameModule, GameView, ViewCtx } from './view';

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
}

type StepMsg = Extract<RoomMsg, { t: 'step' }>;

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
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private gen = 0;
  private lastTurnKey = '';
  private started = false;
  private unsub: () => void;
  private closed = false;

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
      act: (seat, action) => o.client.act(seat, action),
      get mySeats() {
        return self.mySeats;
      },
      demo: false,
      controls: q('.game-controls'),
      name: (seat) => this.name(seat),
      speed: () => settings.speed,
      autoSingle: () => settings.autoSingle,
    };
    const self = this;
    this.view.mount(q('.table-board'), ctx);

    this.unsub = o.client.on((m) => this.onMsg(m));
    o.client.onLost = () => this.lost();
  }

  // ---------------------------------------------------------------- сообщения комнаты

  private onMsg(m: RoomMsg) {
    if (this.closed) return;
    switch (m.t) {
      case 'start':
        return this.start(m);
      case 'step':
        return this.enqueue(m);
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
    this.lastTurnKey = '';
    closeAllModals();
    (this.el.querySelector('.log') as HTMLElement).innerHTML = '';
    this.view.setView(m.view);
    this.log(this.started ? '<b>Новая партия.</b>' : '<b>Партия началась.</b>');
    this.started = true;
    this.renderPlayers();
    showScreen('table');
    this.afterIdle();
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
        this.renderPlayers();
      })
      .catch((e) => console.error(e))
      .then(() => {
        if (gen !== this.gen) return;
        if (--this.pending === 0) this.afterIdle();
      });
  }

  /** Все анимации доиграны: сообщаем комнате и включаем управление. */
  private afterIdle() {
    this.o.client.idle(this.seq);
    const interactive = this.toAct.filter((s) => this.mySeats.includes(s) && this.isOnlineMine(s));
    this.view.setTurn(this.toAct, interactive);
    this.setStatus(this.view.status ? this.view.status(this.current, this.toAct, interactive) : '');
    const key = interactive.join(',');
    if (key && key !== this.lastTurnKey && this.mySeats.length < this.seats.length) Sound.turn();
    this.lastTurnKey = key;
    if (this.result && !this.resultShown) {
      this.resultShown = true;
      Sound.win();
      setTimeout(() => this.showResult(this.result!), 500);
    }
  }

  private isOnlineMine(_seat: number) {
    return true;
  }

  // ---------------------------------------------------------------- панель

  name(seat: number): string {
    const look = this.o.mod.def.seats[seat];
    const st = this.seats.find((s) => s.seat === seat);
    return `<span class="nm" style="--c:${look?.ink ?? look?.color ?? '#333'}">${esc(st?.name || look?.name || 'Игрок')}</span>`;
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
      const off = !s.online && s.kind !== 'bot' ? ' · <b class="off">нет связи — ходит бот</b>' : '';
      const stats = this.view.playerStats && this.current ? this.view.playerStats(this.current, s.seat) : '';
      ul.appendChild(
        h(`<li class="player${active ? ' active' : ''}${win ? ' winner' : ''}">
          <span class="chip" style="--c:${look.color};--d:${look.dark}"></span>
          <span class="pinfo"><span class="pname">${esc(s.name)}${me}</span><span class="pkind">${this.kindLabel(s)}${off}</span></span>
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
    modal(
      `<div class="win-box"><div class="win-chip" style="--c:${look?.color};--d:${look?.dark}"></div>
       <h2>${r.winners.length > 1 ? 'Победители' : 'Победа!'}</h2><p><b>${names}</b> — ${esc(r.text)}.</p></div>`,
      btns
    );
  }

  private menu() {
    const net = this.o.mode !== 'local';
    modal(
      `<h2>Пауза</h2><p>${net ? 'Пока вы в меню, партия идёт дальше.' : 'Партия сохраняется автоматически — её можно продолжить позже.'}</p>`,
      [
        { text: 'Правила', action: () => void openRules(this.o.mod) },
        { text: 'Настройки', action: () => openSettings() },
        { text: 'Выйти', action: () => this.confirmLeave() },
        { text: 'Продолжить', primary: true },
      ]
    );
  }

  private confirmLeave() {
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

  destroy() {
    if (this.closed) return;
    this.closed = true;
    this.gen++;
    this.unsub();
    this.view.destroy?.();
    closeAllModals();
    removeScreen('table');
  }
}
