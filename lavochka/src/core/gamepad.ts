/* Геймпады (XInput и любые со «стандартной» раскладкой) через Gamepad API.
 *
 * Два слоя:
 * 1. Навигация — сама, во всех играх и меню: крестовина/левый стик водят рамку по кнопкам и клеткам экрана,
 *    A — нажать, B — назад (Esc), X — главная кнопка хода (пробел), Y/Back — справка «?», Start — меню паузы,
 *    правый стик — прокрутка, нажатие левого стика — курсор-мышь (для полей на холсте и перетаскивания).
 * 2. Игра — экшен-игра захватывает пад (`claimPad`): кнопки и стики превращаются в её клавиши (раскладка у каждой
 *    своя, у второго пада — клавиши второго игрока), а аналоговые значения доступны каждый кадр (`frame`, `padAxis`).
 *    Пока открыто окно (пауза, итоги), захват спит и работает навигация. Start — всегда меню паузы.
 *
 * Без геймпада модуль ничего не делает: опрос идёт, только пока подключён хотя бы один пад. */

export type PadButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'back' | 'start' | 'ls' | 'rs' | 'up' | 'down' | 'left' | 'right';
/** Номера кнопок в стандартной раскладке (w3c gamepad, «standard» mapping) — у XInput-падов они такие всегда. */
const STD: PadButton[] = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'ls', 'rs', 'up', 'down', 'left', 'right'];

export interface PadSnap {
  /** Порядковый номер среди подключённых (0 — первый игрок). */
  n: number;
  id: string;
  /** Нажатость 0..1 (курки — аналоговые). */
  v: Record<PadButton, number>;
  /** Стики с мёртвой зоной: x вправо, y вниз, −1..1. */
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

export interface PadFrame {
  pads: PadSnap[];
  /** Кнопка нажата в этом кадре. */
  pressed(b: PadButton, pad?: number): boolean;
  released(b: PadButton, pad?: number): boolean;
  held(b: PadButton, pad?: number): boolean;
  /** Секунды с прошлого кадра. */
  dt: number;
}

/** Раскладка одного пада: куда идут стик и кнопки (значения — `KeyboardEvent.code`). */
export interface PadMap {
  /** Левый стик и крестовина: 'arrows' (по умолчанию), 'wasd', свои четыре клавиши [вверх, вниз, влево, вправо] или null — никуда. */
  move?: 'arrows' | 'wasd' | [string, string, string, string] | null;
  /** Левый стик не превращать в клавиши (игра читает его сама через `padAxis`), крестовина — по-прежнему клавишами. */
  analog?: boolean;
  /** Правый стик — так же (по умолчанию никуда). */
  move2?: 'arrows' | 'wasd' | [string, string, string, string] | null;
  /** Кнопки → клавиши. Start занят меню паузы. */
  keys?: Partial<Record<Exclude<PadButton, 'start'>, string>>;
}

export interface PadClaim {
  /** Раскладка; массив — у каждого пада своя (второй игрок за одной клавиатурой), лишним падам — последняя. */
  map?: PadMap | PadMap[] | (() => PadMap | PadMap[]);
  /** Каждый кадр, пока захват действует: аналоговое управление. */
  frame?(f: PadFrame): void;
  /** Подсказка внизу экрана, что где («Ⓐ бросок · стик — прицел»). */
  hint?: string;
}

const DEAD = 0.22;
const ON = 0.55;
const OFF = 0.35;
const NAV_DELAY = 380;
const NAV_REPEAT = 130;
const KEY_DELAY = 400;
const KEY_REPEAT = 50;

let started = false;
let raf = 0;
let last = 0;
let prev: PadSnap[] = [];
let cur: PadSnap[] = [];
let active = false; // пад трогали после последнего движения мышью
let lastModal = false;
let navMode = false;
let inGame = false;
const blocked = new Set<string>();
const claims: PadClaim[] = [];

/** Включить слежение за падами (один раз из main). */
export function initGamepad() {
  if (started || typeof window === 'undefined' || !('getGamepads' in navigator)) return;
  started = true;
  window.addEventListener('gamepadconnected', (e) => {
    if ((e as GamepadEvent).gamepad.mapping === 'standard' || (e as GamepadEvent).gamepad.buttons.length >= 16) note(`🎮 Геймпад подключён`);
    loop();
  });
  window.addEventListener('gamepaddisconnected', () => note('🎮 Геймпад отключён'));
  // мышь или палец — рамку и подсказку убрать, пока пад снова не тронут
  const off = (e: Event) => {
    if (!e.isTrusted || !active) return;
    if (e.type === 'mousemove' && Math.abs((e as MouseEvent).movementX) + Math.abs((e as MouseEvent).movementY) < 4) return;
    setActive(false);
  };
  window.addEventListener('mousemove', off, { passive: true });
  window.addEventListener('pointerdown', off, { passive: true });
  window.addEventListener('keydown', off, { passive: true });
  if (navigator.getGamepads().some((g) => g)) loop();
}

function note(text: string) {
  void import('./ui').then((m) => m.toast(text, 1800));
}

/** Захватить пад под игру; вернуть — отпустить. Захваты складываются стопкой, действует последний. */
export function claimPad(c: PadClaim): () => void {
  claims.push(c);
  updHint();
  return () => {
    const i = claims.indexOf(c);
    if (i < 0) return;
    if (i === claims.length - 1) releaseKeys();
    claims.splice(i, 1);
    updHint();
  };
}

const owned = new Map<object, () => void>();
/** То же, но захват привязан к владельцу (обычно — к обработчику клавиш игры): `padOff(kd)` рядом с removeEventListener. */
export function padOn(owner: object, c: PadClaim) {
  owned.get(owner)?.();
  owned.set(owner, claimPad(c));
}
export function padOff(owner: object) {
  owned.get(owner)?.();
  owned.delete(owner);
}

/** Подключённые пады сейчас (для опроса из игрового цикла). */
export function pads(): PadSnap[] {
  return cur;
}

/** Ось стика пада n (по умолчанию первого); 0, если пада нет. */
export function padAxis(axis: 'lx' | 'ly' | 'rx' | 'ry', n = 0): number {
  return cur[n]?.[axis] ?? 0;
}

/** Есть ли хоть один пад, которым пользуются (не мышь). */
export function padActive(): boolean {
  return active && cur.length > 0;
}

/** Вибрация (Chrome/Edge: dual-rumble), сила 0..1. */
export function rumble(ms = 120, strong = 0.6, weak = 0.4, n = 0) {
  const g = navigator.getGamepads?.().filter((x): x is Gamepad => !!x)[n];
  const va = (g as unknown as { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } })?.vibrationActuator;
  va?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch(() => {});
}

// ---------------------------------------------------------------- опрос

function snap(g: Gamepad, n: number): PadSnap {
  const v = {} as Record<PadButton, number>;
  STD.forEach((b, i) => (v[b] = g.buttons[i]?.value ?? 0));
  const dz = (x: number) => (Math.abs(x) < DEAD ? 0 : Math.sign(x) * ((Math.abs(x) - DEAD) / (1 - DEAD)));
  return { n, id: g.id, v, lx: dz(g.axes[0] ?? 0), ly: dz(g.axes[1] ?? 0), rx: dz(g.axes[2] ?? 0), ry: dz(g.axes[3] ?? 0) };
}

const isDown = (s: PadSnap | undefined, b: PadButton, was?: PadSnap) => {
  if (!s) return false;
  const x = s.v[b];
  // курки аналоговые — с гистерезисом, чтобы не дребезжали
  if (b === 'lt' || b === 'rt') return x > (was && was.v[b] > ON ? OFF : ON);
  return x > 0.5;
};

function loop() {
  if (raf) return;
  last = performance.now();
  const tick = (t: number) => {
    raf = 0;
    const list = navigator.getGamepads().filter((g): g is Gamepad => !!g && g.connected);
    prev = cur;
    cur = list.map((g, i) => snap(g, i));
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    if (cur.length) {
      try {
        step(t, dt);
      } catch (e) {
        console.error(e);
      }
    } else releaseKeys();
    if (list.length) raf = requestAnimationFrame(tick);
    else {
      cur = prev = [];
      setActive(false);
    }
  };
  raf = requestAnimationFrame(tick);
}

const frame = (dt: number): PadFrame => ({
  pads: cur,
  dt,
  pressed: (b, n) => cur.some((s) => (n == null || s.n === n) && isDown(s, b, prev[s.n]) && !isDown(prev[s.n], b, prev[s.n])),
  released: (b, n) => cur.some((s) => (n == null || s.n === n) && !isDown(s, b, prev[s.n]) && isDown(prev[s.n], b, prev[s.n])),
  held: (b, n) => cur.some((s) => (n == null || s.n === n) && isDown(s, b, prev[s.n])),
});

function touched(): boolean {
  return cur.some((s) => STD.some((b) => s.v[b] > 0.5) || Math.abs(s.lx) + Math.abs(s.ly) + Math.abs(s.rx) + Math.abs(s.ry) > 0.5);
}

function step(t: number, dt: number) {
  const f = frame(dt);
  if (touched() && !active) {
    setActive(true);
    void import('./audio').then((m) => m.Sound.unlock());
  }
  if (f.pressed('start')) {
    releaseKeys();
    return openMenu();
  }
  const top = claims[claims.length - 1];
  const modalOpen = !!openModal();
  // подсказка меняется, когда открывается и закрывается окно (пауза над экшен-игрой)
  if (modalOpen !== lastModal) {
    lastModal = modalOpen;
    updHint();
    // окно открылось — рамка на его главную кнопку; закрылось — рамку заново найдём при первом движении
    setFocus(null);
    if (modalOpen && active && !cursor) setFocus(startFocus(candidates()));
  }
  // Back в экшен-игре — переключиться на рамку (до кнопок панели) и обратно
  if (top && !modalOpen && f.pressed('back')) {
    navMode = !navMode;
    releaseKeys();
    updHint();
    return;
  }
  if (!top) navMode = false;
  if (top && !modalOpen && !navMode) {
    // вернулись в игру из окна: кнопка, которой закрыли паузу (B, A), ещё зажата — в игру её не пускать
    if (!inGame) for (const s of cur) for (const b of STD) if (isDown(s, b)) blocked.add(`${s.n}:${b}`);
    inGame = true;
    gameStep(top, t, f);
    return;
  }
  inGame = false;
  releaseKeys();
  navStep(t, f);
}

// ---------------------------------------------------------------- игра: пад → клавиши

const held = new Map<string, { since: number; next: number }>();

const DIRS: Record<'arrows' | 'wasd', [string, string, string, string]> = {
  arrows: ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
  wasd: ['KeyW', 'KeyS', 'KeyA', 'KeyD'],
};

function keyOf(code: string): string {
  if (code === 'Space') return ' ';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^(Digit|Numpad)\d$/.test(code)) return code.slice(-1);
  if (code.startsWith('Shift')) return 'Shift';
  if (code.startsWith('Control')) return 'Control';
  if (code === 'NumpadEnter') return 'Enter';
  return { Comma: ',', Period: '.', Slash: '/', Minus: '-', Equal: '=' }[code] ?? code;
}

function sendKey(type: 'keydown' | 'keyup', code: string, repeat = false) {
  const target = document.body;
  target.dispatchEvent(new KeyboardEvent(type, { code, key: keyOf(code), repeat, bubbles: true, cancelable: true }));
}

function releaseKeys() {
  for (const code of held.keys()) sendKey('keyup', code);
  held.clear();
}

function gameStep(c: PadClaim, t: number, f: PadFrame) {
  const want = new Set<string>();
  const mm = typeof c.map === 'function' ? c.map() : c.map;
  const maps = Array.isArray(mm) ? mm : [mm ?? {}];
  for (const s of cur) {
    const m = maps[Math.min(s.n, maps.length - 1)] ?? {};
    const was = prev[s.n];
    const free = (b: PadButton) => {
      const k = `${s.n}:${b}`;
      if (!blocked.has(k)) return true;
      if (!isDown(s, b)) blocked.delete(k);
      return false;
    };
    const dir = (spec: PadMap['move'], x: number, y: number, pad: boolean) => {
      if (spec === null) return;
      const [u, d, l, r] = Array.isArray(spec) ? spec : DIRS[spec ?? 'arrows'];
      const k = (b: PadButton) => pad && free(b) && isDown(s, b);
      // гистерезис: держим клавишу, пока стик не вернулся ниже OFF
      const on = (val: number, code: string) => val > (held.has(code) ? OFF : ON);
      if (k('up') || on(-y, u)) want.add(u);
      if (k('down') || on(y, d)) want.add(d);
      if (k('left') || on(-x, l)) want.add(l);
      if (k('right') || on(x, r)) want.add(r);
    };
    dir(m.move, m.analog ? 0 : s.lx, m.analog ? 0 : s.ly, true);
    if (m.move2 !== undefined) dir(m.move2, s.rx, s.ry, false);
    for (const [b, code] of Object.entries(m.keys ?? {})) if (code && free(b as PadButton) && isDown(s, b as PadButton, was)) want.add(code);
  }
  want.delete('');
  for (const code of [...held.keys()])
    if (!want.has(code)) {
      held.delete(code);
      sendKey('keyup', code);
    }
  for (const code of want) {
    const h = held.get(code);
    if (!h) {
      held.set(code, { since: t, next: t + KEY_DELAY });
      sendKey('keydown', code);
    } else if (t >= h.next) {
      // как у настоящей клавиатуры — автоповтор (прицел в дартсе и городках ходит по повтору)
      h.next = t + KEY_REPEAT;
      sendKey('keydown', code, true);
    }
  }
  c.frame?.(f);
}

// ---------------------------------------------------------------- меню и окна

function openModal(): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>('.modal');
  for (let i = all.length - 1; i >= 0; i--) if (visible(all[i])) return all[i];
  return null;
}

function openMenu() {
  const m = openModal();
  if (m) return escape();
  const btn = pick<HTMLButtonElement>('[data-act=menu], [data-a=menu], .gp-menu, [data-pad=menu]');
  if (btn) btn.click();
  else escape();
}

function escape() {
  const t = (document.activeElement as HTMLElement | null) ?? document.body;
  for (const type of ['keydown', 'keyup'] as const) t.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
}

function pick<T extends HTMLElement>(sel: string): T | null {
  const sc = scope();
  for (const el of sc.querySelectorAll<T>(sel)) if (visible(el) && !(el as unknown as HTMLButtonElement).disabled) return el;
  return null;
}

// ---------------------------------------------------------------- навигация рамкой

let focus: HTMLElement | null = null;
let navDir: string | null = null;
let navNext = 0;
let cursor: { x: number; y: number; el: HTMLElement; down: boolean } | null = null;

const FOCUSABLE =
  'button, a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role=button], [data-tap], [data-act], [data-a], [data-pad]';

function scope(): HTMLElement {
  return openModal() ?? document.querySelector<HTMLElement>('.screen.active') ?? document.body;
}

function visible(el: HTMLElement): boolean {
  if (!el.isConnected || el.closest('[hidden], [inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && cs.pointerEvents !== 'none';
}

/** Всё, что можно нажать: кнопки и ссылки, а ещё клетки и фишки — у них курсор-рука (берём внешний такой элемент). */
function candidates(): HTMLElement[] {
  const sc = scope();
  const out: HTMLElement[] = [];
  const seen = new Set<Element>();
  for (const el of sc.querySelectorAll<HTMLElement>(`${FOCUSABLE}, [data-from], [data-to]`)) {
    if ((el as HTMLButtonElement).disabled || seen.has(el)) continue;
    seen.add(el);
    out.push(el);
  }
  for (const el of sc.querySelectorAll<HTMLElement>('*')) {
    if (seen.has(el) || el instanceof SVGSVGElement) continue;
    if (getComputedStyle(el).cursor !== 'pointer') continue;
    const p = el.parentElement;
    if (p && getComputedStyle(p).cursor === 'pointer') continue;
    if (el.closest(FOCUSABLE) && el.closest(FOCUSABLE) !== el) continue;
    seen.add(el);
    out.push(el);
  }
  return out.filter((el) => visible(el) && !el.closest('.gp-hint'));
}

function center(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r };
}

/** Где стояла рамка: поле перерисовалось (выбрал шашку — появились цели) — цепляемся за ближайшее на том же месте. */
let lastAt: { x: number; y: number; scope: HTMLElement } | null = null;

function nearest(list: HTMLElement[], x: number, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let d = Infinity;
  for (const el of list) {
    const c = center(el);
    const dd = Math.hypot(c.x - x, c.y - y);
    if (dd < d) {
      d = dd;
      best = el;
    }
  }
  return best;
}

/** Рамка, а если её элемент перерисован — ближайший к старому месту на том же экране. */
function anchor(list: HTMLElement[]): HTMLElement | null {
  if (focus && list.includes(focus)) return focus;
  if (lastAt && lastAt.scope === scope() && lastAt.scope.isConnected) {
    const n = nearest(list, lastAt.x, lastAt.y);
    if (n) {
      focus?.classList.remove('gp-focus');
      focus = n;
      n.classList.add('gp-focus');
      return n;
    }
  }
  return null;
}

function setFocus(el: HTMLElement | null) {
  focus?.classList.remove('gp-focus');
  focus = el;
  if (!el) return;
  const c = center(el);
  lastAt = { x: c.x, y: c.y, scope: scope() };
  el.classList.add('gp-focus');
  if (el.matches(FOCUSABLE) && el.tabIndex >= 0) el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function startFocus(list: HTMLElement[]): HTMLElement | null {
  const sc = scope();
  // в окне — главная кнопка окна, на столе — главная кнопка хода, иначе — ближе всех к верху экрана
  // шапка сайта (вход, «за стол по коду») — не главное на экране
  const main = (sel: string) => [...sc.querySelectorAll<HTMLElement>(sel)].find((e) => list.includes(e) && !e.closest('.site-bar'));
  const pri = main('.modal .btn.primary') ?? main('[data-tap]') ?? main('.btn.primary');
  if (pri) return pri;
  const inView = list.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  });
  return (inView.length ? inView : list).sort((a, b) => {
    const A = center(a), B = center(b);
    return A.y - B.y || A.x - B.x;
  })[0] ?? null;
}

function move(d: 'up' | 'down' | 'left' | 'right') {
  const list = candidates();
  if (!list.length) return;
  if (!anchor(list)) return setFocus(startFocus(list));
  const from = center(focus!);
  const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d];
  // сначала — те, что на одной линии с рамкой (перекрываются по поперечной оси), ближайший по ходу;
  // нет таких — в конусе 45°; нет и там — рамка стоит (с края ряда не прыгаем в шапку страницы)
  let best: HTMLElement | null = null;
  let score = Infinity;
  let cone: HTMLElement | null = null;
  let coneScore = Infinity;
  for (const el of list) {
    if (el === focus || el.contains(focus!) || focus!.contains(el)) continue;
    const c = center(el);
    const along = dx ? (dx > 0 ? c.r.left - from.r.right : from.r.left - c.r.right) : dy > 0 ? c.r.top - from.r.bottom : from.r.top - c.r.bottom;
    const ahead = dx ? (c.x - from.x) * dx : (c.y - from.y) * dy;
    if (ahead <= 2 || along < -Math.min(from.r.width, from.r.height) / 2) continue;
    const across = dx
      ? Math.max(0, Math.max(c.r.top, from.r.top) - Math.min(c.r.bottom, from.r.bottom))
      : Math.max(0, Math.max(c.r.left, from.r.left) - Math.min(c.r.right, from.r.right));
    const off = Math.abs(dx ? c.y - from.y : c.x - from.x);
    if (across === 0) {
      const s = Math.max(0, along) + off * 0.3;
      if (s < score) {
        score = s;
        best = el;
      }
    } else if (off <= ahead) {
      const s = Math.max(0, along) + across * 2;
      if (s < coneScore) {
        coneScore = s;
        cone = el;
      }
    }
  }
  best ??= cone;
  if (best) setFocus(best);
}

function cycle(k: 1 | -1) {
  const list = candidates();
  if (!list.length) return;
  const i = anchor(list) ? list.indexOf(focus!) : -1;
  setFocus(list[(i + k + list.length) % list.length]);
}

/** Нажать как мышью: по-настоящему для полей с pointerdown/перетаскиванием, click для кнопок. */
function press(el: HTMLElement, x?: number, y?: number) {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'button' || el.type === 'submit')) el.click();
    else el.focus();
    return;
  }
  const c = center(el);
  const at = { clientX: x ?? c.x, clientY: y ?? c.y, bubbles: true, cancelable: true, composed: true, button: 0, view: window };
  pointer(el, 'down', at);
  pointer(el, 'up', at);
  el.dispatchEvent(new MouseEvent('click', { ...at, detail: 1 }));
}

function pointer(el: Element, phase: 'down' | 'up' | 'move', at: MouseEventInit) {
  const p = { ...at, pointerId: 77, pointerType: 'mouse', isPrimary: true, buttons: phase === 'up' ? 0 : phase === 'down' ? 1 : cursor?.down ? 1 : 0 };
  el.dispatchEvent(new PointerEvent(`pointer${phase}`, p));
  el.dispatchEvent(new MouseEvent(`mouse${phase}`, p));
}

function navStep(t: number, f: PadFrame) {
  // ушли с экрана (стол → двор) — старая рамка не в счёт
  if (focus && (!focus.isConnected || !scope().contains(focus))) {
    focus.classList.remove('gp-focus');
    focus = null;
  }
  if (f.pressed('ls')) toggleCursor();
  if (cursor) return cursorStep(f);
  const s0 = cur[0];
  const sx = cur.reduce((a, s) => a + s.lx, 0);
  const sy = cur.reduce((a, s) => a + s.ly, 0);
  let d: 'up' | 'down' | 'left' | 'right' | null = null;
  if (f.held('up') || sy < -ON) d = 'up';
  else if (f.held('down') || sy > ON) d = 'down';
  else if (f.held('left') || sx < -ON) d = 'left';
  else if (f.held('right') || sx > ON) d = 'right';
  if (!d) navDir = null;
  else if (d !== navDir) {
    navDir = d;
    navNext = t + NAV_DELAY;
    move(d);
  } else if (t >= navNext) {
    navNext = t + NAV_REPEAT;
    move(d);
  }
  if (f.pressed('rb')) cycle(1);
  if (f.pressed('lb')) cycle(-1);
  if (f.pressed('a')) {
    const list = candidates();
    const el = anchor(list);
    if (el && visible(el)) press(el);
    else setFocus(startFocus(list));
  }
  if (f.pressed('b')) escape();
  if (f.pressed('x')) {
    // главная кнопка хода, как пробел на столе
    for (const type of ['keydown', 'keyup'] as const) document.body.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true, cancelable: true }));
  }
  if (f.pressed('y') || (f.pressed('back') && !claims.length)) pick<HTMLButtonElement>('[data-act=help], [data-a=help], [data-pad=help]')?.click();
  // правый стик — прокрутка окна или страницы
  const ry = s0 ? cur.reduce((a, s) => a + s.ry, 0) : 0;
  const rx = s0 ? cur.reduce((a, s) => a + s.rx, 0) : 0;
  if (ry || rx) {
    const box = scrollBox(focus ?? scope());
    box.scrollBy(rx * 900 * f.dt, ry * 900 * f.dt);
  }
  if (focus && !focus.isConnected) focus = null;
}

function scrollBox(el: HTMLElement): HTMLElement | Window {
  for (let e: HTMLElement | null = el; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 4) return e;
  }
  return window;
}

// ---------------------------------------------------------------- курсор-мышь (нажатие левого стика)

function toggleCursor() {
  if (cursor) {
    cursor.el.remove();
    cursor = null;
    updHint();
    return;
  }
  const c = focus && visible(focus) ? center(focus) : { x: innerWidth / 2, y: innerHeight / 2 };
  const el = document.createElement('div');
  el.className = 'gp-cursor';
  document.body.appendChild(el);
  cursor = { x: c.x, y: c.y, el, down: false };
  setFocus(null);
  placeCursor();
  updHint();
}

function placeCursor() {
  if (cursor) cursor.el.style.transform = `translate(${cursor.x}px, ${cursor.y}px)`;
}

function cursorStep(f: PadFrame) {
  const c = cursor!;
  let vx = cur.reduce((a, s) => a + s.lx, 0);
  let vy = cur.reduce((a, s) => a + s.ly, 0);
  if (f.held('left')) vx -= 0.4;
  if (f.held('right')) vx += 0.4;
  if (f.held('up')) vy -= 0.4;
  if (f.held('down')) vy += 0.4;
  const sp = 900 * (f.held('rt') ? 0.35 : 1); // курок — точнее
  const at = () => ({ clientX: c.x, clientY: c.y, bubbles: true, cancelable: true, composed: true, button: 0, view: window });
  const under = () => {
    c.el.style.display = 'none';
    const e = document.elementFromPoint(c.x, c.y) ?? document.body;
    c.el.style.display = '';
    return e;
  };
  if (vx || vy) {
    // кривая: малый наклон — медленно и точно
    const k = (v: number) => Math.sign(v) * v * v;
    c.x = Math.max(0, Math.min(innerWidth - 1, c.x + k(vx) * sp * f.dt));
    c.y = Math.max(0, Math.min(innerHeight - 1, c.y + k(vy) * sp * f.dt));
    placeCursor();
    pointer(under(), 'move', at());
  }
  if (f.pressed('a')) {
    c.down = true;
    c.el.classList.add('down');
    pointer(under(), 'down', at());
  }
  if (f.released('a') && c.down) {
    c.down = false;
    c.el.classList.remove('down');
    const e = under();
    pointer(e, 'up', at());
    e.dispatchEvent(new MouseEvent('click', { ...at(), detail: 1 }));
  }
  if (f.pressed('b')) {
    if (c.down) {
      c.down = false;
      c.el.classList.remove('down');
    }
    escape();
  }
  const ry = cur.reduce((a, s) => a + s.ry, 0);
  if (ry) scrollBox(under() as HTMLElement).scrollBy(0, ry * 900 * f.dt);
}

// ---------------------------------------------------------------- рамка, подсказка

let hintEl: HTMLElement | null = null;

function setActive(on: boolean) {
  active = on;
  document.documentElement.classList.toggle('gp-on', on);
  if (!on) {
    focus?.classList.remove('gp-focus');
    focus = null;
    if (cursor) toggleCursor();
  }
  updHint();
}

function updHint() {
  if (typeof document === 'undefined') return;
  if (!active) {
    hintEl?.remove();
    hintEl = null;
    return;
  }
  if (!hintEl) {
    hintEl = document.createElement('div');
    hintEl.className = 'gp-hint';
    document.body.appendChild(hintEl);
  }
  const top = claims[claims.length - 1];
  const html = cursor
    ? '<b>Ⓐ</b> нажать · держать — тащить · <b>RT</b> точнее · <b>L3</b> рамка · <b>☰</b> меню'
    : top && !openModal() && !navMode
      ? `${top.hint ?? 'Стик и кнопки — как клавиши игры'} · <b>Back</b> рамка · <b>☰</b> пауза`
      : `<b>Ⓐ</b> выбрать · <b>Ⓑ</b> назад · <b>Ⓧ</b> ход · <b>Ⓨ</b> справка · <b>L3</b> курсор${top && navMode ? ' · <b>Back</b> к игре' : ''} · <b>☰</b> меню`;
  if (hintEl.innerHTML !== html) hintEl.innerHTML = html;
}

