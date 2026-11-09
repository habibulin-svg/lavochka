/* Пекарь — экран: 3D-пустырь, бросок палки «рогаткой» (потянул вниз — отпустил), решения касанием (бирки над головой)
 * или кнопками внизу: бежать ли за палкой; пекарем — поставить банку (коснуться её) и кого салить. Розыгрыш
 * переигрывается по тем же часам и физике, что у комнаты. Музыки нет (решение пользователя) — только звуки. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { padOff, padOn } from '../../core/gamepad';
import { showLoading } from '../../core/loading';
import { segRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { sample } from '../../core/dvorsport/body';
import { PullAim, tip } from '../../core/dvorsport/input';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import {
  actor,
  canHome,
  chaseOf,
  lineY,
  pekarSpot,
  rankName,
  runnerAt,
  safeAt,
  stickFlight,
  tagChance,
  throwBody,
  throwSpot,
  waitSpot,
  type Event,
  type Runner,
  type State,
  type Style,
} from './engine';
import { PekarYard } from './scene';
import './pekar.css';

const PREF_STYLE = 'pekar.style';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Звон жестяной банки, стук палки о землю, свист. */
function clank(v: number) {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  const s = clamp(v, 0.3, 1);
  for (const [f, g] of [[1850, 0.22], [2730, 0.16], [3900, 0.1]] as const) tone(t, { freq: f, to: f * 0.97, dur: 0.35, gain: g * s, type: 'triangle' });
  click(t, { freq: 3200, q: 2, dur: 0.05, gain: 0.6 * s });
  // банка катится и подпрыгивает
  for (let k = 1; k < 4; k++) tone(t + 0.18 * k, { freq: 1600 - k * 150, dur: 0.08, gain: 0.08 / k, type: 'triangle' });
}
function knock() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  tone(t, { freq: 220, to: 120, dur: 0.07, gain: 0.3, type: 'triangle' });
  click(t, { freq: 1400, q: 1.5, dur: 0.03, gain: 0.35 });
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

type Pick = { who: number; label: string; kind: 'chase' | 'run' | 'can' };

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let wrap: HTMLElement;
  let yard: PekarYard;
  let hud: HTMLElement;
  let banner: HTMLElement;
  let bar: HTMLElement;
  let tags: HTMLElement;
  let raf = 0;
  let last = 0;
  let v: State | null = null;
  let act: number | null = null;
  let busy = false;
  let aim = { pow: 0.6, yaw: 0 };
  let aimKey = '';
  let pull: PullAim | null = null;
  let showTip: (on: boolean) => void = () => {};
  let bannerT = 0;
  let picks: Pick[] = [];
  const walking = new Set<number>();
  const cleanup: (() => void)[] = [];
  const t0wob = performance.now();

  const style = () => store.get<Style>(PREF_STYLE, 'flat');
  const sp = () => Math.max(0.25, ctx.speed());
  const nm = (i: number) => (v ? ctx.name(v.seats[i]) : '');

  function say(big: string, small = '', ms = 1400) {
    banner.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`;
    banner.style.opacity = '1';
    bannerT = performance.now() + ms / sp();
  }

  // ---------------------------------------------------------------- расстановка

  function manTo(k: number, x: number, y: number, face: [number, number], clip?: string, speed = 1) {
    if (walking.has(k)) return;
    yard.put(k, x, y, face);
    const tn = yard.men[k]?.toon;
    if (tn && clip) tn.play(clip, true, 0.25, speed);
  }

  /** Палки и люди по состоянию (вне показа розыгрыша). */
  function place(s: State) {
    const c = s.cfg;
    yard.setField({ dist: c.dist, ranks: c.ranks.map((_, r) => lineY(c, r)) });
    yard.setPlayers(c.n, s.seats.map((seat) => SEATS[seat % SEATS.length].color));
    const home = canHome(c);
    const sc = s.sc;
    const cur = actor(s);
    for (let i = 0; i < c.n; i++) {
      const p = s.pl[i];
      const tn = yard.men[i]?.toon ?? null;
      const r = sc?.runners.find((x) => x.who === i);
      if (i === s.pekar && s.phase !== 'kick') {
        const [x, y] = sc ? sc.pk : pekarSpot(c);
        manTo(i, x, y, [0, 0], 'idle');
        yard.stickIn(i, tn, 1);
        continue;
      }
      if (r && sc) {
        const q = runnerAt(r, sc.t);
        manTo(i, q.x, q.y, q.phase === 'back' || q.phase === 'home' ? [q.x, -50] : r.stick, q.phase === 'out' || q.phase === 'back' ? 'run' : 'idle', 1.3);
        if (q.stick) yard.stickIn(i, tn, 1);
        else yard.stickAt(i, p.sx, p.sy, 0.025, p.sa);
        continue;
      }
      if (s.phase === 'kick' && i === cur) {
        manTo(i, -0.25, -0.35, [0, 10], 'idle');
        yard.stickAt(i, 0.15, 0.1, 0.12, 0, 0.6);
        continue;
      }
      if (s.phase === 'throw' && i === cur) {
        const [x, y] = throwSpot(c, p.rank);
        manTo(i, x, y, [home[0] - 0.4, home[1]], 'holding');
        yard.stickIn(i, tn, 1);
        continue;
      }
      const [x, y] = waitSpot(c, i, p.rank);
      manTo(i, x, y, home, i % 2 ? 'idle2' : 'idle');
      const kicked = s.phase === 'kick' && s.kicks[i] != null;
      if (p.stick === 'field' || kicked) yard.stickAt(i, p.sx, p.sy, 0.025, p.sa);
      else yard.stickIn(i, tn, 1);
    }
    yard.setCan(s.can.x, s.can.y, !s.can.up, s.can.a);
  }

  // ---------------------------------------------------------------- табло и выбор

  function drawHud() {
    if (!v) return;
    const s = v;
    const c = s.cfg;
    const cur = actor(s);
    const rows = s.pl
      .map((p, i) => {
        const seat = s.seats[i];
        const role = s.phase === 'kick' ? (s.kicks[i] != null ? `${s.kicks[i]!.toFixed(1)} м` : '…') : i === s.pekar ? '🥫 пекарь' : esc(rankName(c, p));
        return `<div class="pk-row${i === cur ? ' cur' : ''}"><i style="background:${SEATS[seat % SEATS.length].color}"></i><span class="nm">${ctx.name(seat)}</span><span class="rl">${role}</span></div>`;
      })
      .join('');
    const goal = c.ranks.length > 1 ? `сбить ${c.ranks[c.ranks.length - 1].toLowerCase()}ом` : `до ${c.target} банок`;
    const now = s.over
      ? ''
      : s.phase === 'kick'
        ? `Жеребьёвка: пинает ${(nm(cur))}`
        : s.phase === 'throw'
          ? `Бросает ${(nm(cur))} — ${esc(rankName(c, s.pl[cur]))}`
          : s.phase === 'run'
            ? `Банка сбита! ${(nm(cur))}: бежать за палкой?`
            : s.phase === 'fix'
              ? 'Пекарь ставит банку'
              : 'Пекарь: кого салить?';
    hud.innerHTML = `<div class="pk-board"><div class="pk-head">${esc(goal)}</div>${rows}</div>${now ? `<div class="pk-now">${now}</div>` : ''}`;
  }

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
    const me = actor(s);
    const sc = s.sc;
    if (s.phase === 'run') {
      picks.push({ who: me, label: 'за палкой?', kind: 'run' });
      const go = h<HTMLButtonElement>(`<button class="go">Бегу за палкой!</button>`);
      go.onclick = () => send({ type: 'run', go: true });
      const stay = h<HTMLButtonElement>(`<button>Стою</button>`);
      stay.onclick = () => send({ type: 'run', go: false });
      bar.append(go, stay);
    } else if (s.phase === 'fix') {
      picks.push({ who: -1, label: 'поставить банку', kind: 'can' });
      const go = h<HTMLButtonElement>(`<button class="go">Поставить банку</button>`);
      go.onclick = () => send({ type: 'fix' });
      bar.append(go);
    } else if (s.phase === 'chase' && sc) {
      for (const r of sc.runners) {
        if (safeAt(r) <= sc.t) continue;
        const p = tagChance(chaseOf(sc.pk, sc.t, r).margin);
        picks.push({ who: r.who, label: `салить · ${p > 0 ? `${Math.round(p * 100)}%` : 'не успеть'}`, kind: 'chase' });
      }
      const no = h<HTMLButtonElement>(`<button>Не догнать</button>`);
      no.onclick = () => send({ type: 'chase', who: null });
      bar.append(no);
    }
    bar.style.display = bar.children.length ? '' : 'none';
    for (const pk of picks) {
      const el = h<HTMLButtonElement>(`<button class="pk-tag ${pk.kind}">${esc(pk.label)}</button>`);
      el.onclick = (e) => {
        e.stopPropagation();
        choosePick(pk);
      };
      (el as HTMLElement & { _pk?: Pick })._pk = pk;
      tags.appendChild(el);
      if (pk.who >= 0) yard.mark(pk.who, pk.kind === 'chase' ? '#ff4a2a' : '#ffe23a');
    }
    placeTags();
  }

  function placeTags() {
    for (const el of Array.from(tags.children) as (HTMLElement & { _pk?: Pick })[]) {
      const pk = el._pk;
      if (!pk) continue;
      let q: { x: number; y: number; vis: boolean };
      if (pk.kind === 'can') {
        const p = yard.can.position;
        q = yard.toScreen(p.x, -p.z, 0.45);
      } else {
        const m = yard.men[pk.who];
        if (!m) continue;
        q = yard.toScreen(m.x, m.y, 2.05);
      }
      el.style.display = q.vis ? '' : 'none';
      el.style.left = `${q.x}px`;
      el.style.top = `${q.y}px`;
    }
  }

  function choosePick(pk: Pick) {
    if (act == null || busy || !v) return;
    if (pk.kind === 'run') return; // решение — кнопками внизу
    if (pk.kind === 'can') send({ type: 'fix' });
    else send({ type: 'chase', who: pk.who });
  }

  function send(a: Parameters<ViewCtx['act']>[1]) {
    if (act == null || busy) return;
    const seat = act;
    act = null;
    yard.setAim(null, null);
    drawPicks();
    showTip(false);
    Sound.unlock();
    ctx.act(seat, a);
  }

  /** Касание поля: банка (пекарю — поставить) или ближайший бегущий. */
  function tapField(e: PointerEvent) {
    if (act == null || busy || !v || !picks.length) return;
    const r = yard.canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    let best: Pick | null = null;
    let bd = 60;
    for (const pk of picks) {
      const pts: { x: number; y: number }[] = [];
      if (pk.kind === 'can') {
        const p = yard.can.position;
        pts.push(yard.toScreen(p.x, -p.z, 0.06));
      } else {
        const m = yard.men[pk.who];
        if (!m) continue;
        for (const z of [0.3, 1.0, 1.7]) pts.push(yard.toScreen(m.x, m.y, z));
      }
      for (const q of pts) {
        const d = Math.hypot(q.x - px, q.y - py);
        if (d < bd) (bd = d), (best = pk);
      }
    }
    if (best) choosePick(best);
  }

  // ---------------------------------------------------------------- бросок

  /** Рука дрожит: направление и сила чуть «дышат» — бросать надо в удачный миг. */
  function wob() {
    const tt = (performance.now() - t0wob) / 1000;
    return { yaw: Math.sin(tt * 1.9) * 0.03 + Math.sin(tt * 3.3 + 1) * 0.016, pow: Math.sin(tt * 2.6 + 2) * 0.04 };
  }

  function curThrow() {
    const w = wob();
    return { type: 'throw' as const, pow: clamp(aim.pow + w.pow, 0, 1), yaw: clamp(aim.yaw + w.yaw, -0.6, 0.6), style: style() };
  }

  function showAim() {
    if (!v || act == null || busy) return;
    const s = v;
    if (s.phase === 'kick') {
      yard.setAim(null, null);
      return;
    }
    if (s.phase !== 'throw') return;
    const a = curThrow();
    const key = `${a.pow.toFixed(3)},${a.yaw.toFixed(3)},${a.style}`;
    if (key === aimKey) return;
    aimKey = key;
    const me = actor(s);
    const f = stickFlight(throwBody(s.cfg, s.pl[me].rank, a.pow, a.yaw, a.style), a.style, null);
    const pts = f.frames.map((fr) => [fr[1], fr[2], fr[3]] as [number, number, number]);
    yard.setAim(pts, [f.rest[0], f.rest[1]]);
  }

  function release() {
    if (act == null || busy || !v) return;
    if (v.phase === 'kick') send({ type: 'kick', pow: clamp(aim.pow, 0, 1) });
    else if (v.phase === 'throw') send(curThrow());
  }

  function bindInput() {
    pull = new PullAim(yard.canvas, wrap, {
      enabled: () => act != null && !busy && (v?.phase === 'throw' || v?.phase === 'kick'),
      onAim: (pow, side) => {
        aim.pow = pow;
        if (v?.phase === 'throw') aim.yaw = clamp(side * 0.6, -0.5, 0.5);
      },
      onRelease: () => release(),
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
      if (v.phase === 'throw' || v.phase === 'kick') {
        if (e.code === 'ArrowLeft') aim.yaw = clamp(aim.yaw - 0.006, -0.5, 0.5);
        else if (e.code === 'ArrowRight') aim.yaw = clamp(aim.yaw + 0.006, -0.5, 0.5);
        else if (e.code === 'ArrowUp') aim.pow = clamp(aim.pow + 0.02, 0, 1);
        else if (e.code === 'ArrowDown') aim.pow = clamp(aim.pow - 0.02, 0, 1);
        else if (e.code === 'Digit1') store.set(PREF_STYLE, 'flat'), controls();
        else if (e.code === 'Digit2') store.set(PREF_STYLE, 'lob'), controls();
        else if (e.code === 'Space' || e.code === 'Enter') release();
        else used = false;
        if (used) aimKey = '';
      } else if (/^Digit[1-9]$/.test(e.code)) {
        const k = Number(e.code.slice(5)) - 1;
        const pk = picks.find((x) => x.who === k && x.kind === 'chase');
        if (pk) choosePick(pk);
      } else if (e.code === 'Enter' || e.code === 'Space') (bar.querySelector('button:not([disabled])') as HTMLButtonElement | null)?.click();
      else used = false;
      if (used) e.preventDefault();
    };
    window.addEventListener('keydown', key);
    padOn(key, { map: { keys: { a: 'Space', rt: 'Space' } }, hint: 'стик — прицел и сила · <b>Ⓐ</b> бросок / главная кнопка' });
    cleanup.push(() => (window.removeEventListener('keydown', key), padOff(key)));
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

  // ---------------------------------------------------------------- показ

  async function span(a: number, b: number, onT: (t: number) => void, pace = 1) {
    if (b <= a) {
      onT(b);
      return;
    }
    const st = performance.now();
    while (true) {
      const t = a + ((performance.now() - st) / 1000) * sp() * pace;
      if (t >= b) break;
      onT(t);
      await sleep(16);
    }
    onT(b);
  }

  /** Палка в полёте: плашмя крутится вокруг вертикали, навесом — кувырком. */
  function stickFly(k: number, x: number, y: number, z: number, a: number, st: Style, yaw: number) {
    if (st === 'flat') yard.stickAt(k, x, y, z, a, Math.PI / 2);
    else yard.stickAt(k, x, y, z, yaw, a);
  }

  /** Бегущие в момент t. */
  function runners(rs: Runner[], t: number) {
    if (!v) return;
    for (const r of rs) {
      const q = runnerAt(r, t);
      const tn = yard.men[r.who]?.toon ?? null;
      const p = v.pl[r.who];
      yard.put(r.who, q.x, q.y, q.phase === 'out' ? r.stick : q.phase === 'back' ? r.home : undefined);
      tn?.play(q.phase === 'out' || q.phase === 'back' ? 'run' : q.phase === 'pick' ? 'pickup' : 'idle', q.phase !== 'pick', 0.15, 1.25);
      if (q.stick) yard.stickIn(r.who, tn, 1);
      else yard.stickAt(r.who, p.sx, p.sy, 0.025, p.sa);
    }
  }

  async function playKick(ev: Extract<Event, { k: 'kick' }>) {
    const tn = yard.men[ev.who]?.toon ?? null;
    yard.camTo('throw', { x: 0, y: 0 }, 2.5);
    tn?.play('jump', false, 0.1, 1.6);
    await sleep(260 / sp());
    knock();
    const f = stickFlight(ev.b0, 'lob', null);
    let landed = false;
    await span(0, f.t, (t) => {
      const fr = sample(f.frames, t);
      stickFly(ev.who, fr[1], fr[2], fr[3], fr[4], 'lob', 0);
      if (!landed && fr[3] < 0.04 && t > 0.2) (landed = true), knock();
    });
    yard.stickAt(ev.who, ev.rest[0], ev.rest[1], 0.025, ev.rest[2]);
    say(ev.slip ? 'Сорвалась!' : `${ev.d.toFixed(1)} м`, (nm(ev.who)), 900);
    await sleep(500 / sp());
  }

  async function playThrow(ev: Extract<Event, { k: 'throw' }>) {
    if (!v) return;
    const c = v.cfg;
    const tn = yard.men[ev.who]?.toon ?? null;
    const [x0, y0] = throwSpot(c, v.pl[ev.who].rank);
    yard.put(ev.who, x0, y0, [canHome(c)[0] - 0.4, canHome(c)[1]]);
    yard.setAim(null, null);
    yard.camTo('throw', { x: x0, y: y0 }, 3);
    // замах: к выпуску — самая быстрая точка клипа
    await span(0, 0.42, (t) => {
      const ph = clamp(t / 0.42, 0, 1) * 0.62;
      tn?.scrub('throw', ph, 0.62);
      yard.stickIn(ev.who, tn, Math.max(0, 1 - ph / 0.15));
    });
    whoosh(0.4);
    const f = stickFlight(ev.b0, ev.style, ev.hit ? canHome(c) : null);
    const yaw = Math.atan2(ev.b0.vx, ev.b0.vy);
    const home = canHome(c);
    let hitDone = false;
    let landed = false;
    await span(0, f.t, (t) => {
      tn?.scrub('throw', 0.62 + clamp(t / 0.5, 0, 1) * 0.38, 0.62);
      const fr = sample(f.frames, t);
      stickFly(ev.who, fr[1], fr[2], fr[3], fr[4], ev.style, yaw);
      if (!landed && fr[3] < 0.05 && t > 0.15) (landed = true), knock();
      if (t > 0.3) yard.camTo('follow', { x: fr[1] * 0.6, y: Math.min(fr[2], c.dist) }, 2.2);
      if (ev.hit && ev.can) {
        if (t >= ev.tHit && !hitDone) {
          hitDone = true;
          clank(1);
        }
        if (t >= ev.tHit) {
          // банка: подлетает и катится до места
          const k = clamp((t - ev.tHit) / 0.6, 0, 1);
          const e = 1 - (1 - k) * (1 - k);
          yard.setCan(lerp(home[0], ev.can.to[0], e), lerp(home[1], ev.can.to[1], e), k > 0.15, ev.can.a + k * 6, Math.sin(k * Math.PI) * 0.5);
        }
      }
    });
    if (ev.hit && ev.can) {
      const k0 = Math.max(0, ev.tHit + 0.6 - f.t);
      if (k0 > 0) await span(0, k0, (t) => {
        const k = clamp((f.t - ev.tHit + t) / 0.6, 0, 1);
        const e = 1 - (1 - k) * (1 - k);
        yard.setCan(lerp(home[0], ev.can!.to[0], e), lerp(home[1], ev.can!.to[1], e), true, ev.can!.a + k * 6, Math.sin(k * Math.PI) * 0.5);
      });
      yard.setCan(ev.can.to[0], ev.can.to[1], true, ev.can.a);
    }
    yard.stickAt(ev.who, ev.stick[0], ev.stick[1], 0.025, ev.stick[2]);
    tn?.play('idle', true, 0.3);
    if (!ev.hit) {
      say(ev.stick[1] < c.dist - 1 ? 'Недолёт' : ev.stick[1] > c.dist + 1 ? 'Перелёт' : 'Мимо!', '', 900);
      Sound.nomove();
      await sleep(500 / sp());
    } else {
      yard.camTo('field', undefined, 2);
      tn?.play('cheer', false, 0.15);
    }
    // бросавший отходит на своё место за чертой
    const [wx, wy] = waitSpot(c, ev.who, v.pl[ev.who].rank);
    if (tn) {
      walking.add(ev.who);
      void tn.walkTo([{ x: wx, z: -wy }], 2.4).then(() => {
        walking.delete(ev.who);
        tn.face(home[0], -home[1]);
      });
    }
  }

  async function playFix(ev: Extract<Event, { k: 'fix' }>) {
    if (!v) return;
    const tn = yard.men[ev.who]?.toon ?? null;
    yard.camTo('field', undefined, 2);
    let picked = false;
    await span(0, ev.t1, (t) => {
      runners(ev.rs, t);
      if (t < ev.tPick) {
        const k = clamp((t - 0.35) / Math.max(0.05, ev.tPick - 0.35), 0, 1);
        yard.put(ev.who, lerp(ev.from[0], ev.can[0], k), lerp(ev.from[1], ev.can[1], k), ev.can);
        tn?.play(k > 0 && k < 1 ? 'run' : 'idle', true, 0.15, 1.3);
      } else {
        if (!picked) {
          picked = true;
          tn?.play('pickup', false, 0.1, 1.6);
        }
        const tc = ev.tPick + 0.3;
        const tset = ev.t1 - 0.45;
        const k = clamp((t - tc) / Math.max(0.05, tset - tc), 0, 1);
        yard.put(ev.who, lerp(ev.can[0], ev.to[0], k), lerp(ev.can[1], ev.to[1], k), k < 1 ? ev.to : canHome(v!.cfg));
        if (t > tc && t < tset) tn?.play('run', true, 0.15, 1.1);
        if (t >= tset) tn?.play('pickup', false, 0.1, 1.4);
        if (tn && t >= tc && t < ev.t1 - 0.15) yard.canInHand(tn);
      }
    });
    const home = canHome(v.cfg);
    yard.setCan(home[0], home[1], false);
    knock();
    say('Банка на месте', 'теперь пекарь салит', 900);
  }

  async function playChase(ev: Extract<Event, { k: 'chase' }>) {
    if (!v) return;
    const tn = yard.men[ev.who]?.toon ?? null;
    await span(ev.t0, ev.t1, (t) => {
      runners(ev.rs, t);
      const k = clamp((t - ev.t0 - 0.1) / Math.max(0.05, ev.t1 - ev.t0 - 0.1), 0, 1);
      yard.put(ev.who, lerp(ev.from[0], ev.to[0], k), lerp(ev.from[1], ev.to[1], k), ev.to);
      tn?.play(k > 0 && k < 1 ? 'run' : 'idle', true, 0.15, 1.35);
      yard.camTo('follow', { x: ev.to[0], y: ev.to[1] }, 2);
    });
    if (ev.target == null) return;
    if (ev.tag) {
      slap();
      Sound.capture();
      tn?.play('swing1h', false, 0.08, 1.4);
      yard.men[ev.target]?.toon?.play('hit', false, 0.08);
      say('Осалил!', `${(nm(ev.target))} — пекарь`, 1500);
      await sleep(900 / sp());
    } else {
      say(ev.to[1] > 0 ? 'Увернулся!' : 'Не догнал!', '', 1100);
      await sleep(400 / sp());
    }
  }

  async function playBack(ev: Extract<Event, { k: 'back' }>) {
    await span(ev.t0, ev.t1, (t) => runners(ev.rs, t), 1.3);
  }

  /** Расход по местам: кто где должен стоять по новому состоянию. */
  async function regroup(s: State, ms = 1500) {
    const c = s.cfg;
    const waits: Promise<void>[] = [];
    for (let i = 0; i < c.n; i++) {
      const m = yard.men[i];
      const tn = m?.toon;
      if (!m || !tn) continue;
      const [x, y] = i === s.pekar ? pekarSpot(c) : waitSpot(c, i, s.pl[i].rank);
      const d = Math.hypot(m.x - x, m.y - y);
      if (d < 0.3) continue;
      walking.add(i);
      waits.push(
        tn.walkTo([{ x, z: -y }], d > 5 ? 5.5 : 2.4).then(() => {
          walking.delete(i);
          m.x = x;
          m.y = y;
          const hm = canHome(c);
          tn.face(i === s.pekar ? 0 : hm[0], i === s.pekar ? 0 : -hm[1]);
        }),
      );
    }
    await Promise.race([Promise.all(waits), sleep(ms / sp())]);
  }

  function syncWalkers() {
    for (const k of walking) {
      const m = yard.men[k];
      if (m?.toon) {
        m.x = m.toon.root.position.x;
        m.y = -m.toon.root.position.z;
        if (v && v.pl[k].stick !== 'field') yard.stickIn(k, m.toon, 1);
      }
    }
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (document.hidden) return;
    if (act != null && !busy) showAim();
    if (bannerT && now > bannerT) {
      banner.style.opacity = '0';
      bannerT = 0;
    }
    syncWalkers();
    if (v?.shot) {
      // превью карточки: палка летит пропеллером к банке
      const k = v.queue[0];
      const tn = yard.men[k]?.toon ?? null;
      tn?.scrub('throw', 0.8, 0.62);
      const f = stickFlight(throwBody(v.cfg, v.pl[k].rank, 0.62, -0.02, 'flat'), 'flat', null);
      const fr = sample(f.frames, 0.55);
      stickFly(k, fr[1], fr[2], fr[3], fr[4], 'flat', 0);
    }
    if (!busy && v && !v.shot) {
      // стоящие держат палки (кости двигаются — палка за кулаком)
      for (let i = 0; i < v.cfg.n; i++) if (!walking.has(i) && (v.pl[i].stick !== 'field' || i === v.pekar) && !(v.phase === 'kick')) yard.stickIn(i, yard.men[i]?.toon ?? null, 1);
    }
    yard.render(dt);
    if (tags.children.length) placeTags();
  }

  const camFor = (s: State) => {
    const cur = actor(s);
    if (s.over) yard.camTo('field', undefined, 1.5);
    else if (s.phase === 'throw' && cur >= 0) {
      const [x, y] = throwSpot(s.cfg, s.pl[cur].rank);
      yard.camTo('throw', { x, y }, 2);
    } else if (s.phase === 'kick') yard.camTo('throw', { x: 0, y: 0 }, 2);
    else yard.camTo('field', undefined, 2);
  };

  return {
    mount(el, c) {
      ctx = c;
      root = el;
      wrap = h(`<div class="pk-wrap"><div class="pk-cv"></div><div class="pk-hud"></div><div class="pk-tags"></div><div class="pk-bar"></div><div class="pk-banner"></div></div>`);
      root.appendChild(wrap);
      if (!ctx.demo) showTip = tip(wrap, 'Потяните вниз и отпустите — бросок');
      hud = wrap.querySelector('.pk-hud') as HTMLElement;
      banner = wrap.querySelector('.pk-banner') as HTMLElement;
      bar = wrap.querySelector('.pk-bar') as HTMLElement;
      tags = wrap.querySelector('.pk-tags') as HTMLElement;
      bar.style.display = 'none';
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
          if (v) place(v);
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
    },
    setView(s) {
      v = s;
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
        if (ev.k === 'kick') await playKick(ev);
        else if (ev.k === 'draw') {
          say('Пекарь — ' + nm(ev.pekar), 'палка ближе всех', 1600);
          Sound.capture();
          v = { ...s, sc: null };
          await sleep(700 / sp());
          await regroup(s, 2200);
        } else if (ev.k === 'throw') await playThrow(ev);
        else if (ev.k === 'rank') {
          Sound.win();
          const c = v.cfg;
          say(c.ranks.length > 1 ? (ev.rank >= c.ranks.length ? 'Победа!' : c.ranks[ev.rank]) : `Сбил: ${ev.knocks}`, `${(nm(ev.who))} сбил банку`, 1500);
          await sleep(700 / sp());
        } else if (ev.k === 'run') {
          if (ev.go) {
            say('Побежал!', (nm(ev.who)), 700);
            Sound.step();
          }
        } else if (ev.k === 'fix') await playFix(ev);
        else if (ev.k === 'collect') {
          say('Все промахнулись', 'идут за палками', 1400);
          await sleep(700 / sp());
        } else if (ev.k === 'chase') await playChase(ev);
        else if (ev.k === 'back') await playBack(ev);
        else if (ev.k === 'pekar') {
          say('Пекарь — ' + nm(ev.who), ev.rank >= 0 && v.cfg.ranks.length > 1 ? esc(v.cfg.ranks[ev.rank]) : '', 1500);
          await sleep(500 / sp());
        } else if (ev.k === 'end') {
          Sound.win();
          say('Конец партии!', s.winners.map((w) => ctx.name(w)).join(', '), 2500);
          await sleep(1200 / sp());
        }
      }
      const was = !!v?.sc;
      v = s;
      if (was && !s.sc) await regroup(s, 1400);
      place(s);
      drawHud();
      camFor(s);
      busy = false;
      drawPicks();
    },
    setTurn(toAct, interactive) {
      const mine = interactive.find((x) => toAct.includes(x));
      act = v && !v.over && !ctx.demo && mine != null ? mine : null;
      if (act != null && (v?.phase === 'throw' || v?.phase === 'kick')) {
        aim = { pow: 0.6, yaw: 0 };
        aimKey = '';
      } else yard.setAim(null, null);
      showTip(act != null && (v?.phase === 'throw' || v?.phase === 'kick'));
      drawPicks();
    },
    status(s, toAct, interactive) {
      if (s.over) return 'Партия окончена';
      const mine = interactive.includes(toAct[0]);
      if (!mine) return `Решает ${ctx.name(toAct[0])}…`;
      return s.phase === 'kick'
        ? 'Пните палку: потяните вниз и отпустите'
        : s.phase === 'throw'
          ? 'Ваш бросок: потяните вниз и отпустите'
          : s.phase === 'run'
            ? 'Банка сбита! Бежать за палкой?'
            : s.phase === 'fix'
              ? 'Вы пекарь: коснитесь банки — поставить'
              : 'Вы пекарь: коснитесь бегущего — салить';
    },
    playerStats(s, seat) {
      const i = s.seats.indexOf(seat);
      if (i < 0) return '';
      return i === s.pekar ? 'пекарь' : rankName(s.cfg, s.pl[i]);
    },
    saveTitle(s) {
      const best = s.pl.reduce((a, p, i) => (p.rank > s.pl[a].rank ? i : a), 0);
      return s.phase === 'kick' ? 'жеребьёвка' : `пекарь ${ctx.name(s.seats[s.pekar])} · выше всех ${ctx.name(s.seats[best])}`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      yard?.dispose();
    },
  };
}
