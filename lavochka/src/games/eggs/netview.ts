/* «Яйца динозавров» по сети — экран стола: своё поле крупно (прицел, выстрел рисуется сразу, не дожидаясь комнаты), полоска падлянок,
 * поля соперников: в дуэли — рядом целиком, в битве — мини-поля вокруг (нажатие — бить его; выбывшему — смотреть его крупно). */
import { Fx } from '../../core/arcade-fx';
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { Bubbles, COLS, DEAD_ROW, FIELD_W, ROWS, SHOOTER_Y } from './logic';
import { along, drawAim, drawBack, drawCeiling, drawDino, drawEgg, drawLine, EGG, FIELD_H, pathLen } from './paint';
import { boardOf, type VsBoardView, type VsEvent, type VsIn, type VsView } from './versus';
import './eggs.css';

const U = 56;
const CW = FIELD_W * U;
const CH = FIELD_H * U;
const MU = 12;

interface Pop {
  x: number;
  y: number;
  color: number;
  t: number;
  fall: boolean;
  vx: number;
}

/** Поле на холсте: яйца, лопанье, полёт, дрожь перед наездом ряда. */
class Field {
  readonly cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  b: Bubbles | null = null;
  aim = -Math.PI / 2;
  flying: { color: number; path: [number, number][]; t0: number; dur: number; cell: [number, number] | null } | null = null;
  popping: Pop[] = [];
  fx = new Fx();
  bg = 0;
  constructor() {
    this.cv = h<HTMLCanvasElement>(`<canvas width="${CW * 2}" height="${CH * 2}"></canvas>`);
    this.g = this.cv.getContext('2d')!;
    this.g.setTransform(2, 0, 0, 2, 0, 0);
  }

  /** Анимация выстрела: полёт по пути, потом лопнувшие и упавшие. */
  shot(b: Bubbles, color: number, path: [number, number][], cell: [number, number] | null, popped: [number, number, number][], fell: [number, number, number][]) {
    const dur = Math.max(120, pathLen(path) * 28);
    this.flying = { color, path, t0: performance.now(), dur, cell };
    setTimeout(() => {
      if (this.flying?.path === path) this.flying = null;
      let sx = 0;
      let sy = 0;
      for (const [r, c, col] of popped) {
        const [x, y] = b.center(r, c);
        sx += x;
        sy += y;
        this.popping.push({ x, y, color: col, t: 0, fall: false, vx: 0 });
        this.fx.burst(x * U, y * U, EGG[col % EGG.length][0], 8, 190, 5);
      }
      for (const [r, c, col] of fell) {
        const [x, y] = b.center(r, c);
        this.popping.push({ x, y, color: col, t: 0, fall: true, vx: (Math.random() - 0.5) * 1.6 });
      }
      if (popped.length) {
        const n = popped.length;
        if (fell.length) {
          this.fx.text((sx / n) * U, (sy / n) * U - 30, 'Обвал!', '#ffd040', 30);
          this.fx.shake(4 + Math.min(6, fell.length));
        }
      }
    }, dur);
  }

  draw(dt: number, t: number, o: { aimDots: boolean; warn: boolean; out: boolean; dim?: string }) {
    const b = this.b;
    const g = this.g;
    this.fx.update(dt);
    g.save();
    const [ox, oy] = this.fx.offset();
    g.translate(ox, oy);
    drawBack(g, CW, CH, this.bg);
    const jx = o.warn ? Math.sin(t * 40) * 1.5 : 0;
    g.save();
    g.translate(jx, 0);
    drawCeiling(g, CW, 0);
    if (b) {
      const hide = this.flying?.cell;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const v = b.grid[r][c];
          if (v == null || (hide && hide[0] === r && hide[1] === c)) continue;
          const [x, y] = b.center(r, c);
          drawEgg(g, U, x, y, v);
        }
    }
    g.restore();
    let lowest = 0;
    if (b) for (let r = 0; r < ROWS; r++) if (b.grid[r].some((v) => v != null)) lowest = r;
    drawLine(g, U, CW, !o.out && lowest >= DEAD_ROW - 2 ? 0.5 + 0.5 * Math.sin(t * 10) : 0);
    for (const p of this.popping) {
      p.t += dt / 1000 / (p.fall ? 0.9 : 0.25);
      if (p.fall) drawEgg(g, U, p.x + p.t * p.vx, p.y + p.t * p.t * 12, p.color, Math.max(0, 1 - p.t * 0.8), p.t * p.vx * 3);
      else {
        g.save();
        const k = 1 + p.t * 0.4;
        g.translate(p.x * U, p.y * U);
        g.scale(k, k);
        g.translate(-p.x * U, -p.y * U);
        drawEgg(g, U, p.x, p.y, p.color, Math.max(0, 1 - p.t));
        g.restore();
      }
    }
    this.popping = this.popping.filter((p) => p.t < 1);
    if (b && o.aimDots && !this.flying) drawAim(g, U, b.trace(this.aim).path, b.cur);
    if (this.flying) {
      const f = this.flying;
      const [fx, fy] = along(f.path, Math.min(1, (performance.now() - f.t0) / f.dur));
      drawEgg(g, U, fx, fy, f.color);
    }
    const [ex, ey] = drawDino(g, U, this.aim);
    if (b && !this.flying) drawEgg(g, U, ex, ey, b.cur);
    if (b) drawEgg(g, U, FIELD_W / 2 + 1.9, SHOOTER_Y + 1.1, b.next, 0.9);
    this.fx.draw(g);
    if (o.dim) {
      g.fillStyle = 'rgba(20,10,0,0.55)';
      g.fillRect(-8, -8, CW + 16, CH + 16);
      g.fillStyle = '#fff6c0';
      g.font = `900 ${U * 0.8}px 'PT Sans', Arial, sans-serif`;
      g.textAlign = 'center';
      g.fillText(o.dim, CW / 2, CH * 0.45);
    }
    g.restore();
  }
}

/** Мини-поле соперника: сетка кружками (перерисовка, только когда поле поменялось). */
function drawMini(cv: HTMLCanvasElement, v: VsBoardView) {
  const g = cv.getContext('2d')!;
  const W = cv.width;
  const H = cv.height;
  const u = W / FIELD_W;
  g.clearRect(0, 0, W, H);
  g.fillStyle = v.out ? '#3a342e' : '#2e4a1e';
  g.fillRect(0, 0, W, H);
  g.fillStyle = '#5e5850';
  g.fillRect(0, 0, W, u * 0.25);
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const ch = v.g[r * COLS + c];
      if (!ch || ch === '.') continue;
      const x = (c + 0.5 + ((r + v.shift) % 2 === 1 ? 0.5 : 0)) * u;
      const y = (r * 0.866 + 0.5) * u;
      g.fillStyle = EGG[Number(ch) % EGG.length][0];
      g.beginPath();
      g.ellipse(x, y, u * 0.42, u * 0.48, 0, 0, Math.PI * 2);
      g.fill();
    }
  g.strokeStyle = '#e8402a';
  g.lineWidth = Math.max(1, u * 0.08);
  g.beginPath();
  g.moveTo(0, (DEAD_ROW * 0.866 + 0.05) * u);
  g.lineTo(W, (DEAD_ROW * 0.866 + 0.05) * u);
  g.stroke();
  if (v.out) {
    g.strokeStyle = 'rgba(255,80,60,.85)';
    g.lineWidth = u * 0.5;
    g.beginPath();
    g.moveTo(u, u);
    g.lineTo(W - u, H - u);
    g.moveTo(W - u, u);
    g.lineTo(u, H - u);
    g.stroke();
  }
}

export function createView(): GameView<VsView, VsEvent> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let latest: VsView | null = null;
  const own = new Field();
  /** Чужое поле крупно: соперник в дуэли или тот, кого смотрит выбывший. */
  const big = new Field();
  let bigSeat = -1;
  let watch = -1;
  let raf = 0;
  let last = performance.now();
  let t = 0;
  const cleanup: (() => void)[] = [];
  // ввод
  let aim = -Math.PI / 2;
  let shotN = 0;
  let shotAim = aim;
  let swapN = 0;
  let target = -1;
  let sent = { json: '', at: 0 };
  /** Свой выстрел, показанный до ответа комнаты. */
  let pending: { id: number; b: Bubbles; until: number } | null = null;
  let busyUntil = 0;
  const minis = new Map<number, { el: HTMLElement; cv: HTMLCanvasElement; key: string }>();
  let els: { main: HTMLElement; inc: HTMLElement; info: HTMLElement; foes: HTMLElement; foesR: HTMLElement; bigBox: HTMLElement; bigName: HTMLElement; swap: HTMLButtonElement };

  const mySeat = () => (ctx.demo ? -1 : (ctx.mySeats[0] ?? -1));
  const mine = (v: VsView | null) => v?.boards.find((x) => x.seat === mySeat()) ?? null;
  const playing = () => {
    const m = mine(latest);
    return !!m && !m.out && !latest!.over;
  };

  function angleTo(e: PointerEvent) {
    const r = own.cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * FIELD_W;
    const y = ((e.clientY - r.top) / r.height) * FIELD_H;
    return Math.max(-Math.PI + 0.12, Math.min(-0.12, Math.atan2(y - SHOOTER_Y, x - FIELD_W / 2)));
  }

  /** Поле, которое показываем своим: предсказанное после выстрела, пока комната его не подтвердила. */
  function ownBoard(): Bubbles | null {
    const m = mine(latest);
    if (!m || !latest) return null;
    if (pending && (m.shotSeen >= pending.id || performance.now() > pending.until)) pending = null;
    if (pending) return pending.b;
    const b = boardOf(m, latest.colors);
    if (m.swapSeen < swapN) [b.cur, b.next] = [b.next, b.cur];
    return b;
  }

  function fire() {
    if (!playing() || performance.now() < busyUntil || pending) return;
    const b = ownBoard();
    if (!b) return;
    Sound.beep(800, 0.03, 0.08);
    shotN++;
    shotAim = aim;
    const color = b.cur;
    const res = b.shoot(aim);
    if (!res) return;
    pending = { id: shotN, b, until: performance.now() + 1500 };
    own.shot(b, color, res.path, res.cell, res.popped, res.fell);
    busyUntil = performance.now() + Math.max(120, pathLen(res.path) * 28) + 60;
    if (res.popped.length) setTimeout(() => Sound.capture(), pathLen(res.path) * 28);
    send(true);
  }

  function swap() {
    if (!playing()) return;
    swapN++;
    if (pending) [pending.b.cur, pending.b.next] = [pending.b.next, pending.b.cur];
    Sound.ui();
    send(true);
  }

  function send(force = false) {
    if (ctx.demo || !ctx.input || mySeat() < 0 || !playing()) return;
    const inp: VsIn = { aim: Math.round(aim * 1000) / 1000, shot: shotN, shotAim, swap: swapN, target };
    const json = JSON.stringify(inp);
    const now = performance.now();
    if (!force && json === sent.json && now - sent.at < 400) return;
    if (!force && json !== sent.json && now - sent.at < 60) return;
    sent = { json, at: now };
    ctx.input(mySeat(), inp);
  }

  function pickSeat(seat: number) {
    const m = mine(latest);
    if (m && !m.out && !latest?.over) {
      target = target === seat ? -1 : seat;
      Sound.ui();
      send(true);
    } else {
      watch = seat;
      bigSeat = -1;
    }
    drawFoes(true);
  }

  // ---------------------------------------------------------------- соперники

  function bigSeatNow(v: VsView): number {
    const me = mySeat();
    if (v.mode === 'duel' || v.boards.length === 2) return v.boards.find((x) => x.seat !== me)?.seat ?? -1;
    const m = mine(v);
    // выбывший или зритель — смотрит выбранного, иначе живого
    if (!m || m.out || v.over) {
      if (watch >= 0 && v.boards.some((x) => x.seat === watch)) return watch;
      return v.boards.find((x) => !x.out && x.seat !== me)?.seat ?? v.boards.find((x) => x.seat !== me)?.seat ?? -1;
    }
    return -1;
  }

  function drawFoes(force = false) {
    const v = latest;
    if (!v) return;
    const me = mySeat();
    const bs = bigSeatNow(v);
    els.bigBox.hidden = bs < 0;
    if (bs >= 0) {
      const bv = v.boards.find((x) => x.seat === bs)!;
      if (bs !== bigSeat) {
        big.popping = [];
        big.flying = null;
        bigSeat = bs;
      }
      big.b = boardOf(bv, v.colors);
      big.aim = bv.aim;
      big.bg = bs + 1;
      const nm = `${ctx.name(bs)}${bv.out ? ` · выбыл, ${bv.place}-е место` : ''} · ${bv.score}${bv.badges ? ` · ${'★'.repeat(Math.min(4, bv.badges))}` : ''}${bv.inc ? ` · летит ${bv.inc}` : ''}`;
      if (els.bigName.innerHTML !== nm) els.bigName.innerHTML = nm;
    }
    const m = mine(v);
    const tg = m && !m.out ? m.target : -1;
    // соперники — слева и справа от своего поля; справа занято крупным полем — все слева
    const others = v.boards.filter((x) => x.seat !== me);
    const one = bs >= 0 || matchMedia('(max-width: 760px)').matches;
    const half = one ? others.length : Math.ceil(others.length / 2);
    els.foesR.hidden = one;
    for (const bv of v.boards) {
      if (bv.seat === me) continue;
      let mi = minis.get(bv.seat);
      if (!mi) {
        const el = h(`<button class="egv-mini"><canvas width="${Math.round(FIELD_W * MU)}" height="${Math.round((ROWS * 0.866 + 0.3) * MU)}"></canvas><span></span></button>`);
        el.onclick = () => pickSeat(bv.seat);
        els.foes.appendChild(el);
        mi = { el, cv: el.querySelector('canvas') as HTMLCanvasElement, key: '' };
        minis.set(bv.seat, mi);
      }
      const box = others.indexOf(bv) < half ? els.foes : els.foesR;
      if (mi.el.parentElement !== box) box.appendChild(mi.el);
      const key = `${bv.g}|${bv.shift}|${bv.out}`;
      if (force || key !== mi.key) {
        drawMini(mi.cv, bv);
        mi.key = key;
      }
      mi.el.classList.toggle('target', bv.seat === tg);
      mi.el.classList.toggle('picked', bv.seat === target);
      mi.el.classList.toggle('out', bv.out);
      mi.el.classList.toggle('watch', bv.seat === bs);
      mi.el.classList.toggle('danger', !bv.out && bv.inc > 0);
      const label = `${ctx.name(bv.seat)}${bv.badges ? ` <b>${'★'.repeat(Math.min(4, bv.badges))}</b>` : ''}${bv.out ? ` · ${bv.place}` : ''}`;
      const sp = mi.el.lastElementChild as HTMLElement;
      if (sp.innerHTML !== label) sp.innerHTML = label;
    }
  }

  // ---------------------------------------------------------------- кадр

  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden || !latest) return;
    const now = performance.now();
    const dt = Math.min(50, now - last);
    last = now;
    t += dt / 1000;
    const v = latest;
    const m = mine(v);
    const warn = !v.over && v.pushAt - v.t < 1.6;
    if (m) {
      own.b = ownBoard();
      own.aim = m.out ? m.aim : aim;
      own.bg = mySeat();
      own.draw(dt, t, { aimDots: playing() && now >= busyUntil, warn, out: m.out, dim: m.out ? `${m.place}-е место` : v.over && v.winners.includes(m.seat) ? 'Победа!' : undefined });
    }
    if (bigSeat >= 0) {
      const bv = v.boards.find((x) => x.seat === bigSeat);
      big.draw(dt, t, { aimDots: false, warn: warn && !bv?.out, out: !!bv?.out, dim: bv?.out ? `${bv.place}-е место` : undefined });
    }
  }

  function drawInfo() {
    const v = latest;
    if (!v) return;
    const m = mine(v);
    // падлянки, что летят ко мне: столбик яиц, мигает перед наездом
    const inc = m?.inc ?? 0;
    const soon = inc && m!.incAt - v.t < 1.2;
    let s = '';
    for (let i = 0; i < Math.min(12, inc); i++) s += '<i></i>';
    const incHtml = `${s}${inc > 12 ? `<b>+${inc - 12}</b>` : ''}`;
    if (els.inc.innerHTML !== incHtml) els.inc.innerHTML = incHtml;
    els.inc.classList.toggle('soon', !!soon);
    const left = v.boards.filter((x) => !x.out).length;
    const push = Math.max(0, Math.ceil(v.pushAt - v.t));
    const info = `${m ? `<span>очки <b>${m.score}</b></span>` : ''}${m?.badges ? `<span title="за каждого выбитого падлянки сильнее на четверть">${'★'.repeat(Math.min(4, m.badges))} +${Math.min(4, m.badges) * 25}%</span>` : ''}${v.boards.length > 2 ? `<span>осталось <b>${left}</b> из ${v.boards.length}</span>` : ''}<span>ряд через <b>${push}</b> с</span>`;
    if (els.info.innerHTML !== info) els.info.innerHTML = info;
    els.swap.hidden = !playing();
  }

  function onEvents(v: VsView, events: VsEvent[]) {
    const me = mySeat();
    for (const ev of events) {
      if (ev.k === 'shot') {
        if (ev.seat === me) continue; // свой выстрел уже нарисован
        if (ev.seat === bigSeat && big.b) {
          const prev = big.b;
          big.shot(prev, ev.color, ev.path, ev.cell, ev.popped, ev.fell);
        }
      } else if (ev.k === 'attack') {
        if (ev.to === me) {
          Sound.beep(300, 0.12, 0.12);
          own.fx.text(CW / 2, CH * 0.2, `Падлянка ×${ev.n}!`, '#ff8060', 30);
        }
        if (ev.from === me) own.fx.text(CW / 2, CH * 0.62, `→ ${ev.n}`, '#c0ff90', 30);
        const mi = minis.get(ev.to);
        if (mi) {
          mi.el.classList.remove('hit');
          void mi.el.offsetWidth;
          mi.el.classList.add('hit');
        }
      } else if (ev.k === 'cancel' && ev.seat === me) own.fx.text(CW / 2, CH * 0.5, `Погашено ${ev.n}`, '#a0e0ff', 26);
      else if (ev.k === 'land' && ev.seat === me) {
        own.fx.shake(6, 0.4);
        Sound.beep(110, 0.2, 0.2);
      } else if (ev.k === 'push') {
        if (mine(v) && !mine(v)!.out) own.fx.shake(4, 0.3);
        Sound.beep(120, 0.15, 0.15);
      } else if (ev.k === 'clear' && ev.seat === me) own.fx.text(CW / 2, CH * 0.4, 'Чисто!', '#ffd040', 40);
      else if (ev.k === 'out') {
        if (ev.seat === me) Sound.nomove();
        else if (ev.by === me) {
          own.fx.text(CW / 2, CH * 0.35, 'Выбил! ★', '#ffd040', 36);
          Sound.capture();
        }
      } else if (ev.k === 'end' && ev.winners.includes(me)) Sound.win();
    }
  }

  function build() {
    root.innerHTML = '';
    const el = h(`<div class="egv">
      <div class="egv-foes"></div>
      <div class="egv-mainbox">
        <div class="egv-info"></div>
        <div class="egv-main"><div class="egv-inc" title="Падлянки, что летят к вам: успейте погасить своим удачным выстрелом"></div></div>
        <div class="egv-btns"><button class="btn" data-b="swap">⇄ Поменять</button></div>
      </div>
      <div class="egv-big" hidden><div class="egv-bigname"></div></div>
      <div class="egv-foes egv-foes-r"></div>
    </div>`);
    root.appendChild(el);
    const q = (s: string) => el.querySelector(s) as HTMLElement;
    els = { main: q('.egv-main'), inc: q('.egv-inc'), info: q('.egv-info'), foes: q('.egv-foes'), foesR: q('.egv-foes-r'), bigBox: q('.egv-big'), bigName: q('.egv-bigname'), swap: q('[data-b=swap]') as HTMLButtonElement };
    els.main.appendChild(own.cv);
    els.bigBox.appendChild(big.cv);
    els.swap.onclick = () => {
      els.swap.blur();
      swap();
    };
    big.cv.onclick = () => {
      if (bigSeat >= 0 && latest && latest.mode !== 'duel' && playing()) pickSeat(bigSeat);
    };
    own.cv.addEventListener('pointermove', (e) => {
      if (!playing()) return;
      aim = angleTo(e);
      send();
    });
    own.cv.addEventListener('pointerdown', (e) => {
      Sound.unlock();
      if (!playing()) return;
      aim = angleTo(e);
      fire();
    });
    minis.clear();
  }

  return {
    mount(el, c) {
      ctx = c;
      root = h(`<div class="egv-root"></div>`);
      el.appendChild(root);
      build();
      const onKey = (e: KeyboardEvent) => {
        if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
        if (e.code === 'Space') {
          e.preventDefault();
          swap();
        }
      };
      window.addEventListener('keydown', onKey);
      cleanup.push(() => window.removeEventListener('keydown', onKey));
      raf = requestAnimationFrame(frame);
      const iv = setInterval(() => send(), 50);
      cleanup.push(() => clearInterval(iv));
    },
    setView(v) {
      const first = !latest;
      latest = v;
      root.classList.toggle('duel', v.mode === 'duel' || v.boards.length === 2);
      if (first) {
        // вернулись за стол: счётчики — с того места, где их видит комната
        const m = mine(v);
        if (m) {
          shotN = m.shotSeen;
          swapN = m.swapSeen;
        }
      }
      drawFoes(true);
      drawInfo();
    },
    async play(_ev, v) {
      this.setView(v);
    },
    realtime(v, events) {
      if (!latest) return this.setView(v);
      onEvents(v, events);
      latest = v;
      if (import.meta.env.DEV) (window as unknown as { __egv: VsView }).__egv = v;
      drawFoes();
      drawInfo();
    },
    setTurn() {},
    status(v) {
      if (!v) return '';
      if (v.over) return v.winners.length === 1 ? `Победил ${ctx.name(v.winners[0])}` : 'Ничья';
      const m = mine(v);
      if (m?.out) return `Вы выбыли — ${m.place}-е место. Нажмите на поле соперника, чтобы смотреть его.`;
      const left = v.boards.filter((x) => !x.out).length;
      return v.boards.length > 2 ? `Битва: осталось ${left} из ${v.boards.length}` : 'Дуэль: кто продержится дольше';
    },
    playerStats(v, seat) {
      const b = v?.boards.find((x) => x.seat === seat);
      if (!b) return '';
      return `${b.out ? `выбыл, ${b.place}-е` : `очки <b>${b.score}</b>`}${b.ko ? ` · выбил ${b.ko}` : ''}`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      root?.remove();
    },
  };
}
