/* Шифровка — отрисовка: поле 5×5 карточек со словами. Капитану (за его экраном) ключ виден рамкой и подложкой цвета,
 * открытое слово накрывается плашкой своего цвета. Отгадчик нажимает на карточку: «открыть» или «пометить».
 * В панели — счёт, текущая подсказка, ввод подсказки капитану, история подсказок. Хот-сит: ключ — только после занавески. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { knownClue } from './ai';
import { SEATS } from './def';
import { clueProblem, guessers, nText, TEAM_NAME, TEAM_OF, type Event, type Kind, type View } from './engine';
import './shifrovka.css';

const kindCls = (k: Kind | null) => (k == null ? '' : k === 'n' ? 'sf-n' : k === 'x' ? 'sf-x' : `sf-t${k}`);

class ShifrovkaView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private root!: HTMLElement;
  private grid!: HTMLElement;
  private head!: HTMLElement;
  private cover!: HTMLElement;
  private panel!: HTMLElement;
  private v: View | null = null;
  private interactive: number[] = [];
  /** Хот-сит: капитан открыл ключ после занавески. */
  private open: number | null = null;
  /** Выбранная карточка (кнопки «открыть / пометить»). */
  private sel: number | null = null;
  private fresh: number | null = null;
  /** Набранная подсказка (пока капитан печатает, перерисовки её не стирают). */
  private draft = '';
  private draftN = 1;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.root = h(`<div class="sf-wrap"><div class="sf-scroll"><div class="sf-head"></div><div class="sf-grid"></div></div>
      <div class="sf-cover" hidden><div class="sf-cover-box"><div class="sf-cover-t"></div><div class="sf-cover-b"></div></div></div></div>`);
    root.appendChild(this.root);
    this.grid = this.root.querySelector('.sf-grid') as HTMLElement;
    this.head = this.root.querySelector('.sf-head') as HTMLElement;
    this.cover = this.root.querySelector('.sf-cover') as HTMLElement;
    this.panel = h('<div class="sf-panel"></div>');
    ctx.controls.appendChild(this.panel);
    this.grid.addEventListener('click', (e) => {
      const b = (e.target as Element).closest('[data-do]') as HTMLElement | null;
      if (b) {
        e.stopPropagation();
        return this.doCard(+b.dataset.i!, b.dataset.do as 'guess' | 'mark');
      }
      const el = (e.target as Element).closest('[data-i]') as HTMLElement | null;
      if (el) this.pickCard(+el.dataset.i!);
    });
  }

  // ---------------------------------------------------------------- кто за экраном

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '').replace(/\s*\(бот\)/, '');
  }
  private mine(v: View) {
    return this.ctx.demo ? [] : this.ctx.mySeats.filter((x) => v.seats.includes(x));
  }
  private hotseat(v: View) {
    return this.mine(v).length > 1;
  }
  private can(seat: number) {
    return this.interactive.includes(seat);
  }
  /** Видит ли экран ключ сейчас. */
  private showKey(v: View): boolean {
    if (v.phase === 'over') return true;
    if (this.ctx.demo) return true;
    if (!v.fullKey) return false;
    if (this.hotseat(v)) return this.open != null && v.captains.includes(this.open);
    return true;
  }
  /** Чей отгадчик за этим экраном может открывать. */
  private guesserHere(v: View): number | null {
    if (this.ctx.demo || v.phase !== 'guess') return null;
    if (this.hotseat(v) && this.open != null) return null;
    return guessers(v, v.turn).find((x) => this.mine(v).includes(x) && this.can(x)) ?? null;
  }
  private send(seat: number, a: unknown) {
    this.sel = null;
    this.ctx.act(seat, a);
  }

  private curtain(seat: number) {
    const t = this.cover.querySelector('.sf-cover-t') as HTMLElement;
    const b = this.cover.querySelector('.sf-cover-b') as HTMLElement;
    t.innerHTML = `Ключ — только капитану: ${this.ctx.name(seat)}.<br><small>Отгадчики — отвернитесь!</small>`;
    b.innerHTML = '';
    const ok = h<HTMLButtonElement>('<button class="btn primary">Я капитан, смотрю</button>');
    ok.onclick = () => {
      Sound.unlock();
      this.cover.hidden = true;
      this.open = seat;
      this.redraw();
    };
    b.appendChild(ok);
    this.cover.hidden = false;
  }

  // ---------------------------------------------------------------- рисунок

  private redraw() {
    this.draw();
    this.renderPanel();
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    const key = this.showKey(v);
    const g = this.guesserHere(v);
    let s = '';
    v.words.forEach((w, i) => {
      const k = v.key[i];
      const opened = v.opened[i] != null;
      const marks = (v.marks[i] ?? []).map((x) => `<i class="sf-mark" style="--c:${SEATS[x].color}" title="${esc(this.plain(x))}"></i>`).join('');
      const tools =
        g != null && this.sel === i && !opened
          ? `<span class="sf-tools"><button class="btn small primary" data-do="guess" data-i="${i}">Открыть</button><button class="btn small" data-do="mark" data-i="${i}">${(v.marks[i] ?? []).includes(g) ? 'Снять метку' : 'Пометить'}</button></span>`
          : '';
      s += `<div class="sf-card${opened ? ` sf-open ${kindCls(k)}` : key ? ` sf-key ${kindCls(k)}` : ''}${g != null && !opened ? ' sf-can' : ''}${this.sel === i ? ' sf-sel' : ''}${this.fresh === i ? ' sf-fresh' : ''}" data-i="${i}">
        <span class="sf-word${w.length >= 9 ? ' sf-long' : ''}">${esc(w)}</span>${opened && k === 'x' ? '<span class="sf-bomb">💣</span>' : ''}${marks ? `<span class="sf-marks">${marks}</span>` : ''}${tools}</div>`;
    });
    this.grid.innerHTML = s;
    const clue = v.clues[v.clues.length - 1];
    const live = v.phase === 'guess' && clue;
    const score = v.coop
      ? `<span class="sf-sc sf-t0">своих ${v.remain[0]}</span><span class="sf-sc sf-t1">у соперника ${v.remain[1]}</span><span class="sf-sc">ход ${v.rounds}</span>`
      : `<span class="sf-sc sf-t0">красные ${v.remain[0]}</span><span class="sf-sc sf-t1">синие ${v.remain[1]}</span>`;
    const now =
      v.phase === 'over'
        ? `<b>${v.winner == null ? 'Поражение' : v.coop ? 'Победа!' : `Победа: ${TEAM_NAME[v.winner]}`}</b> — ${esc(v.reason)}`
        : live
          ? `<span class="sf-clue sf-t${v.turn}">${esc(clue.word)} <b>${nText(clue.n)}</b></span><small>${clue.n > 0 ? `открыть можно ещё ${v.left}` : 'открывайте сколько угодно'}</small>`
          : `<span class="sf-wait">${v.coop ? 'Капитан' : `Капитан ${TEAM_OF[v.turn]}`} ${esc(this.plain(v.captains[v.turn]))} думает…</span>`;
    this.head.innerHTML = `<div class="sf-score">${score}</div><div class="sf-now">${now}</div>`;
  }

  private pickCard(i: number) {
    const v = this.v;
    if (!v || this.guesserHere(v) == null || v.opened[i] != null) return;
    this.sel = this.sel === i ? null : i;
    this.draw();
  }

  private doCard(i: number, what: 'guess' | 'mark') {
    const v = this.v;
    const g = v && this.guesserHere(v);
    if (!v || g == null) return;
    if (what === 'guess') Sound.card();
    else Sound.place();
    this.send(g, { type: what, index: i });
  }

  // ---------------------------------------------------------------- панель

  private renderPanel() {
    const v = this.v;
    const p = this.panel;
    p.innerHTML = '';
    if (!v) return;
    const add = (html: string) => p.appendChild(h(html));
    const btn = (label: string, fn: () => void, cls = 'btn') => {
      const b = h<HTMLButtonElement>(`<button class="${cls}">${label}</button>`);
      b.onclick = fn;
      p.appendChild(b);
      return b;
    };
    if (!this.ctx.demo) {
      const mine = this.mine(v);
      const cap = v.captains[v.turn];
      if (v.phase === 'clue' && mine.includes(cap) && this.can(cap)) {
        if (this.hotseat(v) && this.open !== cap) {
          add(`<div class="sf-ask">Подсказку даёт капитан ${esc(this.plain(cap))}. Передайте ему устройство.</div>`);
          btn('Показать ключ капитану', () => this.curtain(cap), 'btn primary');
        } else this.clueForm(v, cap);
      } else if (v.phase === 'guess') {
        const g = this.guesserHere(v);
        if (this.hotseat(v) && this.open != null) {
          this.open = null;
          return this.redraw();
        }
        if (g != null) {
          add('<div class="sf-ask">Нажмите на слово — «открыть» или «пометить» (пометки видят все свои).</div>');
          const c = v.clues[v.clues.length - 1];
          const stop = btn('Хватит — передать ход', () => this.send(g, { type: 'stop' }));
          stop.disabled = !c?.picks.length;
        }
      }
      if (v.phase !== 'over' && v.fullKey && !this.hotseat(v) && mine.some((x) => v.captains.includes(x))) add('<div class="sf-sub">Вы капитан: ключ виден только вам. Подсказывать можно лишь словом и числом.</div>');
    }
    // команды
    const teams = v.teams
      .map((t, j) => `<div class="sf-team sf-t${v.coop ? 0 : j}"><b>${v.coop ? 'Команда' : TEAM_NAME[j]}</b>: ${t.map((x) => `${x === v.captains[j] ? '🔐 ' : ''}${esc(this.plain(x))}`).join(', ')}</div>`)
      .join('');
    add(`<div class="sf-teams">${teams}</div>`);
    // история подсказок
    const hist = v.clues
      .slice()
      .reverse()
      .map((c) => `<div class="sf-hrow"><span class="sf-clue sf-small sf-t${c.team}">${esc(c.word)} <b>${nText(c.n)}</b></span> ${c.picks.map((i) => `<span class="sf-pick ${kindCls(v.key[i])}">${esc(v.words[i])}</span>`).join(' ')}</div>`)
      .join('');
    if (hist) add(`<div class="sf-hist">${hist}</div>`);
  }

  private clueForm(v: View, cap: number) {
    const box = h(`<div class="sf-form"><div class="sf-ask">Вы — капитан${v.coop ? '' : ` ${TEAM_OF[v.turn]}`}. Подсказка — одно слово и число:</div>
      <input class="sf-input" maxlength="24" placeholder="слово" autocomplete="off" autocapitalize="off" spellcheck="false">
      <div class="sf-nums"></div><div class="sf-err"></div><button class="btn primary sf-go">Подсказать</button></div>`);
    const inp = box.querySelector('input') as HTMLInputElement;
    const err = box.querySelector('.sf-err') as HTMLElement;
    const go = box.querySelector('.sf-go') as HTMLButtonElement;
    const nums = box.querySelector('.sf-nums') as HTMLElement;
    inp.value = this.draft;
    const check = () => {
      this.draft = inp.value;
      const w = inp.value.trim();
      const pr = w ? clueProblem(w, v.words, v.opened) : null;
      const bots = guessers(v, v.turn).some((x) => !v.humans.includes(x));
      err.textContent = pr ?? (w && bots && !knownClue(w) ? 'Ботам это слово незнакомо — они будут гадать почти вслепую.' : '');
      err.classList.toggle('sf-warn', !pr && !!err.textContent);
      go.disabled = !w || !!pr;
    };
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, -1]) {
      const b = h<HTMLButtonElement>(`<button class="sf-num${n === this.draftN ? ' sf-on' : ''}" title="${n === 0 ? 'ноль: ни одно своё не подходит' : n < 0 ? 'сколько угодно' : ''}">${nText(n)}</button>`);
      b.onclick = () => {
        this.draftN = n;
        nums.querySelectorAll('.sf-num').forEach((x) => x.classList.remove('sf-on'));
        b.classList.add('sf-on');
      };
      nums.appendChild(b);
    }
    inp.oninput = check;
    inp.onkeydown = (e) => {
      if (e.key === 'Enter' && !go.disabled) go.click();
    };
    go.onclick = () => {
      const word = inp.value.trim();
      if (!word || clueProblem(word, v.words, v.opened)) return;
      this.draft = '';
      const n = this.draftN;
      this.draftN = 1;
      if (this.hotseat(v)) this.open = null;
      Sound.chat();
      this.send(cap, { type: 'clue', word, n });
    };
    check();
    this.panel.appendChild(box);
    if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => inp.focus(), 0);
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    if (v.phase !== 'guess') this.sel = null;
    this.v = v;
    this.redraw();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    for (const ev of events) {
      switch (ev.type) {
        case 'clue':
          Sound.chat();
          break;
        case 'guess':
        case 'rival': {
          this.fresh = ev.index;
          this.v = { ...(this.v ?? v), opened: v.opened, key: v.key, remain: v.remain };
          this.draw();
          if (ev.type === 'guess' && ev.kind === 'x') Sound.capture();
          else if (ev.type === 'guess' && ev.kind === this.v.turn) Sound.place();
          else Sound.card();
          await sleep(700 / speed);
          this.fresh = null;
          break;
        }
        case 'turn':
          Sound.turn();
          break;
        case 'over':
          Sound.win();
          break;
      }
    }
    this.setView(v);
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.interactive = interactive;
    this.redraw();
  }

  status(v: View, _toAct: number[], interactive: number[]) {
    const mine = this.mine(v);
    if (v.phase === 'over') return v.winner == null ? 'Поражение' : v.coop ? 'Победа!' : `Победа: ${TEAM_NAME[v.winner]}`;
    if (v.phase === 'clue') return interactive.includes(v.captains[v.turn]) && mine.includes(v.captains[v.turn]) ? 'Дайте подсказку' : `Подсказывает ${this.ctx.name(v.captains[v.turn])}…`;
    return interactive.some((x) => mine.includes(x)) ? 'Отгадывайте' : v.coop ? 'Команда отгадывает…' : `Отгадывают ${TEAM_NAME[v.turn]}…`;
  }

  focusSeat(v: View) {
    return v.phase === 'clue' ? v.captains[v.turn] : null;
  }

  playerStats(v: View, seat: number) {
    const j = v.teams.findIndex((t) => t.includes(seat));
    if (j < 0) return '';
    return `${v.coop ? '' : TEAM_NAME[j]}${v.captains[j] === seat ? (v.coop ? 'капитан' : ', капитан') : ''}`;
  }
}

export function createView(): GameView<View, Event> {
  return new ShifrovkaView();
}
