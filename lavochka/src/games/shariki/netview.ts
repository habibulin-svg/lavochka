/* «Шарики» по сети — экран стола: своя цепочка крупно (между снимками комнаты задний кусок доезжает сам, выстрелы летят по скорости,
 * свой выстрел виден сразу), полоска серых шаров, что летят к тебе, поля соперников: в дуэли — рядом, в битве — мини-поля вокруг
 * (нажатие — бить его; выбывшему — смотреть его крупно). На телефоне стоя своё поле повёрнуто на 90°, как в одиночной игре. */
import { Fx } from '../../core/arcade-fx';
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import '../../core/vs.css';
import type { GameView, ViewCtx } from '../../core/view';
import { D, FH, FW, GRAY, pathOf, type LevelSpec } from './logic';
import { colorOf, drawAimDots, drawBall, drawDanger, drawFrog, drawGroove, drawHole, drawYard } from './paint';
import type { VsBoardView, VsEvent, VsIn, VsView } from './versus';
import './shariki.css';

const MW = 96;

/** Точка пути по длине s. */
function at(pts: [number, number][], s: number): [number, number] {
  const i = Math.max(0, Math.min(pts.length - 1, s / 2));
  const i0 = Math.floor(i);
  const i1 = Math.min(pts.length - 1, i0 + 1);
  const k = i - i0;
  return [pts[i0][0] + (pts[i1][0] - pts[i0][0]) * k, pts[i0][1] + (pts[i1][1] - pts[i0][1]) * k];
}

const colorAt = (ch: string) => (ch === 'g' ? GRAY : Number(ch));

/** Поле на холсте. */
class Field {
  readonly cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  fx = new Fx();
  kick = 0;
  turned = false;
  constructor() {
    this.cv = h<HTMLCanvasElement>(`<canvas></canvas>`);
    this.g = this.cv.getContext('2d')!;
    this.layout(false);
  }

  layout(turned: boolean) {
    this.turned = turned;
    this.cv.width = (turned ? FH : FW) * 2;
    this.cv.height = (turned ? FW : FH) * 2;
    if (turned) this.g.setTransform(0, 2, -2, 0, FH * 2, 0);
    else this.g.setTransform(2, 0, 0, 2, 0, 0);
    this.fx.textAngle = turned ? -Math.PI / 2 : 0;
  }

  /** Точка экрана → точка поля. */
  local(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    return this.turned ? { x: v * FW, y: (1 - u) * FH } : { x: u * FW, y: v * FH };
  }

  draw(dt: number, t: number, spec: LevelSpec, b: VsBoardView, since: number, o: { aim: number; aimDots: boolean; cur: number; next: number; ghosts: { x: number; y: number; color: number }[]; dim?: string; bg: number }) {
    const g = this.g;
    const pts = pathOf(spec).pts;
    this.fx.update(dt);
    this.kick = Math.max(0, this.kick - dt / 180);
    g.save();
    const [ox, oy] = this.fx.offset();
    g.translate(ox, oy);
    drawYard(g, o.bg);
    drawGroove(g, pts);
    const pulse = !b.out && b.danger > 0.8 ? 0.5 + 0.5 * Math.sin(t * 12) : 0;
    drawHole(g, pts, pulse);
    // цепочка: задний кусок доезжает по скорости со времени снимка
    const ahead = Math.min(0.2, since) * b.v;
    const list: [number, number][] = [];
    b.ch.forEach(([s0, cols], gi) => {
      for (let i = 0; i < cols.length; i++) list.push([s0 + i * D + (gi === 0 ? ahead : 0), colorAt(cols[i])]);
    });
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (const [s] of list) {
      if (s < 0) continue;
      const [x, y] = at(pts, s);
      g.beginPath();
      g.arc(x + 3, y + 4, D / 2, 0, Math.PI * 2);
      g.fill();
    }
    for (const [s, c] of list) {
      if (s < 0) continue;
      const [x, y] = at(pts, s);
      drawBall(g, x, y, c, D / 2, s / (D / 2));
    }
    const k = Math.min(0.2, since);
    for (const [x, y, vx, vy, c] of b.shots) drawBall(g, x + vx * k, y + vy * k, c, D / 2, t * 10);
    for (const s of o.ghosts) drawBall(g, s.x, s.y, s.color, D / 2, t * 10);
    const { x, y } = spec.frog;
    if (o.aimDots) drawAimDots(g, x, y, o.aim, o.cur);
    drawFrog(g, x, y, o.aim, this.kick, o.cur, o.next);
    this.fx.draw(g);
    g.restore();
    drawDanger(g, pulse);
    if (o.dim) {
      g.fillStyle = 'rgba(20,10,0,0.55)';
      g.fillRect(0, 0, FW, FH);
      g.save();
      g.translate(FW / 2, FH / 2);
      if (this.turned) g.rotate(-Math.PI / 2);
      g.fillStyle = '#fff6c0';
      g.font = `900 54px 'PT Sans', Arial, sans-serif`;
      g.textAlign = 'center';
      g.fillText(o.dim, 0, 0);
      g.restore();
    }
  }
}

/** Мини-поле: канавка тонкой линией и цепочка точками. */
function drawMini(cv: HTMLCanvasElement, spec: LevelSpec, v: VsBoardView) {
  const g = cv.getContext('2d')!;
  const k = cv.width / FW;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = v.out ? '#3a342e' : '#6a5a3a';
  g.fillRect(0, 0, cv.width, cv.height);
  g.setTransform(k, 0, 0, k, 0, 0);
  const pts = pathOf(spec).pts;
  g.strokeStyle = 'rgba(30,20,10,.7)';
  g.lineWidth = D;
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < pts.length; i += 6) (i ? g.lineTo(pts[i][0], pts[i][1]) : g.moveTo(pts[i][0], pts[i][1]));
  g.stroke();
  const [hx, hy] = pts[pts.length - 1];
  g.fillStyle = v.danger > 0.8 && !v.out ? '#ff3020' : '#000';
  g.beginPath();
  g.arc(hx, hy, 34, 0, Math.PI * 2);
  g.fill();
  for (const [s0, cols] of v.ch)
    for (let i = 0; i < cols.length; i++) {
      const s = s0 + i * D;
      if (s < 0) continue;
      const [x, y] = at(pts, s);
      g.fillStyle = colorOf(colorAt(cols[i]))[0];
      g.beginPath();
      g.arc(x, y, D * 0.5, 0, Math.PI * 2);
      g.fill();
    }
  if (v.out) {
    g.strokeStyle = 'rgba(255,80,60,.85)';
    g.lineWidth = 40;
    g.beginPath();
    g.moveTo(80, 80);
    g.lineTo(FW - 80, FH - 80);
    g.moveTo(FW - 80, 80);
    g.lineTo(80, FH - 80);
    g.stroke();
  }
}

export function createView(): GameView<VsView, VsEvent> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let latest: VsView | null = null;
  let latestAt = 0;
  const own = new Field();
  const big = new Field();
  let bigSeat = -1;
  let watch = -1;
  let raf = 0;
  let last = performance.now();
  let t = 0;
  const cleanup: (() => void)[] = [];
  let aim = -Math.PI / 2;
  let shotN = 0;
  let shotAim = aim;
  let swapN = 0;
  let target = -1;
  let sent = { json: '', at: 0 };
  /** Свои выстрелы, показанные до ответа комнаты. */
  let ghosts: { id: number; x: number; y: number; vx: number; vy: number; color: number; t0: number }[] = [];
  const minis = new Map<number, { el: HTMLElement; cv: HTMLCanvasElement; key: string }>();
  let els: { inc: HTMLElement; info: HTMLElement; foes: HTMLElement; foesR: HTMLElement; bigBox: HTMLElement; bigName: HTMLElement; swap: HTMLButtonElement };

  /** Чьё поле крупно: своё, а у зрителя (и в превью) — первого игрока. */
  const mySeat = () => (!ctx.demo && ctx.mySeats.length ? ctx.mySeats[0] : (latest?.boards[0]?.seat ?? -1));
  const seated = () => !ctx.demo && ctx.mySeats.includes(mySeat());
  const mine = (v: VsView | null) => v?.boards.find((x) => x.seat === mySeat()) ?? null;
  const playing = () => {
    const m = mine(latest);
    return seated() && !!m && !m.out && !latest!.over;
  };
  const tall = () => matchMedia('(max-width: 760px)').matches && innerHeight > innerWidth;

  /** Шары во рту и на спине — с учётом своих ещё не подтверждённых выстрелов и обменов. */
  function loaded(m: VsBoardView): [number, number] {
    let cur = m.cur;
    let next = m.next;
    if (m.swapSeen < swapN) [cur, next] = [next, cur];
    if (ghosts.length && m.shotSeen < shotN) return [next, -1];
    return [cur, next];
  }

  function fire() {
    const m = mine(latest);
    if (!m || !playing() || !latest) return;
    if (m.shots.length + ghosts.length >= 2 || (ghosts.length && m.shotSeen < shotN)) return;
    const [cur] = loaded(m);
    const { x, y } = latest.spec.frog;
    shotN++;
    shotAim = aim;
    ghosts.push({ id: shotN, x: x + Math.cos(aim) * 30, y: y + Math.sin(aim) * 30, vx: Math.cos(aim) * 900, vy: Math.sin(aim) * 900, color: cur, t0: performance.now() });
    own.kick = 1;
    Sound.beep(900, 0.03, 0.08);
    send(true);
  }

  function swap() {
    if (!playing()) return;
    swapN++;
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

  function bigSeatNow(v: VsView): number {
    const me = mySeat();
    if (v.mode === 'duel' || v.boards.length === 2) return v.boards.find((x) => x.seat !== me)?.seat ?? -1;
    const m = mine(v);
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
    bigSeat = bs;
    if (bs >= 0) {
      const bv = v.boards.find((x) => x.seat === bs)!;
      const nm = `${ctx.name(bs)}${bv.out ? ` · выбыл, ${bv.place}-е место` : ''} · ${bv.score}${bv.badges ? ` · ${'★'.repeat(Math.min(4, bv.badges))}` : ''}${bv.inc ? ` · летит ${bv.inc}` : ''}`;
      if (els.bigName.innerHTML !== nm) els.bigName.innerHTML = nm;
    }
    const m = mine(v);
    const tg = m && !m.out ? m.target : -1;
    const others = v.boards.filter((x) => x.seat !== me);
    const one = bs >= 0 || matchMedia('(max-width: 760px)').matches;
    const half = one ? others.length : Math.ceil(others.length / 2);
    els.foesR.hidden = one;
    for (const bv of others) {
      let mi = minis.get(bv.seat);
      if (!mi) {
        const el = h(`<button class="egv-mini"><canvas width="${MW}" height="${Math.round((MW * FH) / FW)}"></canvas><span></span></button>`);
        el.onclick = () => pickSeat(bv.seat);
        mi = { el, cv: el.querySelector('canvas') as HTMLCanvasElement, key: '' };
        minis.set(bv.seat, mi);
      }
      const box = others.indexOf(bv) < half ? els.foes : els.foesR;
      if (mi.el.parentElement !== box) box.appendChild(mi.el);
      const key = JSON.stringify(bv.ch) + bv.out;
      if (force || key !== mi.key) {
        drawMini(mi.cv, v.spec, bv);
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

  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden || !latest) return;
    const now = performance.now();
    const dt = Math.min(50, now - last);
    last = now;
    t += dt / 1000;
    const v = latest;
    const since = (now - latestAt) / 1000;
    const m = mine(v);
    if (tall() !== own.turned) own.layout(tall());
    if (m) {
      // свой выстрел летит, пока комната его не подтвердила (не дольше полсекунды)
      ghosts = ghosts.filter((s) => m.shotSeen < s.id && now - s.t0 < 500);
      const gs = ghosts.map((s) => ({ x: s.x + (s.vx * (now - s.t0)) / 1000, y: s.y + (s.vy * (now - s.t0)) / 1000, color: s.color }));
      const [cur, next] = loaded(m);
      own.draw(dt, t, v.spec, m, since, { aim: playing() ? aim : m.aim, aimDots: playing(), cur: m.out ? -1 : cur, next: m.out ? -1 : next, ghosts: gs, bg: mySeat(), dim: m.out ? `${m.place}-е место` : v.over && v.winners.includes(m.seat) ? 'Победа!' : undefined });
    }
    if (bigSeat >= 0) {
      const bv = v.boards.find((x) => x.seat === bigSeat);
      if (bv) big.draw(dt, t, v.spec, bv, since, { aim: bv.aim, aimDots: false, cur: bv.out ? -1 : bv.cur, next: bv.out ? -1 : bv.next, ghosts: [], bg: bigSeat + 1, dim: bv.out ? `${bv.place}-е место` : undefined });
    }
  }

  function drawInfo() {
    const v = latest;
    if (!v) return;
    const m = mine(v);
    const inc = m?.inc ?? 0;
    const soon = inc && m!.incAt - v.t < 1.2;
    let s = '';
    for (let i = 0; i < Math.min(12, inc); i++) s += '<i class="gray"></i>';
    const incHtml = `${s}${inc > 12 ? `<b>+${inc - 12}</b>` : ''}`;
    if (els.inc.innerHTML !== incHtml) els.inc.innerHTML = incHtml;
    els.inc.classList.toggle('soon', !!soon);
    const left = v.boards.filter((x) => !x.out).length;
    const info = `${m ? `<span>очки <b>${m.score}</b></span>` : ''}${m?.badges ? `<span title="за каждого выбитого атаки сильнее на четверть">${'★'.repeat(Math.min(4, m.badges))} +${Math.min(4, m.badges) * 25}%</span>` : ''}${v.boards.length > 2 ? `<span>осталось <b>${left}</b> из ${v.boards.length}</span>` : ''}<span>${Math.floor(v.t / 60)}:${String(Math.floor(v.t % 60)).padStart(2, '0')}</span>`;
    if (els.info.innerHTML !== info) els.info.innerHTML = info;
    els.swap.hidden = !playing();
  }

  function onEvents(v: VsView, events: VsEvent[]) {
    const me = mySeat();
    for (const ev of events) {
      if (ev.k === 'pop') {
        const f = ev.seat === me ? own : ev.seat === bigSeat ? big : null;
        if (!f) continue;
        const [c] = colorOf(ev.color);
        for (const [x, y] of ev.pts) f.fx.burst(x, y, c, 7, 200, 4);
        const [mx, my] = ev.pts[ev.pts.length >> 1];
        if (ev.seat === me) {
          f.fx.text(mx, my - 14, `+${ev.points}`, '#fff6c0', 30);
          Sound.beep(1200 + Math.min(6, ev.combo) * 260, 0.06, 0.1);
          Sound.capture();
        }
        if (ev.combo > 1) {
          f.fx.text(mx, my - 44, `Комбо ×${ev.combo}`, '#ffd040', 36 + Math.min(4, ev.combo) * 4);
          f.fx.shake(3 + ev.combo * 1.5);
        }
      } else if (ev.k === 'attack') {
        if (ev.to === me) {
          Sound.beep(300, 0.12, 0.12);
          own.fx.text(FW / 2, FH * 0.2, `Летят серые ×${ev.n}!`, '#ff8060', 30);
        }
        if (ev.from === me) own.fx.text(FW / 2, FH * 0.75, `→ ${ev.n}`, '#c0ff90', 30);
        const mi = minis.get(ev.to);
        if (mi) {
          mi.el.classList.remove('hit');
          void mi.el.offsetWidth;
          mi.el.classList.add('hit');
        }
      } else if (ev.k === 'cancel' && ev.seat === me) own.fx.text(FW / 2, FH * 0.3, `Погашено ${ev.n}`, '#a0e0ff', 26);
      else if (ev.k === 'land' && ev.seat === me) {
        own.fx.shake(6, 0.4);
        Sound.beep(110, 0.2, 0.2);
      } else if (ev.k === 'out') {
        if (ev.seat === me) Sound.nomove();
        else if (ev.by === me) {
          own.fx.text(FW / 2, FH * 0.4, 'Выбил! ★', '#ffd040', 36);
          Sound.capture();
        }
      } else if (ev.k === 'end' && ev.winners.includes(me)) Sound.win();
    }
  }

  function build() {
    root.innerHTML = '';
    const el = h(`<div class="egv zmv">
      <div class="egv-foes"></div>
      <div class="egv-mainbox">
        <div class="egv-info"></div>
        <div class="egv-main"><div class="egv-inc" title="Серые шары, что летят к вам: успейте погасить своей тройкой или комбо"></div></div>
        <div class="egv-btns"><button class="btn" data-b="swap">⇄ Поменять</button></div>
      </div>
      <div class="egv-big" hidden><div class="egv-bigname"></div></div>
      <div class="egv-foes egv-foes-r"></div>
    </div>`);
    root.appendChild(el);
    const q = (s: string) => el.querySelector(s) as HTMLElement;
    els = { inc: q('.egv-inc'), info: q('.egv-info'), foes: q('.egv-foes'), foesR: q('.egv-foes-r'), bigBox: q('.egv-big'), bigName: q('.egv-bigname'), swap: q('[data-b=swap]') as HTMLButtonElement };
    q('.egv-main').appendChild(own.cv);
    els.bigBox.appendChild(big.cv);
    els.swap.onclick = () => {
      els.swap.blur();
      swap();
    };
    big.cv.onclick = () => {
      if (bigSeat >= 0 && latest && latest.mode !== 'duel' && playing()) pickSeat(bigSeat);
    };
    const aimAt = (e: PointerEvent) => {
      if (!latest) return;
      const p = own.local(e);
      const { x, y } = latest.spec.frog;
      aim = Math.atan2(p.y - y, p.x - x);
    };
    own.cv.addEventListener('pointermove', (e) => {
      if (!playing()) return;
      aimAt(e);
      send();
    });
    own.cv.addEventListener('pointerdown', (e) => {
      Sound.unlock();
      if (!playing()) return;
      if (e.button === 2) return swap();
      aimAt(e);
      fire();
    });
    own.cv.addEventListener('contextmenu', (e) => e.preventDefault());
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
      latestAt = performance.now();
      root.classList.toggle('duel', v.mode === 'duel' || v.boards.length === 2);
      if (first) {
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
      latestAt = performance.now();
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
