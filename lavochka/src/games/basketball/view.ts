/* Настольный баскетбол — экран: 3D-стол, плавное движение между снимками комнаты, клавиши, звук.
 * Один игрок на экране: нижний ряд Z…/ (или цифры 1…0, или верхний ряд Q…P) — клавиши 1…0 на корпусе; мышь/палец — по лунке или клавише.
 * Двое за одним экраном: красные — верхний ряд Q…P (и цифры), синие — нижний Z…/. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { segRow, speedRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { keyPos } from './ai';
import { labelOf, type BbEvent, type BbIn, type BbState } from './engine';
import { Court3D, type Cam } from './scene';
import './basketball.css';

export const PREF_CAM = 'basketball.cam';

const TEAM = ['Красные', 'Синие'];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ROW_Q = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'];
const ROW_Z = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'];
const ROW_D = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'];
const LET_Q = 'QWERTYUIOP'.split('');
const LET_Z = 'ZXCVBNM,./'.split('');

interface Snap {
  t: number;
  v: BbState;
}

function mix(a: BbState, b: BbState, t: number): BbState {
  const A = a.ball;
  const B = b.ball;
  // мяч лёг в лунку или улетел из неё — без растягивания
  if (a.hole !== b.hole || Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) > 0.08) return b;
  return { ...b, ball: { ...B, x: lerp(A.x, B.x, t), y: lerp(A.y, B.y, t), z: lerp(A.z, B.z, t) } };
}

export function createView(): GameView<BbState, BbEvent> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let court: Court3D;
  let hud: HTMLElement;
  let banner: HTMLElement;
  let raf = 0;
  let snaps: Snap[] = [];
  let latest: BbState | null = null;
  let bannerT = 0;
  /** Своё управление: позиция клавиши и счётчик нажатий каждого места; что нажато сейчас (для показа). */
  const inp: Record<number, BbIn> = {};
  const held: boolean[][] = [Array(10).fill(false), Array(10).fill(false)];
  const sent: Record<number, { json: string; at: number }> = {};
  const cleanup: (() => void)[] = [];
  /** Скорость, выбранная за столом (уходит в ввод); панель скорости; для каких мест построена панель. */
  let spReq: number | undefined;
  let speedEl: (HTMLElement & { sync?: () => void }) | null = null;
  let seatsKey: string | null = null;

  const mine = () => ctx.mySeats.filter((s) => s === 0 || s === 1);
  const hotseat = () => mine().length > 1;
  const camMode = (): Cam => (!mine().length ? 'corner' : store.get<string>(PREF_CAM, 'side') === 'top' ? 'top' : 'side');
  const myTeam = (): 0 | 1 => (mine()[0] === 1 ? 1 : 0);

  function current(): BbState | null {
    if (!snaps.length) return latest;
    const delay = ctx.online ? 85 : 22;
    const t = performance.now() - delay;
    while (snaps.length > 2 && snaps[1].t <= t) snaps.shift();
    const [a, b] = snaps;
    if (!b || t <= a.t) return a.v;
    if (t >= b.t) return b.v;
    return mix(a.v, b.v, (t - a.t) / (b.t - a.t));
  }

  function press(seat: number, k: number) {
    const st = latest;
    if (!st || st.over || ctx.demo || !ctx.input) return;
    Sound.unlock();
    const cur = (inp[seat] ??= { k: -1, n: 0 });
    cur.k = k;
    cur.n++;
    send(seat, true);
  }

  function send(seat: number, force = false) {
    const cur = inp[seat];
    if (!cur || !ctx.input) return;
    if (spReq != null) cur.sp = spReq;
    const json = JSON.stringify(cur);
    const now = performance.now();
    const last = sent[seat];
    if (!force && last && last.json === json && now - last.at < 400) return;
    sent[seat] = { json, at: now };
    ctx.input(seat, cur);
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const st = current();
    if (!st) return;
    court.setCamera(camMode(), myTeam());
    court.update(st, held, mine().length ? myTeam() : -1);
    court.render();
    drawHud(latest ?? st);
    if (bannerT && performance.now() > bannerT) {
      banner.hidden = true;
      bannerT = 0;
    }
  }

  function drawHud(st: BbState) {
    const left = st.limit > 0 ? Math.max(0, st.limit - st.t) : st.t;
    const sec = Math.ceil(left);
    const time = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    // своя подсказка: номер лунки с мячом и «рука залипла»
    let tip = '';
    if (mine().length === 1 && st.hole >= 0) {
      const t = myTeam();
      tip = st.lock[t] > 0 ? '<span class="lock">рука залипла</span>' : `<span class="n n${t}">${labelOf(t, st.hole)}</span>`;
    }
    const html = `<b class="r">${st.score[0]}</b><span class="t">${time}</span><b class="b">${st.score[1]}</b>${tip}`;
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

  function sound(ev: BbEvent) {
    const o = audioOut();
    if (!o) return;
    const t = o.ctx.currentTime;
    if (ev.k === 'shot') {
      // щелчок катапульты: пружина и пластмасса
      click(t, { freq: 1700, q: 4, dur: 0.04, gain: 0.6 });
      tone(t, { freq: 320, to: 140, dur: 0.06, gain: 0.18, type: 'triangle' });
    } else if (ev.k === 'miss') {
      click(t, { freq: 1500, q: 4, dur: 0.03, gain: 0.25 });
    } else if (ev.k === 'floor') {
      const s = Math.min(1, ev.st / 1.2);
      click(t, { freq: 2200 + Math.random() * 600, q: 3, dur: 0.03, gain: 0.15 + 0.4 * s });
      tone(t, { freq: 600, to: 420, dur: 0.04, gain: 0.04 + 0.08 * s, type: 'triangle' });
    } else if (ev.k === 'dome') {
      // тонкий оргстекляный колпак: глухой «бом» с призвуком
      const s = Math.min(1, ev.st / 1.5);
      click(t, { freq: 900, q: 1.2, dur: 0.07, gain: 0.25 + 0.4 * s });
      tone(t, { freq: 210, to: 160, dur: 0.12, gain: 0.08 + 0.12 * s });
      tone(t, { freq: 1240, to: 1100, dur: 0.08, gain: 0.03 + 0.04 * s, type: 'sine' });
    } else if (ev.k === 'board') {
      click(t, { freq: 1100, q: 2, dur: 0.05, gain: 0.5 });
      tone(t, { freq: 260, to: 180, dur: 0.06, gain: 0.12 });
    } else if (ev.k === 'rim') {
      click(t, { freq: 3000, q: 6, dur: 0.03, gain: 0.4 });
      tone(t, { freq: 1900, to: 1700, dur: 0.06, gain: 0.05, type: 'triangle' });
    } else if (ev.k === 'score') {
      for (let i = 0; i < 5; i++) click(t + i * 0.025, { freq: 2500 + Math.random() * 1200, q: 2.5, dur: 0.03, gain: 0.2 });
      tone(t + 0.1, { freq: 784, dur: 0.1, gain: 0.08, type: 'square' });
      tone(t + 0.2, { freq: 1046, dur: 0.16, gain: 0.08, type: 'square' });
    } else if (ev.k === 'drop') whistle(t, 0.2);
    else if (ev.k === 'shake') {
      for (let i = 0; i < 3; i++) click(t + i * 0.05, { freq: 500 + Math.random() * 200, q: 1.5, dur: 0.05, gain: 0.35 });
    } else if (ev.k === 'end') whistle(t, 0.9);
  }

  function whistle(t: number, dur: number) {
    tone(t, { freq: 2900, to: 2750, dur, gain: 0.07, type: 'sine' });
    tone(t, { freq: 3020, to: 2880, dur, gain: 0.05, type: 'sine' });
  }

  // ---------------------------------------------------------------- управление

  /** Какой ряд клавиш чей: один за экраном — любые три ряда; двое — красные Q…P и цифры, синие Z…/. */
  function seatKey(code: string): [number, number] | null {
    const m = mine();
    if (!m.length) return null;
    const iq = ROW_Q.indexOf(code);
    const iz = ROW_Z.indexOf(code);
    const id = ROW_D.indexOf(code);
    if (!hotseat()) {
      const k = iz >= 0 ? iz : iq >= 0 ? iq : id;
      return k >= 0 ? [m[0], k] : null;
    }
    if (iq >= 0 || id >= 0) return [0, iq >= 0 ? iq : id];
    if (iz >= 0) return [1, iz];
    return null;
  }

  function onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.closest?.('input, textarea')) return;
    const sk = seatKey(e.code);
    if (!sk) return;
    e.preventDefault();
    const [seat, k] = sk;
    const team = seat as 0 | 1;
    if (!down) return void (held[team][k] = false);
    if (e.repeat || held[team][k]) return;
    held[team][k] = true;
    press(seat, k);
  }

  function onPointer(e: PointerEvent) {
    if (ctx.demo || !mine().length) return;
    const seat = mine()[0];
    const team = seat as 0 | 1;
    const p = court.pick(e.clientX, e.clientY, team);
    if (!p) return;
    e.preventDefault();
    const k = 'key' in p ? p.key : keyPos(labelOf(team, p.hole));
    held[team][k] = true;
    setTimeout(() => (held[team][k] = false), 140);
    press(seat, k);
  }

  function letters() {
    if (hotseat()) {
      court.setLetters(0, LET_Q);
      court.setLetters(1, LET_Z);
    } else if (mine().length) court.setLetters(myTeam(), LET_Z);
  }

  // ---------------------------------------------------------------- панель

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    box.innerHTML = '';
    box.appendChild(segRow('Вид', [['side', 'спереди'], ['top', 'сверху']], () => (store.get<string>(PREF_CAM, 'side') === 'top' ? 'top' : 'side'), (v) => store.set(PREF_CAM, v)));
    if (mine().length) {
      speedEl = speedRow(
        () => latest?.speed ?? 0.5,
        (v) => {
          spReq = v;
          mine().forEach((s) => {
            inp[s] ??= { k: -1, n: latest?.press[s as 0 | 1] ?? 0 };
            send(s, true);
          });
        }
      );
      box.appendChild(speedEl);
    }
    box.appendChild(h(`<div class="bb-hint">${hotseat() ? 'Красные — <kbd>Q</kbd>…<kbd>P</kbd>, синие — <kbd>Z</kbd>…<kbd>/</kbd>' : 'Клавиши <kbd>Z</kbd>…<kbd>/</kbd> = 1…0, или нажмите на лунку с мячом'}</div>`));
  }

  return {
    mount(el, c) {
      ctx = c;
      root = h(`<div class="bb-wrap"><div class="bb-3d"></div><div class="bb-hud"></div><div class="bb-banner" hidden></div></div>`);
      el.appendChild(root);
      hud = root.querySelector('.bb-hud') as HTMLElement;
      banner = root.querySelector('.bb-banner') as HTMLElement;
      court = new Court3D(root.querySelector('.bb-3d') as HTMLElement);
      const cv = court.canvas;
      cv.style.touchAction = 'none';
      const kd = (e: KeyboardEvent) => onKey(e, true);
      const ku = (e: KeyboardEvent) => onKey(e, false);
      const blur = () => held.forEach((r) => r.fill(false));
      window.addEventListener('keydown', kd);
      window.addEventListener('keyup', ku);
      window.addEventListener('blur', blur);
      cv.addEventListener('pointerdown', onPointer);
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
      // места этого экрана известны только к первому снимку — тогда и строим панель и подписи клавиш
      if (mine().join() !== seatsKey) {
        seatsKey = mine().join();
        controls();
        letters();
      }
      snaps = [{ t: performance.now(), v }];
      // счётчик нажатий — с комнаты (после возврата в партию не начинать с нуля)
      for (const s of mine()) inp[s] = { k: inp[s]?.k ?? -1, n: Math.max(inp[s]?.n ?? 0, v.press[s as 0 | 1]) };
      if (!v.over) banner.hidden = true;
      if (v.over) showBanner(v.score[0] === v.score[1] ? 'Ничья' : `Победили ${TEAM[v.score[0] > v.score[1] ? 0 : 1].toLowerCase()}`, `${v.score[0]} : ${v.score[1]}`, 0);
    },
    async play(_ev, v) {
      this.setView(v);
    },
    realtime(v, events) {
      if (latest && v.speed !== latest.speed) setTimeout(() => speedEl?.sync?.());
      latest = v;
      if (import.meta.env.DEV) (window as unknown as { __bbv: BbState }).__bbv = v;
      snaps.push({ t: performance.now(), v });
      if (snaps.length > 12) snaps.splice(0, snaps.length - 12);
      for (const ev of events) {
        sound(ev);
        if (ev.k === 'score') showBanner('Есть!', `+2 · ${TEAM[ev.team]} · ${ev.score[0]} : ${ev.score[1]}`);
        if (ev.k === 'end') showBanner('Финальный свисток', `${v.score[0]} : ${v.score[1]}`, 0);
      }
    },
    setTurn() {},
    status(v) {
      if (!v) return '';
      return `${TEAM[0]} ${v.score[0]} : ${v.score[1]} ${TEAM[1]}`;
    },
    playerStats(v, seat) {
      return v ? `очков: <b>${v.score[seat] ?? 0}</b>` : '';
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      court?.dispose();
      root?.remove();
    },
  };
}
