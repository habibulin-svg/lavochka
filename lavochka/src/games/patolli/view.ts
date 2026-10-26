/* Патолли — отрисовка: лист Флорентийского кодекса (крест с него стёрт, tools/patolli/prep.py), поверх — крест кодом
 * точно по нарисованному: косой «X», два столбца в луче, тёмные треугольники-«песочные часы», полукруглые концы.
 * Фишки — полированные камешки, у каждого игрока расписная чаша у конца своего луча, ставки — нефритовые бусины,
 * кон — на циновке между нижними лучами. Ход — касание подсвеченной фишки (или чаши), затем клетки, куда её поставить. */
import { Sound } from '../../core/audio';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { CELLS, cellOf, legalMoves, type Event, type Move, type State } from './engine';
import { SEATS } from './def';
import './patolli.css';

const TEX = `${import.meta.env.BASE_URL}patolli/`;
const NS = 'http://www.w3.org/2000/svg';

type Pt = [number, number];

/** Лист кодекса — 984×982; крест — по нарисованному на листе: центр и направления лучей (A — из левого верхнего угла
 * в правый нижний, B — из правого верхнего в левый нижний), полуширина луча h, длина клетки L. */
const SW = 984;
const SH = 982;
const C: Pt = [460.35, 484.98];
const EA: Pt = [0.66348, 0.7482];
const EB: Pt = [-0.63957, 0.76873];
/** Наружу по лучам 0…3: левый верхний, правый верхний, правый нижний, левый нижний (по часовой). */
const DIRS: Pt[] = [
  [-EA[0], -EA[1]],
  [-EB[0], -EB[1]],
  EA,
  EB,
];
const HB = 54;
const L = 78;
const TIP = HB + 6 * L;
const PR = 20;
/** Кон — на свободном месте между нижними лучами. */
const POT: Pt = [470, 850];

/** Точка луча k: along — от центра наружу, across — к следующему лучу. */
function pt(k: number, along: number, across: number): Pt {
  const d = DIRS[k];
  const a = DIRS[(k + 1) % 4];
  return [C[0] + along * d[0] + across * a[0], C[1] + along * d[1] + across * a[1]];
}

/** Клетка → [луч, ряд (−1 — середина), сторона −1/+1]. */
function cellGeo(cell: number): [number, number, number] {
  const k = Math.floor(cell / 13);
  const j = cell % 13;
  if (j === 12) return [k, -1, 1];
  return j < 6 ? [k, j, -1] : [k, 11 - j, 1];
}

function cellCenter(cell: number): Pt {
  const [k, row, side] = cellGeo(cell);
  if (row < 0) return pt(k, HB / 2, HB / 2);
  const along = row === 5 ? HB + 5 * L + L * 0.45 : HB + (row + 0.5) * L;
  return pt(k, along, (side * HB) / 2);
}

function cellPoly(cell: number): string {
  const [k, row, side] = cellGeo(cell);
  let a0: number;
  let a1: number;
  let b0: number;
  let b1: number;
  if (row < 0) [a0, a1, b0, b1] = [0, HB, 0, HB];
  else {
    a0 = HB + row * L;
    a1 = row === 5 ? TIP - HB * 0.35 : a0 + L;
    [b0, b1] = side < 0 ? [-HB, 0] : [0, HB];
  }
  return [pt(k, a0, b0), pt(k, a1, b0), pt(k, a1, b1), pt(k, a0, b1)].map((p) => p.map((x) => x.toFixed(1)).join(',')).join(' ');
}

/** Чаша места — за концом его луча, на углу листа. */
const bowlAt = (arm: number): Pt => pt(arm, TIP + 62, 0);
/** Бусины-ставки — у чаши, вдоль края листа к середине. */
function beadsAt(arm: number): Pt {
  const [x, y] = bowlAt(arm);
  return [x + (C[0] > x ? 112 : -112), y];
}

const f = (n: number) => n.toFixed(1);

export class PatolliView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private wrap!: HTMLElement;
  private svg!: SVGSVGElement;
  private gBowls!: SVGGElement;
  private gPieces!: SVGGElement;
  private gTargets!: SVGGElement;
  private gFx!: SVGGElement;
  private beanEls: HTMLImageElement[] = [];
  private trayVal!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private s: State | null = null;
  private els = new Map<string, SVGGElement>();
  private moves: Move[] = [];
  private rollSeat: number | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space' || this.rollBtn.disabled || !this.rollBtn.isConnected) return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    e.preventDefault();
    this.roll();
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="pt-wrap"><svg class="pt-board" xmlns="${NS}" viewBox="-34 -34 ${SW + 68} ${SH + 68}" preserveAspectRatio="xMidYMid meet">
        ${this.defs()}
        <image href="${TEX}codex.webp" x="0" y="0" width="${SW}" height="${SH}" class="pt-sheet"/>
        <g class="pt-cross">${this.cross()}</g>
        <g class="pt-pot-g">${this.potMat()}</g>
        <g class="pt-b"></g><g class="pt-p"></g><g class="pt-t"></g><g class="pt-fx"></g></svg></div>`);
    root.appendChild(this.wrap);
    this.svg = this.wrap.querySelector('svg') as SVGSVGElement;
    this.gBowls = this.svg.querySelector('.pt-b') as SVGGElement;
    this.gPieces = this.svg.querySelector('.pt-p') as SVGGElement;
    this.gTargets = this.svg.querySelector('.pt-t') as SVGGElement;
    this.gFx = this.svg.querySelector('.pt-fx') as SVGGElement;
    const ctl = h(`<div class="pt-controls">
        <div class="pt-tray blank">${[0, 1, 2, 3, 4].map(() => `<img class="pt-bean" src="${TEX}bean.webp" alt="">`).join('')}</div>
        <div class="pt-val"></div>
        ${ctx.demo ? '' : `<button class="btn primary pt-roll" data-tap disabled>Бросить бобы</button><div class="hint small-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по доске.' : 'Пробел — бросок.'} Нажмите на подсвеченную фишку или свою чашу, затем на клетку.</div>`}
      </div>`);
    ctx.controls.appendChild(ctl);
    this.beanEls = [...ctl.querySelectorAll<HTMLImageElement>('.pt-bean')];
    this.trayVal = ctl.querySelector('.pt-val') as HTMLElement;
    this.rollBtn = (ctl.querySelector('.pt-roll') as HTMLButtonElement) || document.createElement('button');
    this.rollBtn.onclick = () => this.roll();
    const onPick = (e: MouseEvent) => {
      const el = (e.target as Element).closest('[data-from]') as SVGGElement | null;
      if (!el || !this.moves.length) return;
      e.stopPropagation();
      this.pick(Number(el.dataset.from));
    };
    this.gPieces.addEventListener('click', onPick);
    this.gBowls.addEventListener('click', onPick);
    this.gTargets.addEventListener('click', (e) => {
      const el = (e.target as Element).closest('[data-go]') as SVGGElement | null;
      if (!el || !this.s) return;
      e.stopPropagation();
      const from = Number(el.dataset.go);
      const seat = this.s.turn;
      this.clearTurn();
      Sound.unlock();
      this.ctx.act(seat, { type: 'move', from });
    });
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);
    new Image().src = `${TEX}beanm.webp`;
  }

  // ---------------------------------------------------------------- поле

  private defs() {
    const stones = SEATS.map(
      (s, i) => `<radialGradient id="pt-st${i}" cx="38%" cy="32%" r="70%"><stop offset="0" stop-color="${s.light}"/><stop offset="0.55" stop-color="${s.color}"/><stop offset="1" stop-color="${s.dark}"/></radialGradient>`,
    ).join('');
    return `<defs>${stones}
      <radialGradient id="pt-jade" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#b9e6c4"/><stop offset="0.5" stop-color="#3f9a68"/><stop offset="1" stop-color="#14502f"/></radialGradient>
      <radialGradient id="pt-clay" cx="50%" cy="40%" r="65%"><stop offset="0" stop-color="#e79a5c"/><stop offset="0.75" stop-color="#c4642a"/><stop offset="1" stop-color="#8a3c14"/></radialGradient>
      <radialGradient id="pt-bowlin" cx="50%" cy="58%" r="60%"><stop offset="0" stop-color="#9a5226"/><stop offset="1" stop-color="#5a260c"/></radialGradient>
      <pattern id="pt-weave" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="16" height="16" fill="#c9a45c"/><rect width="8" height="8" fill="#b08a42"/><rect x="8" y="8" width="8" height="8" fill="#b08a42"/>
        <path d="M0 8H16M8 0V16" stroke="#7a5a24" stroke-width="0.8"/></pattern>
      <filter id="pt-ink" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="3.2"/></filter>
      <filter id="pt-paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="9" result="n"/>
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.42  0 0 0 0 0.35  0 0 0 0 0.26  0 0 0 0.22 0" result="g"/><feComposite in="g" in2="SourceGraphic" operator="in" result="gi"/>
        <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="gi"/></feMerge></filter>
      <filter id="pt-shadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="2" dy="4" stdDeviation="2.6" flood-color="#2a1404" flood-opacity="0.55"/></filter>
      <filter id="pt-sheetsh" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="0.55"/></filter>
    </defs>`;
  }

  /** Крест: заливка бумагой, клетки, «песочные часы», полукруглые концы — тушью, чуть неровно, как от руки. */
  private cross() {
    const fill: string[] = [];
    const ink: string[] = [];
    const tri: string[] = [];
    const P = (p: Pt) => `${f(p[0])},${f(p[1])}`;
    const mid = [0, 1, 2, 3].map((k) => pt(k, HB, HB));
    fill.push(`<path d="M${mid.map(P).join('L')}Z"/>`);
    for (let k = 0; k < 4; k++) {
      const a = DIRS[k];
      const b = DIRS[(k + 1) % 4];
      const m = `matrix(${a[0]},${a[1]},${b[0]},${b[1]},${C[0]},${C[1]})`;
      const outline = `M${HB},${-HB} L${TIP - HB},${-HB} A${HB} ${HB} 0 0 1 ${TIP - HB},${HB} L${HB},${HB}`;
      fill.push(`<path transform="${m}" d="${outline} Z"/>`);
      const lines: string[] = [`<path class="pt-edge" d="${outline}"/>`, `<path d="M0,0 L${TIP},0"/>`];
      for (let r = 0; r <= 5; r++) lines.push(`<path d="M${HB + r * L},${-HB} L${HB + r * L},${HB}"/>`);
      ink.push(`<g transform="${m}">${lines.join('')}</g>`);
      const t0 = HB + 3 * L;
      const t1 = t0 + L;
      const tm = t0 + L / 2;
      tri.push(`<path transform="${m}" d="M${t0 + 2},${-HB + 3} L${t0 + 2},${HB - 3} L${tm},0 Z M${t1 - 2},${-HB + 3} L${t1 - 2},${HB - 3} L${tm},0 Z"/>`);
    }
    return `<g class="pt-fill" filter="url(#pt-paper)">${fill.join('')}</g><g class="pt-ink" filter="url(#pt-ink)"><g class="pt-tri">${tri.join('')}</g>${ink.join('')}</g>`;
  }

  /** Циновка кона. */
  private potMat() {
    return `<g transform="translate(${POT[0]},${POT[1]})" filter="url(#pt-shadow)"><rect x="-58" y="-34" width="116" height="68" rx="7" fill="url(#pt-weave)" stroke="#6a4818" stroke-width="2.5"/></g><g class="pt-pot" transform="translate(${POT[0]},${POT[1]})"></g>`;
  }

  private bead(x: number, y: number, r = 11) {
    return `<g transform="translate(${f(x)},${f(y)})"><circle r="${r}" fill="url(#pt-jade)" stroke="#0f3a22" stroke-width="1.2"/><circle r="${r * 0.28}" fill="#0c2e1a"/><ellipse cx="${-r * 0.35}" cy="${-r * 0.42}" rx="${r * 0.3}" ry="${r * 0.18}" fill="#fff" opacity="0.55"/></g>`;
  }

  /** Россыпь бусин: до 12 видно, дальше — числом. */
  private beadPile(n: number, cols = 6) {
    const parts: string[] = [];
    const shown = Math.min(n, 12);
    for (let i = 0; i < shown; i++) {
      const r = Math.floor(i / cols);
      const c = i % cols;
      parts.push(this.bead((c - (Math.min(cols, shown) - 1) / 2) * 17 + (r % 2) * 8, r * -13 + Math.sin(i * 2.3) * 2));
    }
    return parts.join('');
  }

  private stone(seat: number, r = PR) {
    return `<circle class="pt-ring" r="${r + 9}"/><g filter="url(#pt-shadow)"><circle r="${r}" fill="url(#pt-st${seat})" stroke="${SEATS[seat].dark}" stroke-width="1.5"/>
      <ellipse cx="${-r * 0.33}" cy="${-r * 0.4}" rx="${r * 0.38}" ry="${r * 0.22}" fill="#fff" opacity="0.42" transform="rotate(-25 ${-r * 0.33} ${-r * 0.4})"/></g>`;
  }

  private place(el: SVGGElement, [x, y]: Pt) {
    el.style.transform = `translate(${f(x)}px, ${f(y)}px)`;
  }

  private renderPieces(s: State) {
    this.gPieces.innerHTML = '';
    this.els.clear();
    for (let i = 0; i < s.n; i++) {
      if (s.out[i]) continue;
      for (const p of s.pos[i]) {
        if (p < 0 || p >= CELLS) continue;
        const el = document.createElementNS(NS, 'g') as SVGGElement;
        el.setAttribute('class', 'pt-pc');
        el.dataset.from = String(p);
        el.dataset.seat = String(i);
        el.innerHTML = this.stone(i);
        this.place(el, cellCenter(cellOf(s.arms[i], p)));
        this.gPieces.appendChild(el);
        this.els.set(`${i}:${p}`, el);
      }
    }
    this.renderBowls(s);
  }

  /** Чаши мест (камешки, ждущие входа, и прошедшие круг), бусины-ставки у чаш и кон. */
  private renderBowls(s: State) {
    const parts: string[] = [];
    for (let i = 0; i < s.n; i++) {
      const arm = s.arms[i];
      const [x, y] = bowlAt(arm);
      const wait = s.pos[i].filter((p) => p < 0).length;
      const done = s.pos[i].filter((p) => p >= CELLS).length;
      parts.push(`<g class="pt-bowl${s.out[i] ? ' out' : ''}" data-from="-1" data-seat="${i}" transform="translate(${f(x)},${f(y)})">`);
      parts.push(`<circle class="pt-ring" r="70"/><g filter="url(#pt-shadow)"><circle r="58" fill="url(#pt-clay)" stroke="#3a1606" stroke-width="2"/>
        <circle r="50" fill="none" stroke="#1d0d05" stroke-width="2.4"/><circle r="45" fill="none" stroke="#1d0d05" stroke-width="1" stroke-dasharray="3 4"/>
        <circle r="41" fill="url(#pt-bowlin)"/></g>`);
      // камешки в чаше — по кругу
      for (let k = 0; k < wait; k++) {
        const ang = (k / Math.max(wait, 1)) * Math.PI * 2 - Math.PI / 2;
        const rr = wait === 1 ? 0 : wait <= 3 ? 14 : 22;
        parts.push(`<g transform="translate(${f(Math.cos(ang) * rr)},${f(Math.sin(ang) * rr)})">${this.stone(i, 12).replace('class="pt-ring"', 'class="pt-none"')}</g>`);
      }
      if (done) parts.push(`<g class="pt-done" transform="translate(42,-44)"><circle r="17" fill="${SEATS[i].color}" stroke="#fff3d6" stroke-width="2.5"/><text y="6">✓${done}</text></g>`);
      if (s.out[i]) parts.push(`<text class="pt-lbl" y="8">выбыл</text>`);
      parts.push('</g>');
      const [bx, by] = beadsAt(arm);
      parts.push(`<g class="pt-beads" transform="translate(${f(bx)},${f(by)})">${this.beadPile(s.stakes[i])}<text class="pt-lbl" y="${s.stakes[i] > 6 ? 30 : 32}">${s.stakes[i]}</text></g>`);
    }
    this.gBowls.innerHTML = parts.join('');
    const pot = this.svg.querySelector('.pt-pot') as SVGGElement;
    pot.innerHTML = `${this.beadPile(s.pot, 5).replace(/translate\(([-\d.]+),([-\d.]+)\)/g, (_, a, b) => `translate(${a},${Number(b) + 6})`)}<text class="pt-lbl" y="58">кон${s.pot ? `: ${s.pot}` : ''}</text>`;
  }

  setView(s: State) {
    this.s = s;
    this.renderPieces(s);
    this.showBeans(s.beans.length ? s.beans : null, s);
  }

  // ---------------------------------------------------------------- бобы

  private valText(beans: number[], s: State) {
    const c = beans.filter((x) => x).length;
    if (s.cfg.throws === 'modern') return c === 0 ? 'ни одной точки — 10' : c === 5 ? 'все пять — 5 и ещё бросок' : `точек: ${c}`;
    return c === 0 ? 'ни одной точки — подношение' : c === 5 ? 'все пять — 10 клеток' : `точек: ${c}`;
  }

  private showBeans(b: number[] | null, s: State) {
    (this.beanEls[0].parentElement as HTMLElement).classList.toggle('blank', !b);
    this.beanEls.forEach((el, i) => {
      const src = `${TEX}${b?.[i] ? 'beanm' : 'bean'}.webp`;
      if (el.getAttribute('src') !== src) el.setAttribute('src', src);
    });
    this.trayVal.textContent = b ? this.valText(b, s) : '';
  }

  private async rollAnim(b: number[], s: State, sp: number) {
    const dur = Math.round(850 / Math.max(0.5, sp));
    Sound.diceRoll(dur / 1000);
    this.beanEls.forEach((el, i) => {
      const dx = (Math.random() * 30 - 15) * (i % 2 ? 1 : -1);
      el.animate(
        [
          { transform: `translate(${-60 + dx}px, -50px) rotate(${-200 + i * 70}deg)`, offset: 0 },
          { transform: `translate(${dx / 2}px, 4px) rotate(${-30 + i * 10}deg)`, offset: 0.6 },
          { transform: `translate(0, -3px) rotate(${i * 4 - 6}deg)`, offset: 0.82 },
          { transform: `rotate(${((i * 37) % 20) - 10}deg)`, offset: 1 },
        ],
        { duration: dur, easing: 'cubic-bezier(.25,.7,.35,1)', fill: 'forwards' },
      );
    });
    const t0 = performance.now();
    while (performance.now() - t0 < dur * 0.65) {
      this.showBeans([0, 1, 2, 3, 4].map(() => (Math.random() < 0.5 ? 1 : 0)), s);
      this.trayVal.textContent = '';
      await sleep(90);
    }
    await sleep(dur * 0.35);
    this.showBeans(b, s);
  }

  // ---------------------------------------------------------------- ходы

  /** Бусина летит от плательщика к получателю (−1 — кон). */
  private async flyBeads(pays: { from: number; to: number }[], s: State, sp: number) {
    const at = (seat: number): Pt => (seat < 0 ? POT : beadsAt(s.arms[seat]));
    const dur = Math.max(260, 520 / sp);
    pays.forEach((p, i) => {
      const g = document.createElementNS(NS, 'g') as SVGGElement;
      g.setAttribute('class', 'pt-fly');
      g.innerHTML = this.bead(0, 0, 12);
      this.place(g, at(p.from));
      this.gFx.appendChild(g);
      g.style.transitionDuration = `${dur}ms`;
      g.style.transitionDelay = `${i * 90}ms`;
      requestAnimationFrame(() => requestAnimationFrame(() => this.place(g, at(p.to))));
      setTimeout(() => g.remove(), dur + i * 90 + 60);
    });
    Sound.place();
    await sleep(dur + pays.length * 90);
  }

  async play(events: Event[], v: State) {
    const sp = this.ctx.speed();
    this.clearTurn();
    let s = this.s ?? v;
    for (const ev of events) {
      if (ev.type === 'roll') {
        await this.rollAnim(ev.beans, s, sp);
        if (ev.none) {
          Sound.nomove();
          await sleep(700 / sp);
        }
      } else if (ev.type === 'move') {
        const arm = s.arms[ev.seat];
        let el = this.els.get(`${ev.seat}:${ev.from}`);
        if (ev.from < 0) {
          el = document.createElementNS(NS, 'g') as SVGGElement;
          el.setAttribute('class', 'pt-pc');
          el.innerHTML = this.stone(ev.seat);
          this.place(el, bowlAt(arm));
          this.gPieces.appendChild(el);
          Sound.enter();
          await sleep(60);
        }
        if (el) {
          el.classList.add('anim');
          this.gPieces.appendChild(el);
          for (const c of ev.path) {
            this.place(el, cellCenter(c));
            Sound.step();
            await sleep(Math.max(60, 150 / sp));
          }
          if (ev.to >= CELLS) {
            this.place(el, bowlAt(arm));
            await sleep(Math.max(120, 260 / sp));
            Sound.home();
            el.classList.add('gone');
            await sleep(250 / sp);
          }
          if (ev.hit >= 0) {
            const cell = cellOf(arm, ev.to);
            const hp = s.pos[ev.hit].find((p) => p >= 0 && p < CELLS && cellOf(s.arms[ev.hit], p) === cell);
            const victim = hp != null ? this.els.get(`${ev.hit}:${hp}`) : undefined;
            Sound.capture();
            if (victim) {
              victim.classList.add('anim', 'slow');
              this.place(victim, bowlAt(s.arms[ev.hit]));
              await sleep(Math.max(250, 450 / sp));
              victim.remove();
            }
          }
          el.classList.remove('anim');
        }
      } else if (ev.type === 'pay') {
        await this.flyBeads(ev.pays, s, sp);
        // промежуточные числа ставок — сразу, не дожидаясь конца хода
        const t = { ...s, stakes: s.stakes.slice(), pot: s.pot };
        for (const p of ev.pays) {
          if (p.from >= 0) t.stakes[p.from]--;
          else t.pot--;
          if (p.to >= 0) t.stakes[p.to]++;
          else t.pot++;
        }
        s = t;
        this.renderBowls(s);
      } else if (ev.type === 'bust') {
        Sound.nomove();
        await sleep(400 / sp);
      } else if (ev.type === 'end' && ev.winners.length) Sound.win();
    }
    this.s = v;
    this.renderPieces(v);
    this.showBeans(v.beans.length ? v.beans : null, v);
  }

  private clearTurn() {
    this.rollBtn.disabled = true;
    this.rollBtn.classList.remove('pulse');
    this.rollSeat = null;
    this.moves = [];
    this.gTargets.innerHTML = '';
    this.svg.querySelectorAll('.can, .sel').forEach((el) => el.classList.remove('can', 'sel'));
  }

  private srcEl(s: State, from: number) {
    if (from < 0) return this.gBowls.querySelector(`.pt-bowl[data-seat="${s.turn}"]`);
    return this.els.get(`${s.turn}:${from}`);
  }

  setTurn(_toAct: number[], interactive: number[]) {
    this.clearTurn();
    const s = this.s;
    if (!s || s.phase === 'over' || this.ctx.demo) return;
    const seat = s.turn;
    if (!interactive.includes(seat)) return;
    if (s.phase === 'roll') {
      this.rollSeat = seat;
      this.rollBtn.disabled = false;
      this.rollBtn.classList.add('pulse');
      return;
    }
    this.moves = legalMoves(s);
    for (const m of this.moves) this.srcEl(s, m.from)?.classList.add('can');
    if (this.moves.length === 1) this.pick(this.moves[0].from);
  }

  /** Выбрали фишку (или чашу) — подсвечиваем клетку, куда она встанет. */
  private pick(from: number) {
    const s = this.s!;
    const m = this.moves.find((x) => x.from === from);
    if (!m) return;
    this.svg.querySelectorAll('.sel').forEach((el) => el.classList.remove('sel'));
    this.srcEl(s, from)?.classList.add('sel');
    const cls = m.hit >= 0 ? ' hit' : m.kind === 'tri' ? ' tri' : m.kind === 'cap' || m.kind === 'home' ? ' good' : '';
    if (m.to >= CELLS) {
      const [x, y] = bowlAt(s.arms[s.turn]);
      this.gTargets.innerHTML = `<g class="pt-target${cls}" data-go="${from}"><circle cx="${f(x)}" cy="${f(y)}" r="66"/><text x="${f(x)}" y="${f(y + 8)}">круг!</text></g>`;
      return;
    }
    const cell = cellOf(s.arms[s.turn], m.to);
    const [x, y] = cellCenter(cell);
    const note = m.hit >= 0 ? 'сбить' : m.kind === 'tri' ? '−1' : m.kind === 'cap' ? 'ещё' : '';
    this.gTargets.innerHTML = `<g class="pt-target${cls}" data-go="${from}"><polygon points="${cellPoly(cell)}"/><circle cx="${f(x)}" cy="${f(y)}" r="${PR + 8}"/>${note ? `<text x="${f(x)}" y="${f(y + 7)}">${note}</text>` : ''}</g>`;
  }

  private roll() {
    if (this.rollSeat == null) return;
    Sound.unlock();
    const seat = this.rollSeat;
    this.clearTurn();
    this.ctx.act(seat, { type: 'roll' });
  }

  status(s: State, _toAct: number[], interactive: number[]) {
    if (s.phase === 'over') return `Победа: ${s.winners.map((i) => this.ctx.name(i)).join(' и ')}!`;
    const who = this.ctx.name(s.turn);
    if (!interactive.includes(s.turn)) return s.phase === 'roll' ? `${who} бросает…` : `${who} ходит…`;
    if (s.phase === 'roll') return `Ход: ${who} — бросайте бобы`;
    return `${who}: ходите на ${s.value}`;
  }

  playerStats(s: State, seat: number) {
    if (s.out[seat]) return '<span>выбыл</span>';
    const wait = s.pos[seat].filter((p) => p < 0).length;
    const on = s.pos[seat].filter((p) => p >= 0 && p < CELLS).length;
    const lap = s.cfg.goal === 'race' ? s.pos[seat].filter((p) => p >= CELLS).length : s.laps[seat];
    return `<span title="В чаше">◍ ${wait}</span><span title="На кресте">✚ ${on}</span><span title="Прошли круг">✓ ${lap}</span><span title="Ставки">● ${s.stakes[seat]}</span>`;
  }

  destroy() {
    document.removeEventListener('keydown', this.onKey);
  }
}

export const createView = () => new PatolliView();
