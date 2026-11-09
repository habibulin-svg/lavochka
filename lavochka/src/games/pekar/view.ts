/* Пекарь — экран игры реального времени: 3D-пустырь, свой пацан под управлением (WASD/стрелки, на телефоне — стик набора
 * core/dvorsport/pad.ts), рывок, бросок палки «рогаткой» (потянул вниз — отпустил), пекарем — «Салить!». Комната шлёт
 * снимки; между ними пацаны и палки идут плавно (досчёт по скорости и по тем же полётам, что у комнаты). Подсказка внизу
 * всегда говорит, что можно сделать сейчас. Музыки нет (решение пользователя) — только звуки. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { showLoading } from '../../core/loading';
import { segRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { sample } from '../../core/dvorsport/body';
import { isFrames, playFrames, type FramesEvent } from '../../core/dvorsport/demo';
import { PullAim } from '../../core/dvorsport/input';
import { Pad } from '../../core/dvorsport/pad';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { canHome, clamp, dist2, inField, kicker, lineY, rankName, stickFlight, throwFrom, whoThrows, yawTo, type Event, type In, type State, type Style } from './engine';
import { PekarYard } from './scene';
import './pekar.css';

const PREF_STYLE = 'pekar.style';
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Звон жестяной банки, стук палки о землю, свист, шлепок. */
function clank(v: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  const s = clamp(v, 0.3, 1);
  for (const [f, g] of [[1850, 0.22], [2730, 0.16], [3900, 0.1]] as const) tone(t, { freq: f, to: f * 0.97, dur: 0.35, gain: g * s, type: 'triangle' });
  click(t, { freq: 3200, q: 2, dur: 0.05, gain: 0.6 * s });
  for (let k = 1; k < 4; k++) tone(t + 0.18 * k, { freq: 1600 - k * 150, dur: 0.08, gain: 0.08 / k, type: 'triangle' });
}
function knock() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  tone(t, { freq: 220, to: 120, dur: 0.07, gain: 0.3, type: 'triangle' });
  click(t, { freq: 1400, q: 1.5, dur: 0.03, gain: 0.35 });
}
function tick() {
  const o = audioOut();
  if (o) click(o.ctx.currentTime, { freq: 1200, q: 2, dur: 0.03, gain: 0.25 });
}
function whoosh(dur: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  for (let k = 0; k < 6; k++) click(t + (k * dur) / 6, { freq: 500 + k * 90, q: 0.8, dur: dur / 5, gain: 0.05 });
}
function slap() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  click(t, { freq: 900, q: 1, dur: 0.06, gain: 0.5 });
  tone(t, { freq: 160, to: 90, dur: 0.08, gain: 0.25 });
}

/** Показ одного пацана: сглаженное место и «занят» (бросок, удар) до такого-то времени. */
interface Disp {
  x: number;
  y: number;
  busy: number;
  init: boolean;
}

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx;
  let wrap: HTMLElement;
  let yard: PekarYard;
  let hud: HTMLElement;
  let banner: HTMLElement;
  let ask: HTMLElement;
  let pad: Pad;
  let pull: PullAim | null = null;
  let raf = 0;
  let iv = 0;
  let last = 0;
  let bannerT = 0;
  let hintT = 0;
  let latest: State | null = null;
  let latestAt = 0;
  /** Каким игроком (номер в партии) управляет этот экран. */
  let ctrl = -1;
  const seq = new Map<number, { th: number; k: number; a: number; d: number }>();
  let thReq: In['th'] | undefined;
  let kReq: In['k'] | undefined;
  let aim = { pow: 0, yaw: 0, on: false };
  let aimKey = '';
  const disp: Disp[] = [];
  const cleanup: (() => void)[] = [];
  const t0wob = performance.now();

  const style = () => store.get<Style>(PREF_STYLE, 'flat');
  const nm = (i: number) => (latest ? ctx.name(latest.seats[i]) : '');
  const sq = (i: number) => {
    let q = seq.get(i);
    if (!q) seq.set(i, (q = { th: 0, k: 0, a: 0, d: 0 }));
    return q;
  };

  function say(big: string, small = '', ms = 1400) {
    banner.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`;
    banner.style.opacity = '1';
    bannerT = performance.now() + ms;
  }

  /** Мои игроки (номера в партии), за которых играет этот экран. */
  function mine(s: State): number[] {
    if (ctx.demo) return [];
    return s.seats.map((seat, i) => (ctx.mySeats.includes(seat) ? i : -1)).filter((i) => i >= 0);
  }

  /** Кем управлять: несколько на одном экране — тот, чей бросок (пинок) или пекарь у лежащей банки; иначе — выбранный. */
  function pickCtrl(s: State) {
    const m = mine(s);
    if (!m.length) {
      ctrl = -1;
      return;
    }
    if (!m.includes(ctrl)) ctrl = m[0];
    if (m.length > 1) {
      const k = s.phase === 'kick' ? kicker(s) : whoThrows(s);
      if (k >= 0 && m.includes(k)) ctrl = k;
      else if (s.phase === 'play' && s.can.mode !== 'up' && m.includes(s.pekar)) ctrl = s.pekar;
    }
  }

  /** Время партии сейчас (между снимками — досчёт). */
  const nowT = () => (latest ? latest.t + Math.min(0.25, (performance.now() - latestAt) / 1000) * latest.speed : 0);

  /** Камера смотрит на банку (+1) или, у пекаря, на черты (−1): стик и клавиши — по камере. */
  const facing = (s: State) => (ctrl >= 0 && ctrl === s.pekar && s.phase === 'play' ? -1 : 1);

  // ---------------------------------------------------------------- ввод

  function wob() {
    const tt = (performance.now() - t0wob) / 1000;
    return { yaw: Math.sin(tt * 1.9) * 0.03 + Math.sin(tt * 3.3 + 1) * 0.016, pow: Math.sin(tt * 2.6 + 2) * 0.04 };
  }

  const myThrow = (s: State | null) => !!s && !s.over && ctrl >= 0 && s.phase === 'play' && whoThrows(s) === ctrl;
  const myKick = (s: State | null) => !!s && !s.over && ctrl >= 0 && s.phase === 'kick' && kicker(s) === ctrl;

  function release() {
    const s = latest;
    if (!s || ctrl < 0) return;
    const q = sq(ctrl);
    Sound.unlock();
    if (myKick(s)) kReq = { n: ++q.k, pow: clamp(aim.pow, 0, 1) };
    else if (myThrow(s)) {
      const w = wob();
      thReq = { n: ++q.th, pow: clamp(aim.pow + w.pow, 0, 1), yaw: clamp(aim.yaw + w.yaw, -0.5, 0.5), style: style() };
    }
    aim.on = false;
    yard.setAim(null, null);
  }

  function sendInputs() {
    const s = latest;
    if (!s || s.over || ctx.demo || !ctx.input) return;
    pickCtrl(s);
    if (ctrl < 0) return;
    const q = sq(ctrl);
    if (pad.take('act')) q.a++;
    if (pad.take('dash')) q.d++;
    if (pad.take('thr')) {
      if (!aim.on) aim = { pow: 0.6, yaw: 0, on: true };
      release();
    }
    if (pad.take('sw')) {
      const m = mine(s);
      ctrl = m[(m.indexOf(ctrl) + 1) % m.length];
    }
    const d = pad.dir();
    const f = facing(s);
    for (const i of mine(s)) {
      const qi = sq(i);
      const inp: In = i === ctrl ? { mx: d.x * f, my: d.y * f, a: qi.a, d: qi.d } : { mx: 0, my: 0, a: qi.a, d: qi.d };
      if (i === ctrl && thReq) inp.th = thReq;
      if (i === ctrl && kReq) inp.k = kReq;
      ctx.input(s.seats[i], inp);
    }
  }

  function bindInput() {
    pad = new Pad(wrap, [
      { id: 'act', label: 'Салить!', keys: ['Space', 'KeyE'] },
      { id: 'thr', label: 'Бросок', keys: ['Enter'] },
      { id: 'dash', label: 'Рывок', keys: ['ShiftLeft', 'ShiftRight'] },
      { id: 'sw', label: 'Другой', keys: ['Tab', 'KeyQ'] },
    ]);
    pad.enabled = () => !!latest && !latest.over && ctrl >= 0 && !ctx.demo;
    cleanup.push(() => pad.dispose());
    pull = new PullAim(yard.canvas, wrap, {
      enabled: () => myThrow(latest) || myKick(latest),
      onStart: () => (aim = { pow: 0, yaw: 0, on: true }),
      onAim: (pow, side) => {
        aim.pow = pow;
        aim.yaw = clamp(side * 0.6, -0.5, 0.5);
        aim.on = true;
      },
      onRelease: () => release(),
    });
    cleanup.push(() => pull?.dispose());
    // тап по полю пекарем — «Салить!»
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      const s = latest;
      if (down && s && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12 && ctrl === s.pekar && s.can.mode === 'up') pad.press('act');
      down = null;
    };
    yard.canvas.addEventListener('pointerdown', pd);
    yard.canvas.addEventListener('pointerup', pu);
    cleanup.push(() => (yard.canvas.removeEventListener('pointerdown', pd), yard.canvas.removeEventListener('pointerup', pu)));
  }

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    box.innerHTML = '';
    box.appendChild(
      segRow(
        'Бросок',
        [
          ['flat', 'низом'],
          ['lob', 'навесом'],
        ],
        style,
        (x) => {
          store.set(PREF_STYLE, x);
          aimKey = '';
        },
      ),
    );
  }

  // ---------------------------------------------------------------- подсказка и табло

  function hint(s: State) {
    let t = '';
    const me = ctrl;
    if (s.over || s.phase === 'pause') t = '';
    else if (s.phase === 'kick') {
      const k = kicker(s);
      t = k < 0 ? '' : me === k ? '<b>Жеребьёвка — ваш пинок.</b> Потяните вниз и отпустите. Ближе всех — пекарь.' : `Жеребьёвка: пинает ${nm(k)}…`;
    } else if (me < 0) {
      const w = whoThrows(s);
      t = w >= 0 ? `Бросает ${nm(w)}…` : s.can.mode !== 'up' ? 'Пекарь бежит за банкой — все за палками!' : 'Все за палками…';
    } else if (me === s.pekar) {
      const runners = s.men.some((_, i) => inField(s, i));
      t =
        s.can.mode === 'down' || s.can.mode === 'fly'
          ? '<b>Вы пекарь!</b> Бегите к банке (WASD, стрелки, стик) — подберёте, коснувшись.'
          : s.can.mode === 'held'
            ? '<b>Несите банку в кружок</b> — поставите, войдя в него.'
            : runners
              ? '<b>Салите!</b> Догоните того, кто в поле (красное кольцо), — «Салить!»: пробел или тап.'
              : 'Вы пекарь. Сторожите банку: выбегут за палкой — догоняйте.';
    } else {
      const st = s.sticks[me];
      const w = whoThrows(s);
      t =
        w === me
          ? '<b>Ваш бросок!</b> Потяните вниз (сила) и вбок, отпустите. Кольцо — где ляжет палка.'
          : st.at === 'ground'
            ? s.can.mode !== 'up'
              ? '<b>Банка лежит — бегите за палкой!</b> (WASD, стрелки, стик) Подберите — и назад за свою черту.'
              : '<b>Ваша палка в поле.</b> Сбегайте, пока пекарь далеко, — за чертой не осалят. Рывок — Shift.'
            : inField(s, me)
              ? '<b>Назад за черту!</b> Там не осалят. Рывок — Shift.'
              : w >= 0
                ? `Бросает ${nm(w)}. Ждите своей очереди за чертой.`
                : 'Ждите: пока палки в поле, бросать некому.';
    }
    if (ask.innerHTML !== t) ask.innerHTML = t;
    const pk = me >= 0 && me === s.pekar && s.phase === 'play';
    pad.show({
      act: pk && s.can.mode === 'up' ? '!Салить!' : null,
      thr: myThrow(s) ? '!Бросок' : null,
      dash: s.phase === 'play' && me >= 0 ? 'Рывок' : null,
      sw: mine(s).length > 1 ? 'Другой' : null,
    });
    pad.visible(me >= 0 && !s.over);
  }

  function drawHud(s: State) {
    const c = s.cfg;
    const w = s.phase === 'kick' ? kicker(s) : whoThrows(s);
    const rows = s.men
      .map((m, i) => {
        const seat = s.seats[i];
        const role = s.phase === 'kick' ? (s.kicks[i] != null ? `${s.kicks[i]!.toFixed(1)} м` : '…') : i === s.pekar ? '🥫 пекарь' : esc(rankName(c, m));
        return `<div class="pk-row${i === w ? ' cur' : ''}${i === ctrl ? ' me' : ''}"><i style="background:${SEATS[seat % SEATS.length].color}"></i><span class="nm">${ctx.name(seat)}</span><span class="rl">${role}</span></div>`;
      })
      .join('');
    const goal = c.ranks.length > 1 ? `сбить ${c.ranks[c.ranks.length - 1].toLowerCase()}ом` : `до ${c.target} банок`;
    const html = `<div class="pk-board"><div class="pk-head">${esc(goal)}</div>${rows}</div>`;
    if (hud.innerHTML !== html) hud.innerHTML = html;
  }

  // ---------------------------------------------------------------- события

  function onEvent(s: State, ev: Event) {
    const tn = (i: number) => yard.men[i]?.toon ?? null;
    const busy = (i: number, sec: number) => {
      if (disp[i]) disp[i].busy = performance.now() + sec * 1000;
    };
    switch (ev.k) {
      case 'kick':
        tn(ev.who)?.play('jump', false, 0.1, 1.6);
        busy(ev.who, 0.7);
        knock();
        say(ev.slip ? 'Сорвалась!' : `${ev.d.toFixed(1)} м`, nm(ev.who), 900);
        break;
      case 'draw':
        Sound.capture();
        say('Пекарь — ' + nm(ev.pekar), 'палка ближе всех', 1600);
        break;
      case 'throw':
        tn(ev.who)?.play('throw', false, 0.08, 1.4);
        busy(ev.who, 0.9);
        whoosh(0.4);
        break;
      case 'knock': {
        clank(1);
        Sound.win();
        const c = s.cfg;
        tn(ev.who)?.play('cheer', false, 0.15);
        busy(ev.who, 1.2);
        say(c.ranks.length > 1 ? (ev.rank >= c.ranks.length ? 'Победа!' : c.ranks[ev.rank]) : `Сбил: ${ev.knocks}`, `${nm(ev.who)} сбил банку`, 1500);
        break;
      }
      case 'land':
        knock();
        if (!ev.hit && ev.who === ctrl && s.phase === 'play') say(ev.y < s.cfg.dist - 1 ? 'Недолёт' : ev.y > s.cfg.dist + 1 ? 'Перелёт' : 'Мимо!', '', 900);
        break;
      case 'pick':
        tick();
        break;
      case 'can':
        knock();
        if (ev.what === 'set') say('Банка на месте', 'теперь пекарь салит', 900);
        break;
      case 'tag':
        slap();
        Sound.capture();
        tn(ev.by)?.play('swing1h', false, 0.08, 1.4);
        busy(ev.by, 0.9);
        tn(ev.who)?.play('hit', false, 0.08);
        busy(ev.who, 0.9);
        say('Осалил!', `${nm(ev.who)} — пекарь`, 1500);
        break;
      case 'pekar':
        say('Пекарь — ' + nm(ev.who), s.cfg.ranks.length > 1 ? esc(s.cfg.ranks[ev.rank]) : '', 1300);
        break;
      case 'skip':
        say('Ход дальше', `${nm(ev.who)} не бросил`, 1100);
        break;
      case 'end':
        Sound.win();
        say('Конец партии!', s.winners.map((w) => ctx.name(w)).join(', '), 3000);
        break;
    }
  }

  // ---------------------------------------------------------------- кадр

  function draw(dt: number) {
    const s = latest;
    if (!s) return;
    const c = s.cfg;
    const T = nowT();
    const home = canHome(c);
    const now = performance.now();
    yard.setField({ dist: c.dist, ranks: c.ranks.map((_, r) => lineY(c, r)) });
    yard.setPlayers(c.n, s.seats.map((seat) => SEATS[seat % SEATS.length].color));
    const k = Math.min(1, dt * 14);
    const lag = Math.min(0.25, (now - latestAt) / 1000) * s.speed;
    const thrower = whoThrows(s);
    for (let i = 0; i < c.n; i++) {
      const m = s.men[i];
      const tx = m.x + m.vx * lag;
      const ty = m.y + m.vy * lag;
      const d = (disp[i] ??= { x: tx, y: ty, busy: 0, init: false });
      if (!d.init || dist2([d.x, d.y], [tx, ty]) > 3) {
        d.x = tx;
        d.y = ty;
        d.init = true;
      } else {
        d.x += (tx - d.x) * k;
        d.y += (ty - d.y) * k;
      }
      const v = Math.hypot(m.vx, m.vy);
      const face: [number, number] = v > 0.5 ? [d.x + m.vx, d.y + m.vy] : i === s.pekar && s.phase === 'play' ? [d.x, d.y - 5] : [home[0], home[1]];
      yard.put(i, d.x, d.y, face);
      const tn = yard.men[i]?.toon ?? null;
      // клип: бег — по скорости на экране (физика замедлена «скоростью игры»)
      const vs = v * s.speed;
      if (tn && now > d.busy) {
        if (vs > 0.4) tn.play(vs > 2 ? 'run' : 'walk', true, 0.2, vs > 2 ? vs / 4.5 : vs / 1.4);
        else tn.play(i === s.pekar && s.can.mode === 'held' ? 'holding' : i === thrower ? 'holding' : i % 2 ? 'idle2' : 'idle', true, 0.3);
      }
      const st = s.sticks[i];
      if (st.at === 'fly' && st.b0 && st.t0 != null) {
        const f = stickFlight(st.b0, st.style ?? 'flat', st.aim ? home : null);
        const fr = sample(f.frames, T - st.t0);
        if ((st.style ?? 'lob') === 'flat') yard.stickAt(i, fr[1], fr[2], fr[3], fr[4], Math.PI / 2);
        else yard.stickAt(i, fr[1], fr[2], fr[3], Math.atan2(st.b0.vx, st.b0.vy), fr[4]);
      } else if (st.at === 'ground') yard.stickAt(i, st.x, st.y, 0.025, st.a);
      else yard.stickIn(i, tn, 1);
    }
    const cn = s.can;
    if (cn.mode === 'up') yard.setCan(home[0], home[1], false);
    else if (cn.mode === 'fly') {
      const q = clamp((T - cn.t0) / 0.6, 0, 1);
      const e = 1 - (1 - q) * (1 - q);
      yard.setCan(lerp(cn.fx, cn.x, e), lerp(cn.fy, cn.y, e), q > 0.15, cn.a + q * 6, Math.sin(q * Math.PI) * 0.5);
    } else if (cn.mode === 'down') yard.setCan(cn.x, cn.y, true, cn.a);
    else {
      const tn = yard.men[s.pekar]?.toon;
      if (tn) yard.canInHand(tn);
    }
    // кольца: я — жёлтое; пекарю — красные у тех, кто в поле; бегущему — красное у пекаря, пока банка стоит
    yard.clearMarks();
    if (ctrl >= 0 && s.phase !== 'kick' && !s.shot) {
      yard.mark(ctrl, '#ffe23a');
      if (ctrl === s.pekar) s.men.forEach((_, i) => inField(s, i) && yard.mark(i, '#ff4a2a'));
      else if (s.pekar >= 0 && s.can.mode === 'up' && inField(s, ctrl)) yard.mark(s.pekar, '#ff4a2a');
    }
    if (aim.on && myThrow(s)) {
      const m = s.men[ctrl];
      const w = wob();
      const pow = clamp(aim.pow + w.pow, 0, 1);
      const yaw = yawTo(c, m.x, m.y) + clamp(aim.yaw + w.yaw, -0.5, 0.5);
      const key = `${pow.toFixed(3)},${yaw.toFixed(3)},${style()},${m.x.toFixed(2)},${m.y.toFixed(2)}`;
      if (key !== aimKey) {
        aimKey = key;
        const f = stickFlight(throwFrom(c, m.x, m.y, pow, yaw, style()), style(), null);
        yard.setAim(
          f.frames.map((fr) => [fr[1], fr[2], fr[3]] as [number, number, number]),
          [f.rest[0], f.rest[1]],
        );
      }
    } else if (!aim.on) yard.setAim(null, null);
    // камера: за своим пацаном (пекарю — лицом к чертам); без своего — общий план
    if (s.shot) yard.camTo('throw', { x: s.men[0].x, y: s.men[0].y }, 50);
    else if (s.phase === 'kick') yard.camTo('throw', { x: 0, y: 0 }, 2.5);
    else if (ctrl >= 0 && disp[ctrl]) {
      const d = disp[ctrl];
      if (facing(s) < 0) yard.shot({ pos: [d.x * 0.8 - 0.6, d.y + 6.2, 3.4], look: [d.x * 0.5, d.y - 7, 0.2], fov: 6, speed: 3 });
      else yard.shot({ pos: [d.x * 0.8 + 0.7, d.y - 5.4, 3.1], look: [d.x * 0.4, Math.max(d.y + 4, d.y + (c.dist - d.y) * 0.7), 0.2], fov: 4, speed: 3 });
    } else yard.camTo('field', undefined, 2);
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (document.hidden) return;
    if (bannerT && now > bannerT) {
      banner.style.opacity = '0';
      bannerT = 0;
    }
    draw(dt);
    if (latest && now > hintT) {
      hintT = now + 150;
      hint(latest);
      drawHud(latest);
    }
    yard.render(dt);
  }

  function take(v: State) {
    latest = v;
    if (import.meta.env.DEV) (window as unknown as { __pks: State }).__pks = v;
    latestAt = performance.now();
    pickCtrl(v);
    // нажатие, которое комната уже учла, больше не слать
    if (ctrl >= 0) {
      const sn = v.seen[ctrl];
      if (thReq && sn && sn.th >= thReq.n) thReq = undefined;
      if (kReq && sn && sn.k >= kReq.n) kReq = undefined;
    }
  }

  return {
    mount(el, c) {
      ctx = c;
      wrap = h(`<div class="pk-wrap"><div class="pk-cv"></div><div class="pk-hud"></div><div class="pk-ask"><div class="pk-say"></div></div><div class="pk-banner"></div></div>`);
      el.appendChild(wrap);
      hud = wrap.querySelector('.pk-hud') as HTMLElement;
      banner = wrap.querySelector('.pk-banner') as HTMLElement;
      ask = wrap.querySelector('.pk-say') as HTMLElement;
      yard = new PekarYard(wrap.querySelector('.pk-cv') as HTMLElement);
      ctx.hold?.(30000);
      const y = yard;
      const shot = ctx.demo || /[?&]thumb=/.test(location.search);
      if (!shot) wrap.classList.add('pk-loading');
      const ld = shot ? null : showLoading({ art: `${import.meta.env.BASE_URL}gorodki/backdrop.webp`, title: 'Пекарь — ставим банку на пустыре…' });
      cleanup.push(() => ld?.done());
      void (async () => {
        try {
          await y.loaded;
          const until = performance.now() + 15000;
          while ((y.pending > 0 || !y.men.length) && performance.now() < until) await sleep(100);
          await y.warm();
        } catch (e) {
          console.warn('пекарь: загрузка поля', e);
        }
        wrap.classList.remove('pk-loading');
        ld?.done();
        ctx.hold?.(0);
      })();
      yard.camTo('throw', { x: 0, y: 0 });
      yard.snapCam();
      bindInput();
      controls();
      raf = requestAnimationFrame(frame);
      iv = window.setInterval(sendInputs, 20);
    },
    setView(v) {
      take(v);
      if (v.shot) {
        hud.style.display = 'none';
        ask.style.display = 'none';
        draw(0.016);
        yard.snapCam();
      }
    },
    async play(events, v) {
      // показ правил: кусок партии снимками — проиграть как живую партию
      for (const e of events as unknown[])
        if (isFrames(e)) await playFrames(e as FramesEvent<State, Event>, (f, evs) => this.realtime!(f, evs), () => ((1000 / 60) * e.every) / Math.max(0.25, ctx.speed()));
      take(v);
    },
    realtime(v, events) {
      take(v);
      for (const ev of events) onEvent(v, ev);
    },
    setTurn() {},
    status(s) {
      if (!s) return '';
      if (s.over) return 'Партия окончена';
      if (s.phase === 'kick' || s.pekar < 0) return 'Жеребьёвка: пинаем палки';
      return `Пекарь — ${ctx.name(s.seats[s.pekar])}`;
    },
    playerStats(s, seat) {
      const i = s.seats.indexOf(seat);
      if (i < 0) return '';
      return i === s.pekar ? 'пекарь' : rankName(s.cfg, s.men[i]);
    },
    saveTitle(s) {
      if (s.phase === 'kick' || s.pekar < 0) return 'жеребьёвка';
      const best = s.men.reduce((a, m, i) => (m.rank > s.men[a].rank ? i : a), 0);
      return `пекарь ${SEATS[s.seats[s.pekar] % SEATS.length].name} · выше всех ${SEATS[s.seats[best] % SEATS.length].name} (${rankName(s.cfg, s.men[best])})`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      cleanup.forEach((f) => f());
      yard?.dispose();
    },
  };
}
