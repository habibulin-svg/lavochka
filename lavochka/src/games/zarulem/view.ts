/* «За рулём» — экран: 3D-игрушка, плавное движение между снимками комнаты, руль и рычаг, табло, звук моторчика.
 * Один игрок: ← → (или A D) — руль, ↑ ↓ (или W S) — передача; мышь/палец — тянуть влево-вправо где угодно на поле,
 * по рычагу — выбрать передачу. Двое за одним экраном: первый — стрелки, второй — A D / W S. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { segRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { esc, h, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { clock, WHY } from './def';
import { GEARS, standings, type Car, type ZrEvent, type ZrIn, type ZrState } from './engine';
import { Toy3D, type Cam } from './scene';
import './zarulem.css';

export const PREF_CAM = 'zarulem.cam';

const GEAR_NAMES = ['Н', '1', '2', '3'];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Snap {
  t: number;
  v: ZrState;
}

function mix(a: ZrState, b: ZrState, t: number): ZrState {
  return {
    ...b,
    t: lerp(a.t, b.t, t),
    cars: b.cars.map((cb) => {
      const ca = a.cars.find((x) => x.seat === cb.seat);
      // после аварии машинку переставляют — без растягивания
      if (!ca || ca.out !== cb.out || (ca.stun > 0) !== (cb.stun > 0) || Math.abs(cb.a - ca.a) > 0.5) return cb;
      return { ...cb, a: lerp(ca.a, cb.a, t), r: lerp(ca.r, cb.r, t), w: lerp(ca.w, cb.w, t) };
    }),
  };
}

export function createView(): GameView<ZrState, ZrEvent> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let toy: Toy3D | null = null;
  let hud: HTMLElement;
  let board: HTMLElement;
  let banner: HTMLElement;
  let raf = 0;
  let snaps: Snap[] = [];
  let latest: ZrState | null = null;
  let bannerT = 0;
  let trackId = '';
  /** Своё управление по местам; какие клавиши руля зажаты; перетаскивание. */
  const inp: Record<number, ZrIn> = {};
  const keys = new Set<string>();
  let drag: { id: number; x0: number; seat: number } | null = null;
  let dragSteer = 0;
  const sent: Record<number, { json: string; at: number }> = {};
  const cleanup: (() => void)[] = [];
  let gearEl: (HTMLElement & { sync?: () => void }) | null = null;
  let seatsKey: string | null = null;
  let motor: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode; lp: BiquadFilterNode } | null = null;

  const mine = () => ctx.mySeats.filter((s) => !latest || latest.cars.some((c) => c.seat === s));
  const hotseat = () => mine().length > 1;
  /** Вид: как выбрано; по умолчанию на узком экране — сверху (из-за руля диск там мелкий). */
  const camMode = (): Cam => (store.get<string>(PREF_CAM, root && root.clientWidth < root.clientHeight ? 'top' : 'drive') === 'top' ? 'top' : 'drive');
  const carOf = (st: ZrState | null, seat: number): Car | undefined => st?.cars.find((c) => c.seat === seat);
  /** Чья машинка стоит на месте (диск крутится под ней): своя, а у зрителя — лидер. */
  const focus = (st: ZrState) => mine()[0] ?? standings(st)[0]?.seat ?? 0;

  function current(): ZrState | null {
    if (!snaps.length) return latest;
    const delay = ctx.online ? 110 : 60;
    const t = performance.now() - delay;
    while (snaps.length > 2 && snaps[1].t <= t) snaps.shift();
    const [a, b] = snaps;
    if (!b || t <= a.t) return a.v;
    if (t >= b.t) return b.v;
    return mix(a.v, b.v, (t - a.t) / (b.t - a.t));
  }

  // ---------------------------------------------------------------- управление

  /** Руль места из зажатых клавиш (первый игрок — стрелки, второй — A/D; один — любые) и перетаскивания. */
  function steerOf(seat: number): number {
    const m = mine();
    const first = seat === m[0];
    const arrows = first;
    const wasd = !hotseat() || seat === m[1];
    let s = 0;
    if (arrows && keys.has('ArrowRight')) s += 1;
    if (arrows && keys.has('ArrowLeft')) s -= 1;
    if (wasd && keys.has('KeyD')) s += 1;
    if (wasd && keys.has('KeyA')) s -= 1;
    if (drag && drag.seat === seat) s += dragSteer;
    return Math.max(-1, Math.min(1, s));
  }

  function setGear(seat: number, g: number) {
    const cur = (inp[seat] ??= { s: 0, g: carOf(latest, seat)?.g ?? 1 });
    const ng = Math.max(0, Math.min(3, g));
    if (ng === cur.g) return;
    cur.g = ng;
    // щелчок рычага
    const o = audioOut();
    if (o) click(o.ctx.currentTime, { freq: 1300, q: 3, dur: 0.035, gain: 0.35 });
    send(seat, true);
    if (seat === mine()[0]) gearEl?.sync?.();
  }

  function send(seat: number, force = false) {
    if (!ctx.input || ctx.demo || !latest || latest.over) return;
    const cur = (inp[seat] ??= { s: 0, g: carOf(latest, seat)?.g ?? 1 });
    cur.s = steerOf(seat);
    const json = JSON.stringify(cur);
    const now = performance.now();
    const last = sent[seat];
    if (!force && last && last.json === json && now - last.at < 300) return;
    sent[seat] = { json, at: now };
    ctx.input(seat, { ...cur });
  }

  const STEER_KEYS = ['ArrowLeft', 'ArrowRight', 'KeyA', 'KeyD'];
  const GEAR_KEYS: Record<string, [number, number]> = { ArrowUp: [0, 1], ArrowDown: [0, -1], KeyW: [1, 1], KeyS: [1, -1] };

  function onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.closest?.('input, textarea') || !mine().length || ctx.demo) return;
    const gk = GEAR_KEYS[e.code];
    if (!STEER_KEYS.includes(e.code) && !gk) return;
    e.preventDefault();
    if (down) Sound.unlock();
    if (STEER_KEYS.includes(e.code)) {
      if (down) keys.add(e.code);
      else keys.delete(e.code);
      mine().forEach((s) => send(s, true));
      return;
    }
    if (!down || e.repeat) return;
    const m = mine();
    const seat = hotseat() ? m[gk[0]] : m[0];
    if (seat == null) return;
    setGear(seat, (inp[seat]?.g ?? carOf(latest, seat)?.g ?? 1) + gk[1]);
  }

  function onPointer(e: PointerEvent, kind: 'down' | 'move' | 'up') {
    if (ctx.demo || !mine().length || !toy) return;
    const seat = mine()[0];
    if (kind === 'down') {
      Sound.unlock();
      startMotor();
      const g = toy.pickGear(e.clientX, e.clientY);
      if (g != null) {
        e.preventDefault();
        return setGear(seat, g);
      }
      drag = { id: e.pointerId, x0: e.clientX, seat };
      dragSteer = 0;
      toy.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (!drag || e.pointerId !== drag.id) return;
    if (kind === 'move') {
      const w = toy.canvas.clientWidth || 600;
      dragSteer = Math.max(-1, Math.min(1, (e.clientX - drag.x0) / Math.max(40, w * 0.09)));
    } else {
      drag = null;
      dragSteer = 0;
    }
    send(seat, true);
  }

  // ---------------------------------------------------------------- звук

  function startMotor() {
    if (motor) return;
    const o = audioOut();
    if (!o) return;
    const c = o.ctx;
    const gain = c.createGain();
    gain.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 60;
    const osc2 = c.createOscillator();
    osc2.type = 'square';
    osc2.frequency.value = 121;
    const g2 = c.createGain();
    g2.gain.value = 0.25;
    osc.connect(lp);
    osc2.connect(g2).connect(lp);
    lp.connect(gain).connect(o.out);
    osc.start();
    osc2.start();
    motor = { osc, osc2, gain, lp };
  }

  function stopMotor() {
    if (!motor) return;
    try {
      motor.osc.stop();
      motor.osc2.stop();
      motor.gain.disconnect();
    } catch {
      /* уже остановлен */
    }
    motor = null;
  }

  /** Моторчик: гудит по скорости диска под своей машинкой (у зрителя — тише). */
  function motorTick(st: ZrState) {
    if (!motor) return;
    const o = audioOut();
    const c = carOf(st, focus(st));
    const v = c && !c.out && st.t >= 0 && !st.over ? Math.max(0, c.w) / GEARS[3] : 0;
    const on = o && !document.hidden ? (mine().length ? 1 : 0.4) : 0;
    const now = motor.gain.context.currentTime;
    const target = on * (v > 0.01 ? 0.03 + 0.05 * v : 0.012 * (st.over ? 0 : 1));
    motor.gain.gain.setTargetAtTime(target, now, 0.08);
    motor.osc.frequency.setTargetAtTime(58 + 120 * v, now, 0.1);
    motor.osc2.frequency.setTargetAtTime(117 + 240 * v, now, 0.1);
  }

  function sound(ev: ZrEvent, st: ZrState) {
    const o = audioOut();
    if (!o) return;
    const t = o.ctx.currentTime;
    const me = mine().includes((ev as { seat?: number }).seat ?? -1);
    if (ev.k === 'count') tone(t, { freq: 660, dur: 0.14, gain: 0.12, type: 'square' });
    else if (ev.k === 'go') tone(t, { freq: 1320, dur: 0.3, gain: 0.14, type: 'square' });
    else if (ev.k === 'crash') {
      // пластмасса о пластмассу: стук и дребезг
      const k = me || !mine().length ? 1 : 0.4;
      click(t, { freq: 900, q: 1.4, dur: 0.08, gain: 0.6 * k });
      click(t + 0.03, { freq: 2600, q: 3, dur: 0.05, gain: 0.35 * k });
      tone(t, { freq: 180, to: 70, dur: 0.18, gain: 0.2 * k, type: 'triangle' });
    } else if (ev.k === 'bump') click(t, { freq: 1700, q: 3, dur: 0.03, gain: me ? 0.4 : 0.15 });
    else if (ev.k === 'grass' && me) click(t, { freq: 500, q: 0.8, dur: 0.12, gain: 0.15 });
    else if (ev.k === 'lap' && me) tone(t, { freq: 1760, dur: 0.07, gain: 0.07, type: 'square' });
    else if (ev.k === 'finish') {
      const k = me ? 1 : 0.4;
      [784, 988, 1175, 1568].forEach((f, i) => tone(t + i * 0.09, { freq: f, dur: 0.12, gain: 0.08 * k, type: 'square' }));
    } else if (ev.k === 'end') stopMotor();
    void st;
  }

  // ---------------------------------------------------------------- кадр и табло

  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden || !toy) return;
    const st = current();
    if (!st) return;
    const f = focus(st);
    // руль и рычаг своей машинки — сразу по своему вводу, без ожидания комнаты
    const my = mine()[0];
    const steer = my != null ? steerOf(my) : carOf(st, f)?.steer ?? 0;
    const gear = my != null ? inp[my]?.g ?? carOf(st, my)?.g ?? 1 : carOf(st, f)?.g ?? 0;
    toy.setCamera(camMode());
    toy.update(st, f, { steer, gear, blink: Math.floor(performance.now() / 120) % 2 === 0 });
    toy.render();
    motorTick(st);
    drawHud(latest ?? st);
    if (bannerT && performance.now() > bannerT) {
      banner.hidden = true;
      bannerT = 0;
    }
  }

  function drawHud(st: ZrState) {
    // превью карточки и показ — без табло
    hud.hidden = ctx.demo;
    if (ctx.demo) return void (board.hidden = true);
    const my = carOf(st, mine()[0] ?? -1);
    const order = standings(st);
    let main = '';
    if (st.goal === 'race') {
      const c = my ?? order[0];
      const lap = c ? Math.min(st.laps, c.laps + (c.fin >= 0 ? 0 : 1)) : 1;
      const place = c ? order.indexOf(c) + 1 : 0;
      main = `<span>Круг <b>${lap}</b>/${st.laps}</span>${st.cars.length > 1 && c ? `<span><b>${place}</b>-е место</span>` : ''}<span class="t">${clock(Math.max(0, c && c.fin >= 0 ? c.fin : st.t))}</span>`;
    } else {
      const c = my ?? order[0];
      const left = st.limit > 0 ? `<span class="t">${clock(Math.max(0, st.limit - Math.max(0, st.t))).replace(/,\d$/, '')}</span>` : '';
      main = `<span><b>${c ? Math.floor(c.meters) : 0}</b> м</span>${left}`;
    }
    if (my) main += `<span class="gear">${GEAR_NAMES[inp[my.seat]?.g ?? my.g]}</span>`;
    if (hud.dataset.h !== main) {
      hud.innerHTML = main;
      hud.dataset.h = main;
    }
    let tb = '';
    if (st.cars.length > 1)
      tb = order
        .map((c) => {
          const val = st.goal === 'race' ? (c.fin >= 0 ? '🏁' : `${Math.min(st.laps, c.laps + 1)}/${st.laps}`) : `${Math.floor(c.meters)} м`;
          return `<div class="${c.out ? 'out' : ''}${mine().includes(c.seat) ? ' me' : ''}"><i style="background:${esc(ctx.demo ? '#888' : seatColor(c.seat))}"></i>${ctx.name(c.seat)}<b>${val}</b></div>`;
        })
        .join('');
    if (board.dataset.h !== tb) {
      board.innerHTML = tb;
      board.dataset.h = tb;
    }
    board.hidden = !tb;
  }

  const seatColor = (s: number) => ['#d4281c', '#2456c8', '#e8b414', '#22963a'][s] ?? '#888';

  function showBanner(title: string, sub = '', ms = 1400) {
    banner.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`;
    banner.hidden = false;
    bannerT = ms > 0 ? performance.now() + ms : 0;
  }

  function finalBanner(v: ZrState) {
    const order = standings(v);
    const my = carOf(v, mine()[0] ?? -1);
    if (v.goal === 'race') {
      if (my && my.fin >= 0) showBanner(v.cars.length > 1 ? `${order.indexOf(my) + 1}-е место` : 'Финиш!', `${v.laps} кругов за ${clock(my.fin)}`, 0);
      else showBanner('Заезд окончен', order[0]?.fin >= 0 ? `первой — ${['красная', 'синяя', 'жёлтая', 'зелёная'][order[0].seat]}` : '', 0);
    } else {
      const c = my ?? order[0];
      showBanner(v.cars.length > 1 && my ? `${order.indexOf(my) + 1}-е место` : 'Конец', c ? `проехали ${Math.floor(c.meters)} м` : '', 0);
    }
  }

  // ---------------------------------------------------------------- панель

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    box.innerHTML = '';
    box.appendChild(segRow('Вид', [['drive', 'из-за руля'], ['top', 'сверху']], () => camMode(), (v) => store.set(PREF_CAM, v)));
    const m = mine();
    if (m.length) {
      gearEl = segRow(
        'Передача',
        GEAR_NAMES.map((n, i) => [String(i), n] as [string, string]),
        () => String(inp[m[0]]?.g ?? carOf(latest, m[0])?.g ?? 1),
        (v) => setGear(m[0], Number(v))
      );
      box.appendChild(gearEl);
    }
    const hint = !m.length
      ? ''
      : hotseat()
        ? 'Первый — <kbd>←</kbd> <kbd>→</kbd> руль, <kbd>↑</kbd> <kbd>↓</kbd> передача; второй — <kbd>A</kbd> <kbd>D</kbd> и <kbd>W</kbd> <kbd>S</kbd>'
        : touchScreen()
          ? 'Руль — тянуть пальцем влево-вправо по полю; передача — рычаг или кнопки'
          : '<kbd>←</kbd> <kbd>→</kbd> — руль (или тянуть мышью), <kbd>↑</kbd> <kbd>↓</kbd> — передача';
    if (hint) box.appendChild(h(`<div class="zr-hint">${hint}</div>`));
  }

  function ensureToy(v: ZrState) {
    if (toy && trackId === v.track) return;
    toy?.dispose();
    trackId = v.track;
    toy = new Toy3D(root.querySelector('.zr-3d') as HTMLElement, v.track);
    const cv = toy.canvas;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => onPointer(e, 'down'));
    cv.addEventListener('pointermove', (e) => onPointer(e, 'move'));
    cv.addEventListener('pointerup', (e) => onPointer(e, 'up'));
    cv.addEventListener('pointercancel', (e) => onPointer(e, 'up'));
  }

  return {
    mount(el, c) {
      ctx = c;
      root = h(`<div class="zr-wrap"><div class="zr-3d"></div><div class="zr-hud"></div><div class="zr-board" hidden></div><div class="zr-banner" hidden></div></div>`);
      el.appendChild(root);
      hud = root.querySelector('.zr-hud') as HTMLElement;
      board = root.querySelector('.zr-board') as HTMLElement;
      banner = root.querySelector('.zr-banner') as HTMLElement;
      const kd = (e: KeyboardEvent) => {
        onKey(e, true);
        if (GEAR_KEYS[e.code] || STEER_KEYS.includes(e.code)) startMotor();
      };
      const ku = (e: KeyboardEvent) => onKey(e, false);
      const blur = () => {
        keys.clear();
        drag = null;
        dragSteer = 0;
        mine().forEach((s) => send(s, true));
      };
      window.addEventListener('keydown', kd);
      window.addEventListener('keyup', ku);
      window.addEventListener('blur', blur);
      cleanup.push(() => {
        window.removeEventListener('keydown', kd);
        window.removeEventListener('keyup', ku);
        window.removeEventListener('blur', blur);
      });
      raf = requestAnimationFrame(frame);
      // ввод повторяем своим таймером (на случай потерянного сообщения)
      const iv = setInterval(() => mine().forEach((s) => send(s)), 100);
      cleanup.push(() => clearInterval(iv));
    },
    setView(v) {
      latest = v;
      ensureToy(v);
      if (mine().join() !== seatsKey) {
        seatsKey = mine().join();
        for (const s of mine()) inp[s] = { s: 0, g: carOf(v, s)?.g ?? 1 };
        controls();
      }
      snaps = [{ t: performance.now(), v }];
      if (!v.over) banner.hidden = true;
      else finalBanner(v);
    },
    async play(_ev, v) {
      this.setView(v);
    },
    realtime(v, events) {
      latest = v;
      ensureToy(v);
      if (mine().join() !== seatsKey) {
        seatsKey = mine().join();
        for (const s of mine()) inp[s] ??= { s: 0, g: carOf(v, s)?.g ?? 1 };
        controls();
      }
      if (import.meta.env.DEV) (window as unknown as { __zrv: ZrState }).__zrv = v;
      snaps.push({ t: performance.now(), v });
      if (snaps.length > 12) snaps.splice(0, snaps.length - 12);
      for (const ev of events) {
        sound(ev, v);
        if (ev.k === 'count') showBanner(String(ev.n), v.goal === 'race' ? `гонка на ${v.laps} кругов` : 'на дальность', 900);
        else if (ev.k === 'go') {
          startMotor();
          showBanner('Марш!', '', 800);
        } else if (ev.k === 'crash' && mine().includes(ev.seat)) showBanner('Авария!', WHY[ev.why], 1300);
        else if (ev.k === 'out' && mine().includes(ev.seat)) showBanner('Сход', 'три аварии', 2000);
        else if (ev.k === 'finish' && mine().includes(ev.seat)) showBanner('Финиш!', v.cars.length > 1 ? `${ev.place}-е место · ${clock(ev.time)}` : clock(ev.time), 2500);
        else if (ev.k === 'end') finalBanner(v);
      }
    },
    setTurn() {},
    status(v) {
      if (!v) return '';
      const lead = standings(v)[0];
      if (v.goal === 'race') return lead?.fin >= 0 ? `Первой финишировала ${['красная', 'синяя', 'жёлтая', 'зелёная'][lead.seat]} машина` : `Гонка на ${v.laps} кругов`;
      return v.limit > 0 ? `На дальность · ${Math.round(v.limit / 60)} мин` : 'На дальность — до трёх аварий';
    },
    playerStats(v, seat) {
      const c = carOf(v, seat);
      if (!c) return '';
      if (v.goal === 'race') return c.fin >= 0 ? `🏁 <b>${clock(c.fin)}</b>` : `круг <b>${Math.min(v.laps, c.laps + 1)}</b>/${v.laps} · аварий ${c.crashes}`;
      return `<b>${Math.floor(c.meters)}</b> м · аварий ${c.crashes}${c.out ? ' · сход' : ''}`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      stopMotor();
      toy?.dispose();
      root?.remove();
    },
  };
}
