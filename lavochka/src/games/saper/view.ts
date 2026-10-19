/* «Сапёр» — отрисовка как в Windows: серое окно с синим заголовком, выпуклые клетки, красное табло на чёрном и рожица.
 * Левая кнопка — открыть, правая — флажок/«?», по числу — открыть соседей; на телефоне — долгое нажатие или режим 🚩. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { boardOf, claimed, nbrOf, type Action, type Board, type Event, type State } from './engine';
import './saper.css';

// семисегментные цифры табло
const SEG: Record<string, string> = {
  a: '2,1 11,1 9,3 4,3',
  b: '11.5,2 11.5,11 9.5,10 9.5,4',
  c: '11.5,12 11.5,21 9.5,19 9.5,13',
  d: '2,22 11,22 9,20 4,20',
  e: '1.5,12 3.5,13 3.5,19 1.5,21',
  f: '1.5,2 3.5,4 3.5,10 1.5,11',
  g: '2.5,11.5 4,10.5 9,10.5 10.5,11.5 9,12.5 4,12.5',
};
const DIG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g' };

function led(v: number): string {
  const n = Math.max(-99, Math.min(999, Math.round(v)));
  const t = n < 0 ? '-' + String(-n).padStart(2, '0') : String(n).padStart(3, '0');
  let out = '';
  [...t].forEach((ch, k) => {
    const on = DIG[ch] ?? '';
    for (const s of 'abcdefg') out += `<polygon transform="translate(${k * 13} 0)" points="${SEG[s]}" class="${on.includes(s) ? 'on' : ''}"/>`;
  });
  return `<svg viewBox="0 0 39 23" class="ms-led">${out}</svg>`;
}

type Face = 'smile' | 'oh' | 'cool' | 'dead';
function face(f: Face): string {
  const eyes =
    f === 'dead'
      ? '<path d="M8 8l3 3M11 8l-3 3M13 8l3 3M16 8l-3 3" stroke="#000" stroke-width="1.2"/>'
      : f === 'cool'
        ? '<path d="M5 9h14v1l-2 3h-3l-2-2-2 2H7L5 10z" fill="#000"/><path d="M4.5 9.5l2-1M19.5 9.5l-2-1" stroke="#000"/>'
        : '<rect x="8.5" y="8.5" width="2" height="2"/><rect x="13.5" y="8.5" width="2" height="2"/>';
  const mouth =
    f === 'oh' ? '<circle cx="12" cy="15.5" r="2" fill="none" stroke="#000" stroke-width="1.3"/>' : f === 'dead' ? '<path d="M8 17.5q4-4 8 0" fill="none" stroke="#000" stroke-width="1.3"/>' : '<path d="M8 14q4 4 8 0" fill="none" stroke="#000" stroke-width="1.3"/>';
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="#ff0" stroke="#000" stroke-width="1"/>${eyes}${mouth}</svg>`;
}

const FLAG = (col: string) => `<svg viewBox="0 0 16 16" class="ms-ico"><path d="M9 2v8L4 6z" fill="${col}"/><rect x="8.5" y="2" width="1.2" height="10"/><rect x="6" y="11" width="6" height="1.3"/><rect x="4" y="12.3" width="10" height="1.7"/></svg>`;

class SaperView implements GameView<State, Event> {
  private ctx!: ViewCtx<Action>;
  private root!: HTMLElement;
  private win!: HTMLElement;
  private field!: HTMLElement;
  private ledMines!: HTMLElement;
  private ledTime!: HTMLElement;
  private faceBtn!: HTMLButtonElement;
  private tools!: HTMLElement;
  private cells: HTMLElement[] = [];
  private s: State | null = null;
  private shape = '';
  private actSeat: number | null = null;
  private flagMode = false;
  private pressed: number[] = [];
  private press: { i: number; timer: number; long: boolean; id: number } | null = null;
  private timer = 0;
  private ro: ResizeObserver | null = null;

  mount(root: HTMLElement, ctx: ViewCtx<Action>) {
    this.ctx = ctx;
    this.root = root;
    const wrap = h(`<div class="ms-wrap">
      <div class="ms-win">
        <div class="ms-title"><svg viewBox="0 0 16 16" class="ms-ico mine"><use href="#ms-mine"/></svg><span>Сапёр</span><span class="ms-tb"><i>_</i><i>□</i><i>✕</i></span></div>
        <div class="ms-menu"><span><u>И</u>гра</span><span><u>С</u>правка</span></div>
        <div class="ms-frame">
          <div class="ms-head"><div class="ms-ledbox" data-l="m"></div><button class="ms-face" title="Новая игра — кнопкой «Сыграть ещё»"></button><div class="ms-ledbox" data-l="t"></div></div>
          <div class="ms-field"></div>
        </div>
      </div>
      <svg width="0" height="0" style="position:absolute"><defs><g id="ms-mine"><circle cx="8" cy="8" r="4.6"/><rect x="7.4" y="1.5" width="1.2" height="13"/><rect x="1.5" y="7.4" width="13" height="1.2"/><rect x="3.6" y="3.6" width="1.6" height="1.6"/><rect x="10.8" y="3.6" width="1.6" height="1.6"/><rect x="3.6" y="10.8" width="1.6" height="1.6"/><rect x="10.8" y="10.8" width="1.6" height="1.6"/><rect x="5.6" y="5.6" width="2" height="2" fill="#fff"/></g></defs></svg>
    </div>`);
    root.appendChild(wrap);
    this.win = wrap.querySelector('.ms-win') as HTMLElement;
    this.field = wrap.querySelector('.ms-field') as HTMLElement;
    this.ledMines = wrap.querySelector('[data-l=m]') as HTMLElement;
    this.ledTime = wrap.querySelector('[data-l=t]') as HTMLElement;
    this.faceBtn = wrap.querySelector('.ms-face') as HTMLButtonElement;
    this.faceBtn.innerHTML = face('smile');
    this.tools = h(`<div class="ms-tools"></div>`);
    if (!ctx.demo) {
      ctx.controls.appendChild(this.tools);
      const hint = h(`<div class="hint small-hint">Щелчок — открыть, правая кнопка — флажок, щелчок по числу — открыть соседей. На телефоне флажок — долгим нажатием.</div>`);
      ctx.controls.appendChild(hint);
    }
    this.field.addEventListener('contextmenu', (e) => e.preventDefault());
    this.field.addEventListener('pointerdown', (e) => this.down(e));
    this.field.addEventListener('pointerup', (e) => this.up(e));
    this.field.addEventListener('pointerleave', () => this.cancelPress());
    this.field.addEventListener('pointercancel', () => this.cancelPress());
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(root);
    this.timer = window.setInterval(() => this.tick(), 250);
  }

  destroy() {
    clearInterval(this.timer);
    this.ro?.disconnect();
  }

  // ------------------------------------------------------------ доска

  private boardIndex(s: State): number {
    if (s.cfg.mode !== 'race') return 0;
    const me = this.ctx.mySeats.find((x) => s.seats.includes(x));
    return me != null ? boardOf(s, me) : 0;
  }

  private board(): Board | null {
    const s = this.s;
    if (!s) return null;
    const b = s.boards[this.boardIndex(s)];
    return b && !b.hidden ? b : null;
  }

  private build(s: State) {
    const key = `${s.cfg.w}x${s.cfg.h}`;
    if (key === this.shape) return;
    this.shape = key;
    this.field.innerHTML = '';
    this.field.style.gridTemplateColumns = `repeat(${s.cfg.w}, var(--cs))`;
    this.cells = [];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < s.cfg.w * s.cfg.h; i++) {
      const d = document.createElement('div');
      d.className = 'c h';
      d.dataset.i = String(i);
      frag.appendChild(d);
      this.cells.push(d);
    }
    this.field.appendChild(frag);
    this.fit();
  }

  private fit() {
    const s = this.s;
    if (!s) return;
    const W = this.root.clientWidth || 600;
    const H = this.root.clientHeight || 500;
    const cs = Math.max(12, Math.min(40, Math.floor(Math.min((W - 40) / s.cfg.w, (H - 140) / s.cfg.h))));
    this.win.style.setProperty('--cs', cs + 'px');
    this.win.style.setProperty('--bw', Math.max(2, Math.round(cs / 8)) + 'px');
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    this.build(s);
    const b = this.board();
    this.win.classList.toggle('flags', s.cfg.mode === 'flags');
    if (!b) {
      this.cells.forEach((d) => (d.className = 'c h'));
      return;
    }
    const over = b.st === 'won' || b.st === 'lost';
    const last = this.actSeat != null ? s.last[this.actSeat] : -1;
    for (let i = 0; i < this.cells.length; i++) {
      const d = this.cells[i];
      let cls = 'c';
      let html = '';
      const owner = b.owner[i] ?? -1;
      if (owner >= 0) {
        cls += ' o claim';
        html = FLAG(SEATS[owner].color);
      } else if (b.open[i]) {
        if (b.mine[i]) {
          cls += ' o mine' + (i === b.boom ? ' boom' : '');
          html = '<svg viewBox="0 0 16 16" class="ms-ico"><use href="#ms-mine"/></svg>';
        } else {
          const n = b.num[i];
          cls += ' o' + (n > 0 ? ' n' + n : '');
          html = n > 0 ? String(n) : '';
        }
      } else if (over && b.mine[i] && b.mark[i] !== 1) {
        cls += ' o mine';
        html = '<svg viewBox="0 0 16 16" class="ms-ico"><use href="#ms-mine"/></svg>';
      } else if (over && b.mark[i] === 1 && b.mine.length && !b.mine[i]) {
        cls += ' o mine wrong';
        html = '<svg viewBox="0 0 16 16" class="ms-ico"><use href="#ms-mine"/><path d="M2 2l12 12M14 2L2 14" stroke="#f00" stroke-width="1.6"/></svg>';
      } else {
        cls += ' h';
        if (b.mark[i] === 1) html = FLAG('#f00');
        else if (b.mark[i] === 2) {
          cls += ' q';
          html = '?';
        }
        if (this.pressed.includes(i) && b.mark[i] !== 1) cls += ' p';
      }
      if (i === last && !over && s.cfg.mode === 'flags') cls += ' last';
      if (d.className !== cls) d.className = cls;
      if (d.innerHTML !== html) d.innerHTML = html;
    }
    this.drawHead();
  }

  private drawHead() {
    const s = this.s;
    const b = this.board();
    if (!s) return;
    let left = s.cfg.m;
    if (b) left = s.cfg.mode === 'flags' ? s.cfg.m - claimed(b) : s.cfg.m - b.mark.filter((m) => m === 1).length;
    this.ledMines.innerHTML = led(b?.st === 'won' && s.cfg.mode !== 'flags' ? 0 : left);
    let f: Face = 'smile';
    if (b?.st === 'lost') f = 'dead';
    else if (b?.st === 'won') f = s.cfg.mode === 'flags' ? 'smile' : 'cool';
    else if (this.press && !this.press.long) f = 'oh';
    this.faceBtn.innerHTML = face(f);
    this.tick();
  }

  private tick() {
    const b = this.board();
    let sec = 0;
    if (b && b.st !== 'new') sec = Math.floor(((b.t1 || Date.now()) - b.t0) / 1000);
    const html = led(Math.max(0, Math.min(999, sec)));
    if (this.ledTime.innerHTML !== html) this.ledTime.innerHTML = html;
  }

  // ------------------------------------------------------------ ввод

  private cellAt(e: PointerEvent): number {
    const t = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
    return t ? Number(t.dataset.i) : -1;
  }

  private canAct(): boolean {
    const b = this.board();
    return !!b && this.actSeat != null && b.st !== 'won' && b.st !== 'lost' && !this.s!.done;
  }

  private down(e: PointerEvent) {
    if (!this.canAct()) return;
    const i = this.cellAt(e);
    if (i < 0) return;
    Sound.unlock();
    const b = this.board()!;
    // правая кнопка — отметка сразу (как в Windows: на нажатие)
    if (e.button === 2) {
      if (!e.buttons || e.buttons === 2) this.cycleMark(i);
      else this.chordOrPress(i, true);
      return;
    }
    if (e.button === 1 || e.buttons === 3) return this.chordOrPress(i, true);
    if (e.button !== 0) return;
    const id = e.pointerId;
    this.press = {
      i,
      id,
      long: false,
      timer: window.setTimeout(() => {
        // долгое нажатие — флажок
        if (!this.press || this.press.id !== id) return;
        this.press.long = true;
        this.pressed = [];
        if (!b.open[i]) {
          this.cycleMark(i, true);
          navigator.vibrate?.(30);
        }
        this.draw();
      }, 420),
    };
    this.pressed = b.open[i] ? nbrOf(this.s!.cfg)[i].filter((j) => !b.open[j]) : [i];
    this.draw();
  }

  private chordOrPress(i: number, now: boolean) {
    const b = this.board()!;
    if (b.open[i] && now) this.chord(i);
  }

  private up(e: PointerEvent) {
    const p = this.press;
    this.cancelPress(false);
    if (!p || p.long || p.id !== e.pointerId || !this.canAct()) return this.draw();
    const i = this.cellAt(e);
    if (i !== p.i) return this.draw();
    const b = this.board()!;
    if (b.open[i]) this.chord(i);
    else if (this.flagMode) this.cycleMark(i);
    else if (b.mark[i] !== 1) this.send({ type: 'open', i });
    this.draw();
  }

  private cancelPress(redraw = true) {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
    this.pressed = [];
    if (redraw) this.draw();
  }

  private chord(i: number) {
    const s = this.s!;
    const b = this.board()!;
    if (s.cfg.mode === 'flags' || b.num[i] <= 0) return;
    const ns = nbrOf(s.cfg)[i];
    if (ns.filter((j) => b.mark[j] === 1).length !== b.num[i] || !ns.some((j) => !b.open[j] && b.mark[j] !== 1)) return;
    this.send({ type: 'chord', i });
  }

  private cycleMark(i: number, onlyFlag = false) {
    const s = this.s!;
    const b = this.board()!;
    if (s.cfg.mode === 'flags' || b.open[i]) return;
    const m = b.mark[i];
    const next = onlyFlag ? (m === 1 ? 0 : 1) : m === 0 ? 1 : m === 1 && s.cfg.marks ? 2 : 0;
    // отметка видна сразу, не дожидаясь комнаты
    b.mark[i] = next;
    Sound.step();
    this.send({ type: 'mark', i, m: next });
    this.draw();
  }

  private send(a: Action) {
    if (this.actSeat == null) return;
    this.ctx.act(this.actSeat, a);
  }

  private drawTools() {
    this.tools.innerHTML = '';
    const s = this.s;
    if (!s || s.cfg.mode === 'flags' || this.ctx.demo || this.actSeat == null || s.done) return;
    const mk = (on: boolean, label: string, fn: () => void) => {
      const b = h<HTMLButtonElement>(`<button class="btn small${on ? ' primary' : ''}">${label}</button>`);
      b.onclick = fn;
      this.tools.appendChild(b);
    };
    mk(!this.flagMode, '⛏ Открывать', () => {
      this.flagMode = false;
      this.drawTools();
    });
    mk(this.flagMode, '🚩 Флажки', () => {
      this.flagMode = true;
      this.drawTools();
    });
  }

  // ------------------------------------------------------------ GameView

  setView(s: State) {
    this.s = s;
    this.draw();
  }

  async play(events: Event[], s: State) {
    const prev = this.board();
    const mine = this.boardIndex(s);
    let sound: 'step' | 'flood' | 'boom' | 'won' | 'claim' | null = null;
    for (const ev of events) {
      if (ev.type === 'open' && ev.b === mine) sound = sound ?? (ev.cells.length > 1 ? 'flood' : 'step');
      if (ev.type === 'boom' && ev.b === mine) sound = 'boom';
      if (ev.type === 'won' && ev.b === mine) sound = 'won';
      if (ev.type === 'claim') sound = 'claim';
      if (ev.type === 'mark' && ev.b === mine && !this.ctx.mySeats.includes(ev.seat)) sound = sound ?? 'step';
    }
    this.s = s;
    this.draw();
    if (sound === 'step') Sound.step();
    else if (sound === 'flood') Sound.place();
    else if (sound === 'boom') Sound.capture();
    else if (sound === 'won') Sound.win();
    else if (sound === 'claim') Sound.home();
    if (this.ctx.demo && events.length && prev) await sleep(500 / this.ctx.speed());
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.actSeat = this.ctx.demo ? null : (interactive.find((x) => toAct.includes(x)) ?? null);
    this.drawTools();
    this.draw();
  }

  status(s: State, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    const b = s.boards[this.boardIndex(s)];
    if (s.done) return '';
    if (s.cfg.mode === 'flags') {
      const who = toAct[0];
      return `${interactive.includes(who) ? `Ваш ход: ${name(who)}` : `Ходит ${name(who)}…`} — ищите мины: найдено ${claimed(s.boards[0])} из ${s.cfg.m}`;
    }
    if (b?.st === 'lost') return 'Вы подорвались — смотрите, как доиграют остальные';
    if (b?.st === 'new') return s.cfg.start === 'noguess' ? 'Первый щелчок — поляна, дальше всё решается логикой' : 'Первый щелчок мины не найдёт';
    return s.cfg.mode === 'race' ? 'Наперегонки: кто первым разминирует своё поле' : `Осталось открыть клеток: ${b?.left ?? 0}`;
  }

  playerStats(s: State, seat: number) {
    if (s.cfg.mode === 'flags') return `<span>мин: <b>${s.score[seat]}</b></span>`;
    if (s.cfg.mode === 'race') {
      const b = s.boards[boardOf(s, seat)];
      if (!b) return '';
      if (b.st === 'lost') return '<span>💥 подорвался</span>';
      if (b.st === 'won') return '<span>😎 разминировал</span>';
      const total = s.cfg.w * s.cfg.h - s.cfg.m;
      return `<span>осталось ${b.left} · ${Math.round(((total - b.left) / total) * 100)}%</span>`;
    }
    return s.seats.length > 1 ? `<span>открыл: ${s.score[seat]}</span>` : '';
  }
}

export function createView(): GameView<State, Event> {
  return new SaperView();
}
