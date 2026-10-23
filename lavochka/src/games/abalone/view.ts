/* Абалон — отрисовка. Шестиугольная плита с 61 лункой (чёрный пластик с серебряной каймой или тёмное дерево), шары с бликом;
 * вытолкнутые шары укатываются в лоток у края. Ход: коснуться одного-трёх своих шаров подряд, затем стрелки направления
 * (или лунки, куда встанет передний шар). Шары переезжают плавно; каждый шар — свой элемент, чтобы было видно, кто куда поехал. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CELLS, DIRS, legal, N, NB, type Action, type Event, type State } from './engine';
import './abalone.css';

const SQ = Math.sqrt(3) / 2;
const X = (c: number) => CELLS[c].q + CELLS[c].r / 2;
const Y = (c: number) => CELLS[c].r * SQ;
const DX = (d: number) => DIRS[d][0] + DIRS[d][1] / 2;
const DY = (d: number) => DIRS[d][1] * SQ;
/** Лотки для вытолкнутых: у чёрных — справа внизу, у белых — слева вверху (место потерь). */
const tray = (seat: number, k: number) => (seat === 0 ? { x: 6.0, y: 4.0 - k * 0.62 } : { x: -6.0, y: -4.0 + k * 0.62 });

function plate(skin: string): string {
  const R = 5.25;
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(Math.cos(a) * R).toFixed(3)},${(Math.sin(a) * R).toFixed(3)}`;
  }).join(' ');
  const inner = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(Math.cos(a) * (R - 0.32)).toFixed(3)},${(Math.sin(a) * (R - 0.32)).toFixed(3)}`;
  }).join(' ');
  let holes = '';
  for (let c = 0; c < N; c++) holes += `<circle cx="${X(c).toFixed(3)}" cy="${Y(c).toFixed(3)}" r="0.4" class="ab-hole"/>`;
  const trays = [0, 1]
    .map((seat) => {
      const a = tray(seat, 0);
      const b = tray(seat, 5);
      const y0 = Math.min(a.y, b.y) - 0.42;
      return `<rect x="${(a.x - 0.42).toFixed(2)}" y="${y0.toFixed(2)}" width="0.84" height="${(Math.abs(a.y - b.y) + 0.84).toFixed(2)}" rx="0.42" class="ab-tray"/>`;
    })
    .join('');
  return `<defs>
    <radialGradient id="ab-b" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#6a6a72"/><stop offset="0.35" stop-color="#26262c"/><stop offset="1" stop-color="#050506"/></radialGradient>
    <radialGradient id="ab-w" cx="35%" cy="30%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#e6e2da"/><stop offset="1" stop-color="#a8a294"/></radialGradient>
    <radialGradient id="ab-sh" cx="50%" cy="50%" r="50%"><stop offset="0.5" stop-color="rgba(0,0,0,0.45)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/></radialGradient>
    <linearGradient id="ab-plate" x1="0" y1="0" x2="1" y2="1">${
      skin === 'wood'
        ? '<stop offset="0" stop-color="#8a5a32"/><stop offset="0.5" stop-color="#6a4022"/><stop offset="1" stop-color="#4a2a14"/>'
        : '<stop offset="0" stop-color="#3a3c44"/><stop offset="0.5" stop-color="#1e2026"/><stop offset="1" stop-color="#0e0f12"/>'
    }</linearGradient>
  </defs>
  <polygon points="${pts}" class="ab-rim"/><polygon points="${inner}" fill="url(#ab-plate)" class="ab-plate"/>${holes}${trays}`;
}

function marble(seat: number): string {
  return `<circle r="0.42" cy="0.07" cx="0.05" fill="url(#ab-sh)"/><circle r="0.4" fill="url(#ab-${seat === 0 ? 'b' : 'w'})" class="ab-m${seat}"/><ellipse cx="-0.13" cy="-0.15" rx="0.13" ry="0.08" fill="#fff" opacity="${seat === 0 ? 0.35 : 0.8}"/>`;
}

class AbaloneView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private layer!: SVGGElement;
  private ui!: SVGGElement;
  private info!: HTMLElement;
  private s: State | null = null;
  private act: number | null = null;
  private sel: number[] = [];
  /** Шары: id → место (клетка или лоток). */
  private ids = new Map<number, { seat: number; cell: number; tray?: number; pos?: { x: number; y: number } }>();
  private els = new Map<number, SVGGElement>();
  private next = 0;
  private skin = '';

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="ab-wrap"><svg class="ab-svg" viewBox="-6.7 -5.1 13.4 10.2"><g class="ab-plate-g"></g><g class="ab-layer"></g><g class="ab-ui"></g></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.layer = wrap.querySelector('.ab-layer') as SVGGElement;
    this.ui = wrap.querySelector('.ab-ui') as SVGGElement;
    this.info = h('<div class="ab-info"></div>');
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h('<div class="ab-hint">Коснитесь одного, двух или трёх своих шаров подряд, потом стрелки: шары сдвинутся на лунку. Двигаясь в линию, три шара толкают два чужих, два — один.</div>'));
    this.svg.addEventListener('click', (e) => this.onClick(e));
  }

  // ---------------------------------------------------------------- шары

  /** Разложить шары по доске заново (без анимации), если раскладка разошлась с позицией. */
  private sync(s: State) {
    const want = new Map<number, number>();
    for (let c = 0; c < N; c++) if (s.board[c] >= 0) want.set(c, s.board[c]);
    const have = new Map<number, number>();
    for (const [id, m] of this.ids) if (m.tray == null) have.set(m.cell, id);
    let ok = want.size === have.size;
    if (ok) for (const [c, seat] of want) if (!have.has(c) || this.ids.get(have.get(c)!)!.seat !== seat) ok = false;
    const trays = [...this.ids.values()].filter((m) => m.tray != null);
    if (ok && trays.filter((m) => m.seat === 0).length === s.lost[0] && trays.filter((m) => m.seat === 1).length === s.lost[1]) return;
    this.ids.clear();
    for (const el of this.els.values()) el.remove();
    this.els.clear();
    for (const [c, seat] of want) this.ids.set(this.next++, { seat, cell: c });
    for (const seat of [0, 1]) for (let k = 0; k < s.lost[seat]; k++) this.ids.set(this.next++, { seat, cell: -1, tray: k });
  }

  private place() {
    for (const [id, m] of this.ids) {
      let el = this.els.get(id);
      if (!el) {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        el.setAttribute('class', 'ab-ball');
        el.innerHTML = marble(m.seat);
        this.layer.appendChild(el);
        this.els.set(id, el);
      }
      const p = m.pos ?? (m.tray != null ? tray(m.seat, m.tray) : { x: X(m.cell), y: Y(m.cell) });
      el.style.transform = `translate(${p.x}px, ${p.y}px)`;
      el.classList.toggle('sel', m.tray == null && !m.pos && this.sel.includes(m.cell));
    }
    for (const [id, el] of this.els) if (!this.ids.has(id)) (el.remove(), this.els.delete(id));
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    const skin = s.cfg.skin ?? 'classic';
    if (skin !== this.skin) {
      this.skin = skin;
      (this.svg.querySelector('.ab-plate-g') as SVGGElement).innerHTML = plate(skin);
      this.svg.classList.toggle('wood', skin === 'wood');
    }
    this.sync(s);
    this.place();
    this.drawUi();
    this.text();
  }

  private drawUi() {
    const s = this.s!;
    let o = '';
    if (s.last && !s.over) for (const c of s.last.cells) o += `<circle cx="${X(NB[c][s.last.dir]).toFixed(3)}" cy="${Y(NB[c][s.last.dir]).toFixed(3)}" r="0.47" class="ab-last"/>`;
    if (this.act != null) {
      for (const m of this.movesOfSel()) {
        const cx = this.sel.reduce((x, c) => x + X(c), 0) / this.sel.length;
        const cy = this.sel.reduce((x, c) => x + Y(c), 0) / this.sel.length;
        const len = 0.55 + this.sel.length * 0.32;
        const ax = cx + DX(m.dir) * len;
        const ay = cy + DY(m.dir) * len;
        const ang = (Math.atan2(DY(m.dir), DX(m.dir)) * 180) / Math.PI;
        o += `<g class="ab-arrow" data-dir="${m.dir}" transform="translate(${ax.toFixed(3)} ${ay.toFixed(3)}) rotate(${ang.toFixed(1)})"><circle r="0.36"/><path d="M-0.16 -0.18 L0.18 0 L-0.16 0.18 Z"/></g>`;
      }
    }
    this.ui.innerHTML = o;
  }

  private movesOfSel(): Action[] {
    const s = this.s;
    if (!s || this.act == null || !this.sel.length) return [];
    const key = this.sel.slice().sort((a, b) => a - b).join(',');
    return legal(s).filter((m) => m.cells.slice().sort((a, b) => a - b).join(',') === key);
  }

  private text() {
    const s = this.s!;
    this.info.innerHTML = `Вытолкнуто: чёрными <b>${s.lost[1]}</b> из ${s.cfg.goal}, белыми <b>${s.lost[0]}</b> из ${s.cfg.goal}<small>ход ${s.ply + 1}</small>`;
  }

  // ---------------------------------------------------------------- ход

  private cellAt(e: MouseEvent): number {
    const pt = this.svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = this.svg.getScreenCTM();
    if (!m) return -1;
    const p = pt.matrixTransform(m.inverse());
    let best = -1;
    let bd = 0.25;
    for (let c = 0; c < N; c++) {
      const d = (X(c) - p.x) ** 2 + (Y(c) - p.y) ** 2;
      if (d < bd) (bd = d), (best = c);
    }
    return best;
  }

  private onClick(e: MouseEvent) {
    const s = this.s;
    if (!s || this.act == null) return;
    const arrow = (e.target as Element).closest('.ab-arrow') as SVGGElement | null;
    if (arrow) {
      const m = this.movesOfSel().find((x) => x.dir === Number(arrow.getAttribute('data-dir')));
      if (m) this.send(m);
      return;
    }
    const c = this.cellAt(e);
    if (c < 0) return;
    if (s.board[c] === this.act) {
      if (this.sel.includes(c)) this.sel = this.sel.filter((x) => x !== c);
      else {
        const next = [...this.sel, c];
        const key = next.slice().sort((a, b) => a - b).join(',');
        const okLine = next.length <= 3 && legal(s).some((m) => m.cells.slice().sort((a, b) => a - b).join(',') === key);
        // не линия — начать выбор заново с этого шара
        this.sel = okLine ? next : [c];
      }
      Sound.ui();
      this.drawUi();
      this.place();
      return;
    }
    // лунка или чужой шар: куда встанет передний шар выбранной линии
    const hits = this.movesOfSel().filter((m) => m.cells.some((x) => NB[x][m.dir] === c));
    if (hits.length === 1) this.send(hits[0]);
    else if (!hits.length && this.sel.length) {
      this.sel = [];
      this.drawUi();
      this.place();
    }
  }

  private send(a: Action) {
    const seat = this.act;
    if (seat == null) return;
    Sound.unlock();
    this.act = null;
    this.sel = [];
    this.drawUi();
    this.ctx.act(seat, a);
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: State) {
    this.act = null;
    this.sel = [];
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type !== 'move') continue;
      const byCell = new Map<number, number>();
      for (const [id, m] of this.ids) if (m.tray == null) byCell.set(m.cell, id);
      const d = ev.dir;
      // чужие шары: дальние первыми; вытолкнутый — за край, потом в лоток
      let outId: number | null = null;
      for (let i = ev.pushed.length - 1; i >= 0; i--) {
        const id = byCell.get(ev.pushed[i]);
        if (id == null) continue;
        const t = NB[ev.pushed[i]][d];
        if (t >= 0) this.ids.get(id)!.cell = t;
        else outId = id;
      }
      for (const c of ev.cells) {
        const id = byCell.get(c);
        if (id != null) this.ids.get(id)!.cell = NB[c][d];
      }
      if (outId != null) {
        const m = this.ids.get(outId)!;
        const from = ev.pushed[ev.pushed.length - 1];
        m.pos = { x: X(from) + DX(d) * 1.1, y: Y(from) + DY(d) * 1.1 };
      }
      this.place();
      if (ev.pushed.length) Sound.capture();
      else Sound.place();
      await sleep(380 / sp());
      if (outId != null) {
        const m = this.ids.get(outId)!;
        delete m.pos;
        m.cell = -1;
        m.tray = [...this.ids.values()].filter((x) => x.tray != null && x.seat === m.seat).length;
        this.place();
        Sound.win();
        await sleep(300 / sp());
      }
    }
    this.s = v;
    this.draw();
  }

  setView(v: State) {
    this.s = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.sel = [];
    this.act = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.drawUi();
    this.place();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)}`;
    return interactive.includes(toAct[0]) ? 'Ваш ход' : `Ходят ${this.ctx.name(toAct[0])}…`;
  }

  playerStats(v: State, seat: number) {
    return `вытолкнуто: ${v.lost[1 - seat]} из ${v.cfg.goal}`;
  }
}

export function createView(): GameView<State, Event> {
  return new AbaloneView();
}
