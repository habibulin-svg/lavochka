/* Настольный хоккей — экран: 3D-стол, плавное движение между снимками комнаты, управление штангами, звук.
 * Клавиши «по экрану»: та пара стрелок, что идёт вдоль прорези на экране, — двигает фигурку, другая — крутит.
 * Один игрок на экране: полевой — стрелки или мышь, вратарь — WASD (или сам). Двое за одним экраном: красные — WASD, синие — стрелки, вратари сами. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { speedRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { botInput } from './ai';
import { slotAt, slotDir, slotNearest, SLOTS, type HkEvent, type HkIn, type HkState, type RodIn } from './engine';
import { Rink3D, type Cam } from './scene';
import './hockey.css';

export const PREF_CAM = 'hockey.cam';
export const PREF_MOUSE = 'hockey.mouse';
export const PREF_GOALIE = 'hockey.goalie';

const TEAM = ['Красные', 'Синие'];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Snap {
  t: number;
  v: HkState;
}

function mix(a: HkState, b: HkState, t: number): HkState {
  const jump = Math.hypot(b.puck.x - a.puck.x, b.puck.y - a.puck.y) > 0.08;
  return {
    ...b,
    figs: b.figs.map((f, i) => ({ ...f, s: lerp(a.figs[i].s, f.s, t), a: lerp(a.figs[i].a, f.a, t) })),
    puck: jump ? b.puck : { ...b.puck, x: lerp(a.puck.x, b.puck.x, t), y: lerp(a.puck.y, b.puck.y, t) },
  };
}

export function createView(): GameView<HkState, HkEvent> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let rink: Rink3D;
  let hud: HTMLElement;
  let banner: HTMLElement;
  let raf = 0;
  let snaps: Snap[] = [];
  let latest: HkState | null = null;
  let bannerT = 0;
  const keys = new Set<string>();
  /** Ввод каждого своего места, выбор фигурки, счётчик стука, «вратарь сам», мышь. */
  const pick: Record<number, { idx: number; auto: number }> = {};
  const knockN: Record<number, number> = {};
  const goalieMem: Record<number, Record<string, any>> = {};
  let goalieTouched = false;
  const mouse = { on: false, x: 0, y: 0, p: null as [number, number] | null, aT: 0, fig: -1 };
  const sent: Record<number, { json: string; at: number }> = {};
  /** Скорость, выбранная за столом (уходит в ввод, пока не выберут другую). */
  let spReq: number | undefined;
  const cleanup: (() => void)[] = [];
  let speedEl: (HTMLElement & { sync?: () => void }) | null = null;
  let seatsKey = '';

  const mine = () => ctx.mySeats.filter((s) => s === 0 || s === 1);
  const hotseat = () => mine().length > 1;
  const camMode = (): Cam => (!mine().length ? 'corner' : hotseat() ? 'side' : store.get<string>(PREF_CAM, 'end') === 'side' ? 'side' : 'end');
  const myTeam = (): 0 | 1 => (mine()[0] === 1 ? 1 : 0);

  function current(): HkState | null {
    if (!snaps.length) return latest;
    const delay = ctx.online ? 85 : 22;
    const t = performance.now() - delay;
    while (snaps.length > 2 && snaps[1].t <= t) snaps.shift();
    const [a, b] = snaps;
    if (!b || t <= a.t) return a.v;
    if (t >= b.t) return b.v;
    return mix(a.v, b.v, (t - a.t) / (b.t - a.t));
  }

  /** Раскладка пары клавиш для фигурки: h — ←/→ (−1…1), v — ↑/↓ (↑ = +1). */
  function rodFromKeys(st: HkState, i: number, hk: number, vk: number): RodIn {
    const sl = SLOTS[i];
    const f = st.figs[i];
    const [x, y] = slotAt(sl, f.s);
    const p0 = sl.pts[0];
    const p1 = sl.pts[sl.pts.length - 1];
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    const [sx, sy] = rink.screenDir(x, y, (p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L);
    const e1 = rink.screenDir(x, y, 1, 0);
    const e2 = rink.screenDir(x, y, 0, 1);
    const cw = e1[0] * e2[1] - e1[1] * e2[0] > 0 ? 1 : -1;
    if (Math.abs(sx) >= Math.abs(sy)) return { m: hk * Math.sign(sx), r: vk * cw };
    return { m: vk * Math.sign(-sy), r: hk * cw };
  }

  const axis = (neg: string, pos: string) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);

  function buildInput(st: HkState, seat: number): HkIn {
    const team = seat as 0 | 1;
    const pk = (pick[seat] ??= { idx: -1, auto: st.auto[team] });
    // выбор вручную держится, пока автомат не захотел другую фигурку
    if (pk.idx >= 0 && st.auto[team] !== pk.auto) pk.idx = -1;
    const fk = pk.idx >= 1 ? pk.idx : st.active[team];
    const fi = team * 6 + fk;
    const hs = hotseat();
    let f: RodIn;
    if (hs) {
      f = seat === 0 ? rodFromKeys(st, fi, axis('KeyA', 'KeyD'), axis('KeyS', 'KeyW')) : rodFromKeys(st, fi, axis('ArrowLeft', 'ArrowRight'), axis('ArrowDown', 'ArrowUp'));
    } else f = rodFromKeys(st, fi, axis('ArrowLeft', 'ArrowRight'), axis('ArrowDown', 'ArrowUp'));
    // мышь ведёт полевого первого своего места
    if (mouse.on && seat === mine()[0] && mouse.p) {
      if (mouse.fig !== fi) {
        mouse.fig = fi;
        mouse.aT = st.figs[fi].a;
      }
      f = { m: 0, r: 0, s: slotNearest(SLOTS[fi], mouse.p[0], mouse.p[1]).s, a: mouse.aT };
    }
    // вратарь: WASD (если игрок за экраном один) или сам
    let g: RodIn;
    const auto = hs || store.get<string>(PREF_GOALIE, 'wasd') === 'auto' || !goalieTouched;
    if (auto) g = botInput(st, seat, 1, (goalieMem[seat] ??= {}), { next: Math.random, int: (n) => Math.floor(Math.random() * n), getState: () => 0 }).g;
    else g = rodFromKeys(st, team * 6, axis('KeyA', 'KeyD'), axis('KeyS', 'KeyW'));
    const out: HkIn = { f, g, pick: pk.idx, knock: knockN[seat] ?? 0 };
    if (spReq != null) out.sp = spReq;
    return out;
  }

  function sendInputs(st: HkState) {
    if (ctx.demo || !ctx.input || st.over) return;
    const now = performance.now();
    for (const seat of mine()) {
      const inp = buildInput(st, seat);
      const json = JSON.stringify(inp);
      const last = sent[seat];
      if (last && last.json === json && now - last.at < 400) continue;
      sent[seat] = { json, at: now };
      ctx.input(seat, inp);
    }
  }

  function highlights(st: HkState): [number, number][] {
    const out: [number, number][] = [];
    for (const seat of mine()) {
      const team = seat as 0 | 1;
      const pk = pick[seat];
      const fk = pk && pk.idx >= 1 ? pk.idx : st.active[team];
      out.push([team * 6 + fk, pk && pk.idx >= 1 ? 0.95 : 0.6]);
    }
    return out;
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const st = current();
    if (!st) return;
    rink.setCamera(camMode(), myTeam());
    rink.update(st, highlights(latest ?? st));
    rink.render();
    drawHud(latest ?? st);
    if (bannerT && performance.now() > bannerT) {
      banner.hidden = true;
      bannerT = 0;
    }
  }

  function drawHud(st: HkState) {
    const left = st.limit > 0 ? Math.max(0, st.limit - st.t) : st.t;
    const sec = Math.ceil(left);
    const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const html = `<b class="r">${st.score[0]}</b><span class="t">${time}</span><b class="b">${st.score[1]}</b>`;
    if (hud.dataset.h !== html) {
      hud.innerHTML = html;
      hud.dataset.h = html;
    }
  }

  function showBanner(title: string, sub = '', ms = 1600) {
    banner.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    banner.hidden = false;
    bannerT = ms > 0 ? performance.now() + ms : 0;
  }

  // ---------------------------------------------------------------- звук

  function sound(ev: HkEvent) {
    const o = audioOut();
    if (!o) return;
    const t = o.ctx.currentTime;
    if (ev.k === 'hit') {
      const s = Math.min(1, ev.st / 2);
      // жесть о шайбу: звонкий щелчок
      click(t, { freq: 2600 + Math.random() * 900, q: 5, dur: 0.035, gain: 0.25 + 0.5 * s });
      tone(t, { freq: 1500 + Math.random() * 300, to: 900, dur: 0.05, gain: 0.05 + 0.08 * s, type: 'triangle' });
    } else if (ev.k === 'wall') {
      const s = Math.min(1, ev.st / 2);
      click(t, { freq: 700 + Math.random() * 300, q: 2, dur: 0.06, gain: 0.25 + 0.5 * s });
      tone(t, { freq: 170, to: 90, dur: 0.07, gain: 0.12 + 0.2 * s });
    } else if (ev.k === 'post') {
      click(t, { freq: 1300, q: 3, dur: 0.05, gain: 0.5 });
      tone(t, { freq: 420, to: 260, dur: 0.08, gain: 0.14, type: 'triangle' });
    } else if (ev.k === 'goal') {
      click(t, { freq: 900, q: 1.5, dur: 0.12, gain: 0.6 });
      for (let i = 0; i < 6; i++) click(t + 0.05 + i * 0.03, { freq: 1800 + Math.random() * 1500, q: 3, dur: 0.03, gain: 0.25 });
      whistle(t + 0.15, 0.5);
    } else if (ev.k === 'drop') whistle(t, 0.22);
    else if (ev.k === 'knock') {
      tone(t, { freq: 140, to: 70, dur: 0.09, gain: 0.35 });
      click(t, { freq: 500, q: 1.5, dur: 0.07, gain: 0.5 });
      tone(t + 0.12, { freq: 130, to: 70, dur: 0.09, gain: 0.3 });
      click(t + 0.12, { freq: 480, q: 1.5, dur: 0.07, gain: 0.45 });
    } else if (ev.k === 'end') whistle(t, 0.9);
  }

  function whistle(t: number, dur: number) {
    tone(t, { freq: 2900, to: 2750, dur, gain: 0.07, type: 'sine' });
    tone(t, { freq: 3020, to: 2880, dur, gain: 0.05, type: 'sine' });
  }

  // ---------------------------------------------------------------- управление

  function onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
    const c = e.code;
    const known = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'Comma', 'Period'];
    if (!known.includes(c)) return;
    e.preventDefault();
    Sound.unlock();
    if (!down) return void keys.delete(c);
    if (keys.has(c)) return;
    keys.add(c);
    if (c.startsWith('Arrow')) mouse.on = false;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(c)) goalieTouched = true;
    const st = latest;
    if (!st) return;
    if (c === 'Space') for (const s of mine()) knockN[s] = (knockN[s] ?? 0) + 1;
    const cycle = (seat: number, d: number) => {
      const pk = (pick[seat] ??= { idx: -1, auto: st.auto[seat as 0 | 1] });
      const cur = pk.idx >= 1 ? pk.idx : st.active[seat as 0 | 1];
      pk.idx = ((cur - 1 + d + 5) % 5) + 1;
      pk.auto = st.auto[seat as 0 | 1];
    };
    if (hotseat()) {
      if (c === 'KeyQ' || c === 'KeyE') cycle(0, c === 'KeyQ' ? -1 : 1);
      if (c === 'Comma' || c === 'Period') cycle(1, c === 'Comma' ? -1 : 1);
    } else if ((c === 'KeyQ' || c === 'KeyE') && mine().length) cycle(mine()[0], c === 'KeyQ' ? -1 : 1);
  }

  function onPointer(e: PointerEvent, kind: 'down' | 'move' | 'leave') {
    if (ctx.demo || !mine().length) return;
    if (kind === 'leave') {
      if (e.pointerType === 'mouse') mouse.on = false;
      return;
    }
    const p = rink.pickIce(e.clientX, e.clientY);
    if (kind === 'down') {
      Sound.unlock();
      // щелчок по своему полевому — взять его вручную
      const fi = rink.pickFig(e.clientX, e.clientY);
      const seat = mine()[0];
      const st = latest;
      if (st && fi >= 0 && fi % 6 !== 0 && Math.floor(fi / 6) === seat) {
        pick[seat] = { idx: fi % 6, auto: st.auto[seat as 0 | 1] };
        mouse.fig = -1;
      }
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    if (!p) return;
    const st = latest;
    const wheel = store.get<string>(PREF_MOUSE, 'drag') === 'wheel' && e.pointerType === 'mouse';
    if (mouse.on && mouse.p && st && mouse.fig >= 0 && !wheel) {
      // поперёк прорези — крутить: смещение влево от направления прорези — против часовой
      const f = st.figs[mouse.fig];
      const [tx, ty] = slotDir(SLOTS[mouse.fig], f.s);
      const dx = p[0] - mouse.p[0];
      const dy = p[1] - mouse.p[1];
      mouse.aT += (tx * dy - ty * dx) / 0.035;
    }
    mouse.p = p;
    mouse.on = true;
  }

  function onWheel(e: WheelEvent) {
    if (store.get<string>(PREF_MOUSE, 'drag') !== 'wheel' || !mine().length) return;
    e.preventDefault();
    const d = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    mouse.aT -= d * 0.008;
    mouse.on = true;
  }

  // ---------------------------------------------------------------- панель

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    const seg = (key: string, def: string, opts: [string, string][], title: string) => {
      const row = h(`<div class="hk-pref"><span>${title}</span><div class="seg"></div></div>`);
      const s = row.querySelector('.seg') as HTMLElement;
      for (const [v, label] of opts) {
        const b = h<HTMLButtonElement>(`<button data-v="${v}">${label}</button>`);
        b.onclick = () => {
          store.set(key, v);
          s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          b.blur();
        };
        if (store.get<string>(key, def) === v) b.classList.add('on');
        s.appendChild(b);
      }
      return row;
    };
    box.innerHTML = '';
    if (!hotseat()) box.appendChild(seg(PREF_CAM, 'end', [['end', 'из-за ворот'], ['side', 'сбоку']], 'Вид'));
    box.appendChild(seg(PREF_MOUSE, 'drag', [['drag', 'поперёк'], ['wheel', 'колёсиком']], 'Крутить мышью'));
    if (!hotseat()) box.appendChild(seg(PREF_GOALIE, 'wasd', [['wasd', 'WASD'], ['auto', 'сам']], 'Вратарь'));
    if (mine().length) {
      speedEl = speedRow(
        () => latest?.speed ?? 0.5,
        (v) => (spReq = v)
      );
      box.appendChild(speedEl);
    }
    const knock = h<HTMLButtonElement>(`<button class="btn small hk-knock" title="Пробел">Стук по борту</button>`);
    knock.onclick = () => {
      for (const s of mine()) knockN[s] = (knockN[s] ?? 0) + 1;
      knock.blur();
    };
    box.appendChild(knock);
  }

  return {
    mount(el, c) {
      ctx = c;
      root = h(`<div class="hk-wrap"><div class="hk-3d"></div><div class="hk-hud"></div><div class="hk-banner" hidden></div></div>`);
      el.appendChild(root);
      hud = root.querySelector('.hk-hud') as HTMLElement;
      banner = root.querySelector('.hk-banner') as HTMLElement;
      rink = new Rink3D(root.querySelector('.hk-3d') as HTMLElement);
      const cv = rink.canvas;
      cv.style.touchAction = 'none';
      const kd = (e: KeyboardEvent) => onKey(e, true);
      const ku = (e: KeyboardEvent) => onKey(e, false);
      const blur = () => keys.clear();
      window.addEventListener('keydown', kd);
      window.addEventListener('keyup', ku);
      window.addEventListener('blur', blur);
      const pd = (e: PointerEvent) => onPointer(e, 'down');
      const pm = (e: PointerEvent) => onPointer(e, 'move');
      const pl = (e: PointerEvent) => onPointer(e, 'leave');
      cv.addEventListener('pointerdown', pd);
      cv.addEventListener('pointermove', pm);
      cv.addEventListener('pointerleave', pl);
      cv.addEventListener('wheel', onWheel, { passive: false });
      cleanup.push(() => {
        window.removeEventListener('keydown', kd);
        window.removeEventListener('keyup', ku);
        window.removeEventListener('blur', blur);
      });
      controls();
      raf = requestAnimationFrame(frame);
      // ввод — своим таймером, не из кадра: кадры замирают, когда окно не на экране
      const iv = setInterval(() => {
        if (!latest) return;
        rink.setCamera(camMode(), myTeam());
        sendInputs(latest);
      }, 20);
      cleanup.push(() => clearInterval(iv));
    },
    setView(v) {
      latest = v;
      // места этого экрана известны только к первому снимку — тогда и строим панель
      if (mine().join() !== seatsKey) {
        seatsKey = mine().join();
        controls();
      }
      snaps = [{ t: performance.now(), v }];
      if (!v.over) banner.hidden = true;
      if (v.over) showBanner(v.score[0] === v.score[1] ? 'Ничья' : `Победили ${TEAM[v.score[0] > v.score[1] ? 0 : 1].toLowerCase()}`, `${v.score[0]} : ${v.score[1]}`, 0);
    },
    async play(_ev, v) {
      this.setView(v);
    },
    realtime(v, events) {
      if (latest && v.speed !== latest.speed) setTimeout(() => speedEl?.sync?.());
      latest = v;
      if (import.meta.env.DEV) (window as unknown as { __hkv: HkState }).__hkv = v;
      snaps.push({ t: performance.now(), v });
      if (snaps.length > 12) snaps.splice(0, snaps.length - 12);
      for (const ev of events) {
        sound(ev);
        if (ev.k === 'goal') showBanner('ГОЛ!', `${ev.own ? 'Автогол · ' : ''}${TEAM[ev.team]} · ${ev.score[0]} : ${ev.score[1]}`);
        if (ev.k === 'end') showBanner('Финальная сирена', `${v.score[0]} : ${v.score[1]}`, 0);
      }
    },
    setTurn() {},
    status(v) {
      if (!v) return '';
      return `${TEAM[0]} ${v.score[0]} : ${v.score[1]} ${TEAM[1]}`;
    },
    playerStats(v, seat) {
      return v ? `шайб: <b>${v.score[seat] ?? 0}</b>` : '';
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      rink?.dispose();
      root?.remove();
    },
  };
}

