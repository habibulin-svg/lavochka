/* Лапта — экран: 3D-пустырь, удар «рогаткой» (потянул вниз — отпустил), решения касанием пацанов (бирки над головой)
 * или кнопками внизу: кому бежать, кто ловит, в кого кидать или кому пас. Розыгрыш переигрывается по тем же часам
 * и физике, что у комнаты. Музыки нет (решение пользователя) — только звуки. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { padOff, padOn } from '../../core/gamepad';
import { showLoading } from '../../core/loading';
import { segRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { sample, type BodyFrame } from '../../core/dvorsport/body';
import { PullAim, tip } from '../../core/dvorsport/input';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import {
  canRun,
  def0,
  flight,
  formation,
  HIT_AT,
  homeSpot,
  intercept,
  REACT,
  runnerAt,
  strike,
  type Event,
  type Runner,
  type State,
  type Style,
} from './engine';
import { LaptaYard } from './scene';
import './lapta.css';

const PREF_STYLE = 'lapta.style';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Деревянный щелчок биты по мячу, шлепок мяча в ладони, свист броска. */
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
function thud() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  tone(t, { freq: 120, to: 70, dur: 0.1, gain: 0.3 });
}
function whoosh(dur: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  for (let k = 0; k < 5; k++) click(t + (k * dur) / 5, { freq: 400 + k * 80, q: 0.8, dur: dur / 4, gain: 0.05 });
}

type Pick = { team: number; who: number; label: string; kind: 'run' | 'catch' | 'throw' | 'pass' };

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let wrap: HTMLElement;
  let yard: LaptaYard;
  let hud: HTMLElement;
  let banner: HTMLElement;
  let bar: HTMLElement;
  let tags: HTMLElement;
  let raf = 0;
  let last = 0;
  let v: State | null = null;
  /** Место, которое решает с этого экрана сейчас (null — не наш ход или идёт показ). */
  let act: number | null = null;
  let busy = false;
  let aim = { pow: 0.7, yaw: 0 };
  let aimKey = '';
  let pull: PullAim | null = null;
  let showTip: (on: boolean) => void = () => {};
  let bannerT = 0;
  /** Выбранные бегущие (решение «бежать»). */
  let chosen = new Set<number>();
  let picks: Pick[] = [];
  /** До какого времени розыгрыша уже показали (стоп-кадр после удара). */
  let shownT = 0;
  /** Пацаны, которые сейчас идут по walkTo (не ставить их на место из состояния). */
  const walking = new Set<string>();
  const cleanup: (() => void)[] = [];
  const t0wob = performance.now();

  const style = () => store.get<Style>(PREF_STYLE, 'far');
  const sp = () => Math.max(0.25, ctx.speed());

  function say(big: string, small = '', ms = 1400) {
    banner.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`;
    banner.style.opacity = '1';
    bannerT = performance.now() + ms / sp();
  }

  // ---------------------------------------------------------------- расстановка

  const manTo = (t: number, k: number, x: number, y: number, face: [number, number], clip?: string, speed = 1) => {
    if (walking.has(`${t}:${k}`)) return;
    yard.put(t, k, x, y, face);
    const tn = yard.men[t][k]?.toon;
    if (tn && clip) tn.play(clip, true, 0.25, speed);
  };

  /** Где кто стоит по состоянию (вне показа розыгрыша). */
  function place(s: State) {
    const c = s.cfg;
    yard.setField(c);
    yard.setTeams(c.n);
    const A = s.atk;
    const D = def0(s);
    const st = s.teams[A].st;
    const server = (() => {
      for (const i of s.teams[A].queue) if (i !== s.batter) return i;
      return st.findIndex((x, i) => i !== s.batter && (x === 'ready' || x === 'used'));
    })();
    for (let i = 0; i < c.n; i++) {
      const r = s.play?.runners.find((x) => x.who === i);
      if (s.phase === 'hit' && i === s.batter) manTo(A, i, HIT_AT.x - 0.75, HIT_AT.y - 0.55, [HIT_AT.x + 3, HIT_AT.y + 2], 'hold2h');
      else if (s.phase === 'hit' && i === server) manTo(A, i, 1.1, 1.6, [HIT_AT.x, HIT_AT.y], 'idle');
      else if (r) {
        const p = runnerAt(c, r, s.play!.t);
        manTo(A, i, p.x, p.y, [p.x, r.from === 'dom' ? 99 : -99], 'run', 1.3);
      } else if (st[i] === 'kon') {
        const [x, y] = homeSpot(c, i, 'kon');
        manTo(A, i, x, y, [x, 0], 'idle');
      } else {
        const [x, y] = homeSpot(c, i, 'dom');
        manTo(A, i, x, y, [0, c.L / 2], i % 3 === 0 ? 'idle2' : 'idle');
      }
    }
    const fp = s.play?.fpos ?? formation(c);
    fp.forEach(([x, y], k) => manTo(D, k, x, y, [0, 0], k % 2 ? 'idle2' : 'idle'));
    // мяч: у подающего, у полевого с мячом или в полёте (стоп-кадр)
    if (s.play?.holder != null) {
      const [x, y] = fp[s.play.holder];
      yard.setBall([x + 0.25, y, 1.1]);
    } else if (s.play) {
      const f = sample(flight(s.play.b0).frames, shownT);
      yard.setBall([f[1], f[2], f[3]]);
    } else yard.setBall([1.0, 1.6, 1.15]);
    const bt = s.phase === 'hit' ? yard.men[A][s.batter]?.toon ?? null : null;
    yard.batIn(bt);
    // куда упадёт мяч — пока мяч не подобран
    const land = s.play && !s.play.caught ? flight(s.play.b0).land : null;
    yard.setLand(land ? [land.x, land.y] : null);
  }

  // ---------------------------------------------------------------- табло и выбор

  function drawHud() {
    if (!v) return;
    const s = v;
    const rows = [0, 1]
      .map((t) => {
        const atk = s.atk === t;
        return `<div class="lp-row${atk ? ' cur' : ''}"><i style="background:${SEATS[t].color}"></i><span class="nm">${ctx.name(s.seats[t])}</span><span class="rl">${atk ? '🏏 бьют' : '🧤 в поле'}</span><b>${s.teams[t].score}</b></div>`;
      })
      .join('');
    const tm = s.teams[s.atk];
    const left = tm.queue.length;
    const kon = tm.st.filter((x) => x === 'kon').length;
    const now = s.over
      ? ''
      : s.phase === 'hit'
        ? `Бьёт №${s.batter + 1} · попытка ${s.cfg.tries - s.tries + 1} из ${s.cfg.tries} · с правом удара: ${left}${kon ? ` · в кону: ${kon}` : ''}`
        : s.phase === 'run'
          ? 'Кому бежать?'
          : s.phase === 'catch'
            ? 'Кто ловит?'
            : 'Мяч в поле — кидать в бегущего?';
    hud.innerHTML = `<div class="lp-board">${rows}<div class="lp-head">до ${s.cfg.target}</div></div>${now ? `<div class="lp-now">${now}</div>` : ''}`;
  }

  /** Бирки над теми, кого можно выбрать, и кнопки внизу. */
  function drawPicks() {
    tags.innerHTML = '';
    bar.innerHTML = '';
    yard.clearMarks();
    picks = [];
    if (!v || act == null || busy || v.over) {
      bar.style.display = 'none';
      return;
    }
    const s = v;
    const A = s.atk;
    const D = def0(s);
    const p = s.play;
    if (s.phase === 'run' && p) {
      for (const w of canRun(s)) picks.push({ team: A, who: w, label: `№${w + 1}${s.teams[A].st[w] === 'kon' ? ' домой' : ' к кону'}`, kind: 'run' });
      const n = chosen.size;
      const go = h<HTMLButtonElement>(`<button class="go"${n ? '' : ' disabled'}>Беги!${n > 1 ? ` (${n})` : ''}</button>`);
      go.onclick = () => send({ type: 'run', who: [...chosen] });
      const all = h<HTMLButtonElement>(`<button>Все бегут</button>`);
      all.onclick = () => send({ type: 'run', who: canRun(s) });
      const stay = h<HTMLButtonElement>(`<button>${p.caught ? 'Стоим — подача' : 'Стоим'}</button>`);
      stay.onclick = () => send({ type: 'run', who: [] });
      bar.append(go, ...(picks.length > 1 ? [all] : []), stay);
    } else if (s.phase === 'catch' && p) {
      let best = 0;
      let bt = Infinity;
      p.fpos.forEach((f, i) => {
        const ic = intercept(p.b0, f);
        if (ic.t < bt) (bt = ic.t), (best = i);
        picks.push({ team: D, who: i, label: `№${i + 1}`, kind: 'catch' });
      });
      const near = h<HTMLButtonElement>(`<button class="go">Ловит ближний (№${best + 1})</button>`);
      near.onclick = () => send({ type: 'catch', who: best });
      bar.append(near);
    } else if (s.phase === 'throw' && p) {
      for (const r of p.runners) picks.push({ team: A, who: r.who, label: `в №${r.who + 1}`, kind: 'throw' });
      p.fpos.forEach((_, i) => {
        if (i !== p.holder) picks.push({ team: D, who: i, label: `пас №${i + 1}`, kind: 'pass' });
      });
      const hold = h<HTMLButtonElement>(`<button>Не кидать</button>`);
      hold.onclick = () => send({ type: 'hold' });
      bar.append(hold);
    }
    bar.style.display = bar.children.length ? '' : 'none';
    for (const pk of picks) {
      const on = pk.kind === 'run' && chosen.has(pk.who);
      const el = h<HTMLButtonElement>(`<button class="lp-tag ${pk.kind}${on ? ' on' : ''}">${esc(pk.label)}${on ? ' ✓' : ''}</button>`);
      el.onclick = (e) => {
        e.stopPropagation();
        choosePick(pk);
      };
      (el as HTMLElement & { _pk?: Pick })._pk = pk;
      tags.appendChild(el);
      yard.mark(pk.team, pk.who, pk.kind === 'throw' ? '#ff4a2a' : pk.kind === 'pass' ? '#7ad0ff' : on ? '#7ad84a' : '#ffe23a');
    }
    placeTags();
  }

  function placeTags() {
    for (const el of Array.from(tags.children) as (HTMLElement & { _pk?: Pick })[]) {
      const pk = el._pk;
      if (!pk) continue;
      const m = yard.men[pk.team][pk.who];
      if (!m) continue;
      const q = yard.toScreen(m.x, m.y, 2.05);
      el.style.display = q.vis ? '' : 'none';
      el.style.left = `${q.x}px`;
      el.style.top = `${q.y}px`;
    }
  }

  function choosePick(pk: Pick) {
    if (act == null || busy || !v) return;
    if (pk.kind === 'run') {
      if (chosen.has(pk.who)) chosen.delete(pk.who);
      else chosen.add(pk.who);
      drawPicks();
    } else if (pk.kind === 'catch') send({ type: 'catch', who: pk.who });
    else if (pk.kind === 'throw') send({ type: 'throw', at: pk.who });
    else send({ type: 'pass', to: pk.who });
  }

  function send(a: Parameters<ViewCtx['act']>[1]) {
    if (act == null || busy) return;
    const seat = act;
    act = null;
    chosen = new Set();
    yard.setAim(null, null);
    drawPicks();
    showTip(false);
    Sound.unlock();
    ctx.act(seat, a);
  }

  /** Касание поля: ближайший к пальцу пацан из тех, кого можно выбрать. */
  function tapField(e: PointerEvent) {
    if (act == null || busy || !v || v.phase === 'hit' || !picks.length) return;
    const r = yard.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best: Pick | null = null;
    let bd = 56;
    for (const pk of picks) {
      const m = yard.men[pk.team][pk.who];
      if (!m) continue;
      for (const z of [0.3, 1.0, 1.7]) {
        const q = yard.toScreen(m.x, m.y, z);
        const d = Math.hypot(q.x - px, q.y - py);
        if (d < bd) (bd = d), (best = pk);
      }
    }
    if (best) choosePick(best);
  }

  // ---------------------------------------------------------------- удар

  function wob() {
    const tt = (performance.now() - t0wob) / 1000;
    return Math.sin(tt * 1.7) * 0.018 + Math.sin(tt * 2.9 + 1) * 0.01;
  }

  function curHit() {
    return { type: 'hit' as const, pow: clamp(aim.pow, 0, 1), yaw: clamp(aim.yaw + wob(), -0.7, 0.7), style: style() };
  }

  function showAim() {
    if (!v || act == null || busy || v.phase !== 'hit') return;
    const a = curHit();
    const key = `${a.pow.toFixed(3)},${a.yaw.toFixed(3)},${a.style}`;
    if (key === aimKey) return;
    aimKey = key;
    const fl = flight(strike(v.cfg, a.pow, a.yaw, a.style));
    const tl = fl.land?.t ?? 2;
    const pts = fl.frames.filter((f) => f[0] <= tl).map((f) => [f[1], f[2], f[3]] as [number, number, number]);
    yard.setAim(pts, fl.land ? [fl.land.x, fl.land.y] : null);
  }

  function hitNow() {
    if (act == null || busy || !v || v.phase !== 'hit') return;
    send(curHit());
  }

  function bindInput() {
    pull = new PullAim(yard.canvas, wrap, {
      enabled: () => act != null && !busy && v?.phase === 'hit',
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
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12) tapField(e);
      down = null;
    };
    yard.canvas.addEventListener('pointerdown', pd);
    yard.canvas.addEventListener('pointerup', pu);
    cleanup.push(() => (yard.canvas.removeEventListener('pointerdown', pd), yard.canvas.removeEventListener('pointerup', pu)));
    const key = (e: KeyboardEvent) => {
      if (act == null || busy || !v) return;
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      let used = true;
      if (v.phase === 'hit') {
        if (e.code === 'ArrowLeft') aim.yaw = clamp(aim.yaw - 0.02, -0.7, 0.7);
        else if (e.code === 'ArrowRight') aim.yaw = clamp(aim.yaw + 0.02, -0.7, 0.7);
        else if (e.code === 'ArrowUp') aim.pow = clamp(aim.pow + 0.02, 0, 1);
        else if (e.code === 'ArrowDown') aim.pow = clamp(aim.pow - 0.02, 0, 1);
        else if (e.code === 'Digit1') store.set(PREF_STYLE, 'far'), controls();
        else if (e.code === 'Digit2') store.set(PREF_STYLE, 'low'), controls();
        else if (e.code === 'Digit3') store.set(PREF_STYLE, 'candle'), controls();
        else if (e.code === 'Space' || e.code === 'Enter') hitNow();
        else used = false;
      } else if (/^Digit[1-9]$/.test(e.code)) {
        const k = Number(e.code.slice(5)) - 1;
        const pk = picks.find((x) => x.who === k && x.kind !== 'pass') ?? picks.find((x) => x.who === k);
        if (pk) choosePick(pk);
      } else if (e.code === 'Enter' || e.code === 'Space') (bar.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.click();
      else used = false;
      if (used) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    padOn(key, { map: { keys: { a: 'Space', rt: 'Space' } }, hint: 'стик — прицел и сила · <b>Ⓐ</b> удар / главная кнопка' });
    cleanup.push(() => (window.removeEventListener('keydown', key), padOff(key)));
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
  }

  // ---------------------------------------------------------------- показ розыгрыша

  /** Прогнать часы розыгрыша от a до b (с) — на каждом шаге onT(t). */
  async function span(a: number, b: number, onT: (t: number) => void, pace = 1) {
    if (b <= a) {
      onT(b);
      return;
    }
    const st = performance.now();
    while (true) {
      const t = a + (((performance.now() - st) / 1000) * sp() * pace);
      if (t >= b) break;
      onT(t);
      await sleep(16);
    }
    onT(b);
  }

  /** Бегущие в момент t. */
  function runners(rs: Runner[], t: number) {
    if (!v) return;
    const c = v.cfg;
    for (const r of rs) {
      const p = runnerAt(c, r, t);
      const tn = yard.men[v.atk][r.who]?.toon;
      if (t < r.t0) continue;
      yard.put(v.atk, r.who, p.x, p.y, [p.x, r.from === 'dom' ? 999 : -999]);
      tn?.play(p.done ? 'idle' : 'run', true, 0.15, 1.35);
    }
  }

  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

  async function playHit(ev: Extract<Event, { k: 'hit' }>) {
    if (!v) return;
    const A = ev.team;
    const bt = yard.men[A][ev.who]?.toon ?? null;
    yard.setAim(null, null);
    yard.camTo('bat', undefined, 3);
    // подача: свой подбрасывает мяч к бите
    const toss0: [number, number, number] = [1.0, 1.55, 1.15];
    const tossT = 0.6;
    let swung = false;
    await span(0, tossT, (t) => {
      const k = t / tossT;
      yard.setBall([lerp(toss0[0], HIT_AT.x, k), lerp(toss0[1], HIT_AT.y, k), lerp(toss0[2], HIT_AT.z, k) + Math.sin(k * Math.PI) * 1.1]);
      // замах: к удару — самая быстрая точка клипа
      const ph = clamp((t - 0.15) / (tossT - 0.15), 0, 1) * 0.62;
      bt?.scrub('swing2h', ph, 0.62);
      yard.batIn(bt, 0);
    });
    const fl = flight(ev.b0);
    if (ev.kind !== 'miss') {
      crack(Math.hypot(ev.b0.vx, ev.b0.vy, ev.b0.vz) / 30);
      swung = true;
    } else whoosh(0.3);
    const tEnd = ev.kind === 'ok' ? Math.min(0.55, fl.land?.t ?? 0.5) : Math.min(fl.rest, (fl.land?.t ?? 1) + 1.2);
    let hitSnd = 0;
    await span(0, tEnd, (t) => {
      bt?.scrub('swing2h', 0.62 + clamp(t / 0.4, 0, 1) * 0.38, 0.62);
      yard.batIn(bt, 0);
      if (ev.kind === 'miss') {
        // промах: мяч падает за спину
        const k = clamp(t / 0.5, 0, 1);
        yard.setBall([HIT_AT.x, HIT_AT.y - k * 0.8, Math.max(0.035, HIT_AT.z - k * k * 1.0)]);
        return;
      }
      const f = sample(fl.frames, t);
      yard.setBall([f[1], f[2], f[3]]);
      if (t > 0.25) yard.camTo('follow', { x: f[1] * 0.6, y: Math.max(4, f[2] * 0.6) }, 2);
      if (hitSnd === 0 && fl.land && t >= fl.land.t) (hitSnd = 1), thud();
    });
    void swung;
    shownT = ev.kind === 'ok' ? tEnd : 0;
    if (ev.kind === 'ok') {
      yard.camTo('field', undefined, 2);
      say('Мяч в поле!', `${Math.round(ev.land?.y ?? 0)} м`, 1100);
    } else {
      Sound.nomove();
      const what = ev.kind === 'miss' ? 'Промах' : ev.kind === 'short' ? 'Недолёт' : 'Аут';
      say(what, ev.left > 0 ? 'ещё попытка' : ev.kind === 'short' ? 'не долетел до контрольной линии' : 'попытки кончились', 1400);
      await sleep(900 / sp());
      bt?.play('hold2h', true, 0.3);
    }
  }

  async function playCatch(ev: Extract<Event, { k: 'catch' }>) {
    if (!v) return;
    const D = ev.team;
    const fl = flight(ev.b0);
    const frames: BodyFrame[] = fl.frames;
    const tn = yard.men[D][ev.who]?.toon ?? null;
    const a = Math.max(ev.t0, shownT);
    const dist = Math.hypot(ev.to[0] - ev.from[0], ev.to[1] - ev.from[1]);
    let landed = false;
    let got = false;
    await span(a, ev.t2, (t) => {
      // полевой: бежит от реакции до t1
      const k = ev.t1 > REACT ? clamp((t - REACT) / (ev.t1 - REACT), 0, 1) : 1;
      const x = lerp(ev.from[0], ev.to[0], k);
      const y = lerp(ev.from[1], ev.to[1], k);
      const f = sample(frames, Math.min(t, ev.t1));
      yard.put(D, ev.who, x, y, k < 1 && dist > 0.3 ? ev.to : [f[1], f[2]]);
      if (t < ev.t1) tn?.play(k > 0 && k < 1 && dist > 0.3 ? 'run' : 'idle', true, 0.15, 1.3);
      else if (!got) {
        got = true;
        if (ev.air && ev.ok) slap();
        tn?.play(ev.air ? 'holding' : 'pickup', false, 0.12);
      }
      // мяч: летит до t1, потом — в руках (или выронил — у ног)
      if (t <= ev.t1) yard.setBall([f[1], f[2], f[3]]);
      else if (ev.air && !ev.ok) yard.setBall([ev.to[0] + 0.3, ev.to[1], 0.035]);
      else yard.setBall([ev.to[0] + 0.2, ev.to[1], ev.air ? 1.35 : 0.9]);
      if (!landed && fl.land && t >= fl.land.t && !ev.air) (landed = true), thud();
      yard.camTo('follow', { x: f[1] * 0.6, y: Math.max(6, f[2] * 0.7) }, 2);
      runners(ev.rs, t);
    });
    yard.setLand(null);
    shownT = ev.t2;
    if (ev.air && !ev.ok) say('Выронил!', 'свечу не поймали', 1100);
  }

  async function playThrow(ev: Extract<Event, { k: 'throw' } | { k: 'pass' }>) {
    if (!v) return;
    const D = ev.team;
    const tn = yard.men[D][ev.who]?.toon ?? null;
    const to = ev.k === 'throw' ? ev.to : ev.at;
    yard.put(D, ev.who, ev.from[0], ev.from[1], to);
    tn?.play('throw', false, 0.1, 1.4);
    const rel = ev.t0 + 0.3;
    let sw = false;
    await span(ev.t0, ev.t1, (t) => {
      if (t < rel) yard.setBall([ev.from[0] + 0.2, ev.from[1], 1.6]);
      else {
        if (!sw) (sw = true), whoosh(0.35);
        const k = clamp((t - rel) / Math.max(0.05, ev.t1 - rel), 0, 1);
        yard.setBall([lerp(ev.from[0], to[0], k), lerp(ev.from[1], to[1], k), lerp(1.7, 1.1, k) + Math.sin(k * Math.PI) * 0.8]);
      }
      const m = yard.men[D][ev.who];
      if (m) yard.camTo('follow', { x: lerp(ev.from[0], to[0], 0.5) * 0.7, y: lerp(ev.from[1], to[1], 0.5) }, 2.5);
      runners(ev.rs, t);
    });
    shownT = ev.t1;
    if (ev.k === 'pass') {
      slap();
      yard.men[D][ev.to]?.toon?.play('holding', false, 0.12);
    } else if (ev.hit) {
      slap();
      yard.men[v.atk][ev.runner]?.toon?.play('hit', false, 0.08);
    }
  }

  async function playFetch(ev: Extract<Event, { k: 'fetch' }>) {
    if (!v) return;
    const D = ev.team;
    const tn = yard.men[D][ev.who]?.toon ?? null;
    const prev = yard.ball.position.clone();
    const b0: [number, number, number] = [prev.x, -prev.z, prev.y];
    let got = false;
    await span(ev.t0, ev.t1, (t) => {
      const kb = clamp((t - ev.t0) / 0.7, 0, 1);
      const kk = 1 - (1 - kb) * (1 - kb);
      if (!got) yard.setBall([lerp(b0[0], ev.ball[0], kk), lerp(b0[1], ev.ball[1], kk), Math.max(0.035, lerp(b0[2], 0.035, Math.min(1, kb * 2)) + (kb < 0.5 ? Math.sin(kb * 2 * Math.PI) * 0.3 : 0))]);
      const k = clamp((t - ev.t0) / Math.max(0.1, ev.t1 - ev.t0 - 0.25), 0, 1);
      yard.put(D, ev.who, lerp(ev.from[0], ev.to[0], k), lerp(ev.from[1], ev.to[1], k), ev.to);
      if (k < 1) tn?.play('run', true, 0.15, 1.3);
      else if (!got) {
        got = true;
        tn?.play('pickup', false, 0.12);
        yard.setBall([ev.to[0] + 0.2, ev.to[1], 0.9]);
      }
      runners(ev.rs, t);
    });
    shownT = ev.t1;
  }

  async function playHold(ev: Extract<Event, { k: 'hold' }>) {
    await span(ev.t0, ev.t1, (t) => runners(ev.rs, t), 1.4);
    shownT = ev.t1;
  }

  /** Все расходятся по местам (walkTo набора — по земле, с бегом). */
  async function regroup(s: State, ms = 1800) {
    const c = s.cfg;
    const A = s.atk;
    const D = def0(s);
    const goals: [number, number, number, number][] = [];
    formation(c).forEach(([x, y], k) => goals.push([D, k, x, y]));
    for (let i = 0; i < c.n; i++) {
      const st = s.teams[A].st[i];
      const [x, y] = homeSpot(c, i, st === 'kon' ? 'kon' : 'dom');
      goals.push([A, i, x, y]);
    }
    const waits: Promise<void>[] = [];
    for (const [t, k, x, y] of goals) {
      const m = yard.men[t][k];
      const tn = m?.toon;
      if (!m || !tn) continue;
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < 0.3) continue;
      const key = `${t}:${k}`;
      walking.add(key);
      const goal = { x, z: -y };
      const pr = tn.walkTo([goal], d > 6 ? 7.5 : 3.2).then(() => {
        walking.delete(key);
        m.x = x;
        m.y = y;
        tn.face(0, t === D ? 0 : -c.L / 2);
      });
      waits.push(pr);
    }
    // ждём недолго: дальше они дойдут сами, пока идёт следующая подача
    await Promise.race([Promise.all(waits), sleep(ms / sp())]);
  }

  /** Пока идут walkTo — держим m.x/m.y по корню (для бирок и колец). */
  function syncWalkers() {
    for (const key of walking) {
      const [t, k] = key.split(':').map(Number);
      const m = yard.men[t]?.[k];
      if (m?.toon) {
        m.x = m.toon.root.position.x;
        m.y = -m.toon.root.position.z;
      }
    }
  }

  // ---------------------------------------------------------------- кадр

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (document.hidden) return;
    if (act != null && !busy && v?.phase === 'hit') showAim();
    if (bannerT && now > bannerT) {
      banner.style.opacity = '0';
      bannerT = 0;
    }
    syncWalkers();
    if (v?.shot) {
      // превью карточки: удар — бита только что прошла, мяч уходит в поле
      const bt = yard.men[v.atk][v.batter]?.toon ?? null;
      bt?.scrub('swing2h', 0.74, 0.62);
      yard.batIn(bt, 0);
      const f = sample(flight(strike(v.cfg, 0.75, 0.12, 'far')).frames, 0.12);
      yard.setBall([f[1], f[2], f[3]]);
    }
    yard.render(dt);
    if (tags.children.length) placeTags();
  }

  const camFor = (s: State) => {
    if (s.over) yard.camTo('field', undefined, 1.5);
    else if (s.phase === 'hit') yard.camTo('bat', undefined, 2);
    else yard.camTo('field', undefined, 2);
  };

  return {
    mount(el, c) {
      ctx = c;
      root = el;
      wrap = h(`<div class="lp-wrap"><div class="lp-cv"></div><div class="lp-hud"></div><div class="lp-tags"></div><div class="lp-bar"></div><div class="lp-banner"></div></div>`);
      root.appendChild(wrap);
      if (!ctx.demo) showTip = tip(wrap, 'Потяните вниз и отпустите — удар');
      hud = wrap.querySelector('.lp-hud') as HTMLElement;
      banner = wrap.querySelector('.lp-banner') as HTMLElement;
      bar = wrap.querySelector('.lp-bar') as HTMLElement;
      tags = wrap.querySelector('.lp-tags') as HTMLElement;
      bar.style.display = 'none';
      yard = new LaptaYard(wrap.querySelector('.lp-cv') as HTMLElement);
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
          while ((y.pending > 0 || !y.men[0].length) && performance.now() < until) await sleep(100);
          if (v) place(v);
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
    },
    setView(s) {
      v = s;
      if (!s.play) shownT = 0;
      place(s);
      drawHud();
      camFor(s);
      if (s.shot) {
        hud.style.display = 'none';
        yard.snapCam();
      }
      drawPicks();
    },
    async play(events, s) {
      busy = true;
      act = null;
      drawPicks();
      yard.setAim(null, null);
      Sound.unlock();
      for (const ev of events) {
        if (!v) break;
        if (ev.k === 'hit') await playHit(ev);
        else if (ev.k === 'run') {
          say(ev.who.length > 1 ? 'Побежали!' : 'Побежал!', '', 800);
          Sound.step();
        } else if (ev.k === 'catch') await playCatch(ev);
        else if (ev.k === 'throw' || ev.k === 'pass') await playThrow(ev);
        else if (ev.k === 'fetch') await playFetch(ev);
        else if (ev.k === 'hold') await playHold(ev);
        else if (ev.k === 'safe') {
          if (ev.at === 'dom') {
            Sound.win();
            say('+2', `${ctx.name(v.seats[ev.team])}: перебежка туда и обратно`, 1300);
            yard.men[ev.team][ev.who]?.toon?.play('cheer', false, 0.15);
          } else yard.men[ev.team][ev.who]?.toon?.play('idle', true, 0.2);
        } else if (ev.k === 'candle') {
          Sound.capture();
          say('Свеча!', ev.pts ? 'поймали с лёта: +1' : 'поймали с лёта — смена', 1600);
          await sleep(900 / sp());
        } else if (ev.k === 'salit') {
          Sound.capture();
          say('Осалили!', 'попали мячом в бегущего', 1600);
          await sleep(1100 / sp());
        } else if (ev.k === 'swap') {
          say('Смена!', `бьют ${ctx.name(v.seats[ev.atk])}`, 1500);
          // меняемся местами: бывшие полевые — в дом, бившие — в поле
          v = { ...s, play: null };
          await regroup(v, 2400);
        } else if (ev.k === 'reset') {
          yard.setLand(null);
          await sleep(300 / sp());
        } else if (ev.k === 'end') {
          Sound.win();
          const [a, b] = s.teams;
          say('Конец партии!', `${a.score} : ${b.score}`, 2500);
          await sleep(1200 / sp());
        }
      }
      const wasPlay = !!v?.play;
      v = s;
      if (wasPlay && !s.play) {
        shownT = 0;
        await regroup(s, 1400);
      }
      place(s);
      drawHud();
      camFor(s);
      busy = false;
      drawPicks();
    },
    setTurn(toAct, interactive) {
      const mine = interactive.find((x) => toAct.includes(x));
      act = v && !v.over && !ctx.demo && mine != null ? mine : null;
      chosen = new Set();
      if (act != null && v?.phase === 'hit') {
        aim = { pow: 0.7, yaw: 0 };
        aimKey = '';
      } else yard.setAim(null, null);
      showTip(act != null && v?.phase === 'hit');
      drawPicks();
    },
    status(s, toAct, interactive) {
      if (s.over) return 'Партия окончена';
      const mine = interactive.includes(toAct[0]);
      if (!mine) return `Решает ${ctx.name(toAct[0])}…`;
      return s.phase === 'hit'
        ? `Ваш удар: №${s.batter + 1}, попытка ${s.cfg.tries - s.tries + 1}`
        : s.phase === 'run'
          ? 'Кому бежать? Отметьте и «Беги!» — или «Стоим»'
          : s.phase === 'catch'
            ? 'Кто ловит мяч? Коснитесь полевого'
            : 'В кого кинуть? Бегущий — бросок, свой — пас';
    },
    playerStats(s, seat) {
      const t = s.seats.indexOf(seat);
      if (t < 0) return '';
      return `${s.teams[t].score} оч. · ${s.atk === t ? 'бьют' : 'в поле'}`;
    },
    saveTitle(s) {
      return `${s.teams[0].score}:${s.teams[1].score} · бьют ${SEATS[s.atk].name}`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      yard?.dispose();
    },
  };
}
