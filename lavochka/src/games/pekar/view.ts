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
import { Coach, Tutor, type TutorStep } from '../../core/dvorsport/coach';
import { PullAim } from '../../core/dvorsport/input';
import { GroundMarks } from '../../core/dvorsport/marks3d';
import { Pad } from '../../core/dvorsport/pad';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { SEATS } from './def';
import { behindCan, canHome, catchable, CATCH_R, CATCH_Z, clamp, dist2, inField, kicker, lineOf, lineY, rankName, stickFlight, throwFrom, VP, VR, whoThrows, yawTo, type Event, type In, type State, type Style } from './engine';
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
  let coach: Coach;
  let marks: GroundMarks;
  let tutor: Tutor | null = null;
  let tutorAsked = false;
  const saw = { throw: false, pick: false, back: false, dash: false, can: false, tag: false, catch: false };
  let pad: Pad;
  let pull: PullAim | null = null;
  let raf = 0;
  let iv = 0;
  let last = 0;
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
    if (pad.take('dash')) (q.d++, (saw.dash = true));
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

  /** Можно ли сейчас бежать за своей палкой: банка лежит (пекарь занят) или пекарь далеко от неё. */
  function safeRun(s: State, i: number): boolean {
    const st = s.sticks[i];
    if (st.at !== 'ground' || s.pekar < 0) return false;
    if (s.can.mode !== 'up') return true;
    const m = s.men[i];
    const pk = s.men[s.pekar];
    const mine = (Math.hypot(st.x - m.x, st.y - m.y) + Math.max(0, st.y - lineOf(s, i))) / VR;
    const his = Math.max(0, Math.hypot(pk.x - st.x, pk.y - st.y) - 1.1) / VP;
    return mine + 0.3 < his;
  }

  function hint(s: State) {
    let t = '';
    let keys: string[] = [];
    let hot = false;
    const me = ctrl;
    if (s.over || s.phase === 'pause') t = '';
    else if (s.phase === 'kick') {
      const k = kicker(s);
      if (k >= 0 && me === k) (t = '<b>Жеребьёвка — твой пинок.</b> Потяни вниз и отпусти. У кого палка ближе всех — тот пекарь.'), (hot = true);
      else if (k >= 0) t = `Жеребьёвка: пинает ${nm(k)}…`;
    } else if (me < 0) {
      const w = whoThrows(s);
      t = w >= 0 ? `Бросает ${nm(w)}…` : s.can.mode !== 'up' ? 'Пекарь бежит за банкой — все за палками!' : 'Все за палками…';
    } else if (me === s.pekar) {
      const runners = s.men.some((_, i) => inField(s, i));
      const cp = catchable(s);
      if (cp && s.cfg.catch) (t = behindCan(s) ? '<b>Лови палку!</b> Летит мимо банки — встань на её пути (кольцо) и жми, когда она рядом. Поймал — её хозяин печёт.' : '<b>Палка летит мимо!</b> Зайди за банку — ловить можно только оттуда.'), (keys = ['Пробел']), (hot = true);
      else if (s.can.mode === 'down' || s.can.mode === 'fly') (t = '<b>Банку сбили!</b> Беги к ней (стрелка) — подберёшь, коснувшись.'), (keys = ['W', 'A', 'S', 'D']), (hot = true);
      else if (s.can.mode === 'held') (t = '<b>Неси банку в кружок</b> — поставишь, войдя в него. Пока она не стоит, салить нельзя.'), (keys = ['W', 'A', 'S', 'D']);
      else if (runners) (t = '<b>Салить!</b> Догони того, кто в поле (красное кольцо), и жми рядом — или просто коснись.'), (keys = ['Пробел']), (hot = true);
      else if (s.fly >= 0) t = 'Палка летит… Сбили — беги за банкой; мимо — лови её за банкой.';
      else t = 'Ты пекарь. Сторожи банку: выбегут за палкой — догоняй и сали. Ближе полполя к чертам нельзя.';
    } else {
      const st = s.sticks[me];
      const w = whoThrows(s);
      if (w === me) (t = '<b>Твой бросок!</b> Нажми на поле и потяни вниз (сила), вбок — направление; отпусти. Кольцо — где ляжет палка.'), (keys = ['Enter']), (hot = true);
      else if (st.at === 'ground') {
        const ok = safeRun(s, me);
        if (inField(s, me)) (t = ok ? '<b>Хватай палку</b> (зелёное кольцо) — и назад за черту!' : '<b>Пекарь рядом!</b> Назад за черту или увернись рывком.'), (keys = ok ? ['W', 'A', 'S', 'D'] : ['Shift']), (hot = !ok);
        else if (ok) (t = s.can.mode !== 'up' ? '<b>Банка лежит — беги за палкой!</b> Пекарь занят. Подбери и назад за свою черту.' : '<b>Сейчас можно!</b> Пекарь далеко — беги за палкой и назад за черту.'), (keys = ['W', 'A', 'S', 'D']), (hot = true);
        else t = w >= 0 ? `Палка в поле, но пекарь рядом — подожди. Бросает ${nm(w)}.` : 'Бросать некому — все палки в поле. Выбегай, когда пекарь отвернётся или отойдёт: он осалит кого-то одного.';
      } else if (st.at === 'fly') t = s.can.mode !== 'up' ? '<b>Сбил!</b> Палка ещё катится — сейчас беги за ней, пока пекарь у банки.' : 'Палка летит…';
      else if (inField(s, me)) (t = '<b>Назад за черту!</b> Там не осалят. Рывок — уйти от пекаря.'), (keys = ['S', 'Shift']), (hot = true);
      else if (w >= 0) t = `Бросает ${nm(w)}. Стой за чертой — следующий бросок твой по очереди.`;
      else t = 'Ждём, пока все соберут палки…';
    }
    coach.say(tutor?.showing ? '' : t, keys, hot);
    const pk = me >= 0 && me === s.pekar && s.phase === 'play';
    const catching = pk && !!catchable(s);
    pad.show({
      act: catching ? '!Лови!' : pk && s.can.mode === 'up' ? '!Салить!' : null,
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
    const meLine = ctrl >= 0 && ctrl !== s.pekar && s.phase !== 'kick' ? `<div class="pk-me">ты — <b>${esc(rankName(c, s.men[ctrl]))}</b>${c.ranks.length > 1 ? ` · до победы ${Math.max(0, c.ranks.length - s.men[ctrl].rank)} банк.` : ` из ${c.target}`}</div>` : ctrl === s.pekar && s.phase !== 'kick' ? '<div class="pk-me">ты — <b>пекарь</b></div>' : '';
    const html = `<div class="pk-board"><div class="pk-head">${esc(goal)}</div>${rows}${meLine}</div>`;
    if (hud.innerHTML !== html) hud.innerHTML = html;
  }

  // ---------------------------------------------------------------- события

  /** Надпись над точкой поля. */
  function popAt(text: string, x: number, y: number, z = 2.1, cls = '') {
    const q = yard.toScreen(x, y, z);
    if (q.vis) coach.pop(text, q.x, q.y, cls);
  }

  function onEvent(s: State, ev: Event) {
    const tn = (i: number) => yard.men[i]?.toon ?? null;
    const busy = (i: number, sec: number) => {
      if (disp[i]) disp[i].busy = performance.now() + sec * 1000;
    };
    const at = (i: number) => s.men[i];
    switch (ev.k) {
      case 'kick':
        tn(ev.who)?.play('jump', false, 0.1, 1.6);
        busy(ev.who, 0.7);
        knock();
        popAt(ev.slip ? 'Сорвалась!' : `${ev.d.toFixed(1)} м`, s.sticks[ev.who].x, s.sticks[ev.who].y, 0.6, ev.slip ? 'bad' : '');
        break;
      case 'draw':
        Sound.capture();
        coach.banner('Пекарь — ' + plain(ev.pekar), 'его палка легла ближе всех', 1600);
        break;
      case 'throw':
        tn(ev.who)?.play('throw', false, 0.08, 1.4);
        busy(ev.who, 0.9);
        whoosh(0.4);
        if (ev.who === ctrl) saw.throw = true;
        break;
      case 'knock': {
        clank(1);
        Sound.win();
        yard.shake(0.07);
        const c = s.cfg;
        tn(ev.who)?.play('cheer', false, 0.15);
        busy(ev.who, 1.2);
        // кто за чертами — радуется: банка лежит, можно бежать
        s.men.forEach((_, i) => {
          if (i !== ev.who && i !== s.pekar && !inField(s, i) && Math.random() < 0.7) {
            tn(i)?.play(i % 2 ? 'cheer' : 'wave', false, 0.2);
            busy(i, 0.9);
          }
        });
        const home = canHome(c);
        popAt('Сбил!', home[0], home[1], 0.9, 'good');
        if (c.ranks.length > 1) popAt(ev.rank >= c.ranks.length ? 'Победа!' : `Новое звание: ${c.ranks[ev.rank]}`, at(ev.who).x, at(ev.who).y, 2.2, 'good');
        else popAt(`Сбил: ${ev.knocks}`, at(ev.who).x, at(ev.who).y, 2.2, 'good');
        if (ev.who === ctrl) coach.banner(c.ranks.length > 1 && ev.rank < c.ranks.length ? c.ranks[ev.rank] : 'Сбил!', 'банка лежит — беги за палкой!', 1400);
        break;
      }
      case 'land':
        knock();
        if (!ev.hit && s.phase === 'play') popAt(ev.y < s.cfg.dist - 1 ? 'Недолёт' : ev.y > s.cfg.dist + 1 ? 'Перелёт' : 'Мимо!', ev.x, ev.y, 0.5, 'bad');
        break;
      case 'pick':
        tick();
        if (ev.who === ctrl) saw.pick = true;
        popAt('Есть палка!', at(ev.who).x, at(ev.who).y, 2.1);
        break;
      case 'can':
        knock();
        if (ctrl === s.pekar) saw.can = true;
        if (ev.what === 'set') popAt('Банка на месте!', canHome(s.cfg)[0], canHome(s.cfg)[1], 0.9);
        break;
      case 'tag':
        slap();
        Sound.capture();
        yard.shake(0.12);
        tn(ev.by)?.play('swing1h', false, 0.08, 1.4);
        busy(ev.by, 0.9);
        tn(ev.who)?.play('hit', false, 0.08);
        busy(ev.who, 0.9);
        if (ev.by === ctrl) saw.tag = true;
        popAt('Осалил!', at(ev.who).x, at(ev.who).y, 2.2, 'bad');
        coach.banner('Осалил!', `${plain(ev.who)} теперь пекарь`, 1500);
        break;
      case 'catch':
        slap();
        Sound.capture();
        yard.shake(0.08);
        tn(ev.by)?.play('holding', false, 0.08);
        busy(ev.by, 0.9);
        if (ev.by === ctrl) saw.catch = true;
        popAt('Поймал!', ev.x, ev.y, 1.6, 'good');
        coach.banner('Поймал палку!', `${plain(ev.who)} теперь пекарь`, 1500);
        break;
      case 'pekar':
        coach.banner('Пекарь — ' + plain(ev.who), s.cfg.ranks.length > 1 ? s.cfg.ranks[ev.rank] : '', 1300);
        break;
      case 'skip':
        coach.banner('Ход дальше', `${plain(ev.who)} не бросил`, 1100);
        break;
      case 'end':
        Sound.win();
        coach.banner('Конец партии!', s.winners.map((w) => SEATS[w % SEATS.length].name).join(', '), 5000);
        break;
    }
  }

  /** Имя игрока без разметки (для надписей). */
  const plain = (i: number) => (latest ? (h(`<span>${ctx.name(latest.seats[i])}</span>`).textContent ?? '') : '');

  // ---------------- обучение первой партии
  function tutorSteps(): TutorStep[] {
    const S = () => latest!;
    const me = () => ctrl;
    const play = () => !!latest && latest.phase === 'play';
    return [
      { text: '<b>Бросок.</b> Нажми на поле, потяни вниз — сила, вбок — направление; отпусти. Целься в банку.', keys: ['Enter'], when: () => myThrow(S()), done: () => saw.throw },
      { text: '<b>Беги за палкой</b> — к зелёному кольцу; подберёшь, коснувшись. Лучше, пока банка лежит или пекарь далеко.', keys: ['W', 'A', 'S', 'D'], when: () => play() && me() !== S().pekar && S().sticks[me()]?.at === 'ground' && safeRun(S(), me()), done: () => saw.pick },
      { text: '<b>Назад за черту!</b> За своей чертой пекарь не осалит.', keys: ['S'], when: () => play() && me() !== S().pekar && inField(S(), me()) && S().sticks[me()]?.at === 'hand', done: () => saw.back },
      { text: '<b>Рывок</b> — так уходят от пекаря.', keys: ['Shift'], when: () => play() && me() !== S().pekar && inField(S(), me()), done: () => saw.dash },
      { text: '<b>Ты пекарь.</b> Беги к сбитой банке, подбери и донеси до кружка.', keys: ['W', 'A', 'S', 'D'], when: () => play() && me() === S().pekar && S().can.mode !== 'up', done: () => saw.can },
      { text: '<b>Сали!</b> Догони того, кто в поле, и жми рядом с ним.', keys: ['Пробел'], when: () => play() && me() === S().pekar && S().can.mode === 'up' && S().men.some((_, i) => inField(S(), i)), done: () => saw.tag },
    ];
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
    drawMarks(s, dt);
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

  /** Метки на земле: я, моя палка и путь к ней, куда бежит пекарь, кого салить, где ловить, куда бросать. */
  function drawMarks(s: State, dt: number) {
    marks.begin(dt);
    const c = s.cfg;
    const home = canHome(c);
    if (ctrl >= 0 && s.phase === 'play' && !s.shot) {
      const d = disp[ctrl];
      const me = s.men[ctrl];
      const mx = d?.x ?? me.x;
      const my = d?.y ?? me.y;
      marks.ring('me', mx, my, '#ffe23a', 0.6, { pulse: true });
      if (ctrl === s.pekar) {
        const cp = catchable(s);
        if (cp && c.catch) {
          // где поймать: первая точка пути палки за банкой
          const st = s.sticks[s.fly];
          const f = stickFlight(st.b0!, st.style!, home);
          const tt = nowT() - st.t0!;
          const pt = f.frames.find((fr) => fr[0] >= tt && fr[2] >= c.dist - 0.1 && fr[3] < CATCH_Z);
          if (pt) {
            marks.ring('catch', pt[1], pt[2], '#ff9a2a', CATCH_R * 0.8, { dashed: true });
            marks.arrow('go', mx, my, pt[1], pt[2], '#ff9a2a', 12);
          }
        } else if (s.can.mode === 'down' || s.can.mode === 'fly') marks.arrow('go', mx, my, s.can.x, s.can.y, '#ffe23a', 30);
        else if (s.can.mode === 'held') {
          marks.ring('circle', home[0], home[1], '#7ad84a', 0.6, { pulse: true });
          marks.arrow('go', mx, my, home[0], home[1], '#7ad84a', 30);
        } else {
          let best = -1;
          let bd = Infinity;
          s.men.forEach((m, i) => {
            if (!inField(s, i)) return;
            marks.ring(`run${i}`, m.x, m.y, '#ff4a2a', 0.6);
            const dd = Math.hypot(m.x - mx, m.y - my);
            if (dd < bd) (bd = dd), (best = i);
          });
          if (best >= 0) marks.arrow('go', mx, my, s.men[best].x, s.men[best].y, '#ff4a2a', 30);
        }
      } else {
        const st = s.sticks[ctrl];
        if (st.at === 'ground') {
          const ok = safeRun(s, ctrl);
          marks.ring('stick', st.x, st.y, ok ? '#7ad84a' : '#f0a020', 0.5, { pulse: ok });
          if (ok || inField(s, ctrl)) marks.arrow('go', mx, my, st.x, st.y, ok ? '#7ad84a' : '#f0a020', 30);
        } else if (inField(s, ctrl)) marks.arrow('go', mx, my, mx, lineOf(s, ctrl) - 0.8, '#7ad84a', 30);
        if (myThrow(s)) marks.ring('target', home[0], home[1], '#ffffff', 0.45, { dashed: true });
        // куда бежит пекарь (когда я в поле или моя палка в поле и банка стоит)
        const p = s.pekar;
        if (p >= 0 && s.can.mode === 'up' && (inField(s, ctrl) || st.at === 'ground')) {
          const pm = s.men[p];
          const v = Math.hypot(pm.vx, pm.vy);
          marks.ring('pekar', pm.x, pm.y, '#ff4a2a', 0.65);
          if (v > 0.8) marks.arrow('pk', pm.x, pm.y, pm.x + pm.vx * 0.6, pm.y + pm.vy * 0.6, '#ff4a2a', 5);
        }
      }
    }
    marks.end();
    // моя палка за краем кадра — стрелка у края
    if (ctrl >= 0 && ctrl !== s.pekar && s.sticks[ctrl]?.at === 'ground' && s.phase === 'play') {
      const st = s.sticks[ctrl];
      coach.edge(yard.toScreen(st.x, st.y, 0.1), wrap.clientWidth, wrap.clientHeight, 'палка');
    } else coach.edge(null, wrap.clientWidth, wrap.clientHeight);
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (document.hidden) return;
    draw(dt);
    if (latest && !tutorAsked && ctrl >= 0 && latest.phase === 'play') {
      tutorAsked = true;
      if (!ctx.demo && !ctx.online && mine(latest).length === 1 && !Tutor.seen('pekar')) tutor = new Tutor(wrap, 'pekar', tutorSteps());
    }
    if (latest && ctrl >= 0 && saw.pick && ctrl !== latest.pekar && !inField(latest, ctrl)) saw.back = true;
    tutor?.tick();
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
    // счётчики нажатий не меньше учтённых комнатой (после загрузки партии или перезагрузки страницы)
    for (const i of mine(v)) {
      const q = sq(i);
      const sn = v.seen[i];
      if (sn) (q.th = Math.max(q.th, sn.th)), (q.k = Math.max(q.k, sn.k)), (q.a = Math.max(q.a, sn.a)), (q.d = Math.max(q.d, sn.d));
    }
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
      wrap = h(`<div class="pk-wrap"><div class="pk-cv"></div><div class="pk-hud"></div></div>`);
      el.appendChild(wrap);
      hud = wrap.querySelector('.pk-hud') as HTMLElement;
      yard = new PekarYard(wrap.querySelector('.pk-cv') as HTMLElement);
      coach = new Coach(wrap);
      marks = new GroundMarks(yard.scene);
      cleanup.push(() => (coach.dispose(), marks.dispose(), tutor?.dispose()));
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
        coach.el.style.display = 'none';
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
