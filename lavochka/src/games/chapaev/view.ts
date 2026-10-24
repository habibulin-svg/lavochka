/* Чапаев и карром — отрисовка. Чапаев — складная шахматная доска (светлый и тёмный шпон, рамка с буквами и цифрами),
 * шашки — деревянные, с кольцевыми бороздками. Карром — светлая фанера, чёрные полосы по краю, лузы с сеткой, линии битка
 * с красными кружками, круг и звезда посередине, стрелки к лузам; фишки светлого и тёмного дерева, красная королева, белый биток.
 * Удар — «рогаткой»: нажать на свою шашку (биток), потянуть назад и отпустить; сила — по длине натяжки.
 * В карроме биток передвигается касанием своей линии. Полёт шашек — кадры той же физики, что считает игра. */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CH_R, CR, shoot, type Action, type Event, type Piece, type State } from './engine';
import './chapaev.css';

const NS = 'http://www.w3.org/2000/svg';
const PAD = 0.5;
/** Натяжка на полную силу (в клетках). */
const PULL = 2.6;

function chessBoard(): string {
  let o = `<defs>
    <linearGradient id="cp-l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f0d6a6"/><stop offset="1" stop-color="#ddb87c"/></linearGradient>
    <linearGradient id="cp-d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#9a5e30"/><stop offset="1" stop-color="#7a4520"/></linearGradient>
    <radialGradient id="cp-w" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fffaf0"/><stop offset="1" stop-color="#e2d2b0"/></radialGradient>
    <radialGradient id="cp-b" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#4a3a32"/><stop offset="1" stop-color="#140c08"/></radialGradient>
  </defs>`;
  o += `<rect x="${-PAD}" y="${-PAD}" width="${8 + 2 * PAD}" height="${8 + 2 * PAD}" rx="0.18" class="cp-frame"/>`;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) o += `<rect x="${x}" y="${y}" width="1.002" height="1.002" fill="url(#cp-${(x + y) % 2 ? 'd' : 'l'})"/>`;
  o += `<line x1="4" y1="-0.02" x2="4" y2="8.02" class="cp-fold"/>`;
  for (let i = 0; i < 8; i++) {
    o += `<text x="${i + 0.5}" y="8.36" class="cp-lbl">${'abcdefgh'[i]}</text><text x="-0.26" y="${i + 0.62}" class="cp-lbl">${8 - i}</text>`;
  }
  return o;
}

function carromBoard(): string {
  const S = CR.size;
  let o = `<defs>
    <linearGradient id="cr-ply" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4dfb4"/><stop offset="1" stop-color="#e2c48a"/></linearGradient>
    <radialGradient id="cr-w" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff5e0"/><stop offset="1" stop-color="#d8b880"/></radialGradient>
    <radialGradient id="cr-b" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#5a3a24"/><stop offset="1" stop-color="#1a0c06"/></radialGradient>
    <radialGradient id="cr-q" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ff7a6a"/><stop offset="1" stop-color="#9a1410"/></radialGradient>
    <radialGradient id="cr-s" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c8ccd4"/></radialGradient>
    <pattern id="cr-net" width="0.08" height="0.08" patternUnits="userSpaceOnUse"><path d="M0 0L0.08 0.08M0.08 0L0 0.08" stroke="#5a5a5a" stroke-width="0.012"/></pattern>
  </defs>`;
  o += `<rect x="${-PAD}" y="${-PAD}" width="${S + 2 * PAD}" height="${S + 2 * PAD}" rx="0.12" class="cr-frame"/>`;
  o += `<rect x="0" y="0" width="${S}" height="${S}" fill="url(#cr-ply)"/>`;
  for (const [x, y] of [
    [0.27, 0.27],
    [S - 0.27, 0.27],
    [0.27, S - 0.27],
    [S - 0.27, S - 0.27],
  ]) {
    o += `<circle cx="${x}" cy="${y}" r="0.3" fill="#111"/><circle cx="${x}" cy="${y}" r="0.26" fill="url(#cr-net)"/>`;
  }
  // линии битка: две параллельные с красными кругами
  const base = (y1: number, y2: number, vertical: boolean) => {
    const a = CR.baseFrom;
    const b = CR.baseTo;
    if (!vertical)
      return `<line x1="${a}" y1="${y1}" x2="${b}" y2="${y1}" class="cr-line"/><line x1="${a}" y1="${y2}" x2="${b}" y2="${y2}" class="cr-line"/><circle cx="${a}" cy="${(y1 + y2) / 2}" r="${Math.abs(y2 - y1) / 2}" class="cr-dot"/><circle cx="${b}" cy="${(y1 + y2) / 2}" r="${Math.abs(y2 - y1) / 2}" class="cr-dot"/>`;
    return `<line x1="${y1}" y1="${a}" x2="${y1}" y2="${b}" class="cr-line"/><line x1="${y2}" y1="${a}" x2="${y2}" y2="${b}" class="cr-line"/><circle cx="${(y1 + y2) / 2}" cy="${a}" r="${Math.abs(y2 - y1) / 2}" class="cr-dot"/><circle cx="${(y1 + y2) / 2}" cy="${b}" r="${Math.abs(y2 - y1) / 2}" class="cr-dot"/>`;
  };
  o += base(CR.base - 0.22, CR.base + 0.22, false) + base(S - CR.base - 0.22, S - CR.base + 0.22, false);
  o += base(CR.base - 0.22, CR.base + 0.22, true) + base(S - CR.base - 0.22, S - CR.base + 0.22, true);
  // стрелки к лузам
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    const cx = S / 2;
    const x1 = cx - sx * 1.25;
    const y1 = cx - sy * 1.25;
    const x2 = cx - sx * 2.75;
    const y2 = cx - sy * 2.75;
    o += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="cr-line"/><path d="M${x2} ${y2}l${sx * 0.22} 0l${-sx * 0.22} ${-sy * 0}l0 ${sy * 0.22}Z" class="cr-arrow"/>`;
  }
  // центр: круги и звезда
  o += `<circle cx="${S / 2}" cy="${S / 2}" r="0.95" class="cr-line"/><circle cx="${S / 2}" cy="${S / 2}" r="0.22" class="cr-dot"/>`;
  let star = '';
  for (let k = 0; k < 16; k++) {
    const a = (Math.PI / 8) * k;
    const r = k % 2 ? 0.32 : 0.82;
    star += `${k ? 'L' : 'M'}${(S / 2 + Math.cos(a) * r).toFixed(3)} ${(S / 2 + Math.sin(a) * r).toFixed(3)}`;
  }
  o += `<path d="${star}Z" class="cr-star"/>`;
  return o;
}

function discSvg(mode: string, o: number, r: number): string {
  if (mode === 'carrom') {
    const fill = o === 0 ? 'url(#cr-w)' : o === 1 ? 'url(#cr-b)' : o === 2 ? 'url(#cr-q)' : 'url(#cr-s)';
    return `<circle r="${r * 1.04}" cy="${r * 0.18}" fill="rgba(0,0,0,0.3)"/><circle r="${r}" fill="${fill}" stroke="rgba(0,0,0,0.5)" stroke-width="0.012"/><circle r="${r * 0.62}" fill="none" stroke="${o === 1 ? 'rgba(255,220,180,0.25)' : 'rgba(80,40,10,0.25)'}" stroke-width="0.012"/>`;
  }
  const fill = o === 0 ? 'url(#cp-w)' : 'url(#cp-b)';
  const groove = o === 0 ? 'rgba(120,90,50,0.45)' : 'rgba(255,230,200,0.18)';
  return `<circle r="${r * 1.03}" cy="0.07" cx="0.04" fill="rgba(0,0,0,0.35)"/><circle r="${r}" fill="${fill}" stroke="${o === 0 ? '#a08860' : '#000'}" stroke-width="0.02"/><circle r="${r * 0.72}" fill="none" stroke="${groove}" stroke-width="0.02"/><circle r="${r * 0.45}" fill="none" stroke="${groove}" stroke-width="0.016"/>`;
}

class ChapaevView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private layer!: SVGGElement;
  private ui!: SVGGElement;
  private info!: HTMLElement;
  private s: State | null = null;
  private act: number | null = null;
  private mode = '';
  private els = new Map<number, SVGGElement>();
  private aim: { id: number; x0: number; y0: number; x: number; y: number } | null = null;
  private strikerX = 4;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h('<div class="cp-wrap"><svg class="cp-svg"><g class="cp-board"></g><g class="cp-layer"></g><g class="cp-ui"></g></svg></div>');
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.layer = wrap.querySelector('.cp-layer') as SVGGElement;
    this.ui = wrap.querySelector('.cp-ui') as SVGGElement;
    this.info = h('<div class="cp-info"></div>');
    ctx.controls.appendChild(this.info);
    if (!ctx.demo) ctx.controls.appendChild(h('<div class="cp-hint">Нажмите на свою шашку, потяните назад, как рогатку, и отпустите: чем дальше тянете, тем сильнее щелчок. В карроме биток передвигается касанием своей линии.</div>'));
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('pointercancel', () => this.cancel());
  }

  private get size() {
    return this.s?.cfg.mode === 'carrom' ? CR.size : 8;
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    if (this.mode !== s.cfg.mode) {
      this.mode = s.cfg.mode;
      const S = this.size;
      this.svg.setAttribute('viewBox', `${-PAD - 0.1} ${-PAD - 0.1} ${S + 2 * PAD + 0.2} ${S + 2 * PAD + 0.2}`);
      (this.svg.querySelector('.cp-board') as SVGGElement).innerHTML = s.cfg.mode === 'carrom' ? carromBoard() : chessBoard();
      for (const el of this.els.values()) el.remove();
      this.els.clear();
    }
    this.place(s.pieces);
    this.drawUi();
    this.text();
  }

  private radius(p: { o: number }) {
    return this.mode === 'carrom' ? (p.o === 3 ? CR.striker : CR.coin) : CH_R;
  }

  private place(pieces: (Piece & { gone?: boolean })[]) {
    const keep = new Set<number>();
    for (const p of pieces) {
      if (p.gone) continue;
      keep.add(p.id);
      let el = this.els.get(p.id);
      if (!el) {
        el = document.createElementNS(NS, 'g') as SVGGElement;
        el.innerHTML = discSvg(this.mode, p.o, this.radius(p));
        this.layer.appendChild(el);
        this.els.set(p.id, el);
      }
      el.setAttribute('transform', `translate(${p.x.toFixed(3)} ${p.y.toFixed(3)})`);
    }
    for (const [id, el] of this.els) if (!keep.has(id)) (el.remove(), this.els.delete(id));
  }

  /** Биток каррома на линии игрока. */
  private strikerPos(): { x: number; y: number } | null {
    const s = this.s;
    if (!s || s.cfg.mode !== 'carrom' || this.act == null) return null;
    const by = s.turn === 0 ? CR.base : CR.size - CR.base;
    return { x: s.turn === 0 ? this.strikerX : CR.size - this.strikerX, y: by };
  }

  private drawUi() {
    let o = '';
    const st = this.strikerPos();
    if (st) o += `<g transform="translate(${st.x} ${st.y})" class="cp-striker">${discSvg('carrom', 3, CR.striker)}</g>`;
    if (this.aim) {
      const a = this.aim;
      const dx = a.x0 - a.x;
      const dy = a.y0 - a.y;
      const pw = Math.min(1, Math.sqrt(dx * dx + dy * dy) / PULL);
      const L = 0.6 + pw * 3;
      const ang = Math.atan2(dy, dx);
      o += `<line x1="${a.x0}" y1="${a.y0}" x2="${a.x0 + Math.cos(ang) * L}" y2="${a.y0 + Math.sin(ang) * L}" class="cp-aim"/>`;
      o += `<line x1="${a.x0}" y1="${a.y0}" x2="${a.x}" y2="${a.y}" class="cp-pull"/>`;
      o += `<circle cx="${a.x0}" cy="${a.y0}" r="${0.55}" class="cp-power" style="stroke-dasharray:${(pw * 3.46).toFixed(3)} 4"/>`;
    } else if (this.act != null && this.s?.cfg.mode === 'chapaev') {
      for (const p of this.s.pieces) if (p.o === this.act) o += `<circle cx="${p.x}" cy="${p.y}" r="${CH_R + 0.05}" class="cp-can"/>`;
    }
    this.ui.innerHTML = o;
  }

  private text() {
    const s = this.s!;
    if (s.cfg.mode === 'carrom') {
      this.info.innerHTML = `Счёт: <b>${s.score[0]} : ${s.score[1]}</b> (до ${s.cfg.target})<small>забито в этой доске: ${s.pocketed[0]} : ${s.pocketed[1]}${s.cover != null ? ` · королеву надо покрыть` : ''}</small>`;
      return;
    }
    const n = (o: number) => s.pieces.filter((p) => p.o === o).length;
    this.info.innerHTML = `Раунд ${s.round}: шашек <b>${n(0)} : ${n(1)}</b><small>линии: белые ${s.line[0] + 1}-я, чёрные ${s.line[1] + 1}-я${s.cfg.strict ? ' · строго по очереди' : ''}</small>`;
  }

  // ---------------------------------------------------------------- рогатка

  private pt(e: PointerEvent) {
    const p = this.svg.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    const m = this.svg.getScreenCTM();
    return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 };
  }

  private down(e: PointerEvent) {
    const s = this.s;
    if (!s || this.act == null) return;
    const p = this.pt(e);
    if (s.cfg.mode === 'carrom') {
      const st = this.strikerPos()!;
      if (Math.hypot(p.x - st.x, p.y - st.y) < CR.striker * 2.2) {
        this.aim = { id: 99, x0: st.x, y0: st.y, x: p.x, y: p.y };
        this.svg.setPointerCapture(e.pointerId);
      } else if (Math.abs(p.y - st.y) < 0.45) {
        const x = s.turn === 0 ? p.x : CR.size - p.x;
        this.strikerX = Math.max(CR.baseFrom, Math.min(CR.baseTo, x));
        Sound.ui();
      }
      this.drawUi();
      return;
    }
    const mine = s.pieces.filter((q) => q.o === this.act).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
    if (mine && Math.hypot(mine.x - p.x, mine.y - p.y) < CH_R * 1.6) {
      this.aim = { id: mine.id, x0: mine.x, y0: mine.y, x: p.x, y: p.y };
      this.svg.setPointerCapture(e.pointerId);
      this.drawUi();
    }
  }

  private move(e: PointerEvent) {
    if (!this.aim) return;
    const p = this.pt(e);
    this.aim.x = p.x;
    this.aim.y = p.y;
    this.drawUi();
  }

  private up(e: PointerEvent) {
    const a = this.aim;
    if (!a) return;
    const p = this.pt(e);
    this.aim = null;
    const dx = a.x0 - p.x;
    const dy = a.y0 - p.y;
    const pw = Math.min(1, Math.sqrt(dx * dx + dy * dy) / PULL);
    if (pw < 0.06) return this.drawUi();
    const angle = Math.atan2(dy, dx);
    const s = this.s!;
    const act: Action = s.cfg.mode === 'carrom' ? { type: 'strike', x: this.strikerX, angle, power: pw } : { type: 'shot', id: a.id, angle, power: pw };
    if (!shoot(s, act)) {
      Sound.nomove();
      return this.drawUi();
    }
    const seat = this.act!;
    this.act = null;
    Sound.unlock();
    this.drawUi();
    this.ctx.act(seat, act);
  }

  private cancel() {
    this.aim = null;
    this.drawUi();
  }

  // ---------------------------------------------------------------- события

  async play(events: Event[], v: State) {
    this.act = null;
    this.aim = null;
    this.drawUi();
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      const cur = this.s;
      if (ev.type === 'shot' && cur) {
        const a: Action = cur.cfg.mode === 'carrom' ? { type: 'strike', x: ev.x!, angle: ev.angle, power: ev.power } : { type: 'shot', id: ev.id, angle: ev.angle, power: ev.power };
        const sim = shoot(cur, a);
        if (sim) {
          const ids = sim.discs.map((d) => d.id);
          const kinds = new Map(sim.discs.map((d) => [d.id, d.id === 99 ? 3 : cur.pieces.find((p) => p.id === d.id)?.o ?? 0]));
          Sound.card();
          let hit = 0;
          const t0 = performance.now();
          for (const f of sim.frames) {
            const wait = (f.t * 1000) / sp() - (performance.now() - t0);
            if (wait > 0) await sleep(wait);
            while (hit < sim.hits.length && sim.hits[hit].t <= f.t) {
              if (sim.hits[hit].v > 0.6) (sim.hits[hit].wall ? Sound.step() : Sound.place());
              hit++;
            }
            this.place(f.p.map(([x, y, g], i) => ({ id: ids[i], o: kinds.get(ids[i])!, x, y, gone: !!g })));
          }
          if (ev.gone.length) Sound.capture();
        }
        await sleep(250 / sp());
      } else if (ev.type === 'round') {
        Sound.win();
        await sleep(900 / sp());
      } else if (ev.type === 'board') {
        Sound.win();
        await sleep(900 / sp());
      } else if (ev.type === 'foul') {
        Sound.nomove();
        await sleep(500 / sp());
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
    this.aim = null;
    this.act = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    if (s?.cfg.mode === 'carrom') {
      // биток — туда, где его можно поставить
      for (let k = 0; k < 30; k++) {
        const x = 4 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.15;
        if (x < CR.baseFrom || x > CR.baseTo) continue;
        if (shoot(s, { type: 'strike', x, angle: -Math.PI / 2, power: 0.1 })) {
          this.strikerX = x;
          break;
        }
      }
    }
    this.drawUi();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)}`;
    return interactive.includes(toAct[0]) ? 'Ваш удар' : `Бьёт ${this.ctx.name(toAct[0])}…`;
  }
}

export function createView(): GameView<State, Event> {
  return new ChapaevView();
}
