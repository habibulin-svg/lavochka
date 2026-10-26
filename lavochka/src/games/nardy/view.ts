/* Нарды — отрисовка: резная доска (SVG), шашки, бар, лотки снятых шашек, куб; кубики и кнопки в панели. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { absOf, apply, BAR, boardSize, checkersOf, isLines, legalSteps, mayDouble, OFF, pipCount, sharedPath, targetOf, type Event, type State, type Step } from './engine';
import { SeededRng } from '../../core/rng';
import { woodTexture, WOODS } from '../../core/wood';
import { arches, BURN, burnDefs, carvedFrame, cup, hinge, rosette, slot, spearFiligree, spearPath, star8 } from './decor';
import './nardy.css';

const NS = 'http://www.w3.org/2000/svg';
const F = 34; // рамка
const T = 72; // лоток снятых шашек
const PW = 64; // ширина пункта
const B = 60; // бар
const W = F * 2 + T * 2 + B + PW * 12; // 1040
const H = 760;
/** Радиус шашки: на помпейской плите буквы стоят тесно — шашки там мельче. */
let R = 29;
const OFF_STEP = 16; // толщина снятой шашки «на ребре» в лотке
const PH = 262; // длина пункта-«копья»
const STACK = 5 * 2 * R; // наибольшая высота стопки

const colX = (col: number) => F + T + col * PW + PW / 2 + (col >= 6 ? B : 0);
const BAR_X = F + T + 6 * PW + B / 2;

/** Пункт → колонка и ряд. Нижний ряд: 0..11 слева направо, верхний: 23..12 слева направо. */
function pointGeo(a: number) {
  const bottom = a < 12;
  const col = bottom ? a : 23 - a;
  return { x: colX(col), bottom };
}

const RH = (H - 2 * F) / 3; // ряд доски «12 линий»

/** Поле под стопку шашек: стопка растёт от y0 в сторону dir на длину len; cy — стопка по центру (средний ряд 12 линий). */
interface Cell {
  x: number;
  y0: number;
  dir: 1 | -1;
  len: number;
  cy?: number;
  bottom: boolean;
}

function spearCell(a: number): Cell {
  const { x, bottom } = pointGeo(a);
  return { x, y0: bottom ? H - F : F, dir: bottom ? -1 : 1, len: STACK, bottom };
}

/* Помпейская плита — фотография (public/nardy/pompeii.webp, снята 600×424), поверх — невидимые поля на буквах.
 * Координаты букв — в пикселях исходного снимка: ряды снизу вверх (PERNAM PAONEM, PVLLVM PISCEM, ABEMVS INCENA),
 * в каждом 6 букв слева от знака посередине и 6 справа. По бокам — полосы под руку и снятые шашки. */
const PHOTO_W = 600;
const PHOTO_H = 424;
const PHOTO_S = (W - 96) / PHOTO_W;
const PHOTO_X0 = 48;
const PHOTO_Y0 = (H - PHOTO_H * PHOTO_S) / 2;
const px = (x: number) => PHOTO_X0 + x * PHOTO_S;
const py = (y: number) => PHOTO_Y0 + y * PHOTO_S;
const STONE_ROWS = [
  { y: 291, xs: [20, 65, 108, 153, 192, 237, 379, 411, 440, 468, 507, 557] },
  { y: 160, xs: [47, 87, 125, 158, 199, 260, 385, 412, 437, 467, 505, 549] },
  { y: 25, xs: [70, 106, 133, 172, 212, 250, 372, 406, 440, 469, 492, 518] },
];
/** Знаки посередине плиты (сердце, колесо, ветвь) — там бар. */
const STONE_MID = px(314);
const STONE_LEN = 176;
const STONE_R = 17;

/** 12 линий: поле a = ряд × 12 + столбец, ряд 0 — нижний. На помпейской плите шашки стоят стопкой прямо на букве. */
function lineCell(a: number, stone = false): Cell {
  const r = Math.floor(a / 12);
  const top = F + (2 - r) * RH;
  const x = colX(a % 12);
  if (stone) {
    const cy = py(STONE_ROWS[r].y);
    return { x: px(STONE_ROWS[r].xs[a % 12]), y0: cy - STONE_LEN / 2, dir: 1, len: STONE_LEN, cy, bottom: r === 0 };
  }
  if (r === 2) return { x, y0: top + 6, dir: 1, len: RH - 12, bottom: false };
  if (r === 0) return { x, y0: top + RH - 6, dir: -1, len: RH - 12, bottom: true };
  return { x, y0: top + 6, dir: 1, len: RH - 12, cy: top + RH / 2, bottom: false };
}

const capOf = (c: Cell) => Math.max(1, Math.floor(c.len / (2 * R)));

function stackY(c: Cell, k: number, n: number) {
  const sp = n > capOf(c) ? (c.len - 2 * R) / (n - 1) : 2 * R;
  if (c.cy != null) return c.cy + (k - (n - 1) / 2) * sp;
  return c.y0 + c.dir * (R + k * sp);
}

/** Дорожка поля «12 линий» (для подсветки и нажатия). */
function laneRect(a: number, stone = false) {
  const c = lineCell(a, stone);
  if (stone) {
    // ширина — до середины между соседними буквами ряда
    const xs = STONE_ROWS[Math.floor(a / 12)].xs;
    const col = a % 12;
    const gaps = [col % 6 > 0 ? xs[col] - xs[col - 1] : 99, col % 6 < 5 ? xs[col + 1] - xs[col] : 99];
    const w = Math.min(60, Math.min(...gaps) * PHOTO_S);
    return `x="${(c.x - w / 2).toFixed(1)}" y="${(c.cy! - STONE_LEN / 2 - 8).toFixed(1)}" width="${w.toFixed(1)}" height="${STONE_LEN + 16}" rx="10"`;
  }
  const top = F + (2 - Math.floor(a / 12)) * RH;
  return `x="${c.x - PW / 2 + 5}" y="${top + 4}" width="${PW - 10}" height="${RH - 8}" rx="12"`;
}



export type Skin = 'dark' | 'light';
const SKIN_KEY = 'lavochka.nardy.skin';
function loadSkin(): Skin {
  try {
    return localStorage.getItem(SKIN_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

interface Model {
  pts: number[];
  bar: [number, number];
  hand?: [number, number];
  off: [number, number];
  /** Плакото: кто зажат на пункте или -1. */
  pin?: number[];
}

class NardyView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private rotor!: SVGGElement;
  private gCheckers!: SVGGElement;
  private gMarks!: SVGGElement;
  private gHi!: SVGGElement;
  private gCube!: SVGGElement;
  private gBanner!: SVGGElement;
  private tray!: DiceTray;
  private trayEl!: HTMLElement;
  private skinBtn!: HTMLButtonElement;
  /** Вид доски: пункты-копья (24), три ряда «12 линий» или они же с помпейской надписью. */
  private kind: 'spears' | 'lines' | 'pompeii' = 'spears';
  private btns!: HTMLElement;
  private leftInfo!: HTMLElement;
  private state: State | null = null;
  private model: Model = { pts: new Array(24).fill(0), bar: [0, 0], off: [0, 0] };
  private flipped = false;
  private skin: Skin = loadSkin();
  private actSeat: number | null = null;
  private selected: number | null = null;
  /** Шашка под курсором — показываем, куда она может пойти. */
  private hover: number | null = null;
  private steps: Step[] = [];
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const b = this.btns.querySelector<HTMLButtonElement>('[data-a=roll],[data-a=opening]');
    if (b && !b.disabled && b.isConnected) {
      e.preventDefault();
      b.click();
    }
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="nd-wrap"><svg class="nd-board" xmlns="${NS}" viewBox="0 0 ${W} ${H}"></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.build();
    const ctl = h(`<div class="nd-controls">
        <div class="nd-tray"></div>
        <div class="nd-left"></div>
        <div class="nd-btns"></div>
        <button class="btn small nd-skin"></button>
        ${ctx.demo ? '' : `<div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Нажмите на шашку, затем на подсвеченный пункт.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.trayEl = ctl.querySelector('.nd-tray') as HTMLElement;
    this.tray = new DiceTray(this.trayEl);
    this.btns = ctl.querySelector('.nd-btns') as HTMLElement;
    this.leftInfo = ctl.querySelector('.nd-left') as HTMLElement;
    const skinBtn = ctl.querySelector('.nd-skin') as HTMLButtonElement;
    this.skinBtn = skinBtn;
    const skinText = () => (skinBtn.textContent = this.skin === 'dark' ? 'Доска: тёмная резная' : 'Доска: светлая выжженная');
    skinText();
    skinBtn.hidden = ctx.demo;
    skinBtn.onclick = () => {
      this.skin = this.skin === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(SKIN_KEY, this.skin);
      } catch {
        /* без сохранения */
      }
      skinText();
      this.build();
      if (this.state) this.render();
    };
    this.svg.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-from],[data-to],.nd-pt') as SVGElement | null;
      if (!el) return this.select(null);
      if (el.dataset.to != null) return this.pickTarget(+el.dataset.to, +(el.dataset.die ?? 0));
      if (el.dataset.from != null) return this.select(+el.dataset.from);
      // щелчок по пункту — как по верхней шашке на нём
      const a = +(el.dataset.a ?? -9);
      if (this.actSeat != null && this.state) {
        const i = this.pathIdx(this.actSeat, a);
        if (this.steps.some((st) => st.from === i)) this.select(i);
        else this.select(null);
      }
    });
    this.svg.addEventListener('pointerover', (e) => {
      // шашка выбрана — цели уже показаны, перерисовка под курсором сорвала бы нажатие
      if (e.pointerType === 'touch' || this.selected != null) return;
      const el = (e.target as Element).closest('[data-from]') as SVGElement | null;
      const from = el ? +el.dataset.from! : null;
      if (from !== this.hover) {
        this.hover = from;
        this.renderMarks();
      }
    });
    this.svg.addEventListener('pointerleave', () => {
      if (this.hover == null) return;
      this.hover = null;
      this.renderMarks();
    });
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
  }

  // ---------------------------------------------------------------- доска

  private build() {
    const dark = this.skin === 'dark';
    const wField = woodTexture(dark ? WOODS.stained : WOODS.linden, 512, 11);
    const wField2 = woodTexture(dark ? WOODS.stained : WOODS.linden, 512, 23);
    const wFrame = woodTexture(WOODS.walnut, 512, 5, false);
    const wLight = woodTexture(WOODS.maple, 256, 3);
    const wDark = woodTexture(WOODS.wenge, 256, 9);
    const half = 6 * PW;
    const fieldL = F + T;
    const rightL = fieldL + half + B;
    const fh = H - 2 * F;
    let s = `<defs>${burnDefs}
      <pattern id="ndWL" patternUnits="userSpaceOnUse" width="150" height="150"><image href="${wLight}" width="150" height="150" preserveAspectRatio="none"/></pattern>
      <pattern id="ndWD" patternUnits="userSpaceOnUse" width="150" height="150"><image href="${wDark}" width="150" height="150" preserveAspectRatio="none"/></pattern>
      <pattern id="ndInlay" patternUnits="userSpaceOnUse" width="300" height="300"><image href="${wLight}" width="300" height="300" preserveAspectRatio="none"/></pattern>
      <radialGradient id="ndBevel" cx="50%" cy="50%" r="50%"><stop offset=".62" stop-color="#000" stop-opacity="0"/><stop offset=".86" stop-color="#000" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
      <radialGradient id="ndGloss" cx="34%" cy="28%" r="55%"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
      <linearGradient id="ndLacquer" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".16"/><stop offset=".4" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".18"/></linearGradient>
      <linearGradient id="ndRim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".22" stop-color="#fff" stop-opacity=".08"/><stop offset=".55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".5"/></linearGradient>
      <linearGradient id="ndRimEnds" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".14" stop-color="#000" stop-opacity="0"/><stop offset=".86" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
      <filter id="ndShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="2" dy="3.5" stdDeviation="2.4" flood-color="#1a0a02" flood-opacity=".6"/></filter>
      <filter id="ndInset" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="7"/></filter>
      <filter id="ndInlayShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="1" stdDeviation=".8" flood-color="#000" flood-opacity=".6"/></filter>
      <clipPath id="ndClipL"><rect x="${fieldL}" y="${F}" width="${half}" height="${fh}"/></clipPath>
      <clipPath id="ndClipR"><rect x="${rightL}" y="${F}" width="${half}" height="${fh}"/></clipPath>
      <clipPath id="ndClipAll"><rect width="${W}" height="${H}" rx="20"/></clipPath>
    </defs>`;
    s += `<g id="ndRotor">`;
    // помпейская плита — мрамор с резными буквами; остальные доски — деревянная «книжка»
    if (this.kind === 'pompeii') s += this.stoneSvg();
    else {
      // корпус: орех под лаком, резная рамка
      s += `<rect width="${W}" height="${H}" rx="20" fill="#3a1d0c"/>`;
      s += `<image href="${wFrame}" width="${W}" height="${H}" preserveAspectRatio="none" clip-path="url(#ndClipAll)"/>`;
      s += `<g filter="url(#ndBurn)">${carvedFrame(W, H, F)}</g>`;
      // борта: желоба для снятых шашек и лунки для кубиков
      for (const cx of [F + T / 2 - 4, W - F - T / 2 + 4]) {
        s += slot(cx, F + 8, H / 2 - 46, 54) + slot(cx, H / 2 + 46, H - F - 8, 54) + cup(cx, H / 2, 22);
      }
      // две половины-доски
      const halves: [number, string, string][] = [
        [fieldL, wField2, 'ndClipL'],
        [rightL, wField, 'ndClipR'],
      ];
      const inlayEdge = dark ? '#1a0a02' : BURN;
      for (const [x0, tex, clip] of halves) {
        const cx = x0 + half / 2;
        s += `<g clip-path="url(#${clip})">`;
        s += `<image href="${tex}" x="${x0}" y="${F}" width="${half}" height="${fh}" preserveAspectRatio="none"/>`;
        if (this.kind !== 'spears') {
          s += `<rect x="${x0 - 8}" y="${F - 8}" width="${half + 16}" height="${fh + 16}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="18" filter="url(#ndInset)"/></g>`;
          continue;
        }
        // медальон в середине — между рядами пунктов, где шашки не стоят
        if (dark) s += `<g filter="url(#ndInlayShadow)">${star8(cx, H / 2, 88, 'url(#ndInlay)', '#6a3c18', inlayEdge)}</g>`;
        else s += `<g filter="url(#ndBurn)">${rosette(cx, H / 2, 92)}</g>`;
        // арки у торцов: резные (тёмная) или выжженные (светлая)
        const arch = arches(x0, half, F + 2, 1) + arches(x0, half, H - F - 2, -1);
        // тёмная: резьба — тень под кромкой и блик на ней
        s += dark
          ? `<g opacity=".7" transform="translate(0,2.5)" stroke-width="4">${arch.replace(new RegExp(BURN, 'g'), '#140802')}</g><g opacity=".6">${arch.replace(new RegExp(BURN, 'g'), '#f0cf9a')}</g>`
          : `<g filter="url(#ndBurn)">${arch}</g>`;
        // тень от бортика рамки — поле утоплено
        s += `<rect x="${x0 - 8}" y="${F - 8}" width="${half + 16}" height="${fh + 16}" fill="none" stroke="#000" stroke-opacity=".55" stroke-width="18" filter="url(#ndInset)"/>`;
        s += `</g>`;
      }
      // сгиб «книжки»: бортики и латунные петли
      s += `<rect x="${BAR_X - B / 2}" y="${F - 6}" width="${B}" height="${fh + 12}" fill="#2a1206" opacity=".35"/>`;
      s += `<rect x="${BAR_X - 1.5}" y="${F - 6}" width="3" height="${fh + 12}" fill="#0d0502" opacity=".8"/>`;
      // у 12 линий в середине рядов розетки — петли на границах рядов
      s += this.kind === 'spears' ? hinge(BAR_X, H * 0.2) + hinge(BAR_X, H * 0.8) : hinge(BAR_X, F + RH) + hinge(BAR_X, F + 2 * RH);
      if (this.kind !== 'spears') s += this.linesSvg(dark, inlayEdge);
      // пункты-«копья»: инкрустация из клёна (тёмная доска) или выжженный контур с узором (светлая)
      let pts = '';
      let fil = '';
      for (let a = 0; a < (this.kind === 'spears' ? 24 : 0); a++) {
        const { x, bottom } = pointGeo(a);
        const dir = bottom ? -1 : 1;
        const base = bottom ? H - F - 12 : F + 12;
        const w = PW - 22;
        const d = spearPath(x, base, PH - 12, w, dir);
        if (dark) pts += `<path class="nd-pt" data-a="${a}" d="${d}" fill="url(#ndInlay)" stroke="${inlayEdge}" stroke-width="1.2"/>`;
        else pts += `<path class="nd-pt" data-a="${a}" d="${d}" fill="#fff6e0" fill-opacity=".25" stroke="${BURN}" stroke-width="2.2"/>`;
        fil += spearFiligree(x, base, PH - 12, w, dir, dark ? '#7a4a20' : BURN);
        const dotY = base + dir * (PH + 8);
        fil += `<circle cx="${x}" cy="${dotY}" r="4" fill="${dark ? 'url(#ndInlay)' : BURN}" stroke="${inlayEdge}" stroke-width=".8"/>`;
      }
      s += dark ? `<g filter="url(#ndInlayShadow)">${pts}</g><g filter="url(#ndBurn)" opacity=".8">${fil}</g>` : `<g filter="url(#ndBurn)">${pts}${fil}</g>`;
      // лаковый отблеск поверх корпуса
      s += `<rect width="${W}" height="${H}" rx="20" fill="url(#ndLacquer)" pointer-events="none"/>`;
    }
    s += `<g id="ndHi"></g><g id="ndCheckers"></g><g id="ndMarks"></g><g id="ndCube"></g></g><g id="ndBanner"></g>`;
    this.svg.innerHTML = s;
    this.rotor = this.svg.querySelector('#ndRotor') as SVGGElement;
    this.gCheckers = this.svg.querySelector('#ndCheckers') as SVGGElement;
    this.gMarks = this.svg.querySelector('#ndMarks') as SVGGElement;
    this.gHi = this.svg.querySelector('#ndHi') as SVGGElement;
    this.gCube = this.svg.querySelector('#ndCube') as SVGGElement;
    this.gBanner = this.svg.querySelector('#ndBanner') as SVGGElement;
    if (this.flipped) this.rotor.setAttribute('transform', `rotate(180 ${W / 2} ${H / 2})`);
  }

  /** Помпейская плита: снимок доски из Помпей, тонированный под мрамор с красными буквами; поля — невидимые дорожки на буквах. */
  private stoneSvg() {
    const src = '/nardy/pompeii.webp';
    const iw = PHOTO_W * PHOTO_S;
    const ih = PHOTO_H * PHOTO_S;
    let s = `<defs>
      <filter id="ndStTone" color-interpolation-filters="sRGB"><feComponentTransfer>
        <feFuncR type="table" tableValues=".33 .62 .9 .97"/><feFuncG type="table" tableValues=".12 .45 .86 .95"/><feFuncB type="table" tableValues=".08 .38 .8 .9"/>
      </feComponentTransfer></filter>
      <filter id="ndStBlur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="14"/></filter>
      <linearGradient id="ndStSide" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1e1208" stop-opacity=".78"/><stop offset=".05" stop-color="#1e1208" stop-opacity=".45"/><stop offset=".08" stop-color="#1e1208" stop-opacity="0"/><stop offset=".92" stop-color="#1e1208" stop-opacity="0"/><stop offset=".95" stop-color="#1e1208" stop-opacity=".45"/><stop offset="1" stop-color="#1e1208" stop-opacity=".78"/></linearGradient>
      <clipPath id="ndStClip"><rect width="${W}" height="${H}" rx="10"/></clipPath>
    </defs>`;
    // края плиты дорисованы размытым тем же снимком, по бокам — тень полос под шашки
    s += `<g clip-path="url(#ndStClip)" filter="url(#ndStTone)"><rect width="${W}" height="${H}" fill="#cfcac0"/>`;
    s += `<image href="${src}" x="-60" y="-60" width="${W + 120}" height="${H + 120}" preserveAspectRatio="none" filter="url(#ndStBlur)" opacity=".9"/>`;
    s += `<image href="${src}" x="${PHOTO_X0}" y="${PHOTO_Y0}" width="${iw}" height="${ih}" preserveAspectRatio="none"/></g>`;
    s += `<rect width="${W}" height="${H}" rx="10" fill="url(#ndStSide)" pointer-events="none"/>`;
    s += `<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" rx="9" fill="none" stroke="#6f6658" stroke-width="3"/>`;
    for (let a = 0; a < 36; a++) s += `<rect class="nd-pt" data-a="${a}" ${laneRect(a, true)} fill="#fff" fill-opacity="0"/>`;
    return s;
  }

  /** 12 линий: три ряда дорожек, между половинами — розетки. */
  private linesSvg(dark: boolean, edge: string) {
    let lanes = '';
    let deco = '';
    const ink = dark ? '#7a4a20' : BURN;
    for (let a = 0; a < 36; a++) {
      const r = Math.floor(a / 12);
      const col = a % 12;
      const odd = (col + r) % 2 === 1;
      if (dark) lanes += `<rect class="nd-pt" data-a="${a}" ${laneRect(a)} fill="url(#ndInlay)" fill-opacity="${odd ? 0.55 : 0.9}" stroke="${edge}" stroke-width="1.4"/>`;
      else lanes += `<rect class="nd-pt" data-a="${a}" ${laneRect(a)} fill="#fff6e0" fill-opacity="${odd ? 0.1 : 0.3}" stroke="${BURN}" stroke-width="2.2"/>`;
      const x = lineCell(a).x;
      const top = F + (2 - r) * RH;
      const cy = top + RH / 2;
      // круглое клеймо в середине дорожки и насечки у её концов
      deco += `<circle cx="${x}" cy="${cy}" r="9" fill="none" stroke="${ink}" stroke-width="1.6"/><circle cx="${x}" cy="${cy}" r="3" fill="${ink}"/>`;
      deco += `<path d="M${x - 14},${top + 18}h28M${x - 14},${top + RH - 18}h28" stroke="${ink}" stroke-width="1.4"/>`;
    }
    // посередине каждого ряда — розетка, как на римских досках
    let ros = '';
    for (let r = 0; r < 3; r++) ros += rosette(BAR_X, F + r * RH + RH / 2, 24);
    if (dark) ros = ros.replace(new RegExp(BURN, 'g'), '#e8c48a');
    return dark
      ? `<g filter="url(#ndInlayShadow)">${lanes}</g><g filter="url(#ndBurn)" opacity=".85">${deco}</g><g opacity=".75">${ros}</g>`
      : `<g filter="url(#ndBurn)">${lanes}${deco}${ros}</g>`;
  }

  private cell(a: number): Cell {
    return this.kind === 'spears' ? spearCell(a) : lineCell(a, this.kind === 'pompeii');
  }

  private pathIdx(p: number, a: number) {
    const cfg = this.state!.cfg;
    for (let i = 0; i < boardSize(cfg); i++) if (absOf(cfg, p, i) === a) return i;
    return -9;
  }

  /** Сторона лотка снятых шашек игрока p: у его дома (в табуле, где дом общий, у чёрных — с другого края). */
  private trayOf(p: number) {
    const cfg = this.state!.cfg;
    const c = this.cell(absOf(cfg, p, boardSize(cfg) - 3));
    let left = c.x < W / 2;
    if (sharedPath(cfg) && p === 1) left = !left;
    const edge = this.kind === 'pompeii' ? 24 : F + T / 2 - 4;
    return { x: left ? edge : W - edge, bottom: c.bottom };
  }

  /** Желоб с шашками на руке (римские игры): на другом борту от снятых. */
  private handOf(p: number) {
    const cfg = this.state!.cfg;
    const tr = this.trayOf(p);
    return { x: W - tr.x, bottom: isLines(cfg) ? tr.bottom : this.cell(absOf(cfg, p, 2)).bottom };
  }

  /** Центр k-й снятой шашки в лотке (от торца лотка к середине доски). */
  private offY(tr: { bottom: boolean }, k: number) {
    return tr.bottom ? H - F - 18 - k * OFF_STEP : F + 18 + k * OFF_STEP;
  }

  /** Снятая шашка, стоящая на ребре: тот же точёный бок — дерево, бороздки по ободу, скруглённые торцы, лак. */
  private edgeSvg(p: number, x: number, y: number) {
    const wood = p === 0 ? 'url(#ndWL)' : 'url(#ndWD)';
    const edge = p === 0 ? '#7a5a34' : '#050302';
    const groove = p === 0 ? '#8a6438' : '#000';
    const lite = p === 0 ? '#fff6e0' : '#9a826c';
    const w = 2 * R - 6;
    const t = OFF_STEP - 1;
    return `<g transform="translate(${x},${y})">
      <rect x="${-w / 2}" y="${-t / 2}" width="${w}" height="${t}" rx="${t / 2.4}" fill="${edge}"/>
      <rect x="${-w / 2 + 1.2}" y="${-t / 2 + 1}" width="${w - 2.4}" height="${t - 2}" rx="${t / 2.8}" fill="${wood}"/>
      <path d="M${-w / 2 + 5} -2.2H${w / 2 - 5}M${-w / 2 + 5} 2.6H${w / 2 - 5}" stroke="${groove}" stroke-width="1.1" opacity=".5"/>
      <path d="M${-w / 2 + 5} -1.2H${w / 2 - 5}" stroke="${lite}" stroke-width=".7" opacity=".45"/>
      <rect x="${-w / 2 + 1.2}" y="${-t / 2 + 1}" width="${w - 2.4}" height="${t - 2}" rx="${t / 2.8}" fill="url(#ndRim)"/>
      <rect x="${-w / 2 + 1.2}" y="${-t / 2 + 1}" width="${w - 2.4}" height="${t - 2}" rx="${t / 2.8}" fill="url(#ndRimEnds)"/>
    </g>`;
  }

  private barPos(p: number, k: number) {
    // белые на баре — в верхней половине, чёрные — в нижней (ближе к дому, куда входить)
    const top = p === 0;
    return { x: this.kind === 'pompeii' ? STONE_MID : BAR_X, y: top ? H / 2 - R - 8 - k * 2 * R * 0.7 : H / 2 + R + 8 + k * 2 * R * 0.7 };
  }

  /** Точёная деревянная шашка: волокна, бороздки, фаска, блик лака. */
  private checkerSvg(p: number, x: number, y: number, extra = '') {
    const wood = p === 0 ? 'url(#ndWL)' : 'url(#ndWD)';
    const edge = p === 0 ? '#8a6a40' : '#0a0503';
    const groove = p === 0 ? '#9a7448' : '#000';
    const lite = p === 0 ? '#fff6e0' : '#8a6a52';
    // поворот волокон у каждой шашки свой — по координатам
    const rot = Math.round((x * 7.3 + y * 3.1) % 360);
    return `<g class="nd-ch" transform="translate(${x},${y})" ${extra}><g filter="url(#ndShadow)">
      <circle r="${R}" fill="${edge}"/>
      <circle r="${R - 1.5}" fill="${wood}" transform="rotate(${rot})"/>
      <circle r="${R - 1.5}" fill="url(#ndBevel)"/>
      <circle r="${R - 9}" fill="none" stroke="${groove}" stroke-width="1.6" opacity=".55"/>
      <circle r="${R - 7.8}" fill="none" stroke="${lite}" stroke-width="1" opacity=".5"/>
      <circle r="${R - 17}" fill="none" stroke="${groove}" stroke-width="1.2" opacity=".45"/>
      <circle r="${R - 16}" fill="none" stroke="${lite}" stroke-width=".8" opacity=".4"/>
      <circle r="2.2" fill="${groove}" opacity=".35"/>
      <circle r="${R - 1.5}" fill="url(#ndGloss)"/>
    </g><circle class="nd-ring" r="${R + 4}" fill="none"/></g>`;
  }

  private label(x: number, y: number, n: number, p: number) {
    return `<text x="${x}" y="${y}" class="nd-count" fill="${p === 0 ? '#3a2a10' : '#f3e2bc'}" transform="rotate(${this.flipped ? 180 : 0} ${x} ${y})">${n}</text>`;
  }

  private render() {
    const m = this.model;
    let s = '';
    const movable = new Set(this.steps.map((st) => st.from));
    const me = this.actSeat;
    for (let a = 0; a < m.pts.length; a++) {
      const v = m.pts[a];
      if (!v) continue;
      const p = v > 0 ? 0 : 1;
      // плакото: зажатая шашка соперника — в основании стопки
      const pinned = m.pin && m.pin[a] >= 0 ? m.pin[a] : -1;
      const shift = pinned >= 0 ? 1 : 0;
      const n = Math.abs(v);
      const c = this.cell(a);
      const x = c.x;
      const idx = me === p ? this.pathIdx(p, a) : -9;
      if (pinned >= 0) s += this.checkerSvg(pinned, x, stackY(c, 0, n + 1), ' class-add="pinned"');
      for (let k = 0; k < n; k++) {
        const y = stackY(c, k + shift, n + shift);
        const top = k === n - 1;
        const cls = top && movable.has(idx) ? ` data-from="${idx}" class-add="${this.selected === idx ? 'selected' : 'movable'}"` : '';
        s += this.checkerSvg(p, x, y, cls);
      }
      if (n > capOf(c)) s += this.label(x, stackY(c, n - 1, n), n, p);
    }
    for (const p of [0, 1]) {
      for (let k = 0; k < m.bar[p]; k++) {
        const { x, y } = this.barPos(p, Math.min(k, 3));
        const top = k === m.bar[p] - 1;
        const cls = top && me === p && movable.has(BAR) ? ` data-from="${BAR}" class-add="${this.selected === BAR ? 'selected' : 'movable'}"` : '';
        s += this.checkerSvg(p, x, y, cls);
      }
      if (m.bar[p] > 1) {
        const { x, y } = this.barPos(p, Math.min(m.bar[p] - 1, 3));
        s += this.label(x, y, m.bar[p], p);
      }
      // римские игры: шашки на руке — на ребре в желобе; верхнюю можно взять, если на баре пусто
      const hand = m.hand?.[p] ?? 0;
      if (hand) {
        const hd = this.handOf(p);
        let stack = '';
        for (let k = 0; k < hand; k++) stack += this.edgeSvg(p, hd.x, this.offY(hd, k));
        s += `<g filter="url(#ndShadow)">${stack}</g>`;
        const ly = this.offY(hd, hand) + (hd.bottom ? -6 : 6);
        s += `<g class="nd-offn" transform="translate(${hd.x},${ly}) rotate(${this.flipped ? 180 : 0})"><rect x="-17" y="-12" width="34" height="24" rx="12"/><text y="1">${hand}</text></g>`;
        if (me === p && movable.has(BAR) && !m.bar[p]) {
          const y0 = Math.min(this.offY(hd, 0), this.offY(hd, hand - 1)) - 14;
          const y1 = Math.max(this.offY(hd, 0), this.offY(hd, hand - 1)) + 14;
          s += `<g class="nd-ch nd-hand" data-from="${BAR}" class-add="${this.selected === BAR ? 'selected' : 'movable'}"><rect class="nd-ring" x="${hd.x - 31}" y="${y0}" width="62" height="${y1 - y0}" rx="14" fill="#fff" fill-opacity="0"/></g>`;
        }
      }
      // снятые шашки — стопкой на ребре в лотке, у открытого конца стопки — сколько снято
      const tr = this.trayOf(p);
      if (m.off[p]) {
        let stack = '';
        for (let k = 0; k < m.off[p]; k++) stack += this.edgeSvg(p, tr.x, this.offY(tr, k));
        s += `<g filter="url(#ndShadow)">${stack}</g>`;
        const ly = this.offY(tr, m.off[p]) + (tr.bottom ? -6 : 6);
        s += `<g class="nd-offn" transform="translate(${tr.x},${ly}) rotate(${this.flipped ? 180 : 0})"><rect x="-17" y="-12" width="34" height="24" rx="12"/><text y="1">${m.off[p]}</text></g>`;
      }
    }
    this.gCheckers.innerHTML = s.replace(/ class-add="(\w+)"/g, (_m, c) => ` data-cls="${c}"`);
    this.gCheckers.querySelectorAll<SVGGElement>('[data-cls]').forEach((el) => el.classList.add(el.dataset.cls!));
    this.renderMarks();
    this.renderCube();
  }

  /** Куда может пойти шашка from: пункт пути (или OFF) и кубик; chain — та же шашка на сумму костей (ходы подряд). */
  private targetsOf(from: number) {
    const st = this.state!;
    const out: { to: number; die: number; label: string; chain?: Step[] }[] = [];
    for (const step of this.steps.filter((x) => x.from === from)) {
      const to = targetOf(st, step);
      if (to == null || out.some((o) => o.to === to)) continue;
      out.push({ to, die: step.die, label: String(step.die) });
    }
    // сумма костей одной шашкой: ход за ходом той же шашкой, пока ход у нас (промежуточные пункты должны быть открыты)
    const seat = st.cur;
    const rng = new SeededRng(1);
    const walk = (s: State, at: number, path: Step[]) => {
      if (path.length >= 4 || s.cur !== seat || s.phase !== 'move') return;
      for (const step of legalSteps(s).filter((x) => x.from === at)) {
        const to = targetOf(s, step);
        if (to == null) continue;
        const r = apply(s, seat, { type: 'move', from: step.from, die: step.die }, rng);
        if (!r) continue;
        const chain = [...path, step];
        if (chain.length > 1 && !out.some((o) => o.to === to)) out.push({ to, die: -1, label: chain.map((c) => c.die).join('+'), chain });
        if (to !== OFF) walk(r.state, to, chain);
      }
    };
    if (from !== BAR) walk(st, from, []);
    return out;
  }

  /** Сумма костей: остальные ходы цепочки — после того, как пришло новое положение. */
  private chain: Step[] = [];
  private chainSeat = -1;

  private renderMarks() {
    let s = '';
    let hi = '';
    const from = this.selected ?? this.hover;
    if (from != null && this.state && this.actSeat != null && this.steps.some((x) => x.from === from)) {
      const st = this.state;
      const p = this.actSeat;
      // выбранная шашка — цели можно нажимать; под курсором — только подсказка
      const live = this.selected != null;
      const cls = live ? 'nd-target' : 'nd-target nd-preview';
      for (const { to, die, label } of this.targetsOf(from)) {
        const attrs = live ? ` data-to="${to}" data-die="${die}"` : '';
        if (to === OFF) {
          const tr = this.trayOf(p);
          const y = tr.bottom ? H - F - 150 : F + 150;
          s += `<g class="${cls}"${attrs}><rect x="${tr.x - 32}" y="${y - 140}" width="64" height="280" rx="10" class="t-bg"/><text x="${tr.x}" y="${y}" class="t-label" transform="rotate(${this.flipped ? 180 : 0} ${tr.x} ${y})">${label}</text></g>`;
          continue;
        }
        const a = absOf(st.cfg, p, to);
        const c = this.cell(a);
        const x = c.x;
        // сам пункт-«копьё» (дорожка 12 линий) светится под шашками
        if (this.kind === 'spears') {
          const base = c.bottom ? H - F - 12 : F + 12;
          hi += `<path class="${cls} nd-pt-hi"${attrs} d="${spearPath(x, base, PH - 12, PW - 22, c.bottom ? -1 : 1)}"/>`;
        } else hi += `<rect class="${cls} nd-pt-hi"${attrs} ${laneRect(a, this.kind === 'pompeii')}/>`;
        const n = Math.abs(this.model.pts[a]) + (this.model.pts[a] * (p === 0 ? 1 : -1) < 0 ? 0 : 1);
        const y = stackY(c, Math.min(n - 1, capOf(c) - 1), Math.max(n, 1));
        s += `<g class="${cls}${die < 0 ? ' nd-sum' : ''}"${attrs}><circle cx="${x}" cy="${y}" r="${R + 2}" class="t-bg"/><text x="${x}" y="${y}" class="t-label${label.length > 2 ? ' t-small' : ''}" transform="rotate(${this.flipped ? 180 : 0} ${x} ${y})">${label}</text></g>`;
      }
    }
    this.gHi.innerHTML = hi;
    this.gMarks.innerHTML = s;
  }

  private renderCube() {
    const st = this.state;
    if (!st || !st.cfg.cube) {
      this.gCube.innerHTML = '';
      return;
    }
    const { value, owner } = st.cube;
    // в центре или у владельца (у его дома по вертикали)
    let y = H / 2;
    if (owner >= 0) y = this.trayOf(owner).bottom ? H - F - 60 : F + 60;
    const txt = value === 1 ? 64 : value;
    this.gCube.innerHTML = `<g transform="translate(${BAR_X},${y})"><rect x="-24" y="-24" width="48" height="48" rx="8" fill="#f8f1e0" stroke="#3a2a10" stroke-width="2.5"/><text class="nd-cube" transform="rotate(${this.flipped ? 180 : 0})" y="1">${txt}</text></g>`;
  }

  // ---------------------------------------------------------------- состояние

  private syncModel(s: State) {
    this.model = { pts: s.pts.slice(), bar: [s.bar[0], s.bar[1]], hand: s.hand ? [s.hand[0], s.hand[1]] : undefined, off: [s.off[0], s.off[1]], pin: s.pin ? s.pin.slice() : undefined };
  }

  private bottomSeat() {
    const mine = this.ctx.mySeats;
    if (mine.length === 1) return mine[0];
    return 0;
  }

  setView(s: State) {
    this.state = s;
    const kind = s.cfg.mode === 'pompeii' ? 'pompeii' : isLines(s.cfg) ? 'lines' : 'spears';
    if (kind !== this.kind) {
      this.kind = kind;
      R = kind === 'pompeii' ? STONE_R : 29;
      this.build();
      // у мраморной плиты нет деревянных «кож»
      this.skinBtn.hidden = this.ctx.demo || kind === 'pompeii';
    }
    // смотрим на доску со стороны своих шашек: дом — внизу справа (у чёрных доска повёрнута); в табуле путь общий — не вертим
    const flip = !sharedPath(s.cfg) && this.bottomSeat() === 1;
    if (flip !== this.flipped) {
      this.flipped = flip;
      this.rotor.setAttribute('transform', flip ? `rotate(180 ${W / 2} ${H / 2})` : '');
    }
    this.syncModel(s);
    this.gBanner.innerHTML = '';
    this.render();
    this.showDice(s);
  }

  /** Лоток на n костей (в римских играх — три; розыгрыш первого хода — всегда две). */
  private ensureTray(n: number) {
    if (this.tray.dice.length === n) return;
    this.trayEl.innerHTML = '';
    this.tray = new DiceTray(this.trayEl, n);
  }

  private showDice(s: State) {
    if (s.dice[0]) {
      this.ensureTray(s.dice.length);
      this.tray.show(s.dice, s.phase === 'move' ? this.usedFlags(s) : s.dice.map(() => true));
    } else this.tray.show(null, [true, true, true]);
    const left = s.phase === 'move' && s.left.length ? `Осталось: <b>${s.left.join(' · ')}</b>` : '';
    const q = s.queue.length ? ` · дальше ${s.queue.map((v) => `${v}:${v}`).join(', ')}` : '';
    const sc = s.cfg.target > 1 ? `<div>Матч до ${s.cfg.target}: <b>${s.score[0]}:${s.score[1]}</b>${s.crawford ? ' · партия Кроуфорда' : ''}</div>` : '';
    this.leftInfo.innerHTML = `${sc}<div>${left}${q}</div>`;
  }

  private usedFlags(s: State): boolean[] {
    if (s.dice.length === 2 && s.dice[0] === s.dice[1]) return [s.left.length < 2, s.left.length < 1];
    const left = s.left.slice();
    return s.dice.map((v) => {
      const i = left.indexOf(v);
      if (i < 0) return true;
      left.splice(i, 1);
      return false;
    });
  }

  async play(events: Event[], s: State) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      switch (ev.type) {
        case 'opening': {
          const last = ev.rolls[ev.rolls.length - 1];
          this.gBanner.innerHTML = '';
          this.ensureTray(2);
          await this.tray.roll(last, speed);
          await this.banner(`${ev.first === 0 ? 'Белые' : 'Чёрные'} начинают`, 900 / speed);
          break;
        }
        case 'roll':
          this.ensureTray(ev.dice.length);
          await this.tray.roll(ev.dice, speed);
          if (ev.noMoves) {
            Sound.nomove();
            await sleep(600 / speed);
          }
          break;
        case 'stage':
          Sound.turn();
          this.tray.show([ev.value, ev.value], [false, false]);
          await sleep(450 / speed);
          break;
        case 'move':
          await this.animateMove(ev, speed);
          break;
        case 'forfeit':
          Sound.nomove();
          await sleep(400 / speed);
          break;
        case 'double':
        case 'take':
          Sound.ui();
          await sleep(300 / speed);
          break;
        case 'gameEnd':
          Sound.win();
          await this.banner(`${ev.winner === 0 ? 'Белые' : 'Чёрные'}: ${ev.kind === 'mars' ? 'марс!' : ev.kind === 'koks' ? 'кокс!' : 'победа'} +${ev.points}`, ev.matchOver ? 600 : 1800 / speed);
          break;
        default:
          break;
      }
    }
    this.state = s;
    if (!events.some((e) => e.type === 'gameEnd' && e.matchOver)) this.gBanner.innerHTML = '';
    this.syncModel(s);
    this.render();
    this.showDice(s);
  }

  private async banner(text: string, ms: number) {
    this.gBanner.innerHTML = `<g class="nd-banner"><rect x="${W / 2 - 260}" y="${H / 2 - 42}" width="520" height="84" rx="14"/><text x="${W / 2}" y="${H / 2 + 2}">${text}</text></g>`;
    await sleep(ms);
  }

  /** Координаты шашки, которую снимают / ставят на абсолютный пункт a (-1 — бар или рука, OFF — снята). */
  private spot(p: number, a: number, leaving: boolean, fromHand = false) {
    const m = this.model;
    if (a === -1 && fromHand) {
      const hd = this.handOf(p);
      return { x: hd.x, y: this.offY(hd, Math.max(0, (m.hand?.[p] ?? 1) - 1)) };
    }
    if (a === -1) return this.barPos(p, Math.max(0, Math.min(m.bar[p] - (leaving ? 1 : 0), 3)));
    if (a === OFF) {
      const tr = this.trayOf(p);
      return { x: tr.x, y: this.offY(tr, m.off[p]) };
    }
    const c = this.cell(a);
    const n = Math.abs(m.pts[a]) + (leaving ? 0 : 1);
    return { x: c.x, y: stackY(c, n - 1, n) };
  }

  private async animateMove(ev: Extract<Event, { type: 'move' }>, speed: number) {
    const p = ev.seat;
    const m = this.model;
    const sg = p === 0 ? 1 : -1;
    const a = this.spot(p, ev.fromAbs, true, ev.fromHand);
    if (ev.fromHand && m.hand) m.hand[p]--;
    else if (ev.fromAbs === -1) m.bar[p]--;
    else m.pts[ev.fromAbs] -= sg;
    let victim: { x: number; y: number } | null = null;
    if (ev.hit && ev.toAbs >= 0 && ev.toAbs !== OFF) {
      victim = this.spot(1 - p, ev.toAbs, true);
      m.pts[ev.toAbs] = 0;
    }
    const b = this.spot(p, ev.toAbs, false);
    this.render();
    const ghost = this.ghost(p, a.x, a.y);
    await this.tween(ghost, a, b, 320 / speed);
    ghost.remove();
    if (ev.toAbs === OFF) m.off[p]++;
    else m.pts[ev.toAbs] += sg;
    Sound.place();
    if (victim) {
      Sound.capture();
      const g2 = this.ghost(1 - p, victim.x, victim.y);
      const dst = this.barPos(1 - p, Math.min(m.bar[1 - p], 3));
      this.render();
      await this.tween(g2, victim, dst, 380 / speed);
      g2.remove();
      m.bar[1 - p]++;
    }
    this.render();
  }

  private ghost(p: number, x: number, y: number) {
    const g = document.createElementNS(NS, 'g');
    g.innerHTML = this.checkerSvg(p, 0, 0);
    g.setAttribute('transform', `translate(${x},${y})`);
    this.gMarks.after(g);
    return g;
  }

  private tween(el: SVGGElement, a: { x: number; y: number }, b: { x: number; y: number }, dur: number) {
    return new Promise<void>((res) => {
      if (document.hidden || dur < 30) {
        el.setAttribute('transform', `translate(${b.x},${b.y})`);
        return res();
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        const lift = Math.sin(Math.PI * t) * 0.12;
        el.setAttribute('transform', `translate(${a.x + (b.x - a.x) * e},${a.y + (b.y - a.y) * e}) scale(${1 + lift})`);
        if (t < 1) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
      setTimeout(res, dur + 200);
    });
  }

  // ---------------------------------------------------------------- ход игрока

  private clearTurn() {
    this.actSeat = null;
    this.selected = null;
    this.hover = null;
    this.steps = [];
    this.btns.innerHTML = '';
    if (this.state) this.render();
  }

  private button(a: string, text: string, primary: boolean, on: () => void) {
    // бросок и розыгрыш первого хода — ещё и тапом по доске (стол сам нажмёт кнопку с data-tap)
    const tap = a === 'roll' || a === 'opening' ? ' data-tap' : '';
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary pulse' : ''}" data-a="${a}"${tap}>${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      this.btns.innerHTML = '';
      on();
    };
    this.btns.appendChild(b);
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const s = this.state;
    // цепочка «на сумму костей» живёт только внутри своего хода (во время анимации interactive пуст — это не повод её бросать)
    if (!s || !toAct.includes(this.chainSeat)) this.chain = [];
    if (!s || s.phase === 'over' || this.ctx.demo) return;
    if (s.phase === 'opening') {
      const seat = interactive[0];
      if (seat != null) this.button('opening', 'Разыграть первый ход', true, () => this.ctx.act(seat, { type: 'opening' }));
      return;
    }
    if (s.phase === 'cube') {
      const seat = 1 - s.cur;
      if (!interactive.includes(seat)) return;
      this.button('take', `Принять (${s.cube.value * 2})`, true, () => this.ctx.act(seat, { type: 'take' }));
      this.button('drop', 'Сдаться', false, () => this.ctx.act(seat, { type: 'drop' }));
      return;
    }
    const seat = s.cur;
    if (!interactive.includes(seat)) return;
    if (s.phase === 'roll') {
      this.button('roll', 'Бросить кости', true, () => this.ctx.act(seat, { type: 'roll' }));
      if (mayDouble(s)) this.button('double', `Удвоить до ${s.cube.value * 2}`, false, () => this.ctx.act(seat, { type: 'double' }));
      return;
    }
    this.actSeat = seat;
    this.steps = legalSteps(s);
    // продолжение хода «на сумму костей» — тем же игроком выбранная цепочка
    const next = this.chain.shift();
    if (next && this.steps.some((x) => x.from === next.from && x.die === next.die)) {
      this.send(next, true);
      return;
    }
    this.chain = [];
    const froms = new Set(this.steps.map((x) => x.from));
    if (froms.size === 1) this.selected = [...froms][0];
    this.render();
  }

  private select(from: number | null) {
    if (this.actSeat == null) return;
    this.selected = from != null && this.steps.some((x) => x.from === from) ? from : null;
    this.render();
  }

  private pickTarget(to: number, die: number) {
    if (this.actSeat == null || this.selected == null) return;
    const s = this.state!;
    if (die < 0) {
      const t = this.targetsOf(this.selected).find((x) => x.to === to && x.chain);
      if (t?.chain) {
        this.chainSeat = this.actSeat;
        // остаток цепочки — до отправки: локальная комната отвечает сразу
        this.chain = t.chain.slice(1);
        this.send(t.chain[0], true);
      }
      return;
    }
    const st = this.steps.find((x) => x.from === this.selected && x.die === die && targetOf(s, x) === to);
    if (st) this.send(st);
  }

  private send(st: Step, keepChain = false) {
    const seat = this.actSeat;
    if (seat == null) return;
    if (!keepChain) this.chain = [];
    this.clearTurn();
    this.ctx.act(seat, { type: 'move', from: st.from, die: st.die });
  }

  status(s: State, _toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (s.phase === 'over') return s.winner != null ? `Победа: ${name(s.winner)}!` : 'Партия окончена';
    if (s.phase === 'opening') return interactive.length ? 'Разыграйте первый ход' : 'Розыгрыш первого хода…';
    if (s.phase === 'cube') return `${name(s.cur)} предлагает удвоить до ${s.cube.value * 2}` + (interactive.includes(1 - s.cur) ? ' — принять?' : '');
    const who = name(s.cur);
    if (!interactive.includes(s.cur)) return s.phase === 'roll' ? `${who} бросает…` : `${who} ходит…`;
    if (s.phase === 'roll') return `Ход: ${who} — бросайте кости`;
    return `${who}: ходите (${s.left.join(', ')})${s.stealing ? ' — за соперника' : ''}`;
  }

  playerStats(s: State, seat: number) {
    const sc = s.cfg.target > 1 ? `<span title="Очки в матче">★ ${s.score[seat]}</span>` : '';
    const hand = s.hand?.[seat] ? `<span title="На руке — ещё не вошли">✋ ${s.hand[seat]}</span>` : '';
    return `${sc}<span title="Осталось пройти">⟶ ${pipCount(s, seat)}</span>${hand}<span title="Снято">⬆ ${s.off[seat]}/${checkersOf(s.cfg)}</span>`;
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<State, Event> {
  return new NardyView();
}
