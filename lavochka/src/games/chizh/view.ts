/* Чиж — экран игры реального времени: 3D-пустырь, свой пацан под управлением (WASD/стрелки, на телефоне — стик набора
 * core/dvorsport/pad.ts), рывок. Бьющий: «рогатка» (PullAim) — сила и куда бить, отпустил — чиж подлетел, «Бей!» —
 * удар (чиж в «поясе» подсвечен зелёным); отбить бросок — «Бей!»; добивание — то же у лежащего чижа, «Считать».
 * Водящий: кольцо падения, «Ловить!», подбор касанием, бросок в кон «рогаткой». Камера — за своим пацаном, стик
 * и клавиши по камере. Подсказка внизу всегда говорит, что можно сделать сейчас. Музыки нет (решение пользователя). */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { showLoading } from '../../core/loading';
import { Coach, Tutor, type TutorStep } from '../../core/dvorsport/coach';
import { isFrames, playFrames, type FramesEvent } from '../../core/dvorsport/demo';
import { GroundMarks } from '../../core/dvorsport/marks3d';
import { nextPlace, placeRow, PLACES, type Place } from '../../core/dvorsport/places';
import { boom, Fx, thump, whistle } from '../../core/dvorsport/fx3d';
import { PullAim } from '../../core/dvorsport/input';
import { Pad } from '../../core/dvorsport/pad';
import { h, sleep } from '../../core/util';
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
  let coach: Coach;
  let marks: GroundMarks;
  let fx: Fx;
  let place: Place = PLACES[0];
  let youTag: HTMLElement;
  let tutor: Tutor | null = null;
  let tutorAsked = false;
  /** Что игрок уже сделал сам (шаги обучения). */
  const tutorSaw = { pop: false, hit: false, move: false, catchBtn: false, pick: false, throw: false, def: false, bonus: false };
  let pad: Pad;
  let pull: PullAim | null = null;
  let raf = 0;
  let iv = 0;
  let last = 0;
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
    // имена приходят разметкой (цвет игрока), а табло печатает текст как есть
    const plain = (x: string) => x.replace(/<[^>]+>/g, '');
    coach.banner(plain(big), plain(small), ms);
  }
  /** Всплывающая надпись над точкой поля (оси игры). */
  function popAt(text: string, x: number, y: number, z = 2.2, cls = '') {
    const q = yard.toScreen(x, y, z);
    if (q.vis) coach.pop(text, q.x, q.y, cls);
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
    // водящему: в полёте — к месту ловли, чиж на земле — к чижу (оба далеко — иначе на кон)
    const to = (x: number, y: number) => (Math.hypot(x - m.x, y - m.y) > 3 ? Math.atan2(x - m.x, y - m.y) : yawToKon(m.x, m.y));
    if (s.phase === 'fly' && s.ch.b0 && airborne(s, nowT())) {
      // смотреть на летящего чижа (видно, как он подлетает); куда бежать — стрелка на земле
      const [cx, cy] = chAt(s, nowT());
      return to(cx, cy);
    }
    if (s.phase === 'field' && s.holder < 0) return to(s.ch.x, s.ch.y);
    if (s.phase === 'bonus') return to(s.ch.x, s.ch.y);
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
      if (s.phase === 'fly' && ctrl !== s.batter) tutorSaw.catchBtn = true;
      if (s.phase === 'back' && ctrl === s.batter) tutorSaw.def = true;
    }
    if (pad.take('dash')) q.d++;
    if (pad.take('st')) {
      q.st++;
      tutorSaw.bonus = true;
    }
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
      if (i === ctrl && tutor?.holding) inp.hold = true;
      if (i === ctrl && s.phase === 'fly' && Math.hypot(d.x, d.y) > 0.3) tutorSaw.move = true;
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

  /** Чиж в «поясе» сейчас (по досчитанной высоте) — момент жать «Бей!». */
  function inBelt(s: State): boolean {
    if (s.phase !== 'pop') return false;
    const q = hitQuality(chAt(s, nowT())[2]);
    return q != null && q > 0.45;
  }

  function hint(s: State) {
    let t = '';
    let keys: string[] = [];
    let hot = false;
    const me = ctrl;
    const B = s.batter;
    const T = nowT();
    if (s.over || s.phase === 'pause') t = '';
    else if (me < 0) {
      t = s.phase === 'tee' || s.phase === 'pop' ? `Бьёт ${nm(B)}…` : s.phase === 'fly' ? 'Летит! Водящие ловят…' : s.phase === 'field' ? 'Водящие бегут за чижом…' : s.phase === 'back' ? 'Бросок в кон!' : `${nm(B)} добивает…`;
    } else if (me === B) {
      const near = Math.hypot(s.men[me].x - s.ch.x, s.men[me].y - s.ch.y) < BONUS_REACH;
      if (s.phase === 'tee') {
        t = `<b>Твой удар!</b> Нажми на поле, потяни вниз и отпусти — чиж подлетит. Вбок — куда бить. Попыток: ${s.tries}.`;
        keys = ['Enter'];
        hot = true;
      } else if (s.phase === 'pop') {
        const belt = inBelt(s);
        t = belt ? '<b>БЕЙ!</b>' : chAt(s, T)[2] > SWING.best ? 'Чиж падает… жди пояса' : 'Чиж взлетает… <b>жди</b>, пока загорится зелёным';
        keys = ['Пробел'];
        hot = belt;
      } else if (s.phase === 'fly') t = 'Летит! Только бы не поймали…';
      else if (s.phase === 'field') {
        t = 'Водящие бегут за чижом. <b>Встань у кона</b> по стрелке — бросят, отбей.';
        keys = ['W', 'A', 'S', 'D'];
      } else if (s.phase === 'back') {
        const [cx, cy, cz] = chAt(s, T);
        const close = Math.hypot(s.men[me].x - cx, s.men[me].y - cy) < 2.5 && cz < 1.8;
        t = close ? '<b>ОТБЕЙ!</b>' : 'Летит в кон — <b>отбей</b>, когда будет рядом!';
        keys = ['Пробел'];
        hot = close;
      } else if (near) {
        t = `<b>Добивание</b> (ещё ${s.strikes}): потяни и отпусти — подбить, потом бей. Хватит — считать.`;
        keys = ['Enter', 'C'];
        hot = true;
      } else {
        t = `<b>Добивание:</b> беги к чижу по стрелке. Хватит — считать мерки.`;
        keys = ['W', 'C'];
      }
    } else {
      if (s.phase === 'tee' || s.phase === 'pop') t = `Бьёт ${nm(B)}. Встань в поле за чертой — куда полетит чиж?`;
      else if (s.phase === 'fly') {
        const [cx, cy, cz] = chAt(s, T);
        const close = airborne(s, T) && Math.hypot(s.men[me].x - cx, s.men[me].y - cy, Math.max(0, cz - 1.3)) < 2.2;
        t = close ? '<b>ЛОВИ!</b>' : '<b>Лови!</b> Беги к оранжевому кольцу — жми, когда чиж у рук.';
        keys = close ? ['Пробел'] : ['W', 'A', 'S', 'D'];
        hot = true;
      } else if (s.phase === 'field') {
        if (s.holder === me) {
          t = '<b>Брось в кон!</b> Потяни вниз и отпусти — кольцо покажет, где ляжет чиж.';
          keys = ['Enter'];
          hot = true;
        } else if (s.holder < 0) {
          t = '<b>Беги к чижу!</b> Кто первым подберёт — бросает в кон.';
          keys = ['W', 'Shift'];
          hot = true;
        } else t = `${nm(s.holder)} бросает в кон…`;
      } else if (s.phase === 'back') t = 'Летит в кон…';
      else t = `${nm(B)} добивает — отбеги подальше и лови!`;
    }
    coach.say(tutor?.showing ? '' : t, keys, hot);
    // кто ты сейчас и зачем — всегда на виду; сменилась роль — крупно по центру
    if (s.over || me < 0) coach.role('');
    else if (me === s.batter) coach.role('Ты бьёшь', s.cfg.score === 'merki' ? 'подбей чижа и выбей <b>подальше от кона</b>: чем дальше ляжет — тем больше мерок' : 'подбей чижа и выбей <b>за черту</b> — очко; попадут в город — очки сгорят', '#c8501e');
    else coach.role('Ты водишь', '<b>поймай чижа с лёта</b> или закинь его в кон — и бить будешь ты', '#2a6fb8');
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

  /** Обучение первой партии: шаги по ролям (бьёшь ты или водишь — как выпадет). Пока шаг с hold не сделан, время стоит. */
  function tutorSteps(): TutorStep[] {
    const S = () => latest!;
    const bat = () => !!latest && ctrl === latest.batter;
    return [
      { text: '<b>Подбей чижа.</b> Нажми на поле, потяни вниз и отпусти — чиж подлетит. Вбок — куда бить. Игра ждёт.', keys: ['Enter'], hold: true, when: () => bat() && S().phase === 'tee', done: () => tutorSaw.pop },
      { text: '<b>Бей!</b> Жми, когда чиж загорится зелёным — он на уровне пояса. Рано — уйдёт влево, поздно — вправо.', keys: ['Пробел'], when: () => bat() && S().phase === 'pop', done: () => tutorSaw.hit },
      { text: '<b>Лови!</b> Чиж летит к оранжевому кольцу — беги туда по стрелке. Игра ждёт, пока не побежишь.', keys: ['W', 'A', 'S', 'D'], hold: true, when: () => !bat() && S().phase === 'fly' && airborne(S(), nowT()), done: () => tutorSaw.move },
      { text: 'Чиж у рук — <b>жми «Ловить»</b>! Поймал — бьёшь сам.', keys: ['Пробел'], when: () => !bat() && S().phase === 'fly' && airborne(S(), nowT()) && tutorSaw.move, done: () => tutorSaw.catchBtn },
      { text: '<b>Беги к чижу</b> по стрелке и подбери — кто первым добежал, бросает в кон.', keys: ['W', 'Shift'], when: () => !bat() && S().phase === 'field' && S().holder < 0, done: () => tutorSaw.pick },
      { text: '<b>Брось в кон.</b> Потяни вниз и отпусти — кольцо покажет, где ляжет чиж. Попал — бьёшь ты. Игра ждёт.', keys: ['Enter'], hold: true, when: () => S().phase === 'field' && S().holder === ctrl, done: () => tutorSaw.throw },
      { text: 'Водящий бросает в кон — <b>отбей</b>, когда чиж подлетит!', keys: ['Пробел'], when: () => bat() && S().phase === 'back', done: () => tutorSaw.def },
      { text: '<b>Добивание:</b> подбеги к чижу и подбей ещё раз — дальше от кона больше мерок. Хватит — «Считать».', keys: ['C'], when: () => bat() && S().phase === 'bonus', done: () => tutorSaw.bonus },
    ];
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
    const goal = c.score === 'merki' ? `Цель: <b>${c.target}</b> мерок` : `Цель: <b>${c.target}</b> очков`;
    const sub = s.strike > 0 || s.phase === 'bonus' ? `добивание · ещё ${s.strikes}` : `попыток: ${s.tries}`;
    const html = `<div class="cz-board"><div class="cz-head">${goal} · ${sub}</div>${rows}</div>`;
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
        if (ev.who === ctrl) {
          tutorSaw.pop = true;
          if (ev.bonus) tutorSaw.bonus = true;
        }
        tn(ev.who)?.play('swing1h', false, 0.04, 2.8);
        busy(ev.who, 0.35);
        crack(0.45);
        break;
      case 'hit':
        tn(ev.who)?.play('swing1h', false, 0.03, 1.8);
        busy(ev.who, 0.7);
        crack(0.6 + ev.q * 0.4);
        boom(0.4 + ev.q * 0.6);
        {
          const [hx, hy, hz] = chAt(s);
          fx.burst(hx, hy, hz, ev.q > 0.85 ? '#b8ff9a' : '#fff2b0', 0.7 + ev.q * 0.8);
        }
        yard.impact(ev.q > 0.85 ? 2 : 1);
        if (ev.q > 0.85 && ev.who === ctrl) coach.flash('good');
        if (ev.who === ctrl) tutorSaw.hit = true;
        {
          const m = s.men[ev.who];
          const f = s.ch.b0 ? chFlight(s.ch.b0) : null;
          const d = f ? Math.hypot(f.rest[0], f.rest[1]) : 0;
          popAt(ev.q > 0.85 ? `В пояс! ${d.toFixed(0)} м` : ev.q > 0.5 ? `${d.toFixed(0)} м` : 'Краем…', m.x, m.y, 2.2, ev.q > 0.85 ? 'good big' : '');
        }
        break;
      case 'whiff':
        popAt('Мимо!', s.men[ev.who].x, s.men[ev.who].y, 2.2, 'bad');
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
        thump(0.5);
        fx.dust(ev.x, ev.y, 0.9);
        break;
      case 'point':
        Sound.capture();
        popAt('+1', s.ch.x, s.ch.y, 0.6, 'good');
        break;
      case 'catch':
        slap();
        Sound.capture();
        tn(ev.who)?.play('holding', false, 0.06);
        busy(ev.who, 1.0);
        say('Поймал с лёта!', `${nm(ev.who)} бьёт`, 1500);
        popAt('Поймал!', s.men[ev.who].x, s.men[ev.who].y, 2.2, 'good big');
        fx.burst(s.men[ev.who].x, s.men[ev.who].y, 1.7, '#c8ffb0', 1);
        yard.impact(2);
        coach.flash(ev.who === ctrl ? 'good' : ev.batter === ctrl ? 'bad' : '');
        break;
      case 'pick':
        if (ev.who === ctrl) tutorSaw.pick = true;
        tn(ev.who)?.play('pickup', false, 0.06, 1.8);
        busy(ev.who, 0.5);
        break;
      case 'throw':
        if (ev.who === ctrl) tutorSaw.throw = true;
        tn(ev.who)?.play('throw', false, 0.06, 1.4);
        busy(ev.who, 0.9);
        whoosh(0.4);
        break;
      case 'def':
        tn(ev.who)?.play('swing1h', false, 0.03, 1.8);
        busy(ev.who, 0.7);
        crack(0.8);
        popAt('Отбил!', s.men[ev.who].x, s.men[ev.who].y, 2.2, 'good big');
        boom(0.8);
        {
          const [hx, hy, hz] = chAt(s);
          fx.burst(hx, hy, hz, '#fff2b0', 1.2);
        }
        yard.impact(2);
        break;
      case 'kon':
        if (s.batter === ctrl) tutorSaw.def = true;
        Sound.capture();
        popAt(ev.burnt ? `−${ev.burnt}` : 'В кону!', s.ch.x, s.ch.y, 0.6, 'bad big');
        fx.ring(0, 0, 0.05, '#ff8a5a', 2.2);
        fx.dust(s.ch.x, s.ch.y, 1.4);
        yard.impact(2);
        coach.flash(ev.who === ctrl ? 'good' : s.batter === ctrl ? 'bad' : '');
        say(ev.burnt ? 'В городе!' : 'В кону!', ev.burnt ? `сгорело ${ev.burnt} — бьёт ${nm(ev.who)}` : `бьёт ${nm(ev.who)}`, 1600);
        break;
      case 'nokon':
        if (s.batter === ctrl) tutorSaw.def = true;
        if (s.cfg.bonus > 0 && s.cfg.score === 'merki') say('Мимо кона', `${nm(s.batter)} добивает`, 1100);
        break;
      case 'score':
        tapeTo = [s.ch.x, s.ch.y];
        ticks(ev.pts);
        Sound.win();
        tn(ev.who)?.play('cheer', false, 0.15);
        busy(ev.who, 1.5);
        popAt(`+${ev.pts}`, s.ch.x, s.ch.y, 0.6, 'good big');
        fx.ring(s.ch.x, s.ch.y, 0.05, '#8aff6a', 2);
        if (ev.who === ctrl) coach.flash('good'), whistle();
        say(`${ev.pts} мерок`, `${nm(ev.who)} · ${ev.d.toFixed(1)} м от кона · всего ${total(s.men[ev.who])} из ${s.cfg.target}`, 2000);
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
      fx.steps(`m${i}`, d.x, d.y, v * s.speed, dt);
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
    else {
      yard.setChizh(cx, cy, cz, ca, ch.b0 ? Math.atan2(ch.b0.vx, ch.b0.vy) + Math.PI / 2 : 0, false);
      if ((ch.mode === 'fly' || ch.mode === 'back') && cz > 0.25) fx.trail(cx, cy, cz, ch.mode === 'back' ? '#ffd0c0' : '#fff6c8', 0.2);
    }
    yard.glow = ch.mode === 'pop' && isBatter(s) ? (hitQuality(cz) ?? 0) : 0;
    // метки на земле: где ловить (оранжевое крутится), кто ловит (белое), я (жёлтое), стрелка — куда бежать
    marks.begin(dt);
    const air = ch.mode === 'fly' && !!ch.b0 && airborne(s, T);
    if (air) {
      const [lx, ly] = catchSpot(ch.b0!);
      marks.ring('land', lx, ly, '#ff7a2a', 0.85, { dashed: true });
      // кто ближе к месту — тот, скорее всего, и ловит
      let best = -1;
      let bt = Infinity;
      s.men.forEach((m, i) => {
        if (i === s.batter) return;
        const d = Math.hypot(m.x - lx, m.y - ly);
        if (d < bt) (bt = d), (best = i);
      });
      if (best >= 0 && best !== ctrl) marks.ring('catcher', s.men[best].x, s.men[best].y, '#ffffff', 0.6, { dashed: true });
      if (ctrl >= 0 && ctrl !== s.batter) marks.arrow('go', s.men[ctrl].x, s.men[ctrl].y, lx, ly, '#ffe23a', 8);
    }
    if (ctrl >= 0 && !s.shot && s.phase !== 'pause') {
      const me = s.men[ctrl];
      marks.ring('me', me.x, me.y, '#ffe23a', 0.6, { pulse: true });
      if (s.holder >= 0 && s.holder !== ctrl) marks.ring('holder', s.men[s.holder].x, s.men[s.holder].y, '#ff4a2a', 0.6);
      if (s.phase === 'field' && s.holder < 0 && ctrl !== s.batter) marks.arrow('go', me.x, me.y, s.ch.x, s.ch.y, '#ffe23a', 8);
      if (s.phase === 'field' && s.holder === ctrl) marks.arrow('go', me.x, me.y, 0, 0, '#ff7a2a', 10);
      if (ctrl === s.batter && s.phase === 'bonus' && Math.hypot(me.x - s.ch.x, me.y - s.ch.y) > BONUS_REACH) marks.arrow('go', me.x, me.y, s.ch.x, s.ch.y, '#ffe23a', 8);
      if (ctrl === s.batter && s.phase === 'field') marks.arrow('go', me.x, me.y, s.ch.x * 0.05 - 0.25, s.ch.y * 0.05, '#ffe23a', 4);
    }
    // кон, куда бросать, подсвечен, пока чиж у водящего или летит в кон
    if (s.phase === 'back' || (s.phase === 'field' && s.holder >= 0)) marks.ring('kon', 0, 0, '#ff7a2a', c.r + 0.25, { pulse: true });
    marks.end();
    // чиж за краем экрана — указатель; «ТЫ» над своим
    coach.edge(ch.mode !== 'tee' && ch.mode !== 'held' ? yard.toScreen(cx, cy, cz) : null, wrap.clientWidth, wrap.clientHeight, 'чиж');
    if (ctrl >= 0 && disp[ctrl] && !s.shot) {
      const q = yard.toScreen(disp[ctrl].x, disp[ctrl].y, 1.9);
      youTag.style.display = q.vis ? 'block' : 'none';
      youTag.style.left = `${q.x}px`;
      youTag.style.top = `${q.y}px`;
    } else youTag.style.display = 'none';
    // замер — пока пауза после кона
    if (s.phase !== 'pause') tapeTo = null;
    yard.setTape(tapeTo, BAT);
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
      const up = atCh ? 3.4 : bat ? 4.2 : 5.6;
      const side = atCh ? 2.6 : 0.8;
      let lx = ax + sx * (atCh ? AHEAD : bat ? 10 : 6);
      let ly = ay + sy * (atCh ? AHEAD : bat ? 10 : 6);
      let lz = atCh ? 0.3 : 0.4;
      // отбитый чиж в воздухе — взгляд за ним (наполовину)
      if (bat && ch.mode === 'fly' && airborne(s, T)) {
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
    // стоп-кадр на ударе: мир замер на долю секунды
    if (yard.frozen) {
      yard.render(0);
      return;
    }
    fx.update(dt, yard.camera);
    draw(dt);
    if (latest && !tutorAsked && ctrl >= 0) {
      tutorAsked = true;
      if (!ctx.demo && !ctx.online && ctx.mySeats.length === 1 && !Tutor.seen('chizh')) tutor = new Tutor(wrap, 'chizh', tutorSteps());
    }
    tutor?.tick();
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
      wrap = h(`<div class="cz-wrap"><div class="cz-cv"></div><div class="cz-hud"></div><div class="cz-you">ТЫ</div></div>`);
      el.appendChild(wrap);
      hud = wrap.querySelector('.cz-hud') as HTMLElement;
      youTag = wrap.querySelector('.cz-you') as HTMLElement;
      // площадка партии: выбранная или следующая по очереди (в показе правил — всегда «за гаражами»)
      // превью карточки снимается на площадке из адреса (&place=school), без неё — гаражи
      const thumbPlace = /[?&]thumb=/.test(location.search) ? (PLACES.find((p) => p.id === new URLSearchParams(location.search).get('place')) ?? PLACES[0]) : null;
      place = thumbPlace ?? (ctx.demo ? PLACES[0] : nextPlace('chizh'));
      yard = new ChizhYard(wrap.querySelector('.cz-cv') as HTMLElement, place);
      marks = new GroundMarks(yard.scene);
      fx = new Fx(yard.scene);
      fx.dustColor.set(place.dust);
      if (ctx.controls && !ctx.demo) ctx.controls.appendChild(placeRow(yard, () => place, (p) => ((place = p), fx.dustColor.set(p.dust))));
      if (!c.demo && !/[?&]thumb=/.test(location.search)) yard.setLift(0.1);
      coach = new Coach(wrap);
      cleanup.push(() => (coach.dispose(), marks.dispose(), fx.dispose(), tutor?.dispose()));
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
        coach.el.style.display = 'none';
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
