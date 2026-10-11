/* Настольный футбол — экран: 3D-поднос, плавное движение между снимками комнаты, управление фигурками и вратарём, звук.
 * Мышь/палец: взял своего футболиста, оттянул, отпустил — удар; взял своего вратаря — водишь поперёк ворот.
 * Клавиши (один за экраном): Пробел — держать/отпустить ближнего к мячу, ←/→ во время оттяжки — вскользь, Q/E — соседний; A/D — вратарь.
 * Вдвоём за экраном: рыжие — W, A/D, Q/E; белые — ↑, ←/→, «,»/«.»; вратари стоят сами. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { speedRow, segRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { botInput } from './ai';
import { keeperX, KEEPER_RANGE, PULL_MAX, SPOTS, type FbEvent, type FbIn, type FbState } from './engine';
import { Pitch3D, type Cam } from './scene';
import './football.css';

export const PREF_CAM = 'football.cam';

const TEAM = ['Рыжие', 'Белые'];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Мышью оттягивают с запасом: смещение указателя по полю × это = оттяжка подставки. */
const DRAG_GAIN = 0.4;

interface Snap {
  t: number;
  v: FbState;
}

function mix(a: FbState, b: FbState, t: number): FbState {
  const jump = Math.hypot(b.ball.x - a.ball.x, b.ball.z - a.ball.z) > 0.1;
  return {
    ...b,
    figs: b.figs.map((f, i) => ({ ...f, ox: lerp(a.figs[i].ox, f.ox, t), oz: lerp(a.figs[i].oz, f.oz, t) })),
    keep: [lerp(a.keep[0], b.keep[0], t), lerp(a.keep[1], b.keep[1], t)],
    ball: jump ? b.ball : { ...b.ball, x: lerp(a.ball.x, b.ball.x, t), z: lerp(a.ball.z, b.ball.z, t) },
  };
}

export function createView(): GameView<FbState, FbEvent> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let pitch: Pitch3D;
  let hud: HTMLElement;
  let banner: HTMLElement;
  let raf = 0;
  let snaps: Snap[] = [];
  let latest: FbState | null = null;
  let bannerT = 0;
  const keys = new Set<string>();
  /** Выбор фигурки вручную (−1 — ближняя к мячу) и при каком «автомате» выбран. */
  const pick: Record<number, { idx: number; auto: number }> = {};
  const knockN: Record<number, number> = {};
  const keeperMem: Record<number, Record<string, any>> = {};
  let keeperTouched = false;
  /** Мышь: тянем фигурку (k, откуда взяли) или вратаря. */
  let drag: { kind: 'fig'; k: number; x0: number; z0: number; px: number; pz: number } | { kind: 'keep'; gs: number } | null = null;
  let lastGs: number | undefined;
  let spReq: number | undefined;
  let speedEl: (HTMLElement & { sync?: () => void }) | null = null;
  let seatsKey: string | null = null;
  const sent: Record<number, { json: string; at: number }> = {};
  const cleanup: (() => void)[] = [];

  const mine = () => ctx.mySeats.filter((s) => s === 0 || s === 1);
  const hotseat = () => mine().length > 1;
  const camMode = (): Cam => (!mine().length ? 'corner' : hotseat() ? 'side' : store.get<string>(PREF_CAM, 'side') === 'end' ? 'end' : 'side');
  const myTeam = (): 0 | 1 => (mine()[0] === 1 ? 1 : 0);
  const axis = (neg: string, pos: string) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);

  function current(): FbState | null {
    if (!snaps.length) return latest;
    const delay = ctx.online ? 85 : 22;
    const t = performance.now() - delay;
    while (snaps.length > 2 && snaps[1].t <= t) snaps.shift();
    const [a, b] = snaps;
    if (!b || t <= a.t) return a.v;
    if (t >= b.t) return b.v;
    return mix(a.v, b.v, (t - a.t) / (b.t - a.t));
  }

  function chosen(st: FbState, seat: number): number {
    const team = seat as 0 | 1;
    const pk = (pick[seat] ??= { idx: -1, auto: st.auto[team] });
    if (pk.idx >= 0 && st.auto[team] !== pk.auto) pk.idx = -1;
    return pk.idx >= 0 ? pk.idx : st.auto[team];
  }

  /** «Вскользь» клавишами: какая сторона поворота выглядит на экране левее. */
  function aimSign(st: FbState, team: 0 | 1, k: number): number {
    const [sx, sz] = SPOTS[team][k];
    const dx = st.ball.x - sx;
    const dz = st.ball.z - sz;
    const d = Math.hypot(dx, dz) || 1;
    const c = Math.cos(0.5);
    const s = Math.sin(0.5);
    const a = pitch.screenDir(sx, sz, dx / d, dz / d);
    const b = pitch.screenDir(sx, sz, (dx * c - dz * s) / d, (dx * s + dz * c) / d);
    return a[0] * b[1] - a[1] * b[0] < 0 ? 1 : -1;
  }

  function buildInput(st: FbState, seat: number): FbIn {
    const team = seat as 0 | 1;
    const hs = hotseat();
    const k = chosen(st, seat);
    const out: FbIn = { f: -1, h: 0, g: 0, knock: knockN[seat] ?? 0 };
    const holdKey = hs ? (seat === 0 ? 'KeyW' : 'ArrowUp') : 'Space';
    const left = hs ? (seat === 0 ? 'KeyA' : 'ArrowLeft') : 'ArrowLeft';
    const right = hs ? (seat === 0 ? 'KeyD' : 'ArrowRight') : 'ArrowRight';
    if (drag?.kind === 'fig' && seat === mine()[0]) {
      out.f = drag.k;
      out.h = 1;
      out.px = drag.px;
      out.pz = drag.pz;
    } else if (keys.has(holdKey) || (!hs && keys.has('ArrowDown'))) {
      out.f = k;
      out.h = 1;
      const turn = axis(left, right);
      if (turn) out.a = turn * -aimSign(st, team, k);
    } else out.f = k;
    // вратарь: мышью, A/D (один за экраном) или сам
    if (drag?.kind === 'keep' && seat === mine()[0]) out.gs = drag.gs;
    else if (!hs && keeperTouched) {
      const g = axis('KeyA', 'KeyD');
      if (g) {
        // A/D — влево/вправо на экране
        const sd = pitch.screenDir(keeperX(team), st.keep[team], 0, 1);
        out.g = g * (sd[0] >= 0 ? 1 : -1);
        lastGs = undefined;
      } else if (lastGs != null) out.gs = lastGs;
    } else out.g = botInput(st, seat, 1, (keeperMem[seat] ??= {}), { next: Math.random, int: (n) => Math.floor(Math.random() * n), getState: () => 0 }).g;
    if (spReq != null) out.sp = spReq;
    return out;
  }

  function sendInputs(st: FbState) {
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

  function highlights(st: FbState): [number, number][] {
    const out: [number, number][] = [];
    for (const seat of mine()) {
      const team = seat as 0 | 1;
      const k = drag?.kind === 'fig' && seat === mine()[0] ? drag.k : chosen(st, seat);
      out.push([team * 10 + k, pick[seat]?.idx >= 0 || drag ? 0.95 : 0.6]);
    }
    return out;
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const st = current();
    if (!st) return;
    pitch.setCamera(camMode(), myTeam());
    pitch.update(st, highlights(latest ?? st));
    pitch.render();
    drawHud(latest ?? st);
    if (bannerT && performance.now() > bannerT) {
      banner.hidden = true;
      bannerT = 0;
    }
  }

  function drawHud(st: FbState) {
    const left = st.limit > 0 ? Math.max(0, st.limit - st.t) : st.t;
    const sec = Math.ceil(left);
    const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const html = `<b class="r">${st.score[0]}</b><span class="t">${time}</span><b class="w">${st.score[1]}</b>`;
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

  function sound(ev: FbEvent) {
    const o = audioOut();
    if (!o) return;
    const t = o.ctx.currentTime;
    if (ev.k === 'kick') {
      const s = Math.min(1, ev.st / 1.5);
      // пластмасса о пластмассу: сухой «ток»
      click(t, { freq: 1900 + Math.random() * 400, q: 4, dur: 0.035, gain: 0.25 + 0.5 * s });
      tone(t, { freq: 620, to: 420, dur: 0.05, gain: 0.05 + 0.1 * s, type: 'triangle' });
    } else if (ev.k === 'twang') {
      // пружина отыграла
      tone(t, { freq: 260 + Math.random() * 40, to: 190, dur: 0.18, gain: 0.04 + 0.05 * ev.st, type: 'sine' });
      tone(t, { freq: 1400, to: 1100, dur: 0.06, gain: 0.02 * ev.st, type: 'sine' });
    } else if (ev.k === 'wall') {
      // жестяной поднос: глухой удар и звон
      const s = Math.min(1, ev.st / 1.5);
      click(t, { freq: 650 + Math.random() * 200, q: 2, dur: 0.05, gain: 0.25 + 0.45 * s });
      tone(t, { freq: 230, to: 150, dur: 0.08, gain: 0.1 + 0.15 * s });
      tone(t, { freq: 1760, to: 1700, dur: 0.22, gain: 0.02 + 0.04 * s, type: 'sine' });
    } else if (ev.k === 'post' || ev.k === 'keeper') {
      click(t, { freq: 1300, q: 3, dur: 0.045, gain: 0.45 });
      tone(t, { freq: 480, to: 300, dur: 0.06, gain: 0.1, type: 'triangle' });
    } else if (ev.k === 'goal') {
      // мяч в сетке
      for (let i = 0; i < 5; i++) click(t + i * 0.03, { freq: 2200 + Math.random() * 1500, q: 2, dur: 0.04, gain: 0.18 });
      whistle(t + 0.2, 0.55);
    } else if (ev.k === 'drop') whistle(t, 0.22);
    else if (ev.k === 'knock') {
      for (const d of [0, 0.12]) {
        click(t + d, { freq: 520, q: 1.5, dur: 0.07, gain: 0.5 });
        tone(t + d, { freq: 150, to: 80, dur: 0.09, gain: 0.3 });
        tone(t + d, { freq: 1500, to: 1450, dur: 0.15, gain: 0.03, type: 'sine' });
      }
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
    const known = ['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'Comma', 'Period'];
    if (!known.includes(c)) return;
    e.preventDefault();
    Sound.unlock();
    if (!down) return void keys.delete(c);
    if (keys.has(c)) return;
    keys.add(c);
    const st = latest;
    if (!st || !mine().length) return;
    if (!hotseat() && (c === 'KeyA' || c === 'KeyD')) keeperTouched = true;
    const cycle = (seat: number, d: number) => {
      const team = seat as 0 | 1;
      // по кругу — от ближней к мячу к дальним
      const order = SPOTS[team].map((p, k) => [Math.hypot(st.ball.x - p[0], st.ball.z - p[1]), k]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      const cur = order.indexOf(chosen(st, seat));
      pick[seat] = { idx: order[(cur + d + 10) % 10], auto: st.auto[team] };
    };
    if (hotseat()) {
      if (c === 'KeyQ' || c === 'KeyE') cycle(0, c === 'KeyQ' ? -1 : 1);
      if (c === 'Comma' || c === 'Period') cycle(1, c === 'Comma' ? -1 : 1);
    } else if (c === 'KeyQ' || c === 'KeyE') cycle(mine()[0], c === 'KeyQ' ? -1 : 1);
  }

  function onPointer(e: PointerEvent, kind: 'down' | 'move' | 'up') {
    if (ctx.demo || !mine().length) return;
    const st = latest;
    const p = pitch.pickField(e.clientX, e.clientY);
    const team = myTeam();
    if (kind === 'down') {
      Sound.unlock();
      if (!st || !p) return;
      // свой вратарь?
      if (Math.abs(p[0] - keeperX(team)) < 0.03 && Math.abs(p[1] - st.keep[team]) < 0.035) {
        keeperTouched = true;
        drag = { kind: 'keep', gs: Math.max(-1, Math.min(1, p[1] / KEEPER_RANGE)) };
      } else {
        // ближний свой футболист под пальцем
        let best = -1;
        let bd = 0.035;
        SPOTS[team].forEach(([x, z], k) => {
          const d = Math.hypot(p[0] - x, p[1] - z);
          if (d < bd) {
            bd = d;
            best = k;
          }
        });
        if (best < 0) return;
        drag = { kind: 'fig', k: best, x0: p[0], z0: p[1], px: 0, pz: 0 };
        pick[mine()[0]] = { idx: best, auto: st.auto[team] };
      }
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      e.preventDefault();
      if (st) sendInputs(st);
      return;
    }
    if (!drag) return;
    if (kind === 'up') {
      if (drag.kind === 'keep') lastGs = drag.gs;
      drag = null;
      if (st) sendInputs(st);
      return;
    }
    if (!p) return;
    if (drag.kind === 'keep') drag.gs = Math.max(-1, Math.min(1, p[1] / KEEPER_RANGE));
    else {
      let px = (p[0] - drag.x0) * DRAG_GAIN;
      let pz = (p[1] - drag.z0) * DRAG_GAIN;
      const l = Math.hypot(px, pz);
      if (l > PULL_MAX) {
        px *= PULL_MAX / l;
        pz *= PULL_MAX / l;
      }
      drag.px = px;
      drag.pz = pz;
    }
  }

  // ---------------------------------------------------------------- панель

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    box.innerHTML = '';
    if (!hotseat()) box.appendChild(segRow('Вид', [['side', 'спереди'], ['end', 'из-за ворот']], () => (store.get<string>(PREF_CAM, 'side') === 'end' ? 'end' : 'side'), (v) => store.set(PREF_CAM, v)));
    if (mine().length) {
      speedEl = speedRow(
        () => latest?.speed ?? 0.5,
        (v) => (spReq = v)
      );
      box.appendChild(speedEl);
      const knock = h<HTMLButtonElement>(`<button class="btn small fb-knock">Стук по подносу</button>`);
      knock.onclick = () => {
        for (const s of mine()) knockN[s] = (knockN[s] ?? 0) + 1;
        knock.blur();
      };
      box.appendChild(knock);
      box.appendChild(h(`<div class="fb-hint">${hotseat() ? 'Рыжие: <kbd>W</kbd> удар, <kbd>A</kbd>/<kbd>D</kbd> вскользь, <kbd>Q</kbd>/<kbd>E</kbd> выбор. Белые: <kbd>↑</kbd>, <kbd>←</kbd>/<kbd>→</kbd>, <kbd>,</kbd>/<kbd>.</kbd>' : 'Тяни фигурку мышью и отпускай. Или держи <kbd>Пробел</kbd> и отпусти; <kbd>Q</kbd>/<kbd>E</kbd> — соседний, <kbd>A</kbd>/<kbd>D</kbd> — вратарь'}</div>`));
    }
  }

  return {
    mount(el, c) {
      ctx = c;
      root = h(`<div class="fb-wrap"><div class="fb-3d"></div><div class="fb-hud"></div><div class="fb-banner" hidden></div></div>`);
      el.appendChild(root);
      hud = root.querySelector('.fb-hud') as HTMLElement;
      banner = root.querySelector('.fb-banner') as HTMLElement;
      pitch = new Pitch3D(root.querySelector('.fb-3d') as HTMLElement);
      const cv = pitch.canvas;
      cv.style.touchAction = 'none';
      const kd = (e: KeyboardEvent) => onKey(e, true);
      const ku = (e: KeyboardEvent) => onKey(e, false);
      const blur = () => {
        keys.clear();
        drag = null;
      };
      window.addEventListener('keydown', kd);
      window.addEventListener('keyup', ku);
      window.addEventListener('blur', blur);
      cv.addEventListener('pointerdown', (e) => onPointer(e, 'down'));
      cv.addEventListener('pointermove', (e) => onPointer(e, 'move'));
      cv.addEventListener('pointerup', (e) => onPointer(e, 'up'));
      cv.addEventListener('pointercancel', (e) => onPointer(e, 'up'));
      cleanup.push(() => {
        window.removeEventListener('keydown', kd);
        window.removeEventListener('keyup', ku);
        window.removeEventListener('blur', blur);
      });
      raf = requestAnimationFrame(frame);
      // ввод — своим таймером: кадры замирают, когда окно не на экране
      const iv = setInterval(() => {
        if (!latest) return;
        pitch.setCamera(camMode(), myTeam());
        sendInputs(latest);
      }, 20);
      cleanup.push(() => clearInterval(iv));
    },
    setView(v) {
      latest = v;
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
      if (import.meta.env.DEV) (window as unknown as { __fbv: FbState }).__fbv = v;
      snaps.push({ t: performance.now(), v });
      if (snaps.length > 12) snaps.splice(0, snaps.length - 12);
      for (const ev of events) {
        sound(ev);
        if (ev.k === 'goal') showBanner('ГОЛ!', `${ev.own ? 'Автогол · ' : ''}${TEAM[ev.team]} · ${ev.score[0]} : ${ev.score[1]}`);
        if (ev.k === 'end') showBanner('Финальный свисток', `${v.score[0]} : ${v.score[1]}`, 0);
      }
    },
    setTurn() {},
    status(v) {
      if (!v) return '';
      return `${TEAM[0]} ${v.score[0]} : ${v.score[1]} ${TEAM[1]}`;
    },
    playerStats(v, seat) {
      return v ? `голов: <b>${v.score[seat] ?? 0}</b>` : '';
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      pitch?.dispose();
      root?.remove();
    },
  };
}
