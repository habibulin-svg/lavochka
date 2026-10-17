/* Автомат «15 копеек»: общий советский корпус — табло с названием, кинескоп за стеклом, пульт с ручкой и двумя
 * кнопками, монетоприёмник. Внутри — эмуляция платы по образам MAME. Монету бросает пробел (или щелчок по щели);
 * пока игра идёт или автомат грузится, монетоприёмник закрыт — монета звякает в лоток возврата. */
import { Beeper } from '../../arcade/beeper';
import type { ArcadeMachine, MachineInput as TiaInput } from '../../arcade/machine';
import { Photon } from '../../arcade/photon';
import { Photon2 } from '../../arcade/photon2';
import { TiaMc1 } from '../../arcade/tiamc1';
import { audioOut, click, tone } from '../../core/audio';
import type { ArcadeInstance, ArcadeOpts } from '../../core/arcade';
import { esc } from '../../core/util';
import { coinMode, DAILY, giveBack, pocket, setCoinMode, takeCoin, type CoinMode } from './coins';
import type { AutoGame } from './games';
import './avtomaty.css';

/** Сколько держим датчик монеты (секунд эмулируемого времени). */
const COIN_HOLD_S = 0.1;

/** Время звука через d секунд (звук выключен — щелчки сами промолчат). */
const at = (d = 0) => (audioOut()?.ctx.currentTime ?? 0) + d;

const KEYS: Record<string, TiaInput> = {
  arrowleft: 'left',
  a: 'left',
  ф: 'left',
  arrowright: 'right',
  d: 'right',
  в: 'right',
  arrowup: 'up',
  w: 'up',
  ц: 'up',
  arrowdown: 'down',
  s: 'down',
  ы: 'down',
  z: 'b1',
  я: 'b1',
  control: 'b1',
  x: 'b2',
  ч: 'b2',
  shift: 'b2',
};

/* Разметка корпуса (tools/avtomaty/cabinet.py → public/avtomaty/cab/layout.json): рамка 846×803, стекло и табличка;
 * пульт 1080×250 — две кнопки, место ручки, окно монетоприёмника. */
const BZ = { w: 846, h: 803, glass: [141, 60, 723, 505], plate: [120, 626, 761, 736] };
const DK = { w: 1080, h: 250, buttons: [[190, 60, 46], [357, 55, 46]], stick: [458, 82], coin: [975, 195, 44] };
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
const rect = (r: number[], w: number, h: number) => `left:${pc(r[0], w)};top:${pc(r[1], h)};width:${pc(r[2] - r[0], w)};height:${pc(r[3] - r[1], h)}`;
const circ = (x: number, y: number, r: number) => rect([x - r, y - r, x + r, y + r], DK.w, DK.h);

function makeMachine(kind: AutoGame['kind'], img: Uint8Array): ArcadeMachine {
  if (kind === 'photon') return new Photon(img);
  if (kind === 'photon2') return new Photon2(img);
  if (kind === 'morboy' || kind === 'magistral') throw new Error('«Морской бой» — не плата, у него свой вид');
  return new TiaMc1(img, kind);
}

export function mountAuto(game: AutoGame, root: HTMLElement, opts?: ArcadeOpts): ArcadeInstance {
  const wrap = document.createElement('div');
  wrap.className = 'avt';
  const cab = `${import.meta.env.BASE_URL}avtomaty/cab/`;
  const btn = (k: 'b1' | 'b2', i: number) => {
    const [x, y, r] = DK.buttons[i];
    const name = k === 'b1' ? game.b1 : game.b2;
    const keys = k === 'b1' ? 'Z или Ctrl' : 'X или Shift';
    // кнопка — кружок из того же снимка: при нажатии он проседает
    return `<button class="avt-btn" data-b="${k}" style="${circ(x, y, r)}" title="${esc(name ?? 'кнопка')}: ${keys}">
      <img alt="" src="${cab}deck.webp" style="width:${((DK.w / (2 * r)) * 100).toFixed(2)}%;left:${(-((x - r) / (2 * r)) * 100).toFixed(2)}%;top:${(-((y - r) / (2 * r)) * 100).toFixed(2)}%"></button>`;
  };
  const [sx, sy] = DK.stick;
  const [cx, cy, cr] = DK.coin;
  wrap.innerHTML = `<div class="avt-cab">
      <div class="avt-top">
        <div class="avt-crt" style="${rect(BZ.glass, BZ.w, BZ.h)}">
          <div class="avt-pic"><canvas></canvas><div class="avt-scan"></div></div><div class="avt-glass"></div>
        </div>
        <img class="avt-bezel" alt="" src="${cab}${game.plate === 'photo' ? 'bezel-konek' : 'bezel'}.webp">
        ${game.plate === 'photo' ? '' : `<div class="avt-plate" style="${rect(BZ.plate, BZ.w, BZ.h)}"><div class="avt-plate-in">
          <b>Правила игры «${esc(game.title.toUpperCase())}»</b>
          <ol>${(game.rules ?? [game.about]).map((r) => `<li>${esc(r)}</li>`).join('')}</ol></div></div>`}
        <div class="avt-msg" hidden></div>
      </div>
      <div class="avt-deck">
        <img class="avt-deck-img" alt="" src="${cab}deck.webp">
        ${btn('b1', 0)}${btn('b2', 1)}
        <div class="avt-stick" style="left:${pc(sx, DK.w)};top:${pc(sy, DK.h)}" title="Ручка: стрелки или WASD"><i class="avt-base"></i><i class="avt-rod"></i><i class="avt-ball"></i></div>
        <button class="avt-slot" style="${circ(cx, cy, cr)}" title="Бросить монету 15 коп.: пробел"><i></i></button>
      </div>
    </div>`;
  root.appendChild(wrap);
  // текст таблички — как можно крупнее, но чтобы влез целиком
  const plate = wrap.querySelector('.avt-plate-in') as HTMLElement | null;
  const fitPlate = () => {
    if (!plate) return;
    const box = plate.parentElement!;
    const cs = getComputedStyle(box);
    const h = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    let fs = h / 5.2;
    plate.style.fontSize = `${fs}px`;
    while (fs > 4 && (plate.scrollHeight > h || plate.scrollWidth > w + 1)) {
      fs *= 0.94;
      plate.style.fontSize = `${fs}px`;
    }
  };
  const ro = new ResizeObserver(fitPlate);
  if (plate) ro.observe(plate.parentElement!);
  void document.fonts?.ready.then(fitPlate);
  const q = <T extends HTMLElement>(s: string) => wrap.querySelector(s) as T;
  const canvas = q<HTMLCanvasElement>('canvas');
  const ctx = canvas.getContext('2d')!;
  const msg = q('.avt-msg');
  const stickEl = q('.avt-stick');
  const slot = q('.avt-slot');

  // ---- карточка справа: монеты, карман, сброс
  const info = document.createElement('div');
  info.className = 'avt-info';
  info.innerHTML = `<p><b>${esc(game.title)}</b> <small>(${esc(game.board)})</small>. ${esc(game.about)}</p>
    <div class="seg avt-mode">
      <button data-m="strict" title="Рубль на день — шесть монет; кончились — приходите завтра">Строго: рубль в день</button>
      <button data-m="free" title="Монета всегда найдётся">Бесконечные монетки</button>
    </div>
    <div class="avt-pocket"></div>
    <button class="btn small" data-a="reset" title="Выключить и включить автомат">Сброс</button>`;
  opts?.panel?.appendChild(info);
  const pocketEl = info.querySelector('.avt-pocket') as HTMLElement;
  const drawPocket = () => {
    const p = pocket();
    const strict = coinMode() === 'strict';
    info.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === coinMode()));
    pocketEl.innerHTML = strict
      ? `<span class="avt-coins">${Array.from({ length: DAILY }, (_, i) => `<i class="${i < p.left ? '' : 'gone'}"></i>`).join('')}</span>
         ${p.left ? `В кармане ${p.left} × 15 коп.` : 'Монеты кончились — приходите завтра.'}`
      : `<span class="avt-coins"><i></i><i></i><i></i></span> Монет сколько угодно. Сегодня брошено: ${p.played}.`;
  };
  info.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => {
    b.onclick = () => {
      setCoinMode(b.dataset.m as CoinMode);
      drawPocket();
    };
  });
  drawPocket();

  let dead = false;
  let paused = false;
  let raf = 0;
  let machine: ArcadeMachine | null = null;
  let beeper: Beeper | null = null;
  let coinLeft = 0;
  let msgTimer = 0;

  const say = (text: string, ms = 2200) => {
    msg.textContent = text;
    msg.hidden = false;
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => (msg.hidden = true), ms);
  };

  // ---- монета
  const insertCoin = () => {
    if (!machine || paused) return;
    if (!takeCoin()) {
      say('Монеты кончились. Завтра будет ещё рубль.', 3000);
      tone(at(), { freq: 140, dur: 0.25, gain: 0.2, type: 'square' });
      drawPocket();
      return;
    }
    slot.classList.remove('drop');
    void slot.offsetWidth;
    slot.classList.add('drop');
    if (machine.coinLocked) {
      // приёмник закрыт — монета прокатилась в лоток возврата
      giveBack();
      click(at(0.35), { freq: 3800, q: 8, dur: 0.05, gain: 0.35 });
      click(at(0.44), { freq: 4200, q: 8, dur: 0.04, gain: 0.25 });
      say('Автомат монету не взял — звякнула в лоток возврата.');
    } else {
      click(at(0.3), { freq: 1600, q: 2, dur: 0.08, gain: 0.5 });
      coinLeft = machine.cpuHz * COIN_HOLD_S;
    }
    drawPocket();
  };
  slot.onclick = insertCoin;

  // ---- ручка и кнопки: клавиши, мышь, палец
  const held = new Map<TiaInput, number>();
  // игра опрашивает кнопки раз в кадр: короткий тап держим хотя бы MIN_HOLD мс
  const MIN_HOLD = 90;
  const downAt = new Map<TiaInput, number>();
  const press = (k: TiaInput, down: boolean) => {
    const n = Math.max(0, (held.get(k) ?? 0) + (down ? 1 : -1));
    held.set(k, n);
    if (n > 0) downAt.set(k, performance.now());
    const since = performance.now() - (downAt.get(k) ?? 0);
    if (n === 0 && since < MIN_HOLD) setTimeout(() => (held.get(k) ?? 0) === 0 && machine?.set(k, false), MIN_HOLD - since);
    else machine?.set(k, n > 0);
    if (k === 'b1' || k === 'b2') wrap.querySelector(`[data-b=${k}]`)?.classList.toggle('down', n > 0);
    tiltStick();
  };
  const tiltStick = () => {
    const on = (k: TiaInput) => (held.get(k) ?? 0) > 0;
    const x = (on('right') ? 1 : 0) - (on('left') ? 1 : 0);
    const y = (on('down') ? 1 : 0) - (on('up') ? 1 : 0);
    stickEl.style.setProperty('--tx', String(x));
    stickEl.style.setProperty('--ty', String(game.joy === 'paddle' ? 0 : y));
  };
  const keysDown = new Set<string>();
  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      if (down && !e.repeat) insertCoin();
      return;
    }
    const inp = KEYS[k];
    if (!inp) return;
    e.preventDefault();
    if (down === keysDown.has(k)) return;
    if (down) keysDown.add(k);
    else keysDown.delete(k);
    press(inp, down);
  };
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  const releaseAll = () => {
    keysDown.clear();
    for (const k of held.keys()) {
      held.set(k, 0);
      machine?.set(k, false);
    }
    wrap.querySelectorAll('.avt-btn.down').forEach((b) => b.classList.remove('down'));
    tiltStick();
  };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', releaseAll);

  wrap.querySelectorAll<HTMLElement>('[data-b]').forEach((el) => {
    const k = el.dataset.b as TiaInput;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      press(k, true);
      const up = () => {
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        press(k, false);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // ручка пальцем: наклон в сторону от центра шарика
  const dirs = new Set<TiaInput>();
  const setDirs = (next: Set<TiaInput>) => {
    for (const d of dirs) if (!next.has(d)) press(d, false);
    for (const d of next) if (!dirs.has(d)) press(d, true);
    dirs.clear();
    next.forEach((d) => dirs.add(d));
  };
  stickEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stickEl.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = stickEl.getBoundingClientRect();
      const dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
      const dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const s = new Set<TiaInput>();
      if (dx < -0.3) s.add('left');
      if (dx > 0.3) s.add('right');
      if (game.joy === 'xy') {
        if (dy < -0.3) s.add('up');
        if (dy > 0.3) s.add('down');
      }
      setDirs(s);
    };
    const up = () => {
      stickEl.removeEventListener('pointermove', move);
      stickEl.removeEventListener('pointerup', up);
      stickEl.removeEventListener('pointercancel', up);
      setDirs(new Set());
    };
    move(e);
    stickEl.addEventListener('pointermove', move);
    stickEl.addEventListener('pointerup', up);
    stickEl.addEventListener('pointercancel', up);
  });

  (info.querySelector('[data-a=reset]') as HTMLButtonElement).onclick = () => {
    machine?.reset();
    say('Автомат перезапущен.');
  };

  void (async () => {
    const img = await fetch(`${import.meta.env.BASE_URL}avtomaty/${game.id}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .catch((e) => {
        console.error(e);
        say('Не загрузилось — проверьте связь и откройте ещё раз.', 1e9);
        return null;
      });
    if (dead || !img) return;
    const m = makeMachine(game.kind, new Uint8Array(img));
    machine = m;
    beeper = new Beeper(m.cpuHz / m.audioDiv, 0.3);
    canvas.width = m.width;
    canvas.height = m.height;
    const image = new ImageData(new Uint8ClampedArray(m.frame.buffer as ArrayBuffer), m.width, m.height);

    let last = performance.now();
    let carry = 0;
    const frame = (t: number) => {
      if (dead || !machine) return;
      const dt = paused ? 0 : Math.min(100, t - last);
      last = t;
      // поворотная ручка «Городков»: держим стрелку — ручка крутится (96…208, у MAME наоборот)
      if (game.joy === 'paddle' && !paused) {
        const on = (k: TiaInput) => (held.get(k) ?? 0) > 0;
        const v = (on('left') ? 1 : 0) - (on('right') ? 1 : 0);
        machine.stick = Math.max(96, Math.min(208, (machine.stick ?? 152) + v * dt * 0.12));
      }
      const want = (dt * m.cpuHz) / 1000 + carry;
      if (want >= 1) {
        const n = Math.floor(want);
        if (coinLeft > 0) {
          machine.set('coin', true);
          coinLeft -= n;
        } else machine.set('coin', false);
        const buf = beeper?.live ? new Float32Array(Math.ceil(n / m.audioDiv) + 64) : null;
        const before = machine.cpu.cycles;
        const got = machine.run(n, buf);
        carry = want - (machine.cpu.cycles - before);
        if (buf) beeper!.push(buf.slice(0, got));
        ctx.putImageData(image, 0, 0);
      } else carry = want;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  })();

  return {
    pause(on) {
      paused = on;
      if (on) releaseAll();
    },
    launch() {
      insertCoin();
    },
    destroy() {
      dead = true;
      ro.disconnect();
      clearTimeout(msgTimer);
      cancelAnimationFrame(raf);
      beeper?.close();
      info.remove();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', releaseAll);
      wrap.remove();
    },
  };
}

