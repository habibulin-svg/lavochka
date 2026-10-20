/* Кто я? — отрисовка: вечерний двор, игроки кругом, над каждым кружком — стикер с персонажем (у себя — «?»).
 * В центре — листок: чей ход, вопрос и ответы. В панели — что уже известно про себя, вопросы, ответы, догадка; выбор персонажа соседу. */
import { Sound } from '../../core/audio';
import { esc, h, sleep, keepDrafts } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ANS_TEXT, SEATS } from './def';
import { CHAR, poolOf, QUESTIONS, type Ans } from './chars';
import type { Event, View } from './engine';
import './whoami.css';

class WhoView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private ring!: HTMLElement;
  private center!: HTMLElement;
  private sheet!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private interactive: number[] = [];
  private filter = '';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="wh-wrap"><div class="wh-bg"></div><div class="wh-ring"></div><div class="wh-center"></div><div class="wh-sheet" hidden></div></div>`);
    root.appendChild(this.root);
    this.ring = this.root.querySelector('.wh-ring') as HTMLElement;
    this.center = this.root.querySelector('.wh-center') as HTMLElement;
    this.sheet = this.root.querySelector('.wh-sheet') as HTMLElement;
    this.panel = h('<div class="wh-panel"></div>');
    ctx.controls.appendChild(this.panel);
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '').replace(/\s*\(бот\)/, '');
  }
  private mine(v: View) {
    return this.ctx.demo ? [] : this.ctx.mySeats.filter((x) => v.seats.includes(x));
  }
  private send(seat: number, a: unknown) {
    this.sheet.hidden = true;
    this.ctx.act(seat, a);
  }

  // ---------------------------------------------------------------- рисунок

  private draw() {
    const v = this.v;
    if (!v) return;
    const n = v.seats.length;
    const mine = this.mine(v);
    const i0 = mine.length === 1 ? Math.max(0, v.seats.indexOf(mine[0])) : 0;
    const order = v.seats.map((_, k) => v.seats[(i0 + k) % n]);
    let s = '';
    order.forEach((seat, k) => {
      const a = Math.PI / 2 + (k / n) * Math.PI * 2;
      const x = 50 + Math.cos(a) * 40;
      const y = 54 + Math.sin(a) * 34;
      const who = v.chars[seat];
      const done = v.done.includes(seat);
      const place = done ? `<span class="wh-place">${v.done.indexOf(seat) + 1} место</span>` : '';
      // стикер: чужой — с именем, свой — «?», ещё не загадан — пустой
      const note = who
        ? `<div class="wh-note${done ? ' wh-done' : ''}">${esc(who.name)}${place}</div>`
        : v.picked.includes(seat)
          ? '<div class="wh-note wh-mystery">?</div>'
          : '<div class="wh-note wh-empty">…</div>';
      const turn = (v.phase === 'ask' || v.phase === 'answer') && v.turn === seat;
      const ans = v.phase === 'answer' && v.answers[seat] ? `<span class="wh-ans wh-a-${v.answers[seat] === '?' ? 'u' : v.answers[seat]}">${ANS_TEXT[v.answers[seat]]}</span>` : '';
      const tilt = ((seat * 37) % 9) - 4;
      s += `<div class="wh-seat${turn ? ' wh-turn' : ''}${mine.includes(seat) && mine.length === 1 ? ' wh-me' : ''}" style="left:${x}%;top:${y}%;--c:${SEATS[seat].color};--t:${tilt}deg">
        ${note}<div class="wh-face">${esc(this.plain(seat)).slice(0, 1)}</div><div class="wh-name">${esc(this.plain(seat))}</div>${ans}</div>`;
    });
    this.ring.innerHTML = s;
    this.center.innerHTML = this.centerHTML(v);
  }

  private centerHTML(v: View): string {
    const nm = (x: number) => esc(this.plain(x));
    if (v.phase === 'pick') return `<div class="wh-big">Загадываем персонажей</div><div class="wh-sub">готово: ${v.picked.length} из ${v.seats.length}</div>`;
    if (v.phase === 'over') return `<div class="wh-big">Игра окончена</div>${v.done.map((x, i) => `<div class="wh-sub">${i + 1}. <b>${nm(x)}</b> — ${esc(v.chars[x]?.name ?? '')}</div>`).join('')}`;
    const last = v.log[v.log.length - 1];
    const recent = v.log
      .slice(-4)
      .map((l, i, arr) => {
        const cur = i === arr.length - 1 && v.phase === 'answer';
        const res = l.guess ? (l.right ? '<b class="wh-y">угадал!</b>' : '<b class="wh-n">нет</b>') : l.result ? `<b class="wh-${l.result === '?' ? 'u' : l.result}">${ANS_TEXT[l.result]}</b>` : cur ? '…' : '';
        return `<div class="wh-line${cur ? ' wh-cur' : ''}"><b>${nm(l.seat)}</b>: ${esc(l.text || 'вопрос голосом')} ${res}</div>`;
      })
      .join('');
    const head = v.phase === 'answer' && last ? `<div class="wh-big">${nm(v.turn)} спрашивает</div>` : `<div class="wh-big">Ход: ${nm(v.turn)}</div>`;
    return `${head}${recent}`;
  }

  // ---------------------------------------------------------------- панель

  /** Что игрок узнал о себе: ответы на свои вопросы. */
  private known(v: View, seat: number): string {
    const rows = v.log.filter((l) => l.seat === seat && (l.result || l.guess));
    if (!rows.length) return '';
    return `<div class="wh-known"><div class="wh-ask">Про ${this.mine(v).length > 1 ? esc(this.plain(seat)) : 'меня'} известно:</div>${rows
      .map((l) => `<div>${esc(l.guess ? `Я — ${l.guess}?` : l.text)} — <b class="wh-${l.guess ? (l.right ? 'y' : 'n') : l.result === '?' ? 'u' : l.result}">${l.guess ? (l.right ? 'да!' : 'нет') : ANS_TEXT[l.result!]}</b></div>`)
      .join('')}</div>`;
  }

  private renderPanel() {
    keepDrafts(this.panel, () => this.drawPanel());
  }

  private drawPanel() {
    const v = this.v;
    if (!v) return;
    this.panel.innerHTML = '';
    if (this.ctx.demo) return;
    const mine = this.mine(v);
    const can = (x: number) => this.interactive.includes(x);
    const add = (html: string) => this.panel.appendChild(h(html));

    if (v.phase === 'pick') {
      for (const x of mine.filter(can)) {
        const to = v.pickFor[x];
        add(`<div class="wh-ask">${mine.length > 1 ? esc(this.plain(x)) + ', загадайте' : 'Загадайте'} персонажа для ${esc(this.plain(to))}</div>`);
        const b = h<HTMLButtonElement>('<button class="btn primary">Выбрать из списка</button>');
        b.onclick = () => this.openList((id) => this.send(x, { type: 'pick', id }), 'Кого загадать?');
        this.panel.appendChild(b);
        if (v.free) this.panel.appendChild(this.textRow('Или впишите своего…', 'Загадать', (name) => this.send(x, { type: 'pick', name })));
      }
      return;
    }

    if (v.phase === 'answer') {
      const q = v.log[v.log.length - 1];
      const who = v.chars[v.turn];
      const rows = mine.filter((x) => can(x) && x !== v.turn);
      if (rows.length) {
        add(`<div class="wh-ask">${esc(this.plain(v.turn))} (${esc(who?.name ?? '?')}) спрашивает: «${esc(q.text || 'голосом')}»</div>`);
        for (const x of rows) {
          const row = h(`<div class="wh-vote">${mine.length > 1 ? `<span>${esc(this.plain(x))}:</span>` : ''}</div>`);
          for (const a of ['y', 'n', '?'] as Ans[]) {
            const b = h<HTMLButtonElement>(`<button class="btn wh-b-${a === '?' ? 'u' : a}">${ANS_TEXT[a]}</button>`);
            b.onclick = () => this.send(x, { type: 'answer', ans: a });
            row.appendChild(b);
          }
          this.panel.appendChild(row);
        }
      }
    }

    if (v.phase === 'ask' && mine.includes(v.turn) && can(v.turn)) {
      const me = v.turn;
      add(`<div class="wh-ask">${mine.length > 1 ? esc(this.plain(me)) + ', ваш' : 'Ваш'} ход: спросите про себя</div>`);
      const asked = new Map(v.log.filter((l) => l.seat === me && l.q != null).map((l) => [l.q!, l.result]));
      const qs = h('<div class="wh-qs"></div>');
      QUESTIONS.forEach((q, i) => {
        const r = asked.get(i);
        const b = h<HTMLButtonElement>(`<button class="btn wh-qbtn${r ? ' wh-asked' : ''}">${esc(q.q)}${r ? ` <small>(${ANS_TEXT[r]})</small>` : ''}</button>`);
        b.onclick = () => this.send(me, { type: 'ask', q: i });
        qs.appendChild(b);
      });
      this.panel.appendChild(qs);
      if (v.free) {
        const row = this.textRow('Свой вопрос…', 'Спросить', (text) => this.send(me, { type: 'ask', text }));
        const voice = h<HTMLButtonElement>('<button class="btn">Спросил голосом</button>');
        voice.onclick = () => this.send(me, { type: 'ask', text: '' });
        row.querySelector('.wh-row')!.appendChild(voice);
        this.panel.appendChild(row);
      }
      const g = h<HTMLButtonElement>('<button class="btn wh-guess">🙋 Я знаю, кто я!</button>');
      g.onclick = () =>
        this.openList((id) => {
          if (confirm(`Назвать «${CHAR[id].name}»? Не угадаете — ход перейдёт.`)) this.send(me, { type: 'guess', id });
        }, 'Кто я?');
      this.panel.appendChild(g);
      if (v.free) this.panel.appendChild(this.textRow('Или скажите сами: я — …', 'Я — он!', (name) => this.send(me, { type: 'guess', name })));
    }

    for (const x of mine) {
      const k = this.known(v, x);
      if (k) add(k);
    }
  }

  private textRow(ph: string, label: string, fn: (text: string) => void): HTMLElement {
    const el = h(`<div class="wh-own"><input type="text" maxlength="60" placeholder="${esc(ph)}"><div class="wh-row"></div></div>`);
    const inp = el.querySelector('input') as HTMLInputElement;
    const b = h<HTMLButtonElement>(`<button class="btn">${esc(label)}</button>`);
    b.onclick = () => inp.value.trim() && fn(inp.value.trim());
    inp.onkeydown = (e) => e.key === 'Enter' && b.click();
    el.querySelector('.wh-row')!.appendChild(b);
    return el;
  }

  /** Лист персонажей с поиском. Уже занятые за столом — не выбрать. */
  private openList(onPick: (id: string) => void, title: string) {
    const v = this.v;
    if (!v) return;
    const used = new Set(Object.values(v.chars).map((w) => w.id));
    const all = poolOf(v.pool)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    this.sheet.innerHTML = `<div class="wh-sheet-box"><div class="wh-sheet-head"><b>${esc(title)}</b><input type="search" placeholder="поиск" value="${esc(this.filter)}"><button class="btn wh-x">✕</button></div><div class="wh-list"></div></div>`;
    const list = this.sheet.querySelector('.wh-list') as HTMLElement;
    const fill = () => {
      const f = this.filter.toLowerCase();
      list.innerHTML = all
        .filter((c) => !f || c.name.toLowerCase().includes(f))
        .map((c) => `<button class="wh-c" data-id="${c.id}"${used.has(c.id) && v.phase === 'pick' ? ' disabled' : ''}>${esc(c.name)}</button>`)
        .join('');
    };
    fill();
    const inp = this.sheet.querySelector('input') as HTMLInputElement;
    inp.oninput = () => {
      this.filter = inp.value;
      fill();
    };
    (this.sheet.querySelector('.wh-x') as HTMLElement).onclick = () => (this.sheet.hidden = true);
    list.onclick = (e) => {
      const el = (e.target as Element).closest('[data-id]') as HTMLButtonElement | null;
      if (!el || el.disabled) return;
      this.filter = '';
      onPick(el.dataset.id!);
    };
    this.sheet.hidden = false;
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.draw();
    this.renderPanel();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'ask') Sound.chat();
      else if (ev.type === 'answer') Sound.step();
      else if (ev.type === 'result') {
        this.v = v;
        this.draw();
        if (ev.result === 'y') Sound.ui();
        await sleep(500 / speed);
      } else if (ev.type === 'guess') {
        this.v = v;
        this.draw();
        if (ev.right) Sound.win();
        else Sound.nomove();
        await sleep(700 / speed);
      }
    }
    this.v = v;
    this.draw();
    this.renderPanel();
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    if (this.v && this.v.phase !== 'pick' && this.v.phase !== 'ask') this.sheet.hidden = true;
    this.draw();
    this.renderPanel();
  }

  status(v: View, _toAct: number[], interactive: number[]) {
    const nm = (p: number) => this.ctx.name(p);
    switch (v.phase) {
      case 'pick':
        return interactive.length ? 'Загадайте персонажа соседу' : 'Загадывают персонажей…';
      case 'ask':
        return interactive.includes(v.turn) ? 'Ваш ход: спросите про себя' : `Спрашивает ${nm(v.turn)}…`;
      case 'answer':
        return interactive.length ? `Ответьте ${nm(v.turn)}` : 'Отвечают…';
      default:
        return 'Игра окончена';
    }
  }

  playerStats(v: View, seat: number) {
    return v.done.includes(seat) ? `${v.done.indexOf(seat) + 1} место` : '';
  }
}

export function createView(): GameView<View, Event> {
  return new WhoView();
}
