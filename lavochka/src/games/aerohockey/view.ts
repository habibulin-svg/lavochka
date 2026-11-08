/* Аэрохоккей — экран: стол на canvas, плавное движение между снимками комнаты, управление битой, звук.
 * Один игрок: бита идёт за мышью (без нажатия) или пальцем; стрелки/WASD — тоже можно. Своя половина внизу (стол вдоль) или слева (поперёк).
 * Двое за одним экраном: каждый палец (или мышь) ведёт биту той половины, где он; клавиши — WASD у красных, стрелки у синих.
 * Вдоль или поперёк — настройка в панели стола (запоминается); по умолчанию — по форме экрана. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { segRow, speedRow } from '../../core/rtview';
import { esc, h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { L, type AhEvent, type AhIn, type AhState } from './engine';
import { TableCanvas, type Orient } from './table';
import './aerohockey.css';

const TEAM = ['Красные', 'Синие'];

/** Ориентация стола — настройка игрока (запоминается в этом браузере); по умолчанию — по форме экрана. */
type OrientPref = 'auto' | 'v' | 'h';
const ORIENT_KEY = 'ah-orient';
const ORIENT_OPTS: [string, string][] = [
  ['auto', 'по экрану'],
  ['v', '▯ вдоль'],
  ['h', '▭ поперёк'],
];
function loadPref(): OrientPref {
  try {
    const v = localStorage.getItem(ORIENT_KEY);
    return v === 'v' || v === 'h' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
function savePref(v: OrientPref) {
  try {
    localStorage.setItem(ORIENT_KEY, v);
  } catch {
    /* хранилище недоступно — настройка живёт до конца партии */
  }
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Snap {
  t: number;
  v: AhState;
}

function mix(a: AhState, b: AhState, t: number): AhState {
  const jump = Math.hypot(b.puck.x - a.puck.x, b.puck.y - a.puck.y) > 0.25;
  const m = (p: AhState['puck'], q: AhState['puck']) => ({ ...q, x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) });
  return { ...b, puck: jump ? b.puck : m(a.puck, b.puck), mal: [m(a.mal[0], b.mal[0]), m(a.mal[1], b.mal[1])] };
}

export function createView(): GameView<AhState, AhEvent> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let table: TableCanvas;
  let hud: HTMLElement;
  let banner: HTMLElement;
  let raf = 0;
  let lastFrame = 0;
  let snaps: Snap[] = [];
  let latest: AhState | null = null;
  let bannerT = 0;
  const keys = new Set<string>();
  /** Куда тянется рука каждого своего места (стол), если ведёт мышь или палец; null — ведут клавиши. */
  const aim: Record<number, [number, number] | null> = {};
  /** Палец → место (двое за экраном). */
  const touches = new Map<number, number>();
  const sent: Record<number, { json: string; at: number }> = {};
  let spReq: number | undefined;
  const cleanup: (() => void)[] = [];
  let speedEl: (HTMLElement & { sync?: () => void }) | null = null;
  let seatsKey = '';
  const colors = SEATS.map((s) => [s.color, s.light, s.dark]);

  const mine = () => ctx.mySeats.filter((s) => s === 0 || s === 1);
  const hotseat = () => mine().length > 1;
  let pref: OrientPref = loadPref();
  /** Как лежит стол: настройка (вдоль, поперёк) или по форме экрана; своя половина — внизу или слева. */
  function orient(): Orient {
    const r = root.getBoundingClientRect();
    const across = pref === 'h' || (pref === 'auto' && r.width > r.height * 1.1);
    const me = !hotseat() && mine().length ? mine()[0] : 0;
    if (across) return me === 1 ? 3 : 2;
    return me === 1 ? 1 : 0;
  }

  function current(): AhState | null {
    if (!snaps.length) return latest;
    const delay = ctx.online ? 70 : 20;
    const t = performance.now() - delay;
    while (snaps.length > 2 && snaps[1].t <= t) snaps.shift();
    const [a, b] = snaps;
    if (!b || t <= a.t) return a.v;
    if (t >= b.t) return b.v;
    return mix(a.v, b.v, (t - a.t) / (b.t - a.t));
  }

  const axis = (neg: string, pos: string) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);

  function buildInput(seat: number): AhIn {
    const a = aim[seat];
    let kx = 0;
    let ky = 0;
    const solo = !hotseat();
    const useArrows = solo || seat === 1;
    const useWasd = solo || seat === 0;
    const hx = (useArrows ? axis('ArrowLeft', 'ArrowRight') : 0) + (useWasd ? axis('KeyA', 'KeyD') : 0);
    const vy = (useArrows ? axis('ArrowDown', 'ArrowUp') : 0) + (useWasd ? axis('KeyS', 'KeyW') : 0);
    if (hx || vy) {
      // клавиши — по экрану: «вверх» на экране — к чужим воротам при своём виде
      const [ax, ay] = table.screenToTableDir(1, 0);
      const [bx, by] = table.screenToTableDir(0, 1);
      kx = Math.max(-1, Math.min(1, hx * ax + vy * bx));
      ky = Math.max(-1, Math.min(1, hx * ay + vy * by));
    }
    const out: AhIn = { kx, ky };
    if (a && !kx && !ky) {
      out.x = Math.round(a[0] * 1e4) / 1e4;
      out.y = Math.round(a[1] * 1e4) / 1e4;
    }
    if (spReq != null) out.sp = spReq;
    return out;
  }

  function sendInputs(st: AhState) {
    if (ctx.demo || !ctx.input || st.over) return;
    const now = performance.now();
    for (const seat of mine()) {
      const inp = buildInput(seat);
      const json = JSON.stringify(inp);
      const last = sent[seat];
      if (last && last.json === json && now - last.at < 400) continue;
      sent[seat] = { json, at: now };
      ctx.input(seat, inp);
    }
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    if (document.hidden) return;
    const st = current();
    if (!st) return;
    table.orient = orient();
    table.theme = (import.meta.env.DEV && (window as unknown as { __ahTheme?: string }).__ahTheme) || st.table || 'katok';
    table.render(st, dt, colors);
    drawHud(latest ?? st);
    if (bannerT && performance.now() > bannerT) {
      banner.hidden = true;
      bannerT = 0;
    }
  }

  function drawHud(st: AhState) {
    let time = '';
    if (st.limit > 0) {
      const sec = Math.ceil(Math.max(0, st.limit - st.t));
      time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    } else time = `до ${st.goals}`;
    const html = `<b class="r">${st.score[0]}</b><span class="t">${time}</span><b class="b">${st.score[1]}</b>`;
    if (hud.dataset.h !== html) {
      hud.innerHTML = html;
      hud.dataset.h = html;
    }
  }

  function showBanner(title: string, sub = '', ms = 1400) {
    banner.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    banner.hidden = false;
    bannerT = ms > 0 ? performance.now() + ms : 0;
  }

  // ---------------------------------------------------------------- звук

  function sound(ev: AhEvent) {
    const o = audioOut();
    if (!o) return;
    const t = o.ctx.currentTime;
    if (ev.k === 'hit') {
      const s = Math.min(1, ev.st / 5);
      // пластик о пластик: короткий звонкий «ток»
      click(t, { freq: 1900 + Math.random() * 500, q: 4, dur: 0.03, gain: 0.25 + 0.55 * s });
      tone(t, { freq: 700 + Math.random() * 120, to: 420, dur: 0.05, gain: 0.08 + 0.12 * s, type: 'triangle' });
    } else if (ev.k === 'wall') {
      const s = Math.min(1, ev.st / 5);
      click(t, { freq: 900 + Math.random() * 300, q: 2, dur: 0.05, gain: 0.2 + 0.45 * s });
      tone(t, { freq: 210, to: 120, dur: 0.06, gain: 0.1 + 0.18 * s });
    } else if (ev.k === 'post') {
      click(t, { freq: 1500, q: 3, dur: 0.05, gain: 0.5 });
      tone(t, { freq: 520, to: 300, dur: 0.08, gain: 0.14, type: 'triangle' });
    } else if (ev.k === 'goal') {
      // шайба провалилась в щель и гремит по жёлобу, потом — гудок табло
      click(t, { freq: 600, q: 1.5, dur: 0.1, gain: 0.6 });
      for (let i = 0; i < 5; i++) click(t + 0.08 + i * 0.06, { freq: 900 - i * 90, q: 2, dur: 0.04, gain: 0.35 - i * 0.05 });
      tone(t + 0.4, { freq: 440, dur: 0.18, gain: 0.12, type: 'square' });
      tone(t + 0.6, { freq: 660, dur: 0.3, gain: 0.12, type: 'square' });
    } else if (ev.k === 'serve') tone(t, { freq: 880, dur: 0.08, gain: 0.08, type: 'triangle' });
    else if (ev.k === 'end') {
      tone(t, { freq: 523, dur: 0.18, gain: 0.12, type: 'square' });
      tone(t + 0.2, { freq: 659, dur: 0.18, gain: 0.12, type: 'square' });
      tone(t + 0.4, { freq: 784, dur: 0.4, gain: 0.12, type: 'square' });
    }
  }

  // ---------------------------------------------------------------- управление

  const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];

  function onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
    const c = e.code;
    if (!KEYS.includes(c) || !mine().length) return;
    e.preventDefault();
    Sound.unlock();
    if (down) keys.add(c);
    else keys.delete(c);
  }

  /** Чья половина под точкой стола. */
  const halfOf = (y: number) => (y < L / 2 ? 0 : 1);

  function onPointer(e: PointerEvent, kind: 'down' | 'move' | 'up') {
    if (ctx.demo || !mine().length) return;
    const p = table.toTable(e.clientX, e.clientY);
    if (kind === 'down') {
      Sound.unlock();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }
    let seat: number;
    if (hotseat()) {
      if (kind === 'down' || !touches.has(e.pointerId)) touches.set(e.pointerId, halfOf(p[1]));
      seat = touches.get(e.pointerId)!;
      // мышь без нажатия переходит к той половине, над которой она
      if (e.pointerType === 'mouse' && !e.buttons) {
        seat = halfOf(p[1]);
        touches.set(e.pointerId, seat);
      }
    } else seat = mine()[0];
    if (kind === 'up') {
      if (e.pointerType !== 'mouse') touches.delete(e.pointerId);
      return;
    }
    // палец не прячет биту под собой: на телефоне цель чуть выше пальца
    const lift = e.pointerType === 'touch' ? 0.06 : 0;
    const [ux, uy] = table.screenToTableDir(0, 1);
    aim[seat] = [p[0] + lift * ux, p[1] + lift * uy];
  }

  // ---------------------------------------------------------------- панель

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    box.innerHTML = '';
    box.appendChild(
      segRow('Стол', ORIENT_OPTS, () => pref, (v) => {
        pref = v as OrientPref;
        savePref(pref);
      })
    );
    if (mine().length) {
      speedEl = speedRow(
        () => latest?.speed ?? 0.7,
        (v) => (spReq = v)
      );
      box.appendChild(speedEl);
    }
  }

  return {
    mount(el, c) {
      ctx = c;
      root = h(`<div class="ah-wrap"><div class="ah-cv"></div><div class="ah-hud"></div><div class="ah-banner" hidden></div></div>`);
      el.appendChild(root);
      hud = root.querySelector('.ah-hud') as HTMLElement;
      banner = root.querySelector('.ah-banner') as HTMLElement;
      table = new TableCanvas(root.querySelector('.ah-cv') as HTMLElement);
      const cv = table.canvas;
      cv.style.touchAction = 'none';
      const kd = (e: KeyboardEvent) => onKey(e, true);
      const ku = (e: KeyboardEvent) => onKey(e, false);
      const blur = () => keys.clear();
      window.addEventListener('keydown', kd);
      window.addEventListener('keyup', ku);
      window.addEventListener('blur', blur);
      const pd = (e: PointerEvent) => onPointer(e, 'down');
      const pm = (e: PointerEvent) => onPointer(e, 'move');
      const pu = (e: PointerEvent) => onPointer(e, 'up');
      cv.addEventListener('pointerdown', pd);
      cv.addEventListener('pointermove', pm);
      cv.addEventListener('pointerup', pu);
      cv.addEventListener('pointercancel', pu);
      cleanup.push(() => {
        window.removeEventListener('keydown', kd);
        window.removeEventListener('keyup', ku);
        window.removeEventListener('blur', blur);
      });
      controls();
      raf = requestAnimationFrame(frame);
      // ввод — своим таймером, не из кадра: кадры замирают, когда окно не на экране
      const iv = setInterval(() => latest && sendInputs(latest), 20);
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
      if (import.meta.env.DEV) (window as unknown as { __ahv: AhState }).__ahv = v;
      snaps.push({ t: performance.now(), v });
      if (snaps.length > 12) snaps.splice(0, snaps.length - 12);
      for (const ev of events) {
        sound(ev);
        if (ev.k === 'hit') table?.hit(v.puck.x, v.puck.y, ev.st);
        if (ev.k === 'goal') {
          table?.goal(ev.seat);
          showBanner('ГОЛ!', `${ev.own ? 'В свои ворота · ' : ''}${TEAM[ev.seat]} · ${ev.score[0]} : ${ev.score[1]}`);
        }
        if (ev.k === 'end') showBanner('Партия!', `${v.score[0]} : ${v.score[1]}`, 0);
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
    saveTitle(v) {
      return `${v.score[0]} : ${v.score[1]}`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      root?.remove();
    },
  };
}
