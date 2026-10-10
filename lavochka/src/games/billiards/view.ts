/* Бильярд — отрисовка: стол сверху (деревянные борта с метками, сукно, лузы, линия дома и задняя отметка), шары (пул — цвета, полосы, номера;
 * русский — слоновая кость, цветной биток; классика — номера), кий с оттяжкой по силе, линия-подсказка до первого касания с «шаром-призраком»
 * и направлением прицельного. Удар: вести мышью — прицел, нажать и тянуть назад — сила, отпустить — удар (или ползунок и «Удар» в панели).
 * Винт — точка на битке в панели. Американка — нажатием выбрать, каким шаром бить. Заказ (классика, восьмёрка) — подсказка, луза — нажатием.
 * С руки — биток следует за указателем, нажать — поставить. Удар проигрывается по кадрам, что прислал хозяин партии. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { cueBalls, geoOf, legalTargets, ownBalls, placeOk, POCKET_NAMES, tableOf, type Action, type Event, type View } from './engine';
import type { Ball } from './physics';
import { SEATS, VARIANT_NAME } from './def';
import './billiards.css';

const RAIL = 0.13;
const POOL_COLORS = ['#f4f4f0', '#f2c21b', '#1f4fb8', '#d8241c', '#5a2a8a', '#f07a1a', '#1f8a3e', '#7a1a1a', '#151515'];

class BilliardsView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private cv!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private panel!: HTMLElement;
  private banner!: HTMLElement;
  private v: View | null = null;
  private S = 200;
  private cw = 0;
  private chh = 0;
  private actSeat: number | null = null;
  private aim = 0;
  private power = 0.45;
  private spin = { x: 0, y: 0 };
  private cue = 0;
  private callPocket: number | null = null;
  private drag: { x: number; y: number } | null = null;
  private dragPower = 0;
  private hover: { x: number; y: number } | null = null;
  /** Во время анимации — позиции из кадров. */
  private anim: Ball[] | null = null;
  private busy = false;
  private ro!: ResizeObserver;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="bl-wrap"><canvas class="bl-canvas"></canvas><div class="cs-banner bl-banner" hidden></div></div>`);
    root.appendChild(wrap);
    this.cv = wrap.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.banner = wrap.querySelector('.bl-banner') as HTMLElement;
    this.panel = h(`<div class="bl-panel"></div>`);
    ctx.controls.appendChild(this.panel);
    this.cv.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    this.cv.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    this.cv.addEventListener('pointerup', (e) => this.pointer(e, 'up'));
    this.cv.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(wrap);
  }

  // ---------------------------------------------------------------- координаты

  private sizeFor(v: View) {
    const t = tableOf(v.cfg);
    this.S = 900 / (t.w + 2 * RAIL);
    this.cw = Math.round((t.w + 2 * RAIL) * this.S);
    this.chh = Math.round((t.h + 2 * RAIL) * this.S);
    if (this.cv.width !== this.cw * 2) {
      this.cv.width = this.cw * 2;
      this.cv.height = this.chh * 2;
    }
  }
  private px = (x: number) => (RAIL + x) * this.S;
  private local(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * this.cw / this.S - RAIL, y: ((e.clientY - r.top) / r.height) * this.chh / this.S - RAIL };
  }

  private balls(): Ball[] {
    return this.anim ?? this.v?.balls ?? [];
  }

  private cueBall(): Ball | undefined {
    return this.v?.balls.find((b) => b.id === this.cue && b.on);
  }

  // ---------------------------------------------------------------- управление

  private myTurn() {
    return this.actSeat != null && this.v != null && !this.busy && this.v.turn === this.actSeat;
  }

  private pointer(e: PointerEvent, kind: 'move' | 'down' | 'up') {
    const v = this.v;
    if (!v) return;
    const p = this.local(e);
    this.hover = p;
    if (!this.myTurn()) return void this.draw();
    const t = tableOf(v.cfg);
    if (v.phase === 'place') {
      if (kind === 'down' && placeOk(v, p.x, p.y)) this.send({ type: 'place', x: p.x, y: p.y });
      return void this.draw();
    }
    const cb = this.cueBall();
    if (!cb) return;
    if (kind === 'down') {
      Sound.unlock();
      // выбрать шар-биток (американка)
      const hit = v.balls.find((b) => b.on && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < t.r * t.r * 1.6);
      if (hit && hit.id !== this.cue && cueBalls(v).includes(hit.id)) {
        this.cue = hit.id;
        Sound.ui();
        return void this.draw();
      }
      // заказ лузы
      const geo = geoOf(v.cfg);
      const pk = geo.pockets.findIndex((q) => (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < (q.cap * 1.6) ** 2);
      if (pk >= 0 && this.needsCall()) {
        this.callPocket = pk;
        Sound.ui();
        return void this.draw();
      }
      this.drag = { x: p.x, y: p.y };
      this.dragPower = 0;
      this.cv.setPointerCapture(e.pointerId);
      return;
    }
    if (kind === 'move') {
      if (this.drag) {
        // тянем назад от прицела — сила
        const back = (this.drag.x - p.x) * Math.cos(this.aim) + (this.drag.y - p.y) * Math.sin(this.aim);
        this.dragPower = Math.max(0, Math.min(1, back / 0.5));
      } else this.aim = Math.atan2(p.y - cb.y, p.x - cb.x);
      return void this.draw();
    }
    if (kind === 'up' && this.drag) {
      const pw = this.dragPower;
      this.drag = null;
      this.dragPower = 0;
      if (pw > 0.03) {
        this.power = pw;
        this.shoot();
      } else this.draw();
    }
  }

  private needsCall() {
    const v = this.v!;
    return v.cfg.variant === 'classic' || (v.cfg.variant === 'pool8' && this.predict()?.ball === 8);
  }

  private shoot() {
    const v = this.v!;
    const pr = this.predict();
    let call: { ball: number; pocket: number } | undefined;
    if (this.needsCall()) {
      const ball = pr?.ball ?? v.balls.find((b) => b.on && b.id !== 0)!.id;
      call = { ball, pocket: this.callPocket ?? pr?.pocket ?? 0 };
    }
    this.send({ type: 'shot', cue: this.cue, angle: this.aim, power: this.power, spinX: this.spin.x, spinY: this.spin.y, call });
  }

  private send(a: Action) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.callPocket = null;
    this.renderPanel();
    this.ctx.act(seat, a);
  }

  /** Куда придёт биток: первый шар (и куда он покатится, и в какую лузу ближе) или борт. */
  private predict(): { x: number; y: number; ball: number | null; dir: number | null; pocket: number | null } | null {
    const v = this.v;
    const cb = this.cueBall();
    if (!v || !cb) return null;
    const t = tableOf(v.cfg);
    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    let best = Infinity;
    let ball: Ball | null = null;
    for (const b of v.balls) {
      if (!b.on || b.id === cb.id) continue;
      const fx = b.x - cb.x;
      const fy = b.y - cb.y;
      const proj = fx * dx + fy * dy;
      if (proj <= 0) continue;
      const perp2 = fx * fx + fy * fy - proj * proj;
      const rr = 4 * t.r * t.r;
      if (perp2 > rr) continue;
      const d = proj - Math.sqrt(rr - perp2);
      if (d < best) {
        best = d;
        ball = b;
      }
    }
    // борт
    const lim = (pos: number, d: number, max: number) => (d > 0 ? (max - t.r - pos) / d : d < 0 ? (t.r - pos) / d : Infinity);
    const wall = Math.min(lim(cb.x, dx, t.w), lim(cb.y, dy, t.h));
    if (!ball || wall < best) return { x: cb.x + dx * wall, y: cb.y + dy * wall, ball: null, dir: null, pocket: null };
    const gx = cb.x + dx * best;
    const gy = cb.y + dy * best;
    const dir = Math.atan2(ball.y - gy, ball.x - gx);
    // луза, ближайшая по направлению
    const geo = geoOf(v.cfg);
    let pocket = 0;
    let bestA = Infinity;
    geo.pockets.forEach((q, k) => {
      let a = Math.abs(Math.atan2(q.y - ball!.y, q.x - ball!.x) - dir);
      if (a > Math.PI) a = 2 * Math.PI - a;
      if (a < bestA) {
        bestA = a;
        pocket = k;
      }
    });
    return { x: gx, y: gy, ball: ball.id, dir, pocket };
  }

  // ---------------------------------------------------------------- рисование

  private draw() {
    const v = this.v;
    if (!v) return;
    this.sizeFor(v);
    const g = this.g;
    const t = tableOf(v.cfg);
    const S = this.S;
    g.setTransform(2, 0, 0, 2, 0, 0);
    g.clearRect(0, 0, this.cw, this.chh);
    // борта
    const wood = g.createLinearGradient(0, 0, 0, this.chh);
    wood.addColorStop(0, '#7a3a14');
    wood.addColorStop(0.5, '#5a2a0e');
    wood.addColorStop(1, '#3e1c08');
    g.fillStyle = wood;
    g.beginPath();
    g.roundRect(0, 0, this.cw, this.chh, 18);
    g.fill();
    // сукно
    const russian = v.cfg.variant !== 'pool8';
    const cloth = g.createRadialGradient(this.cw / 2, this.chh / 2, 40, this.cw / 2, this.chh / 2, this.cw * 0.6);
    cloth.addColorStop(0, russian ? '#2e8a4a' : '#2a7ab0');
    cloth.addColorStop(1, russian ? '#1d6a36' : '#1b5a8a');
    g.fillStyle = '#123a20';
    g.fillRect(this.px(-0.03), this.px(-0.03), (t.w + 0.06) * S, (t.h + 0.06) * S);
    g.fillStyle = cloth;
    g.fillRect(this.px(0), this.px(0), t.w * S, t.h * S);
    // метки на бортах
    g.fillStyle = '#f4e8c8';
    for (let i = 1; i < 8; i++) if (i !== 4) for (const y of [-RAIL / 2, t.h + RAIL / 2]) this.dot(i * (t.w / 8), y, 3);
    for (let i = 1; i < 4; i++) for (const x of [-RAIL / 2, t.w + RAIL / 2]) this.dot(x, i * (t.h / 4), 3);
    // линия дома и задняя отметка
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(this.px(t.w / 4), this.px(0));
    g.lineTo(this.px(t.w / 4), this.px(t.h));
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    this.dot(t.w * 0.75, t.h / 2, 2.5);
    this.dot(t.w / 4, t.h / 2, 2.5);
    // лузы
    const geo = geoOf(v.cfg);
    const callPk = this.myTurn() && v.phase === 'shot' && this.needsCall() ? (this.callPocket ?? this.predict()?.pocket ?? null) : null;
    geo.pockets.forEach((q, k) => {
      g.fillStyle = '#3a2410';
      g.beginPath();
      g.arc(this.px(q.x), this.px(q.y), q.cap * 1.12 * S, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0a0a0a';
      g.beginPath();
      g.arc(this.px(q.x), this.px(q.y), q.cap * 0.95 * S, 0, Math.PI * 2);
      g.fill();
      if (k === callPk) {
        g.strokeStyle = '#ffd24a';
        g.lineWidth = 3;
        g.stroke();
      }
    });
    // подсказка прицела
    const cb = this.cueBall();
    const aiming = this.myTurn() && v.phase === 'shot' && cb;
    if (aiming) {
      const pr = this.predict();
      if (pr) {
        g.setLineDash([6, 6]);
        g.strokeStyle = 'rgba(255,255,255,0.6)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(this.px(cb!.x), this.px(cb!.y));
        g.lineTo(this.px(pr.x), this.px(pr.y));
        g.stroke();
        g.setLineDash([]);
        g.strokeStyle = 'rgba(255,255,255,0.7)';
        g.beginPath();
        g.arc(this.px(pr.x), this.px(pr.y), t.r * S, 0, Math.PI * 2);
        g.stroke();
        if (pr.ball != null && pr.dir != null) {
          const tb = v.balls.find((b) => b.id === pr.ball)!;
          const legal = legalTargets(v, v.turn).includes(pr.ball) || v.cfg.variant !== 'pool8';
          g.strokeStyle = legal ? 'rgba(255,240,150,0.85)' : 'rgba(255,90,70,0.9)';
          g.lineWidth = 2;
          g.beginPath();
          g.moveTo(this.px(tb.x), this.px(tb.y));
          g.lineTo(this.px(tb.x + Math.cos(pr.dir) * 0.35), this.px(tb.y + Math.sin(pr.dir) * 0.35));
          g.stroke();
        }
      }
    }
    // шары
    for (const b of this.balls()) if (b.on) this.ball(b, v);
    // выбранный биток (американка)
    if (aiming && cueBalls(v).length > 1) {
      g.strokeStyle = '#ffd24a';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(this.px(cb!.x), this.px(cb!.y), t.r * S + 3, 0, Math.PI * 2);
      g.stroke();
    }
    // кий
    if (aiming) {
      const pull = 0.02 + (this.drag ? this.dragPower : this.power * 0.3) * 0.25;
      const dx = Math.cos(this.aim);
      const dy = Math.sin(this.aim);
      const sx = cb!.x - dx * (t.r + pull);
      const sy = cb!.y - dy * (t.r + pull);
      const ex = sx - dx * 1.3;
      const ey = sy - dy * 1.3;
      const grad = g.createLinearGradient(this.px(sx), this.px(sy), this.px(ex), this.px(ey));
      grad.addColorStop(0, '#f4ecd8');
      grad.addColorStop(0.03, '#3a6aa8');
      grad.addColorStop(0.05, '#e8c890');
      grad.addColorStop(0.7, '#b07a3a');
      grad.addColorStop(1, '#2a1a0a');
      g.strokeStyle = grad;
      g.lineCap = 'round';
      g.lineWidth = Math.max(4, t.r * S * 0.55);
      g.beginPath();
      g.moveTo(this.px(sx), this.px(sy));
      g.lineTo(this.px(ex), this.px(ey));
      g.stroke();
      g.lineCap = 'butt';
    }
    // с руки: призрак битка
    if (this.myTurn() && v.phase === 'place' && this.hover) {
      const ok = placeOk(v, this.hover.x, this.hover.y);
      g.globalAlpha = ok ? 0.8 : 0.35;
      this.ball({ id: 0, x: this.hover.x, y: this.hover.y, on: true }, v);
      g.globalAlpha = 1;
      if (v.zone === 'kitchen') {
        g.fillStyle = 'rgba(255,255,255,0.08)';
        g.fillRect(this.px(0), this.px(0), (t.w / 4) * S, t.h * S);
      }
    }
  }

  private dot(x: number, y: number, r: number) {
    this.g.beginPath();
    this.g.arc(this.px(x), this.px(y), r, 0, Math.PI * 2);
    this.g.fill();
  }

  private ball(b: Ball, v: View) {
    const g = this.g;
    const t = tableOf(v.cfg);
    const R = t.r * this.S;
    const x = this.px(b.x);
    const y = this.px(b.y);
    const russian = v.cfg.variant !== 'pool8';
    let base = '#f4ecd8';
    let stripe: string | null = null;
    let num = '';
    if (!russian) {
      if (b.id === 0) base = '#fafaf4';
      else if (b.id <= 8) {
        base = POOL_COLORS[b.id];
        num = String(b.id);
      } else {
        base = '#fafaf4';
        stripe = POOL_COLORS[b.id - 8];
        num = String(b.id);
      }
    } else if (b.id === 0) base = v.cfg.variant === 'classic' ? '#fafaf4' : '#b8321a';
    else if (v.cfg.variant === 'classic') num = String(b.id);
    // тень
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.ellipse(x + R * 0.25, y + R * 0.3, R, R * 0.9, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = base;
    g.beginPath();
    g.arc(x, y, R, 0, Math.PI * 2);
    g.fill();
    if (stripe) {
      g.save();
      g.beginPath();
      g.arc(x, y, R, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = stripe;
      g.fillRect(x - R, y - R * 0.55, R * 2, R * 1.1);
      g.restore();
    }
    if (num) {
      g.fillStyle = '#fafaf4';
      g.beginPath();
      g.arc(x, y, R * 0.48, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#151515';
      g.font = `bold ${Math.max(7, R * 0.62)}px Arial`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(num, x, y + R * 0.04);
    }
    // блик
    const hl = g.createRadialGradient(x - R * 0.35, y - R * 0.4, R * 0.05, x, y, R * 1.05);
    hl.addColorStop(0, 'rgba(255,255,255,0.75)');
    hl.addColorStop(0.25, 'rgba(255,255,255,0.08)');
    hl.addColorStop(1, 'rgba(0,0,0,0.3)');
    g.fillStyle = hl;
    g.beginPath();
    g.arc(x, y, R, 0, Math.PI * 2);
    g.fill();
  }

  // ---------------------------------------------------------------- панель

  private renderPanel() {
    const v = this.v;
    if (!v) return;
    const seat = this.actSeat;
    const t = v.cfg.variant;
    const score = v.seats
      .map((p) => {
        const grp = t === 'pool8' && v.groups[p] ? ` · ${v.groups[p] === 'solid' ? 'сплошные' : v.groups[p] === 'stripe' ? 'полосатые' : 'все'}` : '';
        const val = t === 'pool8' ? (v.groups[p] ? `${ownBalls(v, p).length} осталось` : 'стол открыт') : `${v.score[p]}${t === 'classic' ? ' очков' : ' шаров'}`;
        return `<div class="bl-score${v.turn === p ? ' on' : ''}" style="--c:${SEATS[p].color}"><b>${esc(this.plain(p))}</b> ${val}${grp}</div>`;
      })
      .join('');
    const mine = seat != null && this.myTurn();
    this.panel.innerHTML = `<div class="bl-title">${VARIANT_NAME[t]}</div>${score}
      ${v.last ? `<div class="bl-last">${esc(this.plain(v.last.seat))}: ${esc(v.last.text)}</div>` : ''}
      <div class="bl-ctl"${mine && v.phase === 'shot' ? '' : ' hidden'}>
        <label>Сила <input type="range" min="0.03" max="1" step="0.01" value="${this.power}" class="bl-power"></label>
        <div class="bl-spin-row"><canvas class="bl-spin" width="128" height="128"></canvas><span>винт: нажмите на биток</span></div>
        <div class="bl-call"></div>
        <button class="btn primary bl-shoot">Удар</button>
      </div>
      ${mine && v.phase === 'place' ? `<div class="bl-hint">Поставьте биток ${v.zone === 'kitchen' ? 'в «доме» (левая четверть стола)' : 'куда угодно'} — нажмите на стол.</div>` : ''}`;
    const pw = this.panel.querySelector('.bl-power') as HTMLInputElement | null;
    if (pw) pw.oninput = () => {
      this.power = +pw.value;
      this.draw();
    };
    const shootBtn = this.panel.querySelector('.bl-shoot') as HTMLButtonElement | null;
    if (shootBtn) shootBtn.onclick = () => this.shoot();
    const sp = this.panel.querySelector('.bl-spin') as HTMLCanvasElement | null;
    if (sp) {
      const paint = () => {
        const g = sp.getContext('2d')!;
        g.clearRect(0, 0, 128, 128);
        g.fillStyle = '#f4f0e4';
        g.beginPath();
        g.arc(64, 64, 58, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#999';
        g.stroke();
        g.fillStyle = '#c8241c';
        g.beginPath();
        g.arc(64 + this.spin.x * 40, 64 - this.spin.y * 40, 9, 0, Math.PI * 2);
        g.fill();
      };
      paint();
      sp.onpointerdown = (e) => {
        const r = sp.getBoundingClientRect();
        let x = ((e.clientX - r.left) / r.width) * 2 - 1;
        let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
        const d = Math.hypot(x, y);
        if (d > 0.75) {
          x = (x / d) * 0.75;
          y = (y / d) * 0.75;
        }
        this.spin = { x: Math.round((x / 0.75) * 10) / 10, y: Math.round((y / 0.75) * 10) / 10 };
        paint();
      };
    }
    this.updateCall();
  }

  private updateCall() {
    const el = this.panel.querySelector('.bl-call') as HTMLElement | null;
    if (!el || !this.v) return;
    if (!this.myTurn() || this.v.phase !== 'shot' || !this.needsCall()) {
      el.textContent = '';
      return;
    }
    const pr = this.predict();
    const pk = this.callPocket ?? pr?.pocket;
    el.innerHTML = pr?.ball != null ? `Заказ: <b>${pr.ball}</b> → ${POCKET_NAMES[pk ?? 0]} <small>(луза — нажатием)</small>` : 'Заказ: наведите на шар';
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    this.v = v;
    this.banner.hidden = true;
    if (!cueBalls(v).includes(this.cue)) this.cue = 0;
    this.renderPanel();
    this.draw();
  }

  async play(events: Event[], v: View) {
    this.busy = true;
    try {
      for (const ev of events) {
        if (ev.type === 'shot') await this.animate(ev);
        else if (ev.type === 'place') {
          Sound.place();
          await sleep(150);
        } else if (ev.type === 'end') {
          Sound.win();
          this.banner.textContent = ev.winners.length ? `Победа: ${ev.winners.map((p) => this.plain(p)).join(', ')}` : 'Партия проиграна';
          this.banner.hidden = false;
        }
      }
    } finally {
      this.busy = false;
      this.anim = null;
    }
    const banner = this.banner.hidden ? null : this.banner.textContent;
    this.setView(v);
    if (banner) {
      this.banner.textContent = banner;
      this.banner.hidden = false;
    }
  }

  private async animate(ev: Extract<Event, { type: 'shot' }>) {
    const speed = this.ctx.speed();
    const fr = ev.frames;
    if (!fr.length) return;
    Sound.place();
    const end = fr[fr.length - 1].t;
    const start = performance.now();
    const gone = new Set<number>();
    await new Promise<void>((done) => {
      const step = () => {
        const tt = (performance.now() - start) * speed;
        let i = 0;
        while (i < fr.length - 1 && fr[i + 1].t <= tt) i++;
        const a = fr[i];
        const b = fr[Math.min(fr.length - 1, i + 1)];
        const k = b.t > a.t ? Math.min(1, (tt - a.t) / (b.t - a.t)) : 1;
        this.anim = ev.ids.map((id, j) => {
          const ax = a.p[j * 2];
          const bx = b.p[j * 2];
          const on = bx >= 0 && ax >= 0;
          if (ax >= 0 && bx < 0 && !gone.has(id)) {
            gone.add(id);
            Sound.capture();
          }
          return { id, on, x: on ? (ax + (bx - ax) * k) / 1000 : 0, y: on ? (a.p[j * 2 + 1] + (b.p[j * 2 + 1] - a.p[j * 2 + 1]) * k) / 1000 : 0 };
        });
        this.draw();
        if (tt >= end) return done();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    await sleep(250 / speed);
  }

  setTurn(toAct: number[], interactive: number[]) {
    if (this.busy) return;
    const v = this.v;
    if (!v || this.ctx.demo) return;
    this.actSeat = interactive.find((x) => x === v.turn) ?? null;
    if (this.actSeat != null) {
      const cb = this.cueBall() ?? v.balls.find((b) => b.id === 0);
      const t = tableOf(v.cfg);
      if (cb && this.hover == null) this.aim = Math.atan2(t.h / 2 - cb.y, t.w * 0.75 - cb.x);
      if (!cueBalls(v).includes(this.cue)) this.cue = 0;
    }
    this.renderPanel();
    this.draw();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return 'Партия окончена';
    const mine = interactive.includes(toAct[0]);
    const name = this.ctx.name(toAct[0]);
    if (v.phase === 'place') return mine ? 'Поставьте биток с руки' : `${name} ставит биток…`;
    if (!mine) return `Бьёт ${name}…`;
    if (v.cfg.variant === 'pool8') {
      const g = v.groups[v.turn];
      return g ? (ownBalls(v, v.turn).length ? `Ваш удар: ${g === 'solid' ? 'сплошные' : g === 'stripe' ? 'полосатые' : 'любые'}` : 'Ваш удар: восьмёрка!') : 'Ваш удар: стол открыт';
    }
    return 'Ваш удар';
  }

  playerStats(v: View, seat: number) {
    if (v.cfg.variant === 'pool8') return v.groups[seat] ? (v.groups[seat] === 'solid' ? 'сплошные' : v.groups[seat] === 'stripe' ? 'полосатые' : '') : '';
    return `${v.score[seat]}${v.cfg.variant === 'classic' ? ' очк.' : ' шар.'}`;
  }

  destroy() {
    this.ro.disconnect();
  }
}

export function createView(): GameView<View, Event> {
  return new BilliardsView();
}
