/* Ур по Скирюку — отрисовка на той же доске (снимок подлинника). Фишки: пустая сторона — гладкий диск, меченая — с пятью точками.
 * Столбики (на «глазах», B7, клетках безопасности) — стопкой со сдвигом и числом. Ход: бросок, касание фишки (верхней в столбике
 * или из лотка) и подсвеченной клетки; при входе в малый блок — две клетки на выбор, ход назад для рубки — красная метка.
 * Подъём в столбике и переворот столбика — кнопками в панели. */
import { Sound } from '../../core/audio';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CELL_NAME, cellCol, cellOf, cellRow, DEPOT, EXIT, PIECES, slegal, type SAction, type SEvent, type SMove, type SState } from './skyruk';
import { BH, BW, COLS, defs, H, piece, R, ROWS, tetra, TEX, TRAY, W } from './view';

type Pt = [number, number];
const LIFT = 16;

function cellPt(c: number): Pt {
  return [COLS[cellCol(c)], TRAY + ROWS[cellRow(c)]];
}
function trayPt(side: number, exited: boolean, k: number): Pt {
  const y = side === 0 ? H - TRAY / 2 : TRAY / 2;
  return exited ? [W - 110 - k * 120, y] : [110 + k * 120, y];
}

function plain(side: number): string {
  return `<circle cx="7" cy="11" r="${R + 4}" fill="#000" opacity="0.4" filter="url(#ur-blur)"/>
    <circle r="${R}" fill="url(#ur-p${side})" stroke="${side === 0 ? '#a89e86' : '#0c0c0e'}" stroke-width="3"/>
    <circle r="${R - 7}" fill="none" stroke="${side === 0 ? '#fff' : '#6a6a74'}" stroke-opacity="0.35" stroke-width="3"/>
    <circle r="${R * 0.28}" fill="none" stroke="${side === 0 ? '#bdb39a' : '#55555e'}" stroke-width="3"/>
    <circle class="ur-ring" r="${R + 10}"/>`;
}

function trays(): string {
  const t = (y: number, side: number) =>
    `<rect x="20" y="${y + 18}" width="${W - 40}" height="${TRAY - 36}" rx="40" class="ur-tray"/>
     <text x="${W / 2}" y="${y + TRAY / 2 + 12}" class="ur-tlabel">${side === 0 ? 'белые' : 'чёрные'}: ← не вошли · вышли →</text>`;
  return t(0, 1) + t(H - TRAY, 0);
}

class SkyrukView implements GameView<SState, SEvent> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gPieces!: SVGGElement;
  private gMarks!: SVGGElement;
  private gBadges!: SVGGElement;
  private diceBox!: HTMLElement;
  private info!: HTMLElement;
  private extra!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private s: SState | null = null;
  private els: SVGGElement[] = [];
  private rollSeat: number | null = null;
  private moveSeat: number | null = null;
  private sel: number | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || this.rollBtn.disabled || !this.rollBtn.isConnected) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    this.roll();
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="ur-wrap"><svg class="ur-board" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        ${defs()}${trays()}
        <image href="${TEX}" x="0" y="${TRAY}" width="${BW}" height="${BH}" filter="url(#ur-bshadow)"/>
        <g class="ur-last"></g><g class="ur-pcs"></g><g class="ur-badges"></g><g class="ur-marks"></g>
      </svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gPieces = this.svg.querySelector('.ur-pcs') as SVGGElement;
    this.gMarks = this.svg.querySelector('.ur-marks') as SVGGElement;
    this.gBadges = this.svg.querySelector('.ur-badges') as SVGGElement;
    const ctl = h(`<div class="sb-controls">
        <div class="ur-dice"></div>
        <div class="ur-info"></div>
        <div class="ur-extra"></div>
        ${ctx.demo ? '' : `<button class="btn primary sb-roll" data-tap disabled>Бросить пирамидки</button><div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Потом — фишку и клетку, куда её поставить.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.diceBox = ctl.querySelector('.ur-dice') as HTMLElement;
    this.info = ctl.querySelector('.ur-info') as HTMLElement;
    this.extra = ctl.querySelector('.ur-extra') as HTMLElement;
    this.rollBtn = (ctl.querySelector('.sb-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    this.svg.addEventListener('click', (e) => this.click(e));
    this.extra.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('[data-raise]') as HTMLElement | null;
      if (b) this.send(JSON.parse(b.dataset.raise!));
    });
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    this.dice([], 0);
  }

  private dice(d: number[], v: number, rolling = false) {
    const vals = d.length ? d : [0, 0, 0];
    this.diceBox.innerHTML = `<svg viewBox="0 0 ${3 * 62 + 6} 64" class="ur-dsvg${rolling ? ' rolling' : ''}">${vals.map((u, i) => tetra(u, i)).join('')}</svg>
      <b class="ur-val">${d.length ? v : '–'}</b>`;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const out = (x: number) => s.pieces.filter((q) => q.side === x && q.p === EXIT).length;
    const depot = s.cells[DEPOT].length ? this.ctx.name(s.seats[s.pieces[s.cells[DEPOT][0]].side]) : 'никто';
    this.info.innerHTML = `<div>Вышли: ${this.ctx.name(s.seats[0])} <b>${out(0)}</b> · ${this.ctx.name(s.seats[1])} <b>${out(1)}</b> из ${PIECES}</div>
      <div><small>B7 держит: ${depot}</small></div>`;
  }

  /** Где стоит фишка id и на какой высоте в столбике. */
  private place(s: SState): Map<number, Pt> {
    const out = new Map<number, Pt>();
    const k = [
      [0, 0],
      [0, 0],
    ];
    s.pieces.forEach((x, id) => {
      if (x.p === 0) out.set(id, trayPt(x.side, false, k[x.side][0]++));
      else if (x.p === EXIT) out.set(id, trayPt(x.side, true, k[x.side][1]++));
    });
    s.cells.forEach((st, c) => {
      const [cx, cy] = cellPt(c);
      st.forEach((id, lvl) => out.set(id, [cx - lvl * LIFT, cy - lvl * LIFT]));
    });
    return out;
  }

  private layout(s: SState, anim = false) {
    if (this.els.length !== s.pieces.length) {
      this.gPieces.innerHTML = '';
      this.els = s.pieces.map((x, id) => {
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', `ur-pc ur-s${x.side}`);
        g.dataset.id = String(id);
        this.gPieces.appendChild(g);
        return g;
      });
    }
    const pos = this.place(s);
    // порядок отрисовки: столбики снизу вверх
    const order = s.pieces.map((_, id) => id).sort((a, b) => this.level(s, a) - this.level(s, b));
    for (const id of order) {
      const x = s.pieces[id];
      const el = this.els[id];
      const face = x.marked ? 'm' : 'p';
      if (el.dataset.face !== face) {
        el.innerHTML = x.marked ? piece(x.side) : plain(x.side);
        el.dataset.face = face;
      }
      el.classList.toggle('anim', anim);
      const [px, py] = pos.get(id)!;
      el.setAttribute('transform', `translate(${px} ${py})`);
      this.gPieces.appendChild(el);
    }
    let badges = '';
    s.cells.forEach((st, c) => {
      if (st.length < 2) return;
      const [cx, cy] = cellPt(c);
      badges += `<g transform="translate(${cx + R - 6} ${cy + R - 6})"><circle r="26" class="ur-badge"/><text y="10" class="ur-badget">${st.length}</text></g>`;
    });
    this.gBadges.innerHTML = badges;
    const lg = this.svg.querySelector('.ur-last') as SVGGElement;
    lg.innerHTML = '';
    if (s.last && s.last.to > 0 && s.last.to < EXIT) {
      const x = s.pieces.find((q, id) => q.side === s.last!.side && q.p === s.last!.to && s.cells.some((st) => st.includes(id)));
      if (x) {
        const [cx, cy] = cellPt(cellOf(x.side, x.p, x.loop));
        lg.innerHTML = `<rect x="${cx - 92}" y="${cy - 92}" width="184" height="184" rx="14" class="ur-lastc"/>`;
      }
    }
  }

  private level(s: SState, id: number) {
    for (const st of s.cells) {
      const k = st.indexOf(id);
      if (k >= 0) return k;
    }
    return 0;
  }

  setView(v: SState) {
    this.s = v;
    this.layout(v);
    this.dice(v.dice, v.value);
    this.text();
  }

  async play(events: SEvent[], v: SState) {
    const sp = this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'roll') {
        this.dice(ev.dice, ev.value, true);
        Sound.diceRoll(0.5);
        await sleep(520 / sp);
        this.dice(ev.dice, ev.value);
        if (ev.none) {
          if (!ev.start) Sound.nomove();
          await sleep(450 / sp);
        }
      } else if (ev.type === 'smove') {
        const s = this.s!;
        const el = this.els[ev.id];
        this.gPieces.appendChild(el);
        el.classList.add('anim');
        const x = s.pieces[ev.id];
        // шаги по пути
        const dir = ev.back ? -1 : 1;
        const loopOf = (p: number) => (p >= 12 ? (v.pieces[ev.id].loop ?? x.loop) : null);
        for (let p = ev.from + dir; dir > 0 ? p <= ev.to : p >= ev.to; p += dir) {
          if (p <= 0) continue;
          const pt = p >= EXIT ? trayPt(ev.side, true, s.pieces.filter((q) => q.side === ev.side && q.p === EXIT).length) : cellPt(cellOf(ev.side, p, loopOf(p)));
          el.setAttribute('transform', `translate(${pt[0]} ${pt[1]})`);
          Sound.step();
          await sleep(140 / sp);
        }
        if (ev.hit != null) Sound.capture();
        if (ev.flipped) Sound.place();
        if (ev.again) Sound.enter();
        if (ev.to === EXIT) Sound.home();
        await sleep(160 / sp);
      } else if (ev.type === 'raise') {
        Sound.place();
        await sleep(200 / sp);
      } else if (ev.type === 'end') Sound.win();
    }
    this.s = v;
    this.layout(v, true);
    this.dice(v.dice, v.value);
    this.text();
  }

  private clearTurn() {
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
    this.moveSeat = null;
    this.sel = null;
    for (const el of this.els) el.classList.remove('can', 'sel');
    this.gMarks.innerHTML = '';
    this.extra.innerHTML = '';
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.clearTurn();
    const s = this.s;
    if (!s || s.phase === 'over' || this.ctx.demo) return;
    const seat = s.seats[s.cur];
    if (!interactive.includes(seat)) return;
    if (s.phase === 'roll' || s.phase === 'start') {
      this.rollSeat = seat;
      this.rollBtn.disabled = false;
      this.rollBtn.classList.add('pulse');
      return;
    }
    this.moveSeat = seat;
    const moves = slegal(s);
    const ids = new Set(moves.filter((m) => m.a.type === 'move').map((m) => (m.a as { id: number }).id));
    for (const id of ids) this.els[id]?.classList.add('can');
    const raises = moves.filter((m) => m.a.type === 'raise');
    this.extra.innerHTML = raises
      .map((m) => {
        const a = m.a as { cell: number; k: number };
        return `<button class="btn" data-raise='${JSON.stringify(a)}'>${a.k === 0 ? `Перевернуть столбик ${CELL_NAME(a.cell)}` : `Поднять ${a.k}-ю сверху наверх (${CELL_NAME(a.cell)})`}</button>`;
      })
      .join('');
    if (ids.size === 1 && !raises.length) this.select([...ids][0]);
  }

  private movesOf(id: number): SMove[] {
    return slegal(this.s!).filter((m) => m.a.type === 'move' && m.a.id === id);
  }

  private select(id: number) {
    const s = this.s!;
    const ms = this.movesOf(id);
    if (!ms.length) return;
    this.sel = id;
    for (const el of this.els) el.classList.remove('sel');
    this.els[id].classList.add('sel');
    let html = '';
    ms.forEach((m, k) => {
      const pt = m.to === EXIT ? trayPt(s.cur, true, s.pieces.filter((q) => q.side === s.cur && q.p === EXIT).length) : cellPt(m.toCell);
      const back = m.a.type === 'move' && m.a.back;
      const cls = back ? ' ur-back' : m.star ? ' ur-ros' : '';
      html += `<g class="ur-target${cls}" data-k="${k}" transform="translate(${pt[0]} ${pt[1]})"><circle r="${R + 6}"/><circle r="22" class="ur-dot"/></g>`;
    });
    this.gMarks.innerHTML = html;
  }

  private send(a: SAction) {
    const seat = this.moveSeat;
    if (seat == null) return;
    this.clearTurn();
    Sound.unlock();
    this.ctx.act(seat, a);
  }

  private click(e: MouseEvent) {
    const s = this.s;
    if (!s || this.moveSeat == null) return;
    const t = (e.target as Element).closest('[data-k]') as SVGGElement | null;
    if (t && this.sel != null) {
      e.stopPropagation();
      const m = this.movesOf(this.sel)[Number(t.dataset.k)];
      if (m) this.send(m.a);
      return;
    }
    const pc = (e.target as Element).closest('.ur-pc.can') as SVGGElement | null;
    if (pc) {
      e.stopPropagation();
      Sound.unlock();
      this.select(Number(pc.dataset.id));
    }
  }

  private roll() {
    if (this.rollSeat == null) return;
    Sound.unlock();
    const seat = this.rollSeat;
    this.clearTurn();
    this.ctx.act(seat, { type: 'roll' });
  }

  status(s: SState, _toAct: number[], interactive: number[]) {
    if (s.phase === 'over') return s.winner != null ? `Победа: ${this.ctx.name(s.seats[s.winner])}!` : 'Партия окончена';
    const seat = s.seats[s.cur];
    const who = this.ctx.name(seat);
    if (s.phase === 'start') return interactive.includes(seat) ? `${who}: кто первым выбросит единицу, тот и начинает` : `${who} бросает — ждём единицу…`;
    if (!interactive.includes(seat)) return s.phase === 'roll' ? `${who} бросает…` : `${who} ходит…`;
    if (s.phase === 'roll') return `${who}: бросайте пирамидки`;
    return `${who}: выпало ${s.value} — выберите фишку и клетку`;
  }

  playerStats(s: SState, seat: number) {
    const side = s.seats.indexOf(seat);
    if (side < 0) return '';
    const mine = s.pieces.filter((q) => q.side === side);
    return `<span title="Вышли">🏁 ${mine.filter((x) => x.p === EXIT).length}</span><span title="Не вошли">◯ ${mine.filter((x) => x.p === 0).length}</span><span title="Меченых на доске">✦ ${mine.filter((x) => x.marked && x.p < EXIT).length}</span>`;
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createSkyrukView(): GameView<SState, SEvent> {
  return new SkyrukView();
}

