/* Коридор — отрисовка (SVG), всё в коде: деревянное поле с пазами между клетками (тёмный орех со светлыми
 * стенками или светлый бук с тёмными), точёные пешки с лаковыми шляпками цветов игроков, запас стенок —
 * дощечки у своего края; край, куда идёт игрок, отмечен полоской его цвета.
 * Ход: нажать на подсвеченную клетку — пешка шагнёт. Навести на паз — появится стенка (жёлтая — можно, красная —
 * нельзя), нажать — поставить; на сенсорном экране первое касание показывает стенку, второе — ставит. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS, stenok } from './def';
import { dist, pawnMoves, wallFits, wallOk, X, Y, type Event, type State, type Wall } from './engine';
import './quoridor.css';

const NS = 'http://www.w3.org/2000/svg';
const G = 0.26;
const M = 1.05;
const pitch = 1 + G;
const span = (n: number) => 2 * M + n + (n - 1) * G;
const cellL = (i: number) => M + i * pitch;
const cx = (n: number, p: number) => cellL(X(n, p)) + 0.5;
const cy = (n: number, p: number) => cellL(Y(n, p)) + 0.5;

/** Прямоугольник стенки. */
function wallRect(w: Wall): [number, number, number, number] {
  if (w.o === 'h') return [cellL(w.x) - 0.02, cellL(w.y) + 1 + 0.03, 2 + G + 0.04, G - 0.06];
  return [cellL(w.x) + 1 + 0.03, cellL(w.y) - 0.02, G - 0.06, 2 + G + 0.04];
}

const sameWall = (a: Wall | null, b: Wall | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.o === b.o;

class QuoridorView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private info!: HTMLElement;
  private s: State | null = null;
  private actSeat: number | null = null;
  private hoverCell = -1;
  private hoverWall: Wall | null = null;
  private touch = false;
  /** Показ хода: пешка едет, стенка опускается. */
  private anim: { seat: number; from: number } | { wall: Wall } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="qr-wrap"><svg class="qr-board" xmlns="${NS}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.info = h(`<div class="qr-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo)
      ctx.controls.appendChild(
        h(`<div class="qr-hint">Нажмите на подсвеченную клетку — пешка шагнёт. Наведите на паз между клетками — появится стенка: жёлтая — можно поставить, красная — нельзя; нажмите, чтобы поставить. На телефоне: первое касание паза показывает стенку, второе — ставит.</div>`)
      );
    this.svg.addEventListener('pointerdown', (e) => (this.touch = e.pointerType === 'touch'));
    this.svg.addEventListener('click', (e) => this.click(e));
    this.svg.addEventListener('mousemove', (e) => {
      if (this.touch) return;
      this.hoverAt(e);
    });
    this.svg.addEventListener('mouseleave', () => {
      this.hoverCell = -1;
      this.hoverWall = null;
      this.draw();
    });
  }

  /** Что под мышью: клетка или паз (стенка с центром у ближайшего стыка клеток). */
  private target(e: MouseEvent): { cell: number } | { wall: Wall } | null {
    const s = this.s;
    const ctm = this.svg.getScreenCTM();
    if (!s || !ctm) return null;
    const n = s.cfg.n;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    const u = (pt.x - M) / pitch;
    const v = (pt.y - M) / pitch;
    if (u < -0.1 || v < -0.1 || u > n || v > n) return null;
    const iu = Math.floor(u);
    const iv = Math.floor(v);
    const fu = (u - iu) * pitch; // 0…1 — клетка, 1…1+G — паз
    const fv = (v - iv) * pitch;
    const inGu = fu > 1 && iu < n - 1;
    const inGv = fv > 1 && iv < n - 1;
    const clamp = (k: number) => Math.max(0, Math.min(n - 2, k));
    if (!inGu && !inGv) return iu >= 0 && iv >= 0 && iu < n && iv < n ? { cell: iv * n + iu } : null;
    // паз: стенка в нём, центр — у ближайшего стыка
    let o: 'h' | 'v' = inGv ? 'h' : 'v';
    if (inGu && inGv) o = Math.abs(fv - 1 - G / 2) < Math.abs(fu - 1 - G / 2) ? 'h' : 'v';
    // середина паза между столбцами k и k + 1 — на u = k + (1 + G / 2) / pitch
    const mid = (1 + G / 2) / pitch;
    if (o === 'h') return { wall: { x: clamp(Math.round(u - mid)), y: iv, o } };
    return { wall: { x: iu, y: clamp(Math.round(v - mid)), o } };
  }

  private hoverAt(e: MouseEvent) {
    const t = this.target(e);
    const cell = t && 'cell' in t ? t.cell : -1;
    const wall = t && 'wall' in t && this.actSeat != null && this.s && this.s.left[this.actSeat] > 0 ? t.wall : null;
    if (cell !== this.hoverCell || !sameWall(wall, this.hoverWall) || (!wall && this.hoverWall)) {
      this.hoverCell = cell;
      this.hoverWall = wall;
      this.draw();
    }
  }

  private click(e: MouseEvent) {
    const s = this.s;
    const seat = this.actSeat;
    if (!s || seat == null || s.over) return;
    const t = this.target(e);
    if (!t) return;
    if ('cell' in t) {
      if (!pawnMoves(s, seat).includes(t.cell)) return;
      this.send({ type: 'move', to: t.cell });
      return;
    }
    if (s.left[seat] <= 0) return;
    // касание: первое — показать стенку, второе — поставить
    if (this.touch && !sameWall(t.wall, this.hoverWall)) {
      this.hoverWall = t.wall;
      this.draw();
      return;
    }
    if (!wallOk(s, t.wall)) {
      Sound.nomove();
      return;
    }
    this.send({ type: 'wall', ...t.wall });
  }

  private send(a: { type: 'move'; to: number } | { type: 'wall'; x: number; y: number; o: 'h' | 'v' }) {
    const seat = this.actSeat;
    if (seat == null) return;
    this.actSeat = null;
    this.hoverCell = -1;
    this.hoverWall = null;
    Sound.unlock();
    this.ctx.act(seat, a);
    this.draw();
  }

  private defs(s: State): string {
    const beech = s.cfg.look === 'beech';
    let g = beech
      ? `<linearGradient id="qr-base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c8955a"/><stop offset="1" stop-color="#8a5a2c"/></linearGradient>
         <linearGradient id="qr-cell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4dcae"/><stop offset="1" stop-color="#dcb67c"/></linearGradient>
         <linearGradient id="qr-plank" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a4a26"/><stop offset="0.5" stop-color="#4e2a12"/><stop offset="1" stop-color="#2e1606"/></linearGradient>`
      : `<linearGradient id="qr-base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a2a16"/><stop offset="1" stop-color="#1c0e06"/></linearGradient>
         <linearGradient id="qr-cell" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8a5634"/><stop offset="1" stop-color="#5e3418"/></linearGradient>
         <linearGradient id="qr-plank" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e2b8"/><stop offset="0.5" stop-color="#e2c088"/><stop offset="1" stop-color="#b48a52"/></linearGradient>`;
    SEATS.forEach((st, i) => {
      g += `<radialGradient id="qr-p${i}" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="${st.light}"/><stop offset="0.5" stop-color="${st.color}"/><stop offset="1" stop-color="${st.dark}"/></radialGradient>`;
    });
    g += `<radialGradient id="qr-wood" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#f8e6c0"/><stop offset="1" stop-color="#b88850"/></radialGradient>`;
    g += `<radialGradient id="qr-sh" cx="50%" cy="50%" r="50%"><stop offset="0.5" stop-color="#000" stop-opacity="0.5"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`;
    g += `<filter id="qr-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.18 2.6" numOctaves="2" seed="${beech ? 4 : 9}" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 ${beech ? 0.5 : 0.1}  0 0 0 0 ${beech ? 0.3 : 0.05}  0 0 0 0 ${beech ? 0.1 : 0.02}  0 0 0 ${beech ? 0.28 : 0.4} -0.06" result="g"/><feComposite in="g" in2="SourceGraphic" operator="in" result="t"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge></filter>`;
    return `<defs>${g}</defs>`;
  }

  private plank(x: number, y: number, w: number, hh: number, cls = '', extra = ''): string {
    return `<g class="${cls}" ${extra}><rect x="${x + 0.03}" y="${y + 0.05}" width="${w}" height="${hh}" rx="0.04" fill="#000" opacity="0.4"/>
      <rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="0.04" fill="url(#qr-plank)" stroke="#000" stroke-opacity="0.35" stroke-width="0.015"/>
      <rect x="${x + 0.02}" y="${y + 0.02}" width="${w - 0.04}" height="${Math.min(hh, w) * 0.3}" rx="0.02" fill="#fff" opacity="0.25"/></g>`;
  }

  private pawn(seat: number, x: number, y: number, alpha = 1, cls = '', style = ''): string {
    return `<g class="${cls}" style="${style}" opacity="${alpha}">
      <ellipse cx="${x + 0.05}" cy="${y + 0.1}" rx="0.45" ry="0.38" fill="url(#qr-sh)"/>
      <circle cx="${x}" cy="${y}" r="0.42" fill="url(#qr-wood)" stroke="#5a3a18" stroke-width="0.02"/>
      <circle cx="${x}" cy="${y}" r="0.33" fill="none" stroke="#7a5228" stroke-opacity="0.5" stroke-width="0.02"/>
      <circle cx="${x}" cy="${y - 0.02}" r="0.27" fill="url(#qr-p${seat})" stroke="${SEATS[seat].dark}" stroke-width="0.02"/>
      <ellipse cx="${x - 0.09}" cy="${y - 0.13}" rx="0.09" ry="0.055" fill="#fff" opacity="0.7"/></g>`;
  }

  draw() {
    const s = this.s;
    if (!s) return;
    const n = s.cfg.n;
    const W = span(n);
    this.svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
    let o = this.defs(s);
    o += `<rect x="0" y="0" width="${W}" height="${W}" rx="0.3" fill="url(#qr-base)" filter="url(#qr-grain)"/>`;
    o += `<rect x="0.07" y="0.07" width="${W - 0.14}" height="${W - 0.14}" rx="0.26" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="0.03"/>`;
    // цели: полоска цвета игрока у края, куда он идёт
    const inner = n + (n - 1) * G;
    for (const q of s.order) {
      const c = SEATS[q].color;
      const t = 0.09;
      const off = 0.2;
      const r = [
        [M, M - off - t, inner, t],
        [M + inner + off, M, t, inner],
        [M, M + inner + off, inner, t],
        [M - off - t, M, t, inner],
      ][q];
      o += `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="0.04" fill="${c}" opacity="0.9"/>`;
    }
    // клетки
    for (let p = 0; p < n * n; p++) {
      const x = cellL(X(n, p));
      const y = cellL(Y(n, p));
      o += `<rect x="${x}" y="${y}" width="1" height="1" rx="0.07" fill="url(#qr-cell)" filter="url(#qr-grain)"/>`;
      o += `<path d="M${x + 0.06} ${y + 0.94}V${y + 0.07}H${x + 0.94}" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="0.025"/>`;
    }
    // запас стенок — дощечки у своего края
    for (const q of s.order) {
      const k = s.left[q];
      const total = k;
      for (let i = 0; i < total; i++) {
        const along = M + (inner - (total - 1) * 0.42 - 0.2) / 2 + i * 0.42;
        const L = 0.58;
        const T = 0.2;
        const far = 0.36;
        if (q === 0) o += this.plank(along, M + inner + far, T, L);
        else if (q === 2) o += this.plank(along, M - far - L, T, L);
        else if (q === 1) o += this.plank(M - far - L, along, L, T);
        else o += this.plank(M + inner + far, along, L, T);
      }
    }
    // последний ход
    const last = s.last;
    if (last && 'from' in last && !this.anim) {
      o += `<rect x="${cellL(X(n, last.from)) + 0.04}" y="${cellL(Y(n, last.from)) + 0.04}" width="0.92" height="0.92" rx="0.07" fill="none" stroke="#ffd84a" stroke-opacity="0.45" stroke-width="0.04" stroke-dasharray="0.08 0.06"/>`;
    }
    // стенки
    const m = n - 1;
    for (let i = 0; i < m * m; i++)
      for (const [arr, or] of [
        [s.hw, 'h'],
        [s.vw, 'v'],
      ] as const) {
        if (!arr[i]) continue;
        const w: Wall = { x: i % m, y: Math.floor(i / m), o: or };
        const [x, y, ww, hh] = wallRect(w);
        const drop = this.anim && 'wall' in this.anim && sameWall(this.anim.wall, w);
        const isLast = last && 'wall' in last && sameWall(last.wall, w);
        o += this.plank(x, y, ww, hh, drop ? 'qr-drop' : '', drop ? `style="transform-origin:${x + ww / 2}px ${y + hh / 2}px"` : '');
        if (isLast && !drop) o += `<rect x="${x - 0.04}" y="${y - 0.04}" width="${ww + 0.08}" height="${hh + 0.08}" rx="0.06" fill="none" stroke="#ffd84a" stroke-width="0.035" opacity="0.8"/>`;
      }
    // ходы пешкой
    const mine = this.actSeat != null && !s.over && !this.ctx.demo;
    const steps = mine ? pawnMoves(s, this.actSeat!) : [];
    for (const p of steps) {
      const hot = p === this.hoverCell;
      o += `<circle cx="${cx(n, p)}" cy="${cy(n, p)}" r="${hot ? 0.18 : 0.1}" fill="#fff3a0" stroke="#000" stroke-opacity="0.6" stroke-width="0.03"/>`;
    }
    // пешки
    for (const q of s.order) {
      const p = s.pos[q];
      if (p < 0) continue;
      const x = cx(n, p);
      const y = cy(n, p);
      if (this.anim && 'seat' in this.anim && this.anim.seat === q) {
        const dx = cx(n, this.anim.from) - x;
        const dy = cy(n, this.anim.from) - y;
        o += this.pawn(q, x, y, 1, 'qr-fly', `--dx:${dx}px;--dy:${dy}px`);
      } else o += this.pawn(q, x, y);
      if (mine && q === this.actSeat) o += `<circle cx="${x}" cy="${y}" r="0.47" fill="none" stroke="#ffe066" stroke-width="0.04" stroke-dasharray="0.1 0.07"/>`;
    }
    // призрак пешки и стенки
    if (mine && this.hoverCell >= 0 && steps.includes(this.hoverCell)) o += this.pawn(this.actSeat!, cx(n, this.hoverCell), cy(n, this.hoverCell), 0.45);
    if (mine && this.hoverWall && wallFits(s, this.hoverWall)) {
      const ok = wallOk(s, this.hoverWall);
      const [x, y, ww, hh] = wallRect(this.hoverWall);
      o += `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" rx="0.04" fill="${ok ? '#ffe066' : '#e03030'}" opacity="${ok ? 0.85 : 0.6}" stroke="#000" stroke-opacity="0.5" stroke-width="0.02" pointer-events="none"/>`;
    }
    this.svg.innerHTML = o;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const n = s.cfg.n;
    let t = '';
    for (const q of s.order) {
      const d = dist(n, s.hw, s.vw, q, s.pos[q]);
      t += `<div class="qr-row${q === s.turn && !s.over ? ' on' : ''}"><span class="qr-dot" style="background:${SEATS[q].color}"></span><b>${this.ctx.name(q)}</b> · до цели ${d} · ${stenok(s.left[q])}</div>`;
    }
    this.info.innerHTML = t;
  }

  setView(v: State) {
    this.s = v;
    this.draw();
    this.text();
  }

  async play(events: Event[], v: State) {
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'move') {
        const base = this.s ?? v;
        const pos = base.pos.slice();
        pos[ev.seat] = ev.to;
        this.s = { ...base, pos, last: { from: ev.from, to: ev.to } };
        this.anim = { seat: ev.seat, from: ev.from };
        this.draw();
        this.anim = null;
        if (ev.jump) Sound.jump();
        else Sound.step();
        await sleep(340 / sp());
      } else if (ev.type === 'wall') {
        const base = this.s ?? v;
        const m = base.cfg.n - 1;
        const hw = base.hw.slice();
        const vw = base.vw.slice();
        (ev.o === 'h' ? hw : vw)[ev.y * m + ev.x] = ev.seat + 1;
        const left = base.left.slice();
        left[ev.seat] = ev.left;
        this.s = { ...base, hw, vw, left, last: { wall: { x: ev.x, y: ev.y, o: ev.o } } };
        this.anim = { wall: { x: ev.x, y: ev.y, o: ev.o } };
        this.draw();
        this.anim = null;
        Sound.place();
        await sleep(380 / sp());
      } else if (ev.type === 'end') {
        Sound.win();
        await sleep(500 / sp());
      }
    }
    this.s = v;
    this.draw();
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.actSeat = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Конец' : `Победа: ${this.ctx.name(v.winner)}`;
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0]).toLowerCase()}…`;
    return v.left[toAct[0]] > 0 ? 'Ваш ход — шаг пешкой или стенка' : 'Ваш ход — стенки кончились, только шаг';
  }
}

export function createView(): GameView<State, Event> {
  return new QuoridorView();
}

