/* Нарды — отрисовка: резная доска (SVG), шашки, бар, лотки снятых шашек, куб; кубики и кнопки в панели. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { absOf, BAR, CHECKERS, legalSteps, mayDouble, OFF, pipCount, targetOf, type Event, type State, type Step } from './engine';
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
const R = 29; // радиус шашки
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

function stackY(bottom: boolean, k: number, n: number) {
  const sp = n > 5 ? (STACK - 2 * R) / (n - 1) : 2 * R;
  return bottom ? H - F - R - k * sp : F + R + k * sp;
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
  off: [number, number];
}

class NardyView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private rotor!: SVGGElement;
  private gCheckers!: SVGGElement;
  private gMarks!: SVGGElement;
  private gCube!: SVGGElement;
  private gBanner!: SVGGElement;
  private tray!: DiceTray;
  private btns!: HTMLElement;
  private leftInfo!: HTMLElement;
  private state: State | null = null;
  private model: Model = { pts: new Array(24).fill(0), bar: [0, 0], off: [0, 0] };
  private flipped = false;
  private skin: Skin = loadSkin();
  private actSeat: number | null = null;
  private selected: number | null = null;
  private steps: Step[] = [];
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
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
        ${ctx.demo ? '' : '<div class="hint small-hint">Пробел — бросок. Нажмите на шашку, затем на подсвеченный пункт.</div>'}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.tray = new DiceTray(ctl.querySelector('.nd-tray') as HTMLElement);
    this.btns = ctl.querySelector('.nd-btns') as HTMLElement;
    this.leftInfo = ctl.querySelector('.nd-left') as HTMLElement;
    const skinBtn = ctl.querySelector('.nd-skin') as HTMLButtonElement;
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
      <filter id="ndShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="2" dy="3.5" stdDeviation="2.4" flood-color="#1a0a02" flood-opacity=".6"/></filter>
      <filter id="ndInset" x="-5%" y="-5%" width="110%" height="110%"><feGaussianBlur stdDeviation="7"/></filter>
      <filter id="ndInlayShadow" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="1" stdDeviation=".8" flood-color="#000" flood-opacity=".6"/></filter>
      <clipPath id="ndClipL"><rect x="${fieldL}" y="${F}" width="${half}" height="${fh}"/></clipPath>
      <clipPath id="ndClipR"><rect x="${rightL}" y="${F}" width="${half}" height="${fh}"/></clipPath>
      <clipPath id="ndClipAll"><rect width="${W}" height="${H}" rx="20"/></clipPath>
    </defs>`;
    s += `<g id="ndRotor">`;
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
    s += hinge(BAR_X, H * 0.2) + hinge(BAR_X, H * 0.8);
    // пункты-«копья»: инкрустация из клёна (тёмная доска) или выжженный контур с узором (светлая)
    let pts = '';
    let fil = '';
    for (let a = 0; a < 24; a++) {
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
    s += `<g id="ndCheckers"></g><g id="ndMarks"></g><g id="ndCube"></g></g><g id="ndBanner"></g>`;
    this.svg.innerHTML = s;
    this.rotor = this.svg.querySelector('#ndRotor') as SVGGElement;
    this.gCheckers = this.svg.querySelector('#ndCheckers') as SVGGElement;
    this.gMarks = this.svg.querySelector('#ndMarks') as SVGGElement;
    this.gCube = this.svg.querySelector('#ndCube') as SVGGElement;
    this.gBanner = this.svg.querySelector('#ndBanner') as SVGGElement;
    if (this.flipped) this.rotor.setAttribute('transform', `rotate(180 ${W / 2} ${H / 2})`);
  }

  private pathIdx(p: number, a: number) {
    for (let i = 0; i < 24; i++) if (absOf(this.state!.cfg, p, i) === a) return i;
    return -9;
  }

  /** Сторона лотка снятых шашек игрока p: у его дома. */
  private trayOf(p: number) {
    const a = absOf(this.state!.cfg, p, 21);
    const { x, bottom } = pointGeo(a);
    return { x: x < W / 2 ? F + T / 2 - 4 : W - F - T / 2 + 4, bottom };
  }

  private barPos(p: number, k: number) {
    // белые на баре — в верхней половине, чёрные — в нижней (ближе к дому, куда входить)
    const top = p === 0;
    return { x: BAR_X, y: top ? H / 2 - R - 8 - k * 2 * R * 0.7 : H / 2 + R + 8 + k * 2 * R * 0.7 };
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
    for (let a = 0; a < 24; a++) {
      const v = m.pts[a];
      if (!v) continue;
      const p = v > 0 ? 0 : 1;
      const n = Math.abs(v);
      const { x, bottom } = pointGeo(a);
      const idx = me === p ? this.pathIdx(p, a) : -9;
      for (let k = 0; k < n; k++) {
        const y = stackY(bottom, k, n);
        const top = k === n - 1;
        const cls = top && movable.has(idx) ? ` data-from="${idx}" class-add="${this.selected === idx ? 'selected' : 'movable'}"` : '';
        s += this.checkerSvg(p, x, y, cls);
      }
      if (n > 5) s += this.label(x, stackY(bottom, n - 1, n), n, p);
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
      // снятые шашки — плашками в лотке
      const tr = this.trayOf(p);
      for (let k = 0; k < m.off[p]; k++) {
        const y = tr.bottom ? H - F - 20 - k * 17 : F + 20 + k * 17;
        s += `<rect x="${tr.x - 24}" y="${y - 7}" width="48" height="14" rx="5" fill="${p === 0 ? '#efe3c6' : '#2e231d'}" stroke="${p === 0 ? '#9a8a6a' : '#000'}" stroke-width="1.5"/>`;
      }
    }
    this.gCheckers.innerHTML = s.replace(/ class-add="(\w+)"/g, (_m, c) => ` data-cls="${c}"`);
    this.gCheckers.querySelectorAll<SVGGElement>('[data-cls]').forEach((el) => el.classList.add(el.dataset.cls!));
    this.renderMarks();
    this.renderCube();
  }

  private renderMarks() {
    let s = '';
    if (this.selected != null && this.state && this.actSeat != null) {
      const st = this.state;
      const p = this.actSeat;
      const seen = new Set<number>();
      for (const step of this.steps.filter((x) => x.from === this.selected)) {
        const to = targetOf(st, step);
        if (to == null || seen.has(to)) continue;
        seen.add(to);
        if (to === OFF) {
          const tr = this.trayOf(p);
          const y = tr.bottom ? H - F - 150 : F + 150;
          s += `<g class="nd-target" data-to="${to}" data-die="${step.die}"><rect x="${tr.x - 32}" y="${y - 140}" width="64" height="280" rx="10" class="t-bg"/><text x="${tr.x}" y="${y}" class="t-label" transform="rotate(${this.flipped ? 180 : 0} ${tr.x} ${y})">${step.die}</text></g>`;
          continue;
        }
        const a = absOf(st.cfg, p, to);
        const { x, bottom } = pointGeo(a);
        const n = Math.abs(this.model.pts[a]) + (this.model.pts[a] * (p === 0 ? 1 : -1) < 0 ? 0 : 1);
        const y = stackY(bottom, Math.min(n - 1, 4), Math.max(n, 1));
        s += `<g class="nd-target" data-to="${to}" data-die="${step.die}"><circle cx="${x}" cy="${y}" r="${R + 2}" class="t-bg"/><text x="${x}" y="${y}" class="t-label" transform="rotate(${this.flipped ? 180 : 0} ${x} ${y})">${step.die}</text></g>`;
      }
    }
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
    this.model = { pts: s.pts.slice(), bar: [s.bar[0], s.bar[1]], off: [s.off[0], s.off[1]] };
  }

  private bottomSeat() {
    const mine = this.ctx.mySeats;
    if (mine.length === 1) return mine[0];
    return 0;
  }

  setView(s: State) {
    this.state = s;
    // смотрим на доску со стороны своих шашек: дом — внизу справа (у чёрных доска повёрнута)
    const flip = this.bottomSeat() === 1;
    if (flip !== this.flipped) {
      this.flipped = flip;
      this.rotor.setAttribute('transform', flip ? `rotate(180 ${W / 2} ${H / 2})` : '');
    }
    this.syncModel(s);
    this.gBanner.innerHTML = '';
    this.render();
    this.showDice(s);
  }

  private showDice(s: State) {
    if (s.dice[0]) this.tray.show(s.dice, s.phase === 'move' ? this.usedFlags(s) : [true, true]);
    else this.tray.show(null, [true, true]);
    const left = s.phase === 'move' && s.left.length ? `Осталось: <b>${s.left.join(' · ')}</b>` : '';
    const q = s.queue.length ? ` · дальше ${s.queue.map((v) => `${v}:${v}`).join(', ')}` : '';
    const sc = s.cfg.target > 1 ? `<div>Матч до ${s.cfg.target}: <b>${s.score[0]}:${s.score[1]}</b>${s.crawford ? ' · партия Кроуфорда' : ''}</div>` : '';
    this.leftInfo.innerHTML = `${sc}<div>${left}${q}</div>`;
  }

  private usedFlags(s: State): boolean[] {
    if (s.dice[0] === s.dice[1]) return [s.left.length < 2, s.left.length < 1];
    return [!s.left.includes(s.dice[0]), !s.left.includes(s.dice[1]) || (s.dice[0] === s.dice[1])];
  }

  async play(events: Event[], s: State) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      switch (ev.type) {
        case 'opening': {
          const last = ev.rolls[ev.rolls.length - 1];
          this.gBanner.innerHTML = '';
          await this.tray.roll(last, speed);
          await this.banner(`${ev.first === 0 ? 'Белые' : 'Чёрные'} начинают`, 900 / speed);
          break;
        }
        case 'roll':
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

  /** Координаты шашки, которую снимают / ставят на абсолютный пункт a (-1 — бар, 24 — снята). */
  private spot(p: number, a: number, leaving: boolean) {
    const m = this.model;
    if (a === -1) return this.barPos(p, Math.max(0, Math.min(m.bar[p] - (leaving ? 1 : 0), 3)));
    if (a === 24) {
      const tr = this.trayOf(p);
      const k = m.off[p];
      return { x: tr.x, y: tr.bottom ? H - F - 20 - k * 17 : F + 20 + k * 17 };
    }
    const { x, bottom } = pointGeo(a);
    const n = Math.abs(m.pts[a]) + (leaving ? 0 : 1);
    return { x, y: stackY(bottom, n - 1, n) };
  }

  private async animateMove(ev: Extract<Event, { type: 'move' }>, speed: number) {
    const p = ev.seat;
    const m = this.model;
    const sg = p === 0 ? 1 : -1;
    const a = this.spot(p, ev.fromAbs, true);
    if (ev.fromAbs === -1) m.bar[p]--;
    else m.pts[ev.fromAbs] -= sg;
    let victim: { x: number; y: number } | null = null;
    if (ev.hit && ev.toAbs >= 0 && ev.toAbs < 24) {
      victim = this.spot(1 - p, ev.toAbs, true);
      m.pts[ev.toAbs] = 0;
    }
    const b = this.spot(p, ev.toAbs, false);
    this.render();
    const ghost = this.ghost(p, a.x, a.y);
    await this.tween(ghost, a, b, 320 / speed);
    ghost.remove();
    if (ev.toAbs === 24) m.off[p]++;
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
    clearTimeout(this.autoTimer);
    this.actSeat = null;
    this.selected = null;
    this.steps = [];
    this.btns.innerHTML = '';
    if (this.state) this.render();
  }

  private button(a: string, text: string, primary: boolean, on: () => void) {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary pulse' : ''}" data-a="${a}">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      this.btns.innerHTML = '';
      on();
    };
    this.btns.appendChild(b);
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.clearTurn();
    const s = this.state;
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
    const froms = new Set(this.steps.map((x) => x.from));
    if (froms.size === 1) this.selected = [...froms][0];
    this.render();
    const distinct = new Set(this.steps.map((x) => x.from + ':' + targetOf(s, x)));
    if (this.ctx.autoSingle() && distinct.size === 1) {
      const st = this.steps[0];
      this.autoTimer = setTimeout(() => {
        if (this.state === s && this.actSeat === seat) this.send(st);
      }, 450 / this.ctx.speed());
    }
  }

  private select(from: number | null) {
    if (this.actSeat == null) return;
    this.selected = from != null && this.steps.some((x) => x.from === from) ? from : null;
    this.render();
    // одна цель — ходим сразу
    if (this.selected != null) {
      const s = this.state!;
      const opts = this.steps.filter((x) => x.from === this.selected);
      const targets = new Set(opts.map((x) => targetOf(s, x)));
      if (targets.size === 1 && opts.length >= 1) this.send(opts.sort((a, b) => b.die - a.die)[0]);
    }
  }

  private pickTarget(to: number, die: number) {
    if (this.actSeat == null || this.selected == null) return;
    const s = this.state!;
    const st = this.steps.find((x) => x.from === this.selected && x.die === die && targetOf(s, x) === to);
    if (st) this.send(st);
  }

  private send(st: Step) {
    const seat = this.actSeat;
    if (seat == null) return;
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
    return `${sc}<span title="Осталось пройти">⟶ ${pipCount(s, seat)}</span><span title="Снято">⬆ ${s.off[seat]}/${CHECKERS}</span>`;
  }

  destroy() {
    clearTimeout(this.autoTimer);
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<State, Event> {
  return new NardyView();
}
