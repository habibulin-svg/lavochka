/* Brick Game E-23 Plus Mark II «96 in 1» — настоящая прошивка (эмулятор HT1190). Корпус — картинка пользователя
 * в сером пластике, низ с логотипом срезан (экран крупнее); кнопки — колпачки, которые уходят в корпус при нажатии.
 * Экран — SVG из MAME поверх серо-зелёного ЖК. У E-23 нет «вверх»: верхняя кнопка крестовины — тоже поворот.
 * Клавиатура: ← → ↓, ↑/W или X — поворот, Пробел — уронить фигуру, Enter/P — старт/пауза, M — звук, O — вкл/выкл.
 * «Пауза» в карточке замораживает сам эмулятор, «Старт» — нажимает START на корпусе.
 * «Уронить» у E-23 нет: держим «вниз» и гоним прибор в 10 раз быстрее, пока фигура не ляжет — это видно по экрану
 * (сменилась фигура в NEXT или наверху стакана появилась новая). */
import { Beeper } from '../../arcade/beeper';
import { HT_CLOCK } from '../../arcade/ht1190';
import type { ArcadeInstance, ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { store } from '../../core/settings';
import { BrickMachine, KEYS, segIndex, type BrickKey } from './machine';
import type { HtState } from '../../arcade/ht1190';
import './brick.css';

const BASE = `${import.meta.env.BASE_URL}brick/`;
const SAVE = 'brick.e23';
/** Какая игра из списка выставлена на приборе (выбор в карточке листает меню, только если игра сменилась). */
const PICKED = 'brick.e23.game';

/** Основные игры и их номер в меню прибора. Номера идут восьмёрками: четыре тетриса (1 и 3 — обычные фигуры,
 *  2 и 4 — ещё и из 2, 3, 5 клеток), «мяч и ракетка», «сбей стену», два варианта «рядов сверху»; «96 in 1» —
 *  двенадцать таких восьмёрок. */
const GAMES: { id: string; label: string; hint: string; num: number }[] = [
  { id: 'e23', label: 'Тетрис', hint: '№ 01', num: 1 },
  { id: 'odd', label: 'Тетрис: чудные фигуры', hint: '№ 02, из 2–5 клеток', num: 2 },
  { id: 'ball', label: 'Мяч и ракетка', hint: '№ 05', num: 5 },
  { id: 'wall', label: 'Сбей стену', hint: '№ 06, пушка снизу', num: 6 },
  { id: 'rows', label: 'Ряды сверху', hint: '№ 07, пушка снизу', num: 7 },
];

/** Клавиша → кнопка на корпусе (номер в BUTTONS). */
const KEYMAP: Record<string, number> = {
  enter: 0,
  p: 0,
  m: 1,
  o: 2,
  arrowup: 4,
  w: 4,
  arrowleft: 5,
  a: 5,
  arrowright: 6,
  d: 6,
  arrowdown: 7,
  s: 7,
  x: 8,
};

/* Корпус — картинка пользователя, перекрашенная в серый (tools/brick/case.py), 488×940 в координатах исходника. */
const W = 488;
const H = 940;
/** ЖК: окно в корпусе; экран MAME 158.26×226.36 вписан по высоте. */
const LCD = { x: 128.5, y: 72, w: 231, h: 330.5 };

type Btn = { k: BrickKey | 'reset'; x: number; y: number; r: number };
const BUTTONS: Btn[] = [
  { k: 'start', x: 135, y: 621, r: 15 },
  { k: 'mute', x: 210, y: 621, r: 15 },
  { k: 'power', x: 286, y: 621, r: 15 },
  { k: 'reset', x: 362, y: 621, r: 15 },
  { k: 'rotate', x: 132, y: 724, r: 35 },
  { k: 'left', x: 68, y: 792, r: 35 },
  { k: 'right', x: 197, y: 792, r: 35 },
  { k: 'down', x: 132, y: 852, r: 35 },
  { k: 'rotate', x: 390, y: 785, r: 55 },
];

/** Подписи — как у E-23 (у картинки «9999 in 1» кнопки подписаны иначе). */
const LABELS = `<svg class="brk-labels" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <g class="brk-l-s"><text x="135" y="652">START/PAUSE</text><text x="210" y="652">SOUND</text><text x="286" y="652">ON/OFF</text><text x="362" y="652">RESET</text></g>
  <g class="brk-l"><text x="174" y="729" class="st">ROTATE</text>
  <text x="66" y="846">LEFT</text><text x="66" y="859" class="sm">LEVEL</text>
  <text x="199" y="846">RIGHT</text><text x="199" y="859" class="sm">SPEED</text>
  <text x="133" y="904">DOWN</text><text x="133" y="917" class="sm">MODE</text>
  <text x="388" y="866">ROTATE</text><text x="388" y="883">DIRECTION</text></g>
</svg>`;

const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

function buttonHtml(b: Btn, i: number): string {
  const d = b.r * 2;
  const x0 = b.x - b.r;
  const y0 = b.y - b.r;
  // колпачок — тот же кусок картинки, что под ним: при нажатии он уходит вниз и чуть меньше
  const cap = `background-image:url(${BASE}case.webp);background-size:${((W / d) * 100).toFixed(2)}% ${((H / d) * 100).toFixed(2)}%;background-position:${((x0 / (W - d)) * 100).toFixed(3)}% ${((y0 / (H - d)) * 100).toFixed(3)}%`;
  return `<div class="brk-b${b.r > 40 ? ' big' : b.r < 20 ? ' small' : ''}" data-i="${i}" style="left:${pct(x0, W)};top:${pct(y0, H)};width:${pct(d, W)};height:${pct(d, H)}"><div class="brk-cap" style="${cap}"></div></div>`;
}

/** Выставить в меню игру № num, как руками: сброс, дождаться меню, num−1 раз «DOWN» (с паузой: пока прибор рисует
 *  номер, нажатия теряются). Прибор гоняем без звука — это доли секунды. */
function pick(m: BrickMachine, num: number) {
  const run = (sec: number) => m.run(Math.round(sec * HT_CLOCK));
  (Object.keys(KEYS) as BrickKey[]).forEach((k) => m.set(k, false));
  m.cpu.reset();
  run(8);
  for (let i = 1; i < num; i++) {
    m.set('down', true);
    run(0.15);
    m.set('down', false);
    run(2);
  }
}

function mount(root: HTMLElement, opts?: ArcadeOpts): ArcadeInstance {
  const wrap = document.createElement('div');
  wrap.className = 'brk';
  // корпус двумя кусками: верх с экраном и низ с кнопками (на компьютере низ — без широкой полосы и вдвое мельче, см. brick.css);
  // в каждом куске — слой во весь корпус, так что координаты кнопок и экрана прежние
  wrap.innerHTML = `<div class="brk-unit"><div class="brk-top"><div class="brk-layer"><img class="brk-case" alt="" src="${BASE}case.webp"><div class="brk-lcd" style="left:${pct(LCD.x, W)};top:${pct(LCD.y, H)};width:${pct(LCD.w, W)};height:${pct(LCD.h, H)}"></div></div></div><div class="brk-bot"><div class="brk-botin"><div class="brk-layer"><img class="brk-case" alt="" src="${BASE}case.webp">${LABELS}${BUTTONS.map(buttonHtml).join('')}</div></div></div></div>`;
  root.appendChild(wrap);
  const lcd = wrap.querySelector('.brk-lcd') as HTMLElement;
  const info = document.createElement('p');
  info.innerHTML = `Игра выбирается в списке ниже — прибор сам выставит её номер. До старта: <b>LEFT/RIGHT</b> — уровень и скорость, <b>ROTATE</b> — направление. «Старт» — кнопка START на корпусе (в игре она же — пауза прибора).`;
  opts?.panel?.appendChild(info);

  let dead = false;
  let paused = false;
  let raf = 0;
  let machine: BrickMachine | null = null;
  let beeper: Beeper | null = null;
  const segEls: Element[][] = Array.from({ length: 8 * 40 }, () => []);
  const shown = new Uint8Array(8 * 40);
  const held = new Map<BrickKey, number>();
  const downAt = new Map<BrickKey, number>();
  const pending = new Set<BrickKey>();
  const MIN_HOLD = HT_CLOCK * 0.06;

  const save = () => {
    if (machine) store.set(SAVE, machine.save());
  };
  const btnEls = [...wrap.querySelectorAll<HTMLElement>('.brk-b')];
  const btnDown = new Array<number>(BUTTONS.length).fill(0); // сколько источников держат кнопку (клавиша, палец)
  /** Кнопка i нажата/отпущена: колпачок уходит вниз, а прибору — его вывод (у «поворота» две кнопки на один вывод). */
  const pressBtn = (i: number, down: boolean) => {
    btnDown[i] = Math.max(0, btnDown[i] + (down ? 1 : -1));
    btnEls[i].classList.toggle('down', btnDown[i] > 0);
    const k = BUTTONS[i].k;
    if (k === 'reset') {
      if (down) {
        machine?.cpu.reset();
        store.set(PICKED, null);
        save();
      }
      return;
    }
    press(k, down);
  };
  const press = (k: BrickKey, down: boolean) => {
    const n = Math.max(0, (held.get(k) ?? 0) + (down ? 1 : -1));
    held.set(k, n);
    if (!machine) return;
    if (n > 0) {
      pending.delete(k);
      downAt.set(k, machine.clocks);
      machine.set(k, true);
    } else if (machine.clocks - (downAt.get(k) ?? -Infinity) < MIN_HOLD) pending.add(k);
    else machine.set(k, false);
  };
  // ---- пробел: уронить фигуру
  const DOWN_BTN = 7;
  let nextCells: number[] = []; // сегменты окошка NEXT
  let topCells: number[] = []; // две верхние строки стакана
  let drop: { t0: number; next: string; left: boolean } | null = null;
  const sig = (cells: number[]) => cells.map((i) => machine?.lit[i] ?? 0).join('');
  // «вниз» у E-23 роняет не быстрее ~8 строк в секунду (и стук не помогает): держим «вниз» и крутим прибор в TURBO раз быстрее
  const TURBO = 25;
  const startDrop = () => {
    if (drop || !machine) return;
    if (!topCells.length) findCells();
    drop = { t0: performance.now(), next: sig(nextCells), left: false };
    btnEls[DOWN_BTN].classList.add('down');
    machine.set('down', true);
  };
  const endDrop = () => {
    if (!drop) return;
    drop = null;
    btnEls[DOWN_BTN].classList.toggle('down', btnDown[DOWN_BTN] > 0);
    machine?.set('down', (held.get('down') ?? 0) > 0);
  };
  /** Легла ли фигура: сменилась следующая в NEXT или наверху стакана появилась новая. */
  const watchDrop = (t: number) => {
    if (!drop || !machine) return;
    const top = topCells.some((i) => machine!.lit[i]);
    if (!top) drop.left = true;
    if (sig(nextCells) !== drop.next || (drop.left && top) || t - drop.t0 > 1500) endDrop();
  };

  const keysDown = new Set<string>();
  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === ' ') {
      e.preventDefault();
      if (down && !e.repeat) startDrop();
      return;
    }
    const i = KEYMAP[key];
    if (i == null) return;
    e.preventDefault();
    if (down === keysDown.has(key)) return;
    if (down) keysDown.add(key);
    else keysDown.delete(key);
    pressBtn(i, down);
  };
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  const releaseAll = () => {
    drop = null;
    pending.clear();
    keysDown.clear();
    btnDown.fill(0);
    btnEls.forEach((el) => el.classList.remove('down'));
    for (const k of held.keys()) {
      held.set(k, 0);
      machine?.set(k, false);
    }
  };
  const onHide = () => {
    if (document.hidden) {
      releaseAll();
      save();
    }
  };
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', save);

  btnEls.forEach((el, i) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      pressBtn(i, true);
      const up = () => {
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        pressBtn(i, false);
      };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  /** Где на экране стакан 10×20 и окошко NEXT 4×4: по рамке стакана (прямоугольник без data-s) и квадратным клеткам.
   *  Меряем в координатах экрана — у групп сегментов свои сдвиги. */
  const findCells = () => {
    const frameEl = lcd.querySelector('svg rect:not([data-s])');
    if (!frameEl) return;
    const f = frameEl.getBoundingClientRect();
    if (!f.height) return;
    const rowH = f.height / 20;
    const cells: { i: number; x: number; y: number; w: number; h: number }[] = [];
    lcd.querySelectorAll('[data-s]').forEach((el) => {
      const [c, s2] = (el.getAttribute('data-s') ?? '').split('.').map(Number);
      const b = el.getBoundingClientRect();
      cells.push({ i: segIndex(c, s2), x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height });
    });
    const inField = cells.filter((c) => c.x > f.left && c.x < f.right && c.y > f.top && c.y < f.bottom);
    topCells = inField.filter((c) => c.y < f.top + rowH * 2).map((c) => c.i);
    const cw = inField.length ? inField.reduce((a, c) => a + c.w, 0) / inField.length : rowH;
    const sq = (v: number) => Math.abs(v - cw) < cw * 0.2;
    nextCells = cells.filter((c) => c.x > f.right && c.y < f.top + f.height * 0.4 && sq(c.w) && sq(c.h)).map((c) => c.i);
  };

  void (async () => {
    const [rom, mel, svg] = await Promise.all([
      fetch(BASE + 'rom.bin').then((r) => r.arrayBuffer()),
      fetch(BASE + 'melody.bin').then((r) => r.arrayBuffer()),
      fetch(BASE + 'screen.svg').then((r) => r.text()),
    ]).catch((e) => {
      console.error(e);
      lcd.textContent = 'Не загрузилось';
      return [null, null, null] as const;
    });
    if (dead || !rom || !mel || !svg) return;
    lcd.innerHTML = svg;
    lcd.querySelectorAll('[data-s]').forEach((el) => {
      const [c, s] = (el.getAttribute('data-s') ?? '').split('.').map(Number);
      if (c < 8 && s < 40) segEls[segIndex(c, s)].push(el);
    });
    findCells();
    machine = new BrickMachine(new Uint8Array(rom), new Uint8Array(mel));
    const saved = store.get<HtState | null>(SAVE, null);
    if (saved) {
      try {
        machine.load(saved);
      } catch (e) {
        console.warn('brick: сохранение не подошло', e);
      }
    }
    const game = GAMES.find((g) => g.id === opts?.mode);
    if (game && store.get<string | null>(PICKED, null) !== game.id) {
      pick(machine, game.num);
      store.set(PICKED, game.id);
      save();
    }
    beeper = new Beeper(HT_CLOCK, 0.16);

    let last = performance.now();
    let carry = 0;
    let saveAt = last + 5000;
    const frame = (t: number) => {
      if (dead || !machine) return;
      const dt = paused ? 0 : Math.min(100, t - last);
      last = t;
      const want = (dt * HT_CLOCK) / 1000 + carry;
      const n = Math.floor(want);
      if (n > 0) {
        const buf = new Float32Array(n + 8);
        const done = machine.run(n, buf);
        carry = want - done;
        if (beeper?.live) beeper.push(buf.slice(0, done));
        // уронить: догоняем прибор ускоренно кусками по кадру, пока фигура не ляжет (звук на это время молчит)
        for (let j = 1; j < TURBO && drop; j++) {
          machine.run(n);
          watchDrop(t);
        }
        // пауза после стартовой мелодии — тишина и замершая фигура на 11 с: проматываем
        for (let j = 1; j < TURBO && machine.idleWait; j++) machine.run(n);
        watchDrop(t);
        for (const k of pending)
          if (machine.clocks - (downAt.get(k) ?? 0) >= MIN_HOLD) {
            machine.set(k, false);
            pending.delete(k);
          }
      } else carry = want;
      const lit = machine.lit;
      for (let i = 0; i < lit.length; i++) {
        if (lit[i] === shown[i]) continue;
        shown[i] = lit[i];
        for (const el of segEls[i]) el.classList.toggle('on', !!lit[i]);
      }
      if (t > saveAt) {
        saveAt = t + 5000;
        save();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  })();

  return {
    pause(on) {
      paused = on;
      if (on) {
        releaseAll();
        save();
      }
    },
    /** «Старт» — короткое нажатие START на корпусе. */
    launch() {
      pressBtn(0, true);
      pressBtn(0, false);
    },
    destroy() {
      save();
      info.remove();
      dead = true;
      cancelAnimationFrame(raf);
      beeper?.close();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', save);
      wrap.remove();
    },
  };
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'brick',
  title: 'Brick Game',
  about: 'Тот самый «тетрис» E-23 Plus Mark II «96 in 1» — настоящая прошивка: тетрис, мяч и ракетка, стрелялки по стене и рядам.',
  controls: `<p>Мышью или пальцем — по кнопкам на корпусе.</p>
    <p><kbd>←</kbd> <kbd>→</kbd> <kbd>↓</kbd> — влево, вправо, вниз; <kbd>↑</kbd> или <kbd>X</kbd> — поворот; <kbd>Пробел</kbd> — уронить фигуру.</p>
    <p><kbd>Enter</kbd> — старт/пауза, <kbd>M</kbd> — звук, <kbd>O</kbd> — вкл/выкл.</p>
    <p>До старта: ← → — уровень и скорость, ↓ — номер игры (основные — в списке выше).</p>
    <p>Игрушка не выключается: рекорд и выбранная игра сохраняются.</p>`,
  modes: GAMES.map((g) => ({ id: g.id, label: g.label, hint: g.hint })),
  list: true,
  starts: [{ id: 'start', label: 'Старт' }],
  noRecords: true,
  mount: (root, opts) => mount(root, opts),
};

export default mod;
