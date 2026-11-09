/* Чиж — экран игры реального времени: 3D-пустырь, свой пацан под управлением (WASD/стрелки, на телефоне — стик набора
 * core/dvorsport/pad.ts), рывок. Бьющий: «рогатка» (PullAim) — сила и куда бить, отпустил — чиж подлетел, «Бей!» —
 * удар (чиж в «поясе» подсвечен зелёным); отбить бросок — «Бей!»; добивание — то же у лежащего чижа, «Считать».
 * Водящий: кольцо падения, «Ловить!», подбор касанием, бросок в кон «рогаткой». Камера — за своим пацаном, стик
 * и клавиши по камере. Подсказка внизу всегда говорит, что можно сделать сейчас. Музыки нет (решение пользователя). */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { showLoading } from '../../core/loading';
import { isFrames, playFrames, type FramesEvent } from '../../core/dvorsport/demo';
import { PullAim } from '../../core/dvorsport/input';
import { Pad } from '../../core/dvorsport/pad';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import {
  airborne,
  awayYaw,
  BAT,
  catchSpot,
  BONUS_K,
  BONUS_REACH,
  chAt,
  chFlight,
  clamp,
  hitBody,
  hitQuality,
  SWING,
  throwBody,
  total,
  yawToKon,
  type Event,
  type In,
  type State,
} from './engine';
import { ChizhYard } from './scene';
import './chizh.css';

/** Сухой стук дерева о дерево (подбив, удар), шлепок ладоней (поймал), глухой стук о землю. */
function crack(v: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  const s = clamp(v, 0.25, 1);
  click(t, { freq: 2600, q: 3, dur: 0.035, gain: 0.7 * s });
  tone(t, { freq: 620, to: 380, dur: 0.06, gain: 0.25 * s, type: 'triangle' });
  tone(t, { freq: 1240, to: 900, dur: 0.04, gain: 0.12 * s, type: 'square' });
}
function thud() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  tone(t, { freq: 180, to: 110, dur: 0.06, gain: 0.22, type: 'triangle' });
  click(t, { freq: 900, q: 1.2, dur: 0.025, gain: 0.2 });
}
function slap() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  click(t, { freq: 900, q: 1, dur: 0.06, gain: 0.5 });
  tone(t, { freq: 160, to: 90, dur: 0.08, gain: 0.25 });
}
function whoosh(dur: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  for (let k = 0; k < 6; k++) click(t + (k * dur) / 6, { freq: 500 + k * 90, q: 0.8, dur: dur / 5, gain: 0.05 });
}
function ticks(n: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  for (let k = 0; k < Math.min(n, 12); k++) click(t + k * 0.07, { freq: 1500 + k * 40, q: 2, dur: 0.02, gain: 0.18 });
}

interface Disp {
  x: number;
  y: number;
  busy: number;
  init: boolean;
}

/** Куда смотрит камера бьющего от чижа: на телефоне низ поля закрыт стиком и кнопками — чиж выше в кадре. */
const AHEAD = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? -0.4 : 0.9;

const angLerp = (a: number, b: number, k: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx;
  let wrap: HTMLElement;
  let yard: ChizhYard;
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
  let ctrl = -1;
  let autoKey = '';
  const seq = new Map<number, { th: number; s: number; c: number; d: number; st: number }>();
  let thReq: In['th'] | undefined;
  let aim = { pow: 0, yaw: 0, on: false };
  let aimKey = '';
  /** Куда смотрит камера (угол в осях игры: 0 — вдоль поля от кона), плавно. */
  let look = 0;
  let lookInit = false;
  let tapeTo: [number, number] | null = null;
  const disp: Disp[] = [];
  const cleanup: (() => void)[] = [];
  const t0wob = performance.now();

  const nm = (i: number) => (latest && i >= 0 ? ctx.name(latest.seats[i]) : '');
  const sq = (i: number) => {
    let q = seq.get(i);
    if (!q) seq.set(i, (q = { th: 0, s: 0, c: 0, d: 0, st: 0 }));
    return q;
  };

  function say(big: string, small = '', ms = 1400) {
    banner.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`;
    banner.style.opacity = '1';
    bannerT = performance.now() + ms;
  }

  function mine(s: State): number[] {
    if (ctx.demo) return [];
    return s.seats.map((seat, i) => (ctx.mySeats.includes(seat) ? i : -1)).filter((i) => i >= 0);
  }

  /** Кем управлять: за одним экраном несколько — бьющий в своё время, водящий с чижом, ближний к чижу; Tab — вручную. */
  function pickCtrl(s: State) {
    const m = mine(s);
    if (!m.length) {
      ctrl = -1;
      return;
    }
    if (!m.includes(ctrl)) ctrl = m[0];
    if (m.length < 2) return;
    const key = `${s.phase}|${s.ch.t0 ?? ''}|${s.holder}|${s.batter}`;
    if (key === autoKey) return;
    autoKey = key;
    if (m.includes(s.holder)) ctrl = s.holder;
    else if (m.includes(s.batter) && s.phase !== 'fly' && s.phase !== 'field') ctrl = s.batter;
    else {
      const f = m.filter((i) => i !== s.batter);
      if (!f.length) return;
      const [x, y] = s.phase === 'fly' && s.ch.b0 ? chFlight(s.ch.b0).rest : chAt(s);
      ctrl = f.reduce((a, i) => (Math.hypot(s.men[i].x - x, s.men[i].y - y) < Math.hypot(s.men[a].x - x, s.men[a].y - y) ? i : a), f[0]);
    }
  }

  const nowT = () => (latest ? latest.t + Math.min(0.25, (performance.now() - latestAt) / 1000) * latest.speed : 0);

  /** Куда смотреть: бьющему — в поле (на добивании — прочь от кона), водящему — на кон. */
  function lookGoal(s: State): number {
    if (ctrl < 0) return 0;
    const m = s.men[ctrl];
    if (ctrl === s.batter) return s.phase === 'tee' || s.phase === 'pop' ? (s.strike > 0 ? awayYaw(s.ch.x, s.ch.y) : 0) : awayYaw(s.ch.x, s.ch.y);
    return yawToKon(m.x, m.y);
  }

  // ---------------------------------------------------------------- ввод

  function wob() {
    const tt = (performance.now() - t0wob) / 1000;
    return { yaw: Math.sin(tt * 1.9) * 0.025 + Math.sin(tt * 3.3 + 1) * 0.012, pow: Math.sin(tt * 2.6 + 2) * 0.035 };
  }

  const isBatter = (s: State | null) => !!s && !s.over && ctrl >= 0 && ctrl === s.batter;
  /** Можно тянуть «рогатку»: бьющий у кона / у лежащего чижа на добивании, водящий с чижом. */
  function canPull(s: State | null): boolean {
    if (!s || s.over || ctrl < 0 || ctx.demo) return false;
    if (s.holder === ctrl && s.phase === 'field') return true;
    if (!isBatter(s)) return false;
    if (s.phase === 'tee') return true;
    if (s.phase === 'bonus') return Math.hypot(s.men[ctrl].x - s.ch.x, s.men[ctrl].y - s.ch.y) < BONUS_REACH;
    return false;
  }
  /** «Бей!» / «Ловить!» сейчас к месту. */
  function actNow(s: State | null): 'bat' | 'catch' | null {
    if (!s || s.over || ctrl < 0) return null;
    if (ctrl === s.batter) return s.phase === 'pop' || (s.phase === 'back' && airborne(s, nowT())) ? 'bat' : null;
    return s.phase === 'fly' && airborne(s, nowT()) ? 'catch' : null;
  }

  function release() {
    const s = latest;
    if (!s || ctrl < 0 || !canPull(s)) return;
    const q = sq(ctrl);
    Sound.unlock();
    const w = wob();
    thReq = { n: ++q.th, pow: clamp(aim.pow + w.pow, 0, 1), yaw: clamp(aim.yaw + w.yaw, -0.9, 0.9) };
    aim.on = false;
    yard.setAim(null, null);
  }

  function sendInputs() {
    const s = latest;
    if (!s || s.over || ctx.demo || !ctx.input) return;
    pickCtrl(s);
    if (ctrl < 0) return;
    const q = sq(ctrl);
    if (pad.take('act')) {
      q.s++;
      q.c++;
      Sound.unlock();
    }
    if (pad.take('dash')) q.d++;
    if (pad.take('st')) q.st++;
    if (pad.take('thr') && canPull(s)) {
      if (!aim.on) aim = { pow: s.holder === ctrl ? 0.5 : 0.85, yaw: 0, on: true };
      release();
    }
    if (pad.take('sw')) {
      const m = mine(s);
      ctrl = m[(m.indexOf(ctrl) + 1) % m.length];
    }
    const d = pad.dir();
    const c = Math.cos(look);
    const sn = Math.sin(look);
    for (const i of mine(s)) {
      const qi = sq(i);
      const inp: In = i === ctrl ? { mx: d.x * c + d.y * sn, my: -d.x * sn + d.y * c, s: qi.s, c: qi.c, d: qi.d, st: qi.st } : { mx: 0, my: 0, s: qi.s, c: qi.c, d: qi.d, st: qi.st };
      if (i === ctrl && thReq) inp.th = thReq;
      ctx.input(s.seats[i], inp);
    }
  }

  function bindInput() {
    pad = new Pad(wrap, [
      { id: 'act', label: 'Бей!', keys: ['Space', 'KeyE'] },
      { id: 'thr', label: 'Подбить', keys: ['Enter'] },
      { id: 'st', label: 'Считать', keys: ['KeyC'] },
      { id: 'dash', label: 'Рывок', keys: ['ShiftLeft', 'ShiftRight'] },
      { id: 'sw', label: 'Другой', keys: ['Tab', 'KeyQ'] },
    ]);
    pad.enabled = () => !!latest && !latest.over && ctrl >= 0 && !ctx.demo;
    cleanup.push(() => pad.dispose());
    pull = new PullAim(yard.canvas, wrap, {
      enabled: () => canPull(latest),
      onStart: () => (aim = { pow: 0, yaw: 0, on: true }),
      onAim: (pow, side) => {
        aim.pow = pow;
        aim.yaw = clamp(side * 1.1, -0.6, 0.6);
        aim.on = true;
      },
      onRelease: () => release(),
    });
    cleanup.push(() => pull?.dispose());
    // тап по полю — «Бей!» / «Ловить!» (в своё время)
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY };
      // по подбитому чижу бьют сразу по касанию — время дорого
      if (actNow(latest) === 'bat' && latest?.phase === 'pop') {
        pad.press('act');
        down = null;
      }
    };
    const pu = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12 && actNow(latest)) pad.press('act');
      down = null;
    };
    yard.canvas.addEventListener('pointerdown', pd);
    yard.canvas.addEventListener('pointerup', pu);
    cleanup.push(() => (yard.canvas.removeEventListener('pointerdown', pd), yard.canvas.removeEventListener('pointerup', pu)));
  }

  // ---------------------------------------------------------------- подсказка и табло

  function hint(s: State) {
    let t = '';
    const me = ctrl;
    const B = s.batter;
    if (s.over || s.phase === 'pause') t = '';
    else if (me < 0) {
      t = s.phase === 'tee' || s.phase === 'pop' ? `Бьёт ${nm(B)}…` : s.phase === 'fly' ? 'Летит! Водящие ловят…' : s.phase === 'field' ? 'Водящие бегут за чижом…' : s.phase === 'back' ? 'Бросок в кон!' : `${nm(B)} добивает…`;
    } else if (me === B) {
      const near = Math.hypot(s.men[me].x - s.ch.x, s.men[me].y - s.ch.y) < BONUS_REACH;
      t =
        s.phase === 'tee'
          ? `<b>Вы бьёте!</b> Потяните вниз (сила) и вбок (куда), отпустите — чиж подлетит. Попыток: ${s.tries}.`
          : s.phase === 'pop'
            ? '<b>Бей!</b> — пробел или тап, когда чиж у пояса (зелёный).'
            : s.phase === 'fly'
              ? 'Летит! Только бы не поймали…'
              : s.phase === 'field'
                ? 'Водящие бегут за чижом. <b>Встаньте у кона</b> — бросят, отбейте «Бей!».'
                : s.phase === 'back'
                  ? '<b>Бей!</b> — отбейте чижа, пока он не лёг в кон.'
                  : near
                    ? `<b>Добивание</b> (ещё ${s.strikes}): потяните и отпустите — подбить, потом «Бей!». «Считать» (C) — хватит.`
                    : `<b>Добивание:</b> бегите к чижу (WASD, стрелки, стик). «Считать» (C) — хватит, меряем.`;
    } else {
      t =
        s.phase === 'tee' || s.phase === 'pop'
          ? `Бьёт ${nm(B)}. Встаньте в поле за чертой — куда полетит чиж?`
          : s.phase === 'fly'
            ? '<b>Ловите!</b> Бегите к белому кольцу и «Ловить!» (пробел), когда чиж рядом.'
            : s.phase === 'field'
              ? s.holder === me
                ? '<b>Бросайте в кон!</b> Потяните вниз и отпустите — кольцо покажет, где ляжет чиж.'
                : s.holder < 0
                  ? '<b>Бегите к чижу!</b> Кто первым подберёт — бросает в кон.'
                  : `${nm(s.holder)} бросает в кон…`
              : s.phase === 'back'
                ? 'Летит в кон…'
                : `${nm(B)} добивает — отбегите подальше и ловите!`;
    }
    if (ask.innerHTML !== t) ask.innerHTML = t;
    const act = actNow(s);
    const pullNow = canPull(s);
    pad.show({
      act: act === 'bat' ? '!Бей!' : act === 'catch' ? '!Ловить!' : null,
      thr: pullNow ? (s.holder === me ? 'Бросок' : 'Подбить') : null,
      st: me >= 0 && me === B && s.phase === 'bonus' ? 'Считать' : null,
      dash: me >= 0 && s.phase !== 'pause' ? 'Рывок' : null,
      sw: mine(s).length > 1 ? 'Другой' : null,
    });
    pad.visible(me >= 0 && !s.over);
  }

  function drawHud(s: State) {
    const c = s.cfg;
    const rows = s.men
      .map((m, i) => {
        const seat = s.seats[i];
        const role = i === s.batter ? '🏏' : '';
        const sc = c.score === 'hits' && m.run ? `${m.score}<em>+${m.run}</em>` : `${total(m)}`;
        return `<div class="cz-row${i === s.batter ? ' cur' : ''}${i === ctrl ? ' me' : ''}"><i style="background:${SEATS[seat % SEATS.length].color}"></i><span class="nm">${ctx.name(seat)} ${role}</span><span class="rl">${sc}</span></div>`;
      })
      .join('');
    const goal = c.score === 'merki' ? `до ${c.target} мерок` : `до ${c.target} очков`;
    const sub = s.strike > 0 || s.phase === 'bonus' ? `добивание · ещё ${s.strikes}` : `попыток: ${s.tries}`;
    const html = `<div class="cz-board"><div class="cz-head">${esc(goal)} · ${sub}</div>${rows}</div>`;
    if (hud.innerHTML !== html) hud.innerHTML = html;
  }

  // ---------------------------------------------------------------- события

  function onEvent(s: State, ev: Event) {
    const tn = (i: number) => yard.men[i]?.toon ?? null;
    const busy = (i: number, sec: number) => {
      if (disp[i]) disp[i].busy = performance.now() + sec * 1000;
    };
    switch (ev.k) {
      case 'pop':
        tn(ev.who)?.play('swing1h', false, 0.04, 2.8);
        busy(ev.who, 0.35);
        crack(0.45);
        break;
      case 'hit':
        tn(ev.who)?.play('swing1h', false, 0.03, 1.8);
        busy(ev.who, 0.7);
        crack(0.6 + ev.q * 0.4);
        if (ev.who === ctrl) say(ev.q > 0.85 ? 'В пояс!' : ev.q > 0.5 ? 'Есть!' : 'Краем…', '', 700);
        break;
      case 'whiff':
        tn(ev.who)?.play('swing1h', false, 0.03, 1.8);
        busy(ev.who, 0.7);
        whoosh(0.25);
        break;
      case 'miss':
        thud();
        if (ev.left > 0 || s.strike === 0) say(ev.short ? 'За черту не долетел' : 'Промах!', s.strike > 0 ? '' : ev.left > 0 ? `попыток осталось: ${ev.left}` : '', 1100);
        break;
      case 'land':
        thud();
        break;
      case 'point':
        Sound.capture();
        say(`+1`, `${nm(ev.who)}: за этот выход ${ev.run}`, 900);
        break;
      case 'catch':
        slap();
        Sound.capture();
        tn(ev.who)?.play('holding', false, 0.06);
        busy(ev.who, 1.0);
        say('Поймал!', `${nm(ev.who)} бьёт`, 1500);
        break;
      case 'pick':
        tn(ev.who)?.play('pickup', false, 0.06, 1.8);
        busy(ev.who, 0.5);
        break;
      case 'throw':
        tn(ev.who)?.play('throw', false, 0.06, 1.4);
        busy(ev.who, 0.9);
        whoosh(0.4);
        break;
      case 'def':
        tn(ev.who)?.play('swing1h', false, 0.03, 1.8);
        busy(ev.who, 0.7);
        crack(0.8);
        say('Отбил!', '', 900);
        break;
      case 'kon':
        Sound.capture();
        say(ev.burnt ? 'В городе!' : 'В кону!', ev.burnt ? `сгорело ${ev.burnt} — бьёт ${nm(ev.who)}` : `бьёт ${nm(ev.who)}`, 1600);
        break;
      case 'nokon':
        if (s.cfg.bonus > 0 && s.cfg.score === 'merki') say('Мимо кона', `${nm(s.batter)} добивает`, 1100);
        break;
      case 'score':
        tapeTo = [s.ch.x, s.ch.y];
        ticks(ev.pts);
        Sound.win();
        tn(ev.who)?.play('cheer', false, 0.15);
        busy(ev.who, 1.5);
        say(`${ev.pts} мерок`, `${nm(ev.who)} · ${ev.d.toFixed(1)} м от кона`, 2200);
        break;
      case 'out':
        break;
      case 'batter':
        say('Бьёт ' + nm(ev.who), '', 1100);
        break;
      case 'slow':
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
    const now = performance.now();
    yard.setField(c.shape, c.r, c.line);
    yard.setPlayers(c.n);
    const k = Math.min(1, dt * 14);
    const lag = Math.min(0.25, (now - latestAt) / 1000) * s.speed;
    const [cx, cy, cz, ca] = chAt(s, T);
    for (let i = 0; i < c.n; i++) {
      const m = s.men[i];
      const tx = m.x + m.vx * lag;
      const ty = m.y + m.vy * lag;
      const d = (disp[i] ??= { x: tx, y: ty, busy: 0, init: false });
      if (!d.init || Math.hypot(d.x - tx, d.y - ty) > 3) {
        d.x = tx;
        d.y = ty;
        d.init = true;
      } else {
        d.x += (tx - d.x) * k;
        d.y += (ty - d.y) * k;
      }
      const v = Math.hypot(m.vx, m.vy);
      const face: [number, number] = v > 0.5 ? [d.x + m.vx, d.y + m.vy] : i === s.batter && (s.phase === 'tee' || s.phase === 'pop') ? [d.x + 0.3, d.y + 5] : [cx, cy];
      yard.put(i, d.x, d.y, face);
      const tn = yard.men[i]?.toon ?? null;
      const vs = v * s.speed;
      if (tn && now > d.busy) {
        if (vs > 0.4) tn.play(vs > 2 ? 'run' : 'walk', true, 0.2, vs > 2 ? vs / 4.5 : vs / 1.4);
        else tn.play(i === s.holder ? 'holding' : i === s.batter ? 'idle' : i % 2 ? 'idle2' : 'idle', true, 0.3);
      }
    }
    // бита — у бьющего
    const bt = yard.men[s.batter]?.toon ?? null;
    const col = SEATS[s.seats[s.batter] % SEATS.length].color;
    if (yard.batColor !== col) yard.dressBat(col);
    yard.batIn(bt);
    // чиж
    const ch = s.ch;
    if (ch.mode === 'held' && s.holder >= 0 && yard.men[s.holder]?.toon) yard.chizhInHand(yard.men[s.holder].toon!);
    else if (ch.mode === 'tee') yard.setChizh(0, 0, 0, 0, Math.PI / 2, true);
    else if (ch.mode === 'ground') yard.setChizh(ch.x, ch.y, 0, 0, ch.a, true);
    else yard.setChizh(cx, cy, cz, ca, ch.b0 ? Math.atan2(ch.b0.vx, ch.b0.vy) + Math.PI / 2 : 0, false);
    yard.glow = ch.mode === 'pop' && isBatter(s) ? (hitQuality(cz) ?? 0) : 0;
    // кольцо — где ловить отбитого чижа (спуск на высоте груди) — всем
    if (ch.mode === 'fly' && ch.b0 && airborne(s, T)) {
      yard.setLand(catchSpot(ch.b0));
    } else yard.setLand(null);
    // замер — пока пауза после кона
    if (s.phase !== 'pause') tapeTo = null;
    yard.setTape(tapeTo, BAT);
    // кольца: я — жёлтое, бьющий для водящих — красное
    yard.clearMarks();
    if (ctrl >= 0 && !s.shot) {
      yard.mark(ctrl, '#ffe23a');
      if (s.holder >= 0 && s.holder !== ctrl) yard.mark(s.holder, '#ff4a2a');
    }
    // прицел: бьющему — куда улетит при ударе в пояс, водящему с чижом — где ляжет
    if (aim.on && canPull(s)) {
      const m = s.men[ctrl];
      const w = wob();
      const pow = clamp(aim.pow + w.pow, 0, 1);
      const yaw = clamp(aim.yaw + w.yaw, -0.9, 0.9);
      const key = `${pow.toFixed(3)},${yaw.toFixed(3)},${s.phase},${m.x.toFixed(2)},${m.y.toFixed(2)}`;
      if (key !== aimKey) {
        aimKey = key;
        let f;
        if (s.holder === ctrl) f = chFlight(throwBody(s.ch.x, s.ch.y, pow, yaw));
        else {
          const base = s.phase === 'bonus' ? awayYaw(s.ch.x, s.ch.y) : 0;
          f = chFlight(hitBody(s.ch.x, s.ch.y, SWING.best, -1, pow, base + yaw, 1, s.phase === 'bonus' ? BONUS_K : 1));
        }
        yard.setAim(
          f.frames.map((fr) => [fr[1], fr[2], fr[3]] as [number, number, number]),
          [f.rest[0], f.rest[1]],
        );
      }
    } else if (!aim.on) yard.setAim(null, null);
    // камера
    if (s.shot) {
      yard.shot({ pos: [1.6, -4.2, 1.9], look: [-0.2, 6, 0.6], fov: 2, speed: 50 });
      return;
    }
    if (ctrl >= 0 && disp[ctrl]) {
      const d = disp[ctrl];
      const g = lookGoal(s);
      if (!lookInit) (look = g), (lookInit = true);
      look = angLerp(look, g, Math.min(1, dt * 2.5));
      const sx = Math.sin(look);
      const sy = Math.cos(look);
      // бьющий у чижа (кон, добивание) — как в трансляции: справа-сзади от чижа, бьющий слева за ним (не заслоняет),
      // поле впереди; иначе — за своим пацаном (водящему — выше, поле перед ним)
      const bat = ctrl === s.batter;
      const atCh = bat && (s.phase === 'tee' || s.phase === 'pop' || (s.phase === 'bonus' && Math.hypot(s.men[ctrl].x - s.ch.x, s.men[ctrl].y - s.ch.y) < 2.5));
      const ax = atCh ? s.ch.x : d.x;
      const ay = atCh ? s.ch.y : d.y;
      const back = atCh ? 4.5 : bat ? 4.5 : 6.5;
      const up = atCh ? 3.4 : 4.2;
      const side = atCh ? 2.6 : 0.8;
      let lx = ax + sx * (atCh ? AHEAD : 10);
      let ly = ay + sy * (atCh ? AHEAD : 10);
      let lz = atCh ? 0.3 : 0.4;
      // отбитый чиж в воздухе — взгляд за ним (наполовину)
      if (ch.mode === 'fly' && airborne(s, T)) {
        lx = (lx + cx) / 2;
        ly = (ly + cy) / 2;
        lz = Math.max(0.4, cz * 0.5);
      }
      yard.shot({ pos: [ax - sx * back + sy * side, ay - sy * back - sx * side, up], look: [lx, ly, lz], fov: 5, speed: 3 });
    } else {
      // без своего (показ, зритель): общий план за чижом
      yard.shot({ pos: [cx * 0.45 + 4, cy * 0.45 - 9, 8 + Math.min(8, Math.hypot(cx, cy) * 0.15)], look: [cx * 0.65, cy * 0.65 + 1, 0], fov: 8, speed: 2 });
    }
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
      hintT = now + 120;
      hint(latest);
      drawHud(latest);
    }
    yard.render(dt);
  }

  function take(v: State) {
    latest = v;
    if (import.meta.env.DEV) (window as unknown as { __czs: State }).__czs = v;
    latestAt = performance.now();
    pickCtrl(v);
    if (ctrl >= 0) {
      const sn = v.seen[ctrl];
      if (thReq && sn && sn.th >= thReq.n) thReq = undefined;
    }
  }

  return {
    mount(el, c) {
      ctx = c;
      wrap = h(`<div class="cz-wrap"><div class="cz-cv"></div><div class="cz-hud"></div><div class="cz-ask"><div class="cz-say"></div></div><div class="cz-banner"></div></div>`);
      el.appendChild(wrap);
      hud = wrap.querySelector('.cz-hud') as HTMLElement;
      banner = wrap.querySelector('.cz-banner') as HTMLElement;
      ask = wrap.querySelector('.cz-say') as HTMLElement;
      yard = new ChizhYard(wrap.querySelector('.cz-cv') as HTMLElement);
      ctx.hold?.(30000);
      const y = yard;
      const shot = ctx.demo || /[?&]thumb=/.test(location.search);
      if (!shot) wrap.classList.add('cz-loading');
      const ld = shot ? null : showLoading({ art: `${import.meta.env.BASE_URL}gorodki/backdrop.webp`, title: 'Чиж — точим чижа на пустыре…' });
      cleanup.push(() => ld?.done());
      void (async () => {
        try {
          await y.loaded;
          const until = performance.now() + 15000;
          while ((y.pending > 0 || !y.men.length) && performance.now() < until) await sleep(100);
          await y.warm();
        } catch (e) {
          console.warn('чиж: загрузка поля', e);
        }
        wrap.classList.remove('cz-loading');
        ld?.done();
        ctx.hold?.(0);
      })();
      yard.camTo('tee');
      yard.snapCam();
      bindInput();
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
      return `Бьёт ${ctx.name(s.seats[s.batter])}`;
    },
    playerStats(s, seat) {
      const i = s.seats.indexOf(seat);
      if (i < 0) return '';
      return `${total(s.men[i])}${s.cfg.score === 'merki' ? ' мер.' : ''}${i === s.batter ? ' · бьёт' : ''}`;
    },
    saveTitle(s) {
      const best = s.men.reduce((a, m, i) => (total(m) > total(s.men[a]) ? i : a), 0);
      return `бьёт ${SEATS[s.seats[s.batter] % SEATS.length].name} · больше всех ${SEATS[s.seats[best] % SEATS.length].name} (${total(s.men[best])})`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      cleanup.forEach((f) => f());
      yard?.dispose();
    },
  };
}
