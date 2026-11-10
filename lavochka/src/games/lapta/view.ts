/* Лапта — экран реального времени: 3D-пустырь, свой пацан под управлением (WASD/стрелки или стик на телефоне, кнопки
 * действий — core/dvorsport/pad.ts), переключение на любого своего, удар «рогаткой» (потянул вниз — отпустил), бросок
 * касанием бегущего или точки поля. Снимки комнаты сглаживаются; мяч в полёте считается тем же flight(b0), что у комнаты.
 * Подсказка «что делать сейчас» — внизу. Музыки нет (решение пользователя) — только звуки. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { sample } from '../../core/dvorsport/body';
import { PullAim } from '../../core/dvorsport/input';
import { Pad } from '../../core/dvorsport/pad';
import { Coach, Tutor, type TutorStep } from '../../core/dvorsport/coach';
import { GroundMarks } from '../../core/dvorsport/marks3d';
import { isFrames, playFrames, type FramesEvent } from '../../core/dvorsport/demo';
import { segRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { showLoading } from '../../core/loading';
import { esc, h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { BAT_SPOT, ballPos, ballRests, chasePoint, defT, flight, mayLeave, strike, type Event, type In, type Man, type State, type Style } from './engine';
import { LaptaYard } from './scene';
import './lapta.css';

const PREF_STYLE = 'lapta.style';
const PREF_CAM = 'lapta.cam';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

function crack(v: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  const s = clamp(v, 0.2, 1);
  tone(t, { freq: 680, to: 420, dur: 0.06, gain: 0.35 * s, type: 'triangle' });
  click(t, { freq: 2600, q: 2.5, dur: 0.045, gain: 0.7 * s });
}
function slap() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  click(t, { freq: 900, q: 1, dur: 0.06, gain: 0.45 });
  tone(t, { freq: 160, to: 90, dur: 0.08, gain: 0.25 });
}
function whoosh() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  for (let k = 0; k < 5; k++) click(t + k * 0.06, { freq: 400 + k * 80, q: 0.8, dur: 0.08, gain: 0.05 });
}

interface Snap {
  at: number;
  v: State;
}

/** Смешать два снимка: люди — плавно, остальное — по свежему. */
function mix(a: State, b: State, k: number): State {
  if (a.atk !== b.atk || a.cfg.n !== b.cfg.n) return b;
  return {
    ...b,
    t: lerp(a.t, b.t, k),
    men: b.men.map((team, t) => team.map((m, i) => ({ ...m, x: lerp(a.men[t][i].x, m.x, k), y: lerp(a.men[t][i].y, m.y, k) }))) as [Man[], Man[]],
  };
}

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx;
  let wrap: HTMLElement;
  let yard: LaptaYard;
  let hud: HTMLElement;
  let coach: Coach;
  let marks: GroundMarks;
  let tutor: Tutor | null = null;
  let tutorAsked = false;
  let raf = 0;
  let iv = 0;
  let last = 0;
  let latest: State | null = null;
  let snaps: Snap[] = [];
  let pad: Pad;
  let pull: PullAim | null = null;
  const cleanup: (() => void)[] = [];
  /** Одноразовые действия: счётчики, ручной выбор пацана, удар и бросок. */
  const seq = { hit: 0, c: 0, th: 0, d: 0 };
  let pick = -1;
  let pickAtk = -1;
  let hitReq: In['hit'] | null = null;
  let thReq: In['th'] | null = null;
  let aim = { pow: 0.7, yaw: 0 };
  let aimKey = '';
  /** Анимации людей по событиям: до какого момента (performance.now) играть клип. */
  const oneShot = new Map<string, { clip: string; until: number }>();
  /** Удар: когда начался взмах (для показа). */
  let swingAt = -1;
  let swingWho = -1;
  let sent: { json: string; at: number } | null = null;
  const t0wob = performance.now();

  const style = () => store.get<Style>(PREF_STYLE, 'far');
  const camMode = () => store.get<string>(PREF_CAM, 'field');
  const mine = () => (ctx.demo ? [] : ctx.mySeats);
  /** За какую сторону сейчас управление с этого экрана (вдвоём за одним — по смыслу: подача — бьющие, розыгрыш — защита). */
  function myTeam(s: State): 0 | 1 | -1 {
    const m = mine();
    const has = [m.includes(s.seats[0]), m.includes(s.seats[1])];
    if (has[0] && has[1]) return s.phase === 'live' ? defT(s) : s.atk;
    if (has[0]) return 0;
    if (has[1]) return 1;
    return -1;
  }



  function current(): State | null {
    if (!snaps.length) return latest;
    const delay = ctx.online ? 90 : 34;
    const t = performance.now() - delay;
    while (snaps.length > 2 && snaps[1].at <= t) snaps.shift();
    const [a, b] = snaps;
    if (!b || t <= a.at) return a.v;
    if (t >= b.at) return b.v;
    return mix(a.v, b.v, (t - a.at) / (b.at - a.at));
  }

  // ---------------------------------------------------------------- ввод

  function wob() {
    const tt = (performance.now() - t0wob) / 1000;
    return Math.sin(tt * 1.7) * 0.018 + Math.sin(tt * 2.9 + 1) * 0.01;
  }
  const curHit = () => ({ pow: clamp(aim.pow, 0, 1), yaw: clamp(aim.yaw + wob(), -0.7, 0.7), style: style() });

  /** Сейчас мой удар. */
  const myServe = (s: State | null) => !!s && !s.over && s.phase === 'serve' && myTeam(s) === s.atk;

  function hitNow() {
    const s = latest;
    if (!myServe(s)) return;
    hitReq = { n: ++seq.hit, ...curHit() };
    yard.setAim(null, null);
    Sound.unlock();
  }

  function buildInput(s: State, team: 0 | 1): In {
    const d = pad.dir();
    const inp: In = { mx: d.x, my: d.y, k: -1, ai: -1 };
    const p = team === s.atk ? pickAtk : pick;
    if (p >= 0) inp.k = p;
    if (hitReq) inp.hit = hitReq;
    inp.c = seq.c;
    inp.d = seq.d;
    if (thReq) inp.th = thReq;
    if (tutor?.holding) inp.hold = true;
    return inp;
  }

  function sendInputs() {
    const s = latest;
    if (!s || s.over || ctx.demo || !ctx.input) return;
    const team = myTeam(s);
    if (team < 0) return;
    if (pad.take('catch')) seq.c++;
    if (pad.take('dash')) seq.d++;
    if (pad.take('sw')) switchNext(s, team as 0 | 1);
    if (pad.take('thr')) throwAt(s, 'runner');
    if (pad.take('pass')) throwAt(s, 'pass');
    if (pad.take('hit')) hitNow();
    const now = performance.now();
    const m = mine();
    for (const seat of m) {
      const t = s.seats.indexOf(seat) as 0 | 1;
      // вдвоём за одним экраном: вторую сторону ведёт компьютер
      const inp: In = t === team ? buildInput(s, t) : { mx: 0, my: 0, k: -1, ai: 2 };
      const json = JSON.stringify(inp);
      if (sent && sent.json === json && now - sent.at < 300 && m.length === 1) continue;
      if (m.length === 1) sent = { json, at: now };
      ctx.input(seat, inp);
    }
  }

  /** Переключиться на следующего своего (в нападении — тех, кто может бежать). */
  function switchNext(s: State, team: 0 | 1) {
    const n = s.cfg.n;
    const cur = s.ctrl[team];
    for (let k = 1; k <= n; k++) {
      const i = (cur + k) % n;
      if (team === s.atk && !(s.men[team][i].st === 'run' || mayLeave(s, i))) continue;
      if (team === s.atk) pickAtk = i;
      else pick = i;
      return;
    }
  }

  /** Бросок: в ближнего бегущего или пас своему ближе к бегущему. */
  function throwAt(s: State, what: 'runner' | 'pass' | [number, number]) {
    const D = defT(s);
    if (myTeam(s) !== D || s.ball.mode !== 'held' || s.ball.holder !== s.ctrl[D]) return;
    const h = s.men[D][s.ball.holder];
    const runners = s.men[s.atk].filter((m) => m.st === 'run');
    let tx: number;
    let ty: number;
    if (Array.isArray(what)) [tx, ty] = what;
    else if (!runners.length) return;
    else {
      const r = runners.reduce((a, m) => (Math.hypot(m.x - h.x, m.y - h.y) < Math.hypot(a.x - h.x, a.y - h.y) ? m : a));
      if (what === 'runner') [tx, ty] = [r.x, r.y];
      else {
        let best: Man | null = null;
        let bd = Infinity;
        s.men[D].forEach((m, i) => {
          if (i === s.ball.holder) return;
          const d = Math.hypot(m.x - r.x, m.y - r.y);
          if (d < bd) (bd = d), (best = m);
        });
        if (!best) return;
        [tx, ty] = [(best as Man).x, (best as Man).y];
      }
    }
    thReq = { n: ++seq.th, tx, ty };
    Sound.unlock();
  }

  /** Касание поля: свой пацан — переключиться; с мячом в руках — бросок туда. */
  function tapField(e: PointerEvent) {
    const s = latest;
    if (!s || s.over) return;
    const team = myTeam(s);
    if (team < 0) return;
    const r = yard.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const near = (t: number) => {
      let best = -1;
      let bd = 48;
      s.men[t].forEach((m, i) => {
        for (const z of [0.3, 1.0, 1.7]) {
          const q = yard.toScreen(m.x, m.y, z);
          const d = Math.hypot(q.x - px, q.y - py);
          if (d < bd) (bd = d), (best = i);
        }
      });
      return best;
    };
    const D = defT(s);
    if (team === D && s.ball.mode === 'held' && s.ball.holder === s.ctrl[D]) {
      const ra = near(s.atk);
      if (ra >= 0) return throwAt(s, [s.men[s.atk][ra].x, s.men[s.atk][ra].y]);
      const fa = near(D);
      if (fa >= 0 && fa !== s.ball.holder) return throwAt(s, [s.men[D][fa].x, s.men[D][fa].y]);
      const g = yard.pickGround(e.clientX, e.clientY);
      if (g) return throwAt(s, [g.x, g.y]);
      return;
    }
    const k = near(team);
    if (k >= 0) {
      if (team === s.atk) pickAtk = k;
      else pick = k;
    }
  }

  function bindInput() {
    pad = new Pad(wrap, [
      { id: 'catch', label: 'Ловить', keys: ['Space'] },
      { id: 'thr', label: 'Бросок', keys: ['KeyE'] },
      { id: 'pass', label: 'Пас', keys: ['KeyR'] },
      { id: 'dash', label: 'Рывок', keys: ['ShiftLeft', 'ShiftRight'] },
      { id: 'sw', label: 'Другой', keys: ['Tab', 'KeyQ'] },
      { id: 'hit', label: 'Удар', keys: ['Enter'] },
    ]);
    pad.enabled = () => {
      const s = latest;
      return !!s && !s.over && myTeam(s) >= 0 && !ctx.demo;
    };
    cleanup.push(() => pad.dispose());
    pull = new PullAim(yard.canvas, wrap, {
      enabled: () => myServe(latest),
      onAim: (pow, side) => {
        aim.pow = pow;
        aim.yaw = clamp(side * 1.3, -0.7, 0.7);
      },
      onRelease: () => hitNow(),
    });
    cleanup.push(() => pull?.dispose());
    let down: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const pu = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12 && !myServe(latest)) tapField(e);
      down = null;
    };
    yard.canvas.addEventListener('pointerdown', pd);
    yard.canvas.addEventListener('pointerup', pu);
    cleanup.push(() => (yard.canvas.removeEventListener('pointerdown', pd), yard.canvas.removeEventListener('pointerup', pu)));
    // удар клавишами: стрелки — прицел (в подаче стрелки не бег), Пробел — удар
    const key = (e: KeyboardEvent) => {
      if (!myServe(latest)) return;
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      if (e.code === 'ArrowLeft') aim.yaw = clamp(aim.yaw - 0.02, -0.7, 0.7);
      else if (e.code === 'ArrowRight') aim.yaw = clamp(aim.yaw + 0.02, -0.7, 0.7);
      else if (e.code === 'ArrowUp') aim.pow = clamp(aim.pow + 0.02, 0, 1);
      else if (e.code === 'ArrowDown') aim.pow = clamp(aim.pow - 0.02, 0, 1);
      else if (e.code === 'Digit1') store.set(PREF_STYLE, 'far'), controls();
      else if (e.code === 'Digit2') store.set(PREF_STYLE, 'low'), controls();
      else if (e.code === 'Digit3') store.set(PREF_STYLE, 'candle'), controls();
      else if (e.code === 'Space') hitNow();
      else return;
      aimKey = '';
      e.preventDefault();
    };
    window.addEventListener('keydown', key, true);
    cleanup.push(() => window.removeEventListener('keydown', key, true));
  }

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    box.innerHTML = '';
    box.appendChild(
      segRow(
        'Удар',
        [
          ['far', 'дальний'],
          ['low', 'низом'],
          ['candle', 'свечой'],
        ],
        style,
        (x) => {
          store.set(PREF_STYLE, x);
          aimKey = '';
        },
      ),
    );
    box.appendChild(
      segRow(
        'Камера',
        [
          ['field', 'над полем'],
          ['me', 'за своим'],
        ],
        camMode,
        (x) => store.set(PREF_CAM, x),
      ),
    );
  }

  // ---------------------------------------------------------------- подсказки

  function drawHud(s: State) {
    const rows = [0, 1]
      .map((t) => `<div class="lp-row${s.atk === t ? ' cur' : ''}"><i style="background:${SEATS[t].color}"></i><span class="nm">${ctx.name(s.seats[t])}</span><span class="rl">${s.atk === t ? '🏏 бьют' : '🧤 в поле'}</span><b>${s.score[t]}</b></div>`)
      .join('');
    const left = s.cfg.minutes > 0 ? Math.max(0, s.cfg.minutes * 60 - s.t) : -1;
    const clock = left >= 0 ? `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}` : '';
    const atk = s.men[s.atk];
    const kon = atk.filter((m) => m.st === 'kon').length;
    const info = s.phase === 'serve' ? `Бьёт №${s.batter + 1} · попытка ${s.cfg.tries - s.tries + 1} из ${s.cfg.tries} · с правом удара: ${s.queue.length}${kon ? ` · в кону: ${kon}` : ''}` : '';
    const html = `<div class="lp-board">${rows}<div class="lp-head">до ${s.cfg.target}${clock ? ` · ${clock}` : ''}</div></div>${info ? `<div class="lp-now">${info}</div>` : ''}`;
    if (hud.innerHTML !== html) hud.innerHTML = html;
  }

  /** Что делать сейчас — крупно, со значками клавиш; кнопки телефона — те же действия. */
  function drawHint(s: State) {
    const team = myTeam(s);
    const D = defT(s);
    let t = '';
    let keys: string[] = [];
    let hot = false;
    const btn: Record<string, string | null> = { catch: null, thr: null, pass: null, dash: null, sw: null, hit: null };
    if (s.over || team < 0 || s.phase === 'pause') t = '';
    else if (s.phase === 'serve') {
      if (team === s.atk) {
        t = `<b>Твой удар!</b> Нажми на поле, потяни вниз и отпусти. Вбок — направление.`;
        keys = ['Пробел'];
        hot = true;
        btn.hit = '!Удар';
      } else t = `Бьют соперники — <b>готовься ловить</b>: побежишь к мячу, когда отобьют.`;
    } else if (team === s.atk) {
      const k = s.ctrl[team];
      const m = s.men[team][k];
      btn.sw = 'Другой';
      if (m.st === 'run') {
        t = `<b>Беги ${m.from === 'dom' ? 'к кону' : 'домой — это 2 очка'}!</b> Летит мяч — <b>рывок</b> в сторону.`;
        keys = ['Shift'];
        hot = true;
        btn.dash = '!Рывок';
      } else if (mayLeave(s, k)) {
        t = `<b>Мяч в поле!</b> Беги ${m.st === 'kon' ? 'домой' : 'к кону'} по стрелке — или жди, пока полевой с мячом далеко.`;
        keys = m.st === 'kon' ? ['S'] : ['W'];
        hot = true;
        btn.dash = 'Рывок';
      } else {
        t = `Этот пацан бежать не может — <b>переключись</b> на того, кто может (белое кольцо).`;
        keys = ['Tab'];
      }
    } else {
      btn.sw = 'Другой';
      if (s.ball.mode === 'held' && s.ball.holder === s.ctrl[D]) {
        const runs = s.men[s.atk].some((m) => m.st === 'run');
        t = runs ? `<b>Осаливай!</b> Коснись бегущего — бросок; своего — пас.` : `Мяч у тебя. Бегущих нет — розыгрыш сейчас кончится.`;
        if (runs) (keys = ['E']), (hot = true), (btn.thr = '!Бросок'), (btn.pass = 'Пас');
      } else if (s.ball.mode === 'held') t = `Мяч у своего — <b>перекрой бегущего</b>.`;
      else {
        const air = s.ball.mode === 'free' && !ballRests(s) && ballPos(s)[2] > 0.5;
        t = air ? `<b>Ловим!</b> Беги по стрелке под мяч и жми, когда он у рук.` : `<b>Догоняй мяч!</b> Беги по стрелке — подберёшь сам.`;
        keys = air ? ['Пробел'] : ['W', 'A', 'S', 'D'];
        hot = true;
        btn.catch = '!Ловить';
        btn.dash = 'Рывок';
      }
    }
    pad.show(btn);
    pad.visible(team >= 0 && !s.over);
    coach.say(tutor?.showing ? '' : t, keys, hot);
  }

  // ---------------------------------------------------------------- кадр

  function place(s: State, now: number, dt: number) {
    const c = s.cfg;
    yard.setField(c);
    yard.setTeams(c.n);
    yard.clearMarks();
    marks.begin(dt);
    const team = myTeam(s);
    const [bx, by] = ballPos(s);
    for (let t = 0; t < 2; t++) {
      s.men[t].forEach((m, i) => {
        const sp = Math.hypot(m.vx, m.vy);
        const face: [number, number] = sp > 0.4 ? [m.x + m.vx, m.y + m.vy] : t === s.atk ? (m.st === 'kon' ? [m.x, 0] : [0, c.L / 2]) : [bx, by];
        yard.put(t, i, m.x, m.y, face);
        const tn = yard.men[t][i]?.toon;
        if (!tn) return;
        const os = oneShot.get(`${t}:${i}`);
        if (t === s.atk && i === swingWho && swingAt > 0) {
          const k = (now - swingAt) / 450;
          if (k < 1) {
            tn.scrub('swing2h', clamp(k, 0, 1), 0.5);
            return;
          }
          swingAt = -1;
        }
        if (os && now < os.until) tn.play(os.clip, false, 0.12);
        else if (sp > 0.5) tn.play('run', true, 0.12, clamp(sp / 4.5, 0.7, 2));
        else if (t === s.atk && i === s.batter && s.phase !== 'live') tn.play('hold2h', true, 0.25);
        else tn.play(i % 3 ? 'idle' : 'idle2', true, 0.3);
      });
    }
    // метки на земле: свой — жёлтое кольцо; на кого переключишься — белое пунктирное; бегущие (в защите) — красные;
    // куда упадёт мяч — оранжевое крутящееся; стрелка — куда бежать / в кого кидать
    const L = c.L;
    if (team >= 0) {
      const T = team as 0 | 1;
      const me = s.men[T][s.ctrl[T]];
      marks.ring('me', me.x, me.y, '#ffe23a', 0.6, { pulse: true });
      if (s.phase === 'live') {
        const nx = nextOf(s, T);
        if (nx >= 0) marks.ring('next', s.men[T][nx].x, s.men[T][nx].y, '#ffffff', 0.55, { dashed: true });
      }
      if (T === defT(s)) s.men[s.atk].forEach((m, i) => m.st === 'run' && marks.ring(`run${i}`, m.x, m.y, '#ff4a2a', 0.6));
      if (s.phase === 'live') {
        if (T === s.atk && (me.st === 'run' || mayLeave(s, s.ctrl[T]))) {
          const toKon = me.st === 'run' ? me.from === 'dom' : me.st !== 'kon';
          marks.arrow('go', me.x, me.y, me.x, toKon ? L + 1 : -1, '#ffe23a');
        } else if (T !== s.atk && s.ball.mode === 'free') {
          const [cx, cy] = chasePoint(s);
          marks.arrow('go', me.x, me.y, cx, cy, '#ffe23a');
        } else if (T !== s.atk && s.ball.mode === 'held' && s.ball.holder === s.ctrl[T]) {
          let best: Man | null = null;
          for (const r of s.men[s.atk]) if (r.st === 'run' && (!best || Math.hypot(r.x - me.x, r.y - me.y) < Math.hypot(best.x - me.x, best.y - me.y))) best = r;
          if (best) marks.arrow('go', me.x, me.y, best.x, best.y, '#ff4a2a', 30);
        }
      }
    }
    const land = s.ball.mode === 'free' && s.ball.b0 && s.ball.air ? flight(s.ball.b0).land : null;
    if (land) marks.ring('land', land.x, land.y, '#ff7a2a', 0.8, { dashed: true });
    marks.end();
    yard.setLand(null);
    // мяч и бита
    const bp = ballPos(s);
    yard.setBall(bp);
    const bt = s.phase !== 'live' || swingAt > 0 ? (yard.men[s.atk][s.batter]?.toon ?? null) : null;
    yard.batIn(bt, s.phase === 'serve' && swingAt < 0 ? 1 : 0);
    // мяч за краем экрана — указатель
    coach.edge(s.phase === 'live' ? yard.toScreen(bp[0], bp[1], bp[2]) : null, wrap.clientWidth, wrap.clientHeight);
    // метка «ТЫ» над своим
    if (team >= 0) {
      const m = s.men[team as 0 | 1][s.ctrl[team as 0 | 1]];
      const q = yard.toScreen(m.x, m.y, 1.85);
      youTag.style.display = q.vis ? 'block' : 'none';
      youTag.style.left = `${q.x}px`;
      youTag.style.top = `${q.y}px`;
    } else youTag.style.display = 'none';
    // камера
    if (camMode() === 'me' && team >= 0 && s.phase === 'live') {
      const m = s.men[team as 0 | 1][s.ctrl[team as 0 | 1]];
      yard.camTo('follow', { x: m.x, y: m.y }, 2.5);
    } else if (s.phase === 'serve' && s.atk === team) yard.camTo('bat', undefined, 2.5);
    else yard.camTo('field', undefined, 2.5);
  }

  /** На кого переключит Tab. */
  function nextOf(s: State, team: 0 | 1): number {
    const n = s.cfg.n;
    const cur = s.ctrl[team];
    for (let k = 1; k < n; k++) {
      const i = (cur + k) % n;
      if (team === s.atk && !(s.men[team][i].st === 'run' || mayLeave(s, i))) continue;
      return i;
    }
    return -1;
  }

  /** Обучение: что сделать — по шагам; пока не сделал, партия ждёт (hold во вводе). */
  const tutorSaw = { hit: false, dash: false, throw: false };
  function tutorSteps(): TutorStep[] {
    const S = () => latest!;
    const me = () => {
      const s = S();
      const t = myTeam(s) as 0 | 1;
      return s.men[t]?.[s.ctrl[t]];
    };
    const atk = () => !!S() && myTeam(S()) === S().atk;
    const live = () => !!S() && S().phase === 'live';
    return [
      { text: '<b>Удар.</b> Нажми на поле мышью или пальцем, потяни вниз и отпусти. Вбок — направление.', keys: ['Пробел'], when: () => atk() && S().phase === 'serve', done: () => tutorSaw.hit },
      { text: '<b>Мяч в поле — беги к кону!</b> Жми вперёд и держи. Пока не побежишь, игра ждёт.', keys: ['W', '↑'], hold: true, when: () => atk() && live() && !!me() && mayLeave(S(), S().ctrl[S().atk]), done: () => me()?.st === 'run' && atk() },
      { text: '<b>Рывок</b> — так уворачиваются от брошенного мяча. Игра ждёт.', keys: ['Shift'], hold: true, when: () => atk() && live() && me()?.st === 'run', done: () => tutorSaw.dash },
      { text: 'Добеги до линии кона по жёлтой стрелке. Полевые будут кидать в тебя мячом — уворачивайся.', when: () => atk() && live() && me()?.st === 'run', done: () => atk() && me()?.st === 'kon' },
      { text: '<b>Защита.</b> Беги к мячу по жёлтой стрелке; с лёта лови кнопкой, когда мяч у рук.', keys: ['Пробел'], when: () => !atk() && live() && S().ball.mode === 'free', done: () => !atk() && S().ball.mode === 'held' },
      { text: '<b>Осаливай!</b> Мяч у тебя: коснись бегущего (красное кольцо) — или жми E. Попал — команды меняются.', keys: ['E'], when: () => !atk() && live() && S().ball.mode === 'held' && S().ball.holder === S().ctrl[defT(S())] && S().men[S().atk].some((m) => m.st === 'run'), done: () => tutorSaw.throw },
    ];
  }


  let youTag: HTMLElement;

  function showAim(s: State) {
    if (!myServe(s)) {
      if (aimKey) yard.setAim(null, null), (aimKey = '');
      return;
    }
    const a = curHit();
    const key = `${a.pow.toFixed(3)},${a.yaw.toFixed(3)},${a.style}`;
    if (key === aimKey) return;
    aimKey = key;
    const fl = flight(strike(s.cfg, a.pow, a.yaw, a.style));
    const tl = fl.land?.t ?? 2;
    const pts = fl.frames.filter((f) => f[0] <= tl).map((f) => [f[1], f[2], f[3]] as [number, number, number]);
    yard.setAim(pts, fl.land ? [fl.land.x, fl.land.y] : null);
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (document.hidden) return;
    const s = current();
    if (s && Array.isArray(s.men)) {
      if (s.shot) {
        // превью карточки: удар — бита только что прошла, мяч уходит в поле
        yard.setField(s.cfg);
        yard.setTeams(s.cfg.n);
        s.men.forEach((team, t) => team.forEach((m, i) => yard.put(t, i, m.x, m.y, [0, s.cfg.L / 2])));
        const bt = yard.men[s.atk][s.batter]?.toon ?? null;
        bt?.scrub('swing2h', 0.74, 0.62);
        yard.batIn(bt, 0);
        const f = sample(flight(s.ball.b0!).frames, 0.12);
        yard.setBall([f[1], f[2], f[3]]);
        yard.camTo('bat');
        hud.style.display = 'none';
      } else {
        place(s, now, dt);
        // обучение — в первой партии против компьютера (не в показе правил и не по сети); места известны после первого снимка
        if (!tutorAsked && myTeam(s) >= 0) {
          tutorAsked = true;
          if (!ctx.demo && !ctx.online && ctx.mySeats.length === 1 && !Tutor.seen('lapta')) tutor = new Tutor(wrap, 'lapta', tutorSteps());
        }
        tutor?.tick();
        drawHud(s);
        drawHint(s);
        showAim(s);
      }
    }
    yard.render(dt);
  }

  function onEvent(s: State, ev: Event) {
    const now = performance.now();
    const shot = (t: number, i: number, clip: string, ms: number) => oneShot.set(`${t}:${i}`, { clip, until: now + ms });
    const popAt = (t: number, i: number, text: string, cls = '') => {
      const m = s.men[t]?.[i];
      if (!m) return;
      const q = yard.toScreen(m.x, m.y, 2.2);
      if (q.vis) coach.pop(text, q.x, q.y, cls);
    };
    const cheer = (t: number) => s.men[t].forEach((_, i) => i % 2 === 0 && shot(t, i, 'cheer', 1400));
    const mine = (t: number) => myTeam(s) === t;
    switch (ev.k) {
      case 'hit':
        swingAt = now;
        swingWho = ev.who;
        hitReq = null;
        tutorSaw.hit = true;
        if (ev.kind === 'miss') whoosh();
        else {
          crack(Math.hypot(ev.b0.vx, ev.b0.vy, ev.b0.vz) / 30);
          yard.shake(0.05);
        }
        if (ev.kind === 'ok') {
          const land = flight(ev.b0).land;
          popAt(ev.team, ev.who, land ? `${Math.round(land.y)} м!` : 'В поле!', 'good');
        } else {
          Sound.nomove();
          coach.banner(ev.kind === 'miss' ? 'Промах' : ev.kind === 'short' ? 'Недолёт' : 'Аут', ev.left > 0 ? 'ещё попытка' : 'попытки кончились', 1300);
        }
        break;
      case 'catch':
        slap();
        shot(ev.team, ev.who, ev.air ? 'holding' : 'pickup', 700);
        thReq = null;
        if (ev.air) {
          popAt(ev.team, ev.who, 'Поймал с лёта!', 'good');
          yard.shake(0.04);
        }
        break;
      case 'throw':
        whoosh();
        thReq = null;
        if (mine(ev.team)) tutorSaw.throw = true;
        shot(ev.team, ev.who, 'throw', 700);
        break;
      case 'dash':
        if (mine(ev.team)) tutorSaw.dash = true;
        break;
      case 'safe':
        if (ev.at === 'dom') {
          Sound.win();
          popAt(ev.team, ev.who, '+2', 'good');
          shot(ev.team, ev.who, 'cheer', 1500);
          cheer(ev.team);
        } else popAt(ev.team, ev.who, 'В кону!');
        break;
      case 'candle':
        Sound.capture();
        coach.banner('Свеча!', ev.pts ? 'поймали с лёта: +1' : 'поймали с лёта — смена', 1500);
        cheer(ev.team);
        break;
      case 'salit':
        Sound.capture();
        shot(ev.team, ev.who, 'hit', 900);
        popAt(ev.team, ev.who, 'Осалил!', 'bad');
        yard.shake(0.12);
        coach.banner('Осалили!', mine(ev.team) ? 'тебя осалили — команды меняются' : 'попали в бегущего — команды меняются', 1500);
        cheer(ev.team === s.atk ? defT(s) : s.atk);
        break;
      case 'swap':
        pick = -1;
        pickAtk = -1;
        if (ev.reason === 'nobat') coach.banner('Смена!', 'бить больше некому', 1500);
        break;
      case 'dead':
        pick = -1;
        pickAtk = -1;
        thReq = null;
        break;
      case 'end': {
        Sound.win();
        coach.banner('Конец партии!', `${s.score[0]} : ${s.score[1]}`, 5000);
        break;
      }
    }
  }

  return {
    mount(el, c) {
      ctx = c;
      wrap = h(`<div class="lp-wrap"><div class="lp-cv"></div><div class="lp-hud"></div><div class="lp-you">ТЫ</div></div>`);
      el.appendChild(wrap);
      hud = wrap.querySelector('.lp-hud') as HTMLElement;
      youTag = wrap.querySelector('.lp-you') as HTMLElement;
      yard = new LaptaYard(wrap.querySelector('.lp-cv') as HTMLElement);
      marks = new GroundMarks(yard.scene);
      coach = new Coach(wrap);
      cleanup.push(() => (coach.dispose(), marks.dispose(), tutor?.dispose()));

      ctx.hold?.(30000);
      const y = yard;
      const shot = ctx.demo || /[?&]thumb=/.test(location.search);
      if (!shot) wrap.classList.add('lp-loading');
      const ld = shot ? null : showLoading({ art: `${import.meta.env.BASE_URL}gorodki/backdrop.webp`, title: 'Лапта — собираемся на пустыре…' });
      cleanup.push(() => ld?.done());
      void (async () => {
        try {
          await y.loaded;
          const until = performance.now() + 15000;
          while ((y.pending > 0 || !y.men[0].length) && performance.now() < until) await new Promise((r) => setTimeout(r, 100));
          await y.warm();
        } catch (e) {
          console.warn('лапта: загрузка поля', e);
        }
        wrap.classList.remove('lp-loading');
        ld?.done();
        ctx.hold?.(0);
      })();
      yard.camTo('bat');
      yard.snapCam();
      bindInput();
      controls();
      raf = requestAnimationFrame(frame);
      iv = window.setInterval(sendInputs, 20);
    },
    setView(v) {
      latest = v;
      snaps = [{ at: performance.now(), v }];
      if (v.cfg) {
        yard.setField(v.cfg);
        yard.setTeams(v.cfg.n);
      }
    },
    async play(events, v) {
      // показ правил: кусок партии снимками (core/dvorsport/demo.ts)
      for (const e of events as unknown[]) if (isFrames(e)) await playFrames(e as FramesEvent<State, Event>, (f, evs) => this.realtime!(f, evs), () => ((1000 / 60) * e.every) / Math.max(0.25, ctx.speed()));
      this.setView(v);
    },
    realtime(v, events) {
      latest = v;
      if (import.meta.env.DEV) (window as unknown as { __lps: State }).__lps = v;
      snaps.push({ at: performance.now(), v });
      if (snaps.length > 12) snaps.splice(0, snaps.length - 12);
      for (const ev of events) onEvent(v, ev);
    },
    setTurn() {},
    status(s) {
      if (!s) return '';
      if (s.over) return 'Партия окончена';
      return `${SEATS[0].name} ${s.score[0]} : ${s.score[1]} ${SEATS[1].name}`;
    },
    playerStats(s, seat) {
      const t = s.seats.indexOf(seat);
      if (t < 0) return '';
      return `${s.score[t]} оч. · ${s.atk === t ? 'бьют' : 'в поле'}`;
    },
    saveTitle(s) {
      return `${s.score[0]}:${s.score[1]} · бьют ${esc(SEATS[s.atk].name)}`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      clearInterval(iv);
      cleanup.forEach((f) => f());
      yard?.dispose();
    },
  };
}

export { BAT_SPOT };
