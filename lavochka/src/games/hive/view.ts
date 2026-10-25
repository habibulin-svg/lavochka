/* Улей — отрисовка: толстые бакелитовые шестиугольники (слоновая кость и чёрный), насекомые — цветные «гравировки»
 * (картинки public/hive/<буква>.webp), стопки видны слоями. Поля нет — вид сам подстраивается под размер улья.
 * Ход: коснуться фишки в запасе (панель справа), потом подсвеченной клетки; или фишки в улье, потом клетки.
 * Мокрица: коснуться соседней с ней фишки (своей или чужой) — подсветятся клетки, куда её можно перенести. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BUG_ACC, BUG_RU, BUGS, legal, parse, top, type Action, type Bug, type Event, type Piece, type State } from './engine';
import './hive.css';

export const IMG = (b: Bug) => `${import.meta.env.BASE_URL}hive/${b}.webp`;

const R = 1; // радиус клетки
const SQ3 = Math.sqrt(3);
const LIFT = 0.16; // подъём фишки на каждый слой стопки
const THICK = 0.17; // толщина фишки

export function xy(k: string): [number, number] {
  const [q, r] = parse(k);
  return [R * SQ3 * (q + r / 2), R * 1.5 * r];
}

function hexPts(x: number, y: number, r: number): string {
  const o: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180;
    o.push(`${(x + r * Math.cos(a)).toFixed(3)},${(y + r * Math.sin(a)).toFixed(3)}`);
  }
  return o.join(' ');
}

/** Общие градиенты и фильтры для фишек. */
export const TILE_DEFS = `
  <linearGradient id="hv-w" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#fffaf0"/><stop offset="0.55" stop-color="#efe4cc"/><stop offset="1" stop-color="#d6c6a4"/></linearGradient>
  <linearGradient id="hv-b" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#4a4744"/><stop offset="0.5" stop-color="#262422"/><stop offset="1" stop-color="#121110"/></linearGradient>
  <radialGradient id="hv-shine" cx="0.35" cy="0.25" r="0.7"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <filter id="hv-glow" x="-20%" y="-20%" width="140%" height="140%"><feMorphology in="SourceAlpha" operator="dilate" radius="0.02" result="d"/><feFlood flood-color="#cfc6b6" flood-opacity="0.55"/><feComposite in2="d" operator="in"/><feGaussianBlur stdDeviation="0.012"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

/** Одна фишка: x, y — центр клетки на полу, lvl — слой стопки (0 — на полу). */
export function tileSvg(p: Piece, x: number, y: number, lvl: number, extra = ''): string {
  const cy = y - lvl * LIFT;
  const r = 0.86;
  const white = p.o === 0;
  const side = white ? '#b8a684' : '#050505';
  const edge = white ? '#8e7c5c' : '#000';
  let o = `<g class="hv-tile${extra}">`;
  o += `<polygon points="${hexPts(x + 0.03, cy + THICK + 0.06, r)}" fill="rgba(0,0,0,0.35)" stroke="rgba(0,0,0,0.35)" stroke-width="0.14" stroke-linejoin="round" class="hv-shadow"/>`;
  o += `<polygon points="${hexPts(x, cy + THICK, r)}" fill="${side}" stroke="${side}" stroke-width="0.14" stroke-linejoin="round"/>`;
  o += `<polygon points="${hexPts(x, cy, r)}" fill="url(#hv-${white ? 'w' : 'b'})" stroke="${edge}" stroke-width="0.14" stroke-linejoin="round"/>`;
  o += `<polygon points="${hexPts(x, cy, r - 0.05)}" fill="url(#hv-shine)"/>`;
  const s = p.b === 'L' || p.b === 'Q' ? 1.06 : 1.12;
  o += `<image href="${IMG(p.b)}" x="${x - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}"${white ? '' : ' filter="url(#hv-glow)"'}/>`;
  return o + '</g>';
}

class HiveView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private hands!: HTMLElement;
  private btns!: HTMLElement;
  private s: State | null = null;
  private act: number | null = null;
  /** Выбрано: фишка из запаса или клетка в улье. */
  private bug: Bug | null = null;
  private from: string | null = null;
  private box: [number, number, number, number] | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h('<div class="hv-wrap"><svg class="hv-svg"></svg></div>');
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.hands = h('<div class="hv-hands"></div>');
    ctx.controls.appendChild(this.hands);
    this.btns = h('<div class="hv-btns"></div>');
    if (!ctx.demo) ctx.controls.appendChild(this.btns);
    this.svg.addEventListener('click', (e) => this.onClick(e));
    this.hands.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest('[data-bug]') as HTMLElement | null;
      if (el) this.pickBug(el.dataset.bug as Bug, Number(el.dataset.seat));
    });
  }

  // ---------------------------------------------------------------- что можно сделать

  private mine(): Action[] {
    return this.s && this.act != null ? legal(this.s) : [];
  }

  /** Подсвеченные клетки: куда поставить или передвинуть выбранное. */
  private targets(): Map<string, Action> {
    const out = new Map<string, Action>();
    for (const a of this.mine()) {
      if (this.bug && a.type === 'place' && a.bug === this.bug) out.set(a.at, a);
      if (this.from && a.type === 'move' && a.from === this.from) out.set(a.to, a);
    }
    // перенос мокрицей — если обычного хода туда нет
    for (const a of this.mine()) if (this.from && a.type === 'throw' && a.from === this.from && !out.has(a.to)) out.set(a.to, a);
    return out;
  }

  private movable(): Set<string> {
    const out = new Set<string>();
    for (const a of this.mine()) if (a.type === 'move' || a.type === 'throw') out.add(a.from);
    return out;
  }

  // ---------------------------------------------------------------- рисунок

  private fit(keys: string[]) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const k of keys.length ? keys : ['0,0']) {
      const [x, y] = xy(k);
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const m = 2.4;
    let w = x1 - x0 + 2 * m;
    let hh = y1 - y0 + 2 * m;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    // не крупнее, чем примерно семь клеток в ширину, — чтобы первые фишки не были огромными
    w = Math.max(w, 9);
    hh = Math.max(hh, 7);
    // пропорции рамки — под окно
    const r = this.svg.getBoundingClientRect();
    const ar = r.width > 0 && r.height > 0 ? r.width / r.height : 1.3;
    if (w / hh < ar) w = hh * ar;
    else hh = w / ar;
    this.box = [cx - w / 2, cy - hh / 2, w, hh];
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const tg = this.targets();
    const mv = this.movable();
    this.fit([...Object.keys(s.cells), ...tg.keys()]);
    const [bx, by, bw, bh] = this.box!;
    this.svg.setAttribute('viewBox', `${bx.toFixed(2)} ${by.toFixed(2)} ${bw.toFixed(2)} ${bh.toFixed(2)}`);
    let o = `<defs>${TILE_DEFS}<radialGradient id="hv-felt" cx="0.5" cy="0.45" r="0.75"><stop offset="0" stop-color="#3f6a4a"/><stop offset="0.6" stop-color="#2a4b33"/><stop offset="1" stop-color="#1a2f20"/></radialGradient></defs>`;
    o += `<rect x="${bx - 1}" y="${by - 1}" width="${bw + 2}" height="${bh + 2}" fill="url(#hv-felt)"/>`;
    // фишки — сверху вниз по экрану, чтобы нижние ряды перекрывали верхние
    const keys = Object.keys(s.cells).sort((a, b) => xy(a)[1] - xy(b)[1] || xy(a)[0] - xy(b)[0]);
    const last = s.last;
    for (const k of keys) {
      const [x, y] = xy(k);
      const st = s.cells[k];
      st.forEach((p, i) => {
        const topmost = i === st.length - 1;
        let cls = '';
        if (topmost && this.from === k) cls += ' sel';
        else if (topmost && mv.has(k) && !this.bug && !this.from) cls += ' can';
        if (topmost && s.trapped.includes(k)) cls += ' trapped';
        o += `<g data-k="${k}">${tileSvg(p, x, y, i, cls)}</g>`;
      });
      if (last && last.to === k) o += `<polygon points="${hexPts(x, y - (st.length - 1) * LIFT, 0.86)}" class="hv-last"/>`;
      if (st.length > 1) o += `<text x="${x + 0.62}" y="${y - (st.length - 1) * LIFT - 0.5}" class="hv-n">${st.length}</text>`;
    }
    if (last?.from && !s.cells[last.from]) {
      const [x, y] = xy(last.from);
      o += `<polygon points="${hexPts(x, y, 0.8)}" class="hv-was"/>`;
    }
    for (const [k] of tg) {
      const [x, y] = xy(k);
      const lvl = s.cells[k]?.length ?? 0;
      o += `<polygon points="${hexPts(x, y - lvl * LIFT, 0.8)}" class="hv-tgt" data-k="${k}"/>`;
    }
    this.svg.innerHTML = o;
    this.drawHands();
  }

  private drawHands() {
    const s = this.s!;
    let o = '';
    for (const seat of [1, 0]) {
      const hand = s.hand[seat];
      let row = '';
      for (const b of BUGS) {
        if (!hand[b] && !(b === 'M' ? s.cfg.M : b === 'L' ? s.cfg.L : b === 'P' ? s.cfg.P : true)) continue;
        const can = this.act === seat && this.mine().some((a) => a.type === 'place' && a.bug === b);
        const n = hand[b];
        row += `<button class="hv-hb${can ? ' can' : ''}${this.bug === b && this.act === seat ? ' sel' : ''}${n ? '' : ' none'}" data-bug="${b}" data-seat="${seat}" title="${BUG_RU[b]}"${can ? '' : ' tabindex="-1"'}>
          <svg viewBox="-1.05 -1.05 2.1 2.35">${tileSvg({ o: seat, b }, 0, 0, 0)}</svg>${n > 1 ? `<i>×${n}</i>` : ''}</button>`;
      }
      o += `<div class="hv-hand"><div class="hv-who">${this.ctx.name(seat)}${s.turn === seat && !s.over ? ' — ходит' : ''}</div><div class="hv-row">${row}</div></div>`;
    }
    // градиенты — общие с доской (те же id), но доска может быть ещё не нарисована
    this.hands.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs>${TILE_DEFS}</defs></svg>${o}`;
  }

  // ---------------------------------------------------------------- ввод

  private pickBug(b: Bug, seat: number) {
    if (this.act == null || seat !== this.act) return;
    if (!this.mine().some((a) => a.type === 'place' && a.bug === b)) return Sound.nomove();
    this.bug = this.bug === b ? null : b;
    this.from = null;
    Sound.ui();
    this.draw();
    this.renderButtons();
  }

  private cellAt(e: MouseEvent): string | null {
    const el = (e.target as Element).closest('[data-k]');
    if (el) return el.getAttribute('data-k');
    return null;
  }

  private onClick(e: MouseEvent) {
    const s = this.s;
    if (!s || this.act == null) return;
    const k = this.cellAt(e);
    if (!k) return this.reset();
    const tg = this.targets();
    const a = tg.get(k);
    if (a) return this.send(a);
    if (this.movable().has(k) && this.from !== k) {
      this.from = k;
      this.bug = null;
      Sound.ui();
      this.draw();
      this.renderButtons();
      return;
    }
    if (top(s, k)) Sound.nomove();
    this.reset();
  }

  private reset() {
    this.from = null;
    this.bug = null;
    this.draw();
    this.renderButtons();
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const s = this.s;
    if (!s || this.act == null) return;
    const ms = this.mine();
    if (ms.length === 1 && ms[0].type === 'pass') {
      this.btns.appendChild(h('<div class="hv-ask">Ходов нет — пропуск.</div>'));
      const b = h<HTMLButtonElement>('<button class="btn primary">Пропустить ход</button>');
      b.onclick = () => this.send(ms[0]);
      this.btns.appendChild(b);
      return;
    }
    const me = this.act;
    let tip: string;
    if (this.bug) tip = `Коснитесь подсвеченной клетки — поставить ${BUG_ACC[this.bug]}.`;
    else if (this.from) tip = 'Коснитесь подсвеченной клетки — куда пойти.';
    else if (s.hand[me].Q && s.placed[me] === 3) tip = 'Четвёртый ход — пора ставить <b>пчелу</b>.';
    else if (s.hand[me].Q) tip = 'Выберите фишку в запасе. Ходить можно, когда своя пчела в улье.';
    else tip = 'Выберите фишку в запасе или в улье (с золотой каймой — те, что могут ходить).';
    this.btns.appendChild(h(`<div class="hv-ask">${tip}</div>`));
  }

  private send(a: Action) {
    const seat = this.act;
    if (seat == null) return;
    Sound.unlock();
    this.act = null;
    this.from = null;
    this.bug = null;
    this.btns.innerHTML = '';
    this.ctx.act(seat, a);
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: State) {
    this.act = null;
    const prev = this.s;
    this.s = v;
    this.from = null;
    this.bug = null;
    this.draw();
    for (const ev of events) {
      if (ev.type === 'place') Sound.place();
      else if (ev.type === 'move' || ev.type === 'throw') {
        ev.type === 'throw' ? Sound.capture() : Sound.step();
        if (prev) await this.slide(ev.from, ev.to, prev);
      } else if (ev.type === 'end') ev.winner == null ? Sound.ui() : Sound.win();
    }
    await sleep(260 / this.ctx.speed());
  }

  /** Переезд фишки: новая позиция уже нарисована, верхнюю фишку на to сдвигаем от старого места к новому. */
  private async slide(from: string, to: string, prev: State) {
    const groups = this.svg.querySelectorAll(`g[data-k="${to}"]`);
    const g = groups[groups.length - 1] as SVGGElement | undefined;
    if (!g) return;
    const [x0, y0] = xy(from);
    const [x1, y1] = xy(to);
    const l0 = (prev.cells[from]?.length ?? 1) - 1;
    const l1 = (this.s!.cells[to]?.length ?? 1) - 1;
    const dx = x0 - x1;
    const dy = y0 - l0 * LIFT - (y1 - l1 * LIFT);
    const ms = Math.min(700, 220 + Math.hypot(dx, dy) * 90) / this.ctx.speed();
    g.style.transition = 'none';
    g.style.transform = `translate(${dx}px, ${dy}px)`;
    g.getBoundingClientRect();
    g.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.3,1)`;
    g.style.transform = 'translate(0px, 0px)';
    await sleep(ms);
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.from = null;
    this.bug = null;
    this.act = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    // первый ход и обязательная пчела — фишка выбирается сразу, если вариант один
    if (s && this.act != null) {
      const bugs = new Set(this.mine().flatMap((a) => (a.type === 'place' ? [a.bug] : [])));
      if (bugs.size === 1 && !this.mine().some((a) => a.type !== 'place')) this.bug = [...bugs][0];
    }
    this.draw();
    this.renderButtons();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)} — пчела окружена!`;
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходят ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new HiveView();
}
