/* Городки — экран: 3D-двор, бросок жестом «рогаткой» (потянул назад — отпустил), клавишами или кнопками; переигрывание броска
 * по кадрам той же физики, что у комнаты; табло, надписи, деревянный стук, музыка двора (выключатель запоминается). */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { segRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { figName, fromLite, lineOf, type Event, type Lite, type State } from './engine';
import { figure } from './figures';
import { launch, powFor, simulate, type Throw } from './physics';
import { Yard3D, type RodPose } from './scene';
import './gorodki.css';

export const PREF_HINT = 'gorodki.hint';
const PREF_MUSIC = 'gorodki.music';
const PREF_STYLE = 'gorodki.style';

const TRACKS = ['match', 'dvor'];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Деревянный стук: бита о городок, городок о городок, бита о землю. */
function knock(kind: 'bat' | 'rod' | 'ground', v: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  const s = clamp(v / 8, 0.15, 1);
  if (kind === 'ground') {
    tone(t, { freq: 110, to: 60, dur: 0.14, gain: 0.45 * s });
    click(t, { freq: 500, q: 1.2, dur: 0.08, gain: 0.35 * s });
    return;
  }
  const f = kind === 'bat' ? 520 + Math.random() * 120 : 760 + Math.random() * 260;
  tone(t, { freq: f, to: f * 0.7, dur: 0.07, gain: 0.32 * s, type: 'triangle' });
  click(t, { freq: kind === 'bat' ? 1600 : 2400, q: 3, dur: 0.05, gain: 0.55 * s });
}

function whoosh(dur: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  for (let k = 0; k < 6; k++) click(t + (k * dur) / 6, { freq: 300 + k * 60, q: 0.8, dur: dur / 5, gain: 0.06 });
}

interface Aim {
  /** Сила по месту приземления: 0 — у самой черты, 1 — далеко за город. */
  f: number;
  ang: number;
}

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let yard: Yard3D;
  let hud: HTMLElement;
  let banner: HTMLElement;
  let lupaTag: HTMLElement;
  let raf = 0;
  let last = 0;
  let v: State | null = null;
  /** Чьё место бросает с этого экрана сейчас (null — не наш ход или идёт анимация). */
  let act: number | null = null;
  let busy = false;
  let aim: Aim = { f: 0.8, ang: 0 };
  let posX = 0;
  let drag: { x: number; y: number; id: number } | null = null;
  let t0 = performance.now();
  let music: HTMLAudioElement | null = null;
  let track = 0;
  let bannerT = 0;
  const cleanup: (() => void)[] = [];

  const style = () => store.get<string>(PREF_STYLE, 'flat');
  const musicOn = () => store.get<string>(PREF_MUSIC, 'on') !== 'off';
  const hintOn = () => store.get<string>(PREF_HINT, 'full') !== 'dir';

  function syncMusic() {
    const want = musicOn() && !ctx.demo && !!v && !v.over && !document.hidden;
    if (!want) {
      music?.pause();
      return;
    }
    if (!music) {
      music = new Audio(`/gorodki/music/${TRACKS[track % TRACKS.length]}.ogg`);
      music.volume = 0.3;
      music.onended = () => {
        track++;
        music = null;
        syncMusic();
      };
    }
    if (music.paused) void music.play().catch(() => {});
  }

  /** Бросок с текущего прицела (с «дыханием» руки). */
  function currentThrow(withWobble = true): Throw | null {
    if (!v) return null;
    const line = lineOf(v);
    const tt = (performance.now() - t0) / 1000;
    const wob = withWobble ? Math.sin(tt * 1.9) * 0.007 + Math.sin(tt * 3.1 + 1) * 0.004 : 0;
    const ang = clamp(aim.ang + wob, -0.38, 0.38);
    // f → где приземлится: от черты до 3,5 м за лицевой линией
    const landAt = line + 0.6 + aim.f * (-line + 3.5 - 0.6);
    const pow = clamp(powFor(landAt, ang, line), 0, 1);
    const st = style();
    return { x: posX, ang, pow, spin: st === 'end' ? 0 : st === 'ccw' ? -0.7 : 0.7, end: st === 'end' };
  }

  function throwNow() {
    if (act == null || busy || !v) return;
    const t = currentThrow();
    if (!t) return;
    const seat = act;
    act = null;
    yard.setAim(null);
    Sound.unlock();
    ctx.act(seat, { type: 'throw', ...t });
  }

  // ---------------------------------------------------------------- отрисовка

  function rodsOf(list: Lite[]): (RodPose & { mark?: boolean })[] {
    yard.lupaWide = list.some((l) => l.y > 0.7 || Math.abs(l.x) > 0.55 || l.y < -0.1);
    return list.map((l) => ({ x: l.x, y: l.y, z: l.st ? 0 : 0.025, a: l.a, roll: 0, stand: !!l.st, mark: !!l.mark }));
  }

  function showState(s: State, cam = true) {
    const i = s.cur;
    yard.setSeats(s.seats);
    yard.thrower = { seat: s.seats[i], x: act != null ? posX : 0, line: lineOf(s) };
    yard.phase = null;
    yard.setBat(null);
    yard.setRods(rodsOf(s.p[i].rods));
    if (cam) yard.camTo('aim', undefined, 2.2);
    drawHud();
  }

  function drawHud() {
    if (!v) return;
    const s = v;
    const n = s.cfg.figs.length;
    const rows = s.seats
      .map((seat, k) => {
        const p = s.p[k];
        const cur = k === s.cur && !s.over;
        const fig = p.done ? '✔ все фигуры' : `${Math.min(p.fig + 1, n)}/${n} ${esc(figName(s.cfg.figs[Math.min(p.fig, n - 1)]))}`;
        return `<div class="gk-row${cur ? ' cur' : ''}${p.out && !p.done ? ' off' : ''}"><i style="background:${SEATS[seat].color}"></i><span class="nm">${ctx.name(seat)}</span><span class="fg">${fig}</span><b>${p.throws}</b></div>`;
      })
      .join('');
    const p = s.p[s.cur];
    const fid = s.cfg.figs[Math.min(p.fig, n - 1)];
    const where = figure(fid).konOnly ? 'только с кона' : p.kon ? 'с кона' : 'с полукона';
    hud.innerHTML = `<div class="gk-board">${rows}<div class="gk-head">бит</div></div>
      ${s.over ? '' : `<div class="gk-now"><b>«${esc(figName(fid))}»</b> · ${where} · ${s.bat === 0 ? 'первая' : 'вторая'} бита</div>`}`;
    placeLupaTag();
  }

  let lupaKey = '';
  function placeLupaTag() {
    const lr = yard.lupaRect();
    const show = !!lr && yard.lupaShown;
    const key = show ? `${lr!.x},${lr!.w}` : '-';
    if (key === lupaKey) return;
    lupaKey = key;
    lupaTag.style.display = show ? '' : 'none';
    if (show) {
      lupaTag.style.left = `${lr!.x}px`;
      lupaTag.style.top = `${lr!.y}px`;
      lupaTag.style.width = `${lr!.w}px`;
    }
  }

  function say(big: string, small = '', ms = 1400) {
    banner.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`;
    banner.style.opacity = '1';
    bannerT = performance.now() + ms / Math.max(0.5, ctx.speed());
  }

  /** Разработка: ?gkpose=<фаза> — замереть в позе броска (подбор анимации). */
  const dbgPose = import.meta.env.DEV ? new URLSearchParams(location.search).get('gkpose') : null;

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if ((dbgPose != null || v?.shot) && v) {
      yard.thrower = { seat: v.seats[0], x: 0, line: -13 };
      const ph = dbgPose != null ? Number(dbgPose) : 0.48;
      yard.phase = Number.isFinite(ph) ? ph : null;
    }
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (document.hidden) return;
    if (act != null && !busy && v) {
      const t = currentThrow();
      if (t) yard.setAim({ x: t.x, ang: t.ang, pow: t.pow, line: lineOf(v), full: hintOn() });
      yard.thrower.x = posX;
    }
    if (bannerT && now > bannerT) {
      banner.style.opacity = '0';
      bannerT = 0;
    }
    yard.render(dt);
    placeLupaTag();
  }

  // ---------------------------------------------------------------- ввод

  function bindInput() {
    const cv = yard.canvas;
    const pdown = (e: PointerEvent) => {
      if (act == null || busy) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      cv.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const pmove = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const r = cv.getBoundingClientRect();
      const dy = e.clientY - drag.y;
      const dx = e.clientX - drag.x;
      aim.f = clamp(dy / (r.height * 0.55), 0, 1);
      aim.ang = clamp((-dx / r.width) * 0.32, -0.38, 0.38);
    };
    const pup = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const r = cv.getBoundingClientRect();
      const pulled = (e.clientY - drag.y) / r.height;
      drag = null;
      if (pulled > 0.06) throwNow();
    };
    cv.addEventListener('pointerdown', pdown);
    cv.addEventListener('pointermove', pmove);
    cv.addEventListener('pointerup', pup);
    cv.addEventListener('pointercancel', () => (drag = null));
    const key = (e: KeyboardEvent) => {
      if (act == null || busy) return;
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      let used = true;
      if (e.code === 'ArrowLeft') aim.ang = clamp(aim.ang + 0.006, -0.38, 0.38);
      else if (e.code === 'ArrowRight') aim.ang = clamp(aim.ang - 0.006, -0.38, 0.38);
      else if (e.code === 'ArrowUp') aim.f = clamp(aim.f + 0.01, 0, 1);
      else if (e.code === 'ArrowDown') aim.f = clamp(aim.f - 0.01, 0, 1);
      else if (e.code === 'KeyA') posX = clamp(posX - 0.1, -1.5, 1.5);
      else if (e.code === 'KeyD') posX = clamp(posX + 0.1, -1.5, 1.5);
      else if (e.code === 'Space' || e.code === 'Enter') throwNow();
      else used = false;
      if (used) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    cleanup.push(() => window.removeEventListener('keydown', key));
  }

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    box.innerHTML = '';
    const pos = h(`<div class="rt-pref gk-pos"><span>Встать</span><div class="seg"><button data-d="-1">◀ левее</button><button data-d="0">в центр</button><button data-d="1">правее ▶</button></div></div>`);
    pos.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.onclick = () => {
        const d = Number(b.dataset.d);
        posX = d === 0 ? 0 : clamp(posX + d * 0.25, -1.5, 1.5);
        b.blur();
      };
    });
    box.appendChild(pos);
    box.appendChild(
      segRow(
        'Бросок',
        [
          ['flat', 'плашмя ⟳'],
          ['ccw', 'плашмя ⟲'],
          ['end', 'торцом'],
        ],
        style,
        (x) => store.set(PREF_STYLE, x)
      )
    );
    box.appendChild(
      segRow(
        'Прицел',
        [
          ['full', 'точка падения'],
          ['dir', 'только направление'],
        ],
        () => (hintOn() ? 'full' : 'dir'),
        (x) => store.set(PREF_HINT, x)
      )
    );
    box.appendChild(
      segRow(
        '♪ Музыка',
        [
          ['on', 'вкл'],
          ['off', 'выкл'],
        ],
        () => (musicOn() ? 'on' : 'off'),
        (x) => {
          store.set(PREF_MUSIC, x);
          syncMusic();
        }
      )
    );
    const lupa = segRow(
      'Лупа',
      [
        ['on', 'город крупно'],
        ['off', 'нет'],
      ],
      () => (yard.lupa ? 'on' : 'off'),
      (x) => {
        yard.lupa = x === 'on';
        store.set('gorodki.lupa', x);
        drawHud();
      }
    );
    box.appendChild(lupa);
  }

  // ---------------------------------------------------------------- проигрывание броска

  async function playThrow(ev: Extract<Event, { k: 'throw' }>) {
    const sp = () => Math.max(0.25, ctx.speed());
    const i = v ? v.seats.indexOf(ev.seat) : 0;
    yard.thrower = { seat: ev.seat, x: ev.t.x, line: ev.line };
    yard.setRods(rodsOf(ev.before));
    yard.setAim(null);
    yard.camTo('aim', undefined, 4);
    // замах
    const swing = 650;
    const s0 = performance.now();
    while (true) {
      const k = (performance.now() - s0) / (swing / sp());
      if (k >= 1) break;
      yard.phase = k * 0.62;
      await sleep(16);
    }
    yard.phase = 0.62;
    const sim = simulate(launch(ev.t, ev.line), ev.before.map(fromLite), true);
    whoosh(0.5);
    let hit = 0;
    const start = performance.now();
    const tEnd = sim.frames[sim.frames.length - 1].t;
    let followed = false;
    for (let f = 0; f < sim.frames.length; ) {
      const t = ((performance.now() - start) / 1000) * sp() * 0.85;
      while (f < sim.frames.length - 1 && sim.frames[f + 1].t <= t) f++;
      const fr = sim.frames[f];
      const [bx, by, bz, ba, br] = fr.p[0];
      yard.phase = Math.min(1, 0.62 + t * 0.8);
      yard.setBat({ x: bx, y: by, z: bz, a: ba, roll: br, stand: false });
      yard.setRods(fr.p.slice(1).map(([x, y, z, a, roll, st], k) => ({ x, y, z, a, roll, stand: !!st, mark: !!ev.before[k]?.mark })));
      while (hit < sim.hits.length && sim.hits[hit].t <= t) {
        knock(sim.hits[hit].k, sim.hits[hit].v);
        hit++;
      }
      // камера: за битой, потом — на город
      if (by < -3 && ev.line < -8 && by > ev.line + 3.5) yard.camTo('flight', { x: bx, y: Math.min(by, -3) }, 5);
      else if (by < -3 && ev.line < -8) yard.camTo('aim', undefined, 4);
      else if (!followed) {
        followed = true;
        yard.camTo('city', undefined, 3.5);
      }
      if (t >= tEnd) break;
      await sleep(16);
    }
    yard.phase = null;
    await sleep(250 / sp());
    if (ev.lost) {
      Sound.nomove();
      say('Потерянный бросок', 'бита коснулась земли перед штрафной линией — городки на место', 1800);
      await sleep(900 / sp());
      yard.setRods(rodsOf(ev.before));
    } else {
      const n = ev.out.length;
      if (n) {
        Sound.capture();
        say(n >= 5 ? 'Чисто!' : n === 1 ? 'Выбит!' : `Выбито ${n}!`, ev.markBack ? 'марка задела соседей — вернули в центр' : '', 1300);
      } else say('Мимо', ev.markBack ? 'марка задела соседей — вернули в центр' : '', 1000);
      if (ev.moved.length) {
        await sleep(700 / sp());
        say('На отметку', 'городок у штрафной линии переставили', 1200);
      }
      await sleep(500 / sp());
      yard.setRods(rodsOf(ev.after));
    }
    yard.setBat(null);
    await sleep(500 / sp());
    void i;
  }

  return {
    mount(el, c) {
      ctx = c;
      root = el;
      const wrap = h(`<div class="gk-wrap"><div class="gk-cv"></div><div class="gk-hud"></div><div class="gk-lupa">город крупно</div><div class="gk-banner"></div>
        ${ctx.demo ? '' : '<div class="gk-tip">Потяните вниз и отпустите — бросок</div>'}</div>`);
      root.appendChild(wrap);
      hud = wrap.querySelector('.gk-hud') as HTMLElement;
      banner = wrap.querySelector('.gk-banner') as HTMLElement;
      lupaTag = wrap.querySelector('.gk-lupa') as HTMLElement;
      yard = new Yard3D(wrap.querySelector('.gk-cv') as HTMLElement);
      yard.lupa = store.get<string>('gorodki.lupa', 'on') !== 'off';
      // двор и люди грузятся — боты подождут
      ctx.hold?.(20000);
      void yard.loaded.then(
        () => ctx.hold?.(0),
        () => ctx.hold?.(0)
      );
      yard.camTo('aim');
      yard.snapCam();
      bindInput();
      controls();
      const vis = () => syncMusic();
      document.addEventListener('visibilitychange', vis);
      cleanup.push(() => document.removeEventListener('visibilitychange', vis));
      raf = requestAnimationFrame(frame);
    },
    setView(s) {
      v = s;
      showState(s);
      if (s.shot && dbgPose == null) {
        // превью карточки: замах у кона, город — в лупе
        hud.style.display = 'none';
        yard.thrower = { seat: s.seats[0], x: 0, line: -13 };
        yard.phase = 0.48;
        yard.camTo('aim');
        yard.snapCam();
      }
      syncMusic();
    },
    async play(events, s) {
      busy = true;
      act = null;
      yard.setAim(null);
      Sound.unlock();
      const sp = () => Math.max(0.25, ctx.speed());
      for (const ev of events) {
        if (ev.k === 'throw') await playThrow(ev);
        else if (ev.k === 'figure') {
          yard.cheer();
          Sound.win();
          say(`«${esc(figName(ev.fig))}» выбита!`, ev.next ? `дальше — «${esc(figName(ev.next))}»` : '', 1600);
          await sleep(1300 / sp());
        } else if (ev.k === 'finish') {
          say('Все фигуры!', `${ctx.name(ev.seat)} — за ${ev.throws} бит`, 2000);
          await sleep(1500 / sp());
        } else if (ev.k === 'turn') {
          v = s;
          showState(s);
          say(`Бросает ${ctx.name(ev.seat)}`, '', 1100);
          await sleep(700 / sp());
        }
      }
      v = s;
      showState(s, false);
      if (!s.over) yard.camTo('aim', undefined, 2.5);
      busy = false;
      syncMusic();
    },
    setTurn(toAct, interactive) {
      const mine = interactive.find((x) => toAct.includes(x));
      act = v && !v.over && !ctx.demo && mine != null ? mine : null;
      if (act != null && v) {
        // прицел — в середину фигуры, сила — к лицевой линии
        const rods = v.p[v.cur].rods;
        const cx = rods.length ? rods.reduce((a, r) => a + r.x, 0) / rods.length : 0;
        aim = { f: figure(v.cfg.figs[v.p[v.cur].fig] ?? 'pushka').id === 'tir' ? 0.86 : 0.8, ang: clamp(Math.atan2(cx - posX, -lineOf(v)), -0.38, 0.38) };
        t0 = performance.now();
      } else yard.setAim(null);
      root.querySelector('.gk-tip')?.classList.toggle('on', act != null);
    },
    status(s, toAct, interactive) {
      if (s.over) return 'Партия окончена';
      const p = s.p[s.cur];
      const fig = figName(s.cfg.figs[Math.min(p.fig, s.cfg.figs.length - 1)]);
      return interactive.includes(toAct[0]) ? `Ваш бросок: «${fig}», ${p.kon ? 'с кона' : 'с полукона'}` : `Бросает ${ctx.name(toAct[0])}…`;
    },
    playerStats(s, seat) {
      const k = s.seats.indexOf(seat);
      if (k < 0) return '';
      const p = s.p[k];
      return p.done ? `все фигуры · бит: ${p.throws}` : `фигура ${p.fig + 1}/${s.cfg.figs.length} · бит: ${p.throws}`;
    },
    saveTitle(s) {
      const p = s.p[s.cur];
      return `«${figName(s.cfg.figs[Math.min(p.fig, s.cfg.figs.length - 1)])}» · бит ${p.throws}`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      music?.pause();
      music = null;
      yard?.dispose();
    },
  };
}

export { lerp };
