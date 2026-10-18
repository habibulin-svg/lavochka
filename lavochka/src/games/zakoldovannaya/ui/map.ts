/* Карта Заколдованной страны: оригинальное поле под камерой сборника, карточки замков на розовых местах, фишка отряда,
 * развилки — куда можно пойти (путь до развилки прокладывается целиком, выбор — только на развилках). */
import { BoardCam, type CamPoint } from '../../../core/boardcam';
import { sleep } from '../../../core/util';
import type { View } from '../engine';
import { ADJ, MAP, route } from '../world';
import { CAMPAIGNS } from '../content';
import { IMG, castleImg } from './common';

const W = MAP.size[0];
const H = MAP.size[1];
const P = (n: number): CamPoint => ({ x: MAP.nodes[n].x * W, y: MAP.nodes[n].y * H });
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag: string, attrs: Record<string, string | number>) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

/** Куда ведёт каждая дорога от узла: до первой развилки, места или тупика. */
export function forks(from: number, siteNodes: Set<number>): number[][] {
  const out: number[][] = [];
  for (const first of ADJ[from]) {
    const path = [from, first];
    let prev = from;
    let cur = first;
    while (ADJ[cur].length === 2 && !siteNodes.has(cur) && path.length < 40) {
      const next = ADJ[cur][0] === prev ? ADJ[cur][1] : ADJ[cur][0];
      prev = cur;
      cur = next;
      path.push(cur);
    }
    out.push(path);
  }
  return out;
}

export class WorldMap {
  el: HTMLElement;
  private board: HTMLElement;
  private over: SVGSVGElement;
  private cam: BoardCam;
  private token: SVGGElement;
  private marks: SVGGElement;
  private castles: SVGGElement;
  private shown = -1;
  onGo: ((path: number[]) => void) | null = null;

  constructor(parent: HTMLElement, demo: boolean, speed: () => number) {
    this.el = document.createElement('div');
    this.el.className = 'zs-map';
    this.el.innerHTML = `<div class="zs-map-board"><img class="zs-map-img zs-map-mini" src="${IMG}map-small.webp" alt="" draggable="false"><img class="zs-map-img zs-map-full" src="${IMG}map.webp" alt="Карта Заколдованной страны" draggable="false"></div>`;
    parent.append(this.el);
    this.board = this.el.querySelector('.zs-map-board') as HTMLElement;
    const full = this.el.querySelector('.zs-map-full') as HTMLImageElement;
    full.onload = () => this.board.classList.add('ready');
    if (full.complete) this.board.classList.add('ready');
    this.over = svg('svg', { class: 'zs-map-over', viewBox: `0 0 ${W} ${H}` }) as SVGSVGElement;
    this.board.append(this.over);
    this.castles = svg('g', {}) as SVGGElement;
    this.marks = svg('g', {}) as SVGGElement;
    this.token = svg('g', { class: 'zs-token' }) as SVGGElement;
    this.token.innerHTML = `<ellipse cx="0" cy="34" rx="46" ry="14" fill="rgba(0,0,0,.45)"/><path d="M-30 30 L0 -70 L30 30 Z" fill="#b3261e" stroke="#fff3d6" stroke-width="6"/><circle cx="0" cy="-74" r="20" fill="#e8c27a" stroke="#fff3d6" stroke-width="6"/>`;
    this.over.append(this.castles, this.marks, this.token);
    this.cam = new BoardCam(this.el, this.board, {
      w: W,
      h: H,
      mini: `${IMG}map-small.webp`,
      src: 3200,
      token: 0.05,
      followKey: 'zs.follow',
      demo,
      speed,
      dots: () => (this.shown >= 0 ? [{ key: 1, ...P(this.shown), color: '#b3261e', on: true }] : []),
      turn: () => (this.shown >= 0 ? [P(this.shown)] : [{ x: W / 2, y: H / 2 }]),
    });
  }

  set(v: View, canGo: boolean): void {
    // замки на местах
    this.castles.replaceChildren();
    MAP.castles.forEach((n, i) => {
      const site = v.world.slots[i];
      const card = site ? Number(site.slice(1)) : 0;
      const p = P(n);
      const g = svg('g', { class: 'zs-castle', transform: `translate(${p.x},${p.y})` });
      g.append(svg('image', { href: castleImg(card), x: -125, y: -175, width: 250, height: 350, preserveAspectRatio: 'xMidYMid meet' }));
      const done = v.world.visited.some((x) => x.startsWith(`${site}:`) && x !== `${site}:*`);
      if (done) g.classList.add('seen');
      this.castles.append(g);
    });
    // свои места кампании — значком на белом кружке
    for (const pl of CAMPAIGNS[v.mode]?.places ?? []) {
      const p = P(pl.node);
      const site = CAMPAIGNS[v.mode]?.sites?.[pl.site];
      const g = svg('g', { class: 'zs-place', transform: `translate(${p.x},${p.y})` });
      g.append(svg('circle', { r: 58, fill: 'rgba(27,18,12,.85)', stroke: '#ffcf6a', 'stroke-width': 7 }));
      const t = svg('text', { y: 20, 'text-anchor': 'middle', 'font-size': 56 });
      t.textContent = site?.card === -1 ? '⛺' : '🏠';
      g.append(t);
      const title = document.createElementNS(NS, 'title');
      title.textContent = site?.title ?? pl.site;
      g.append(title);
      this.castles.append(g);
    }
    const fp = P(MAP.start);
    const f = svg('g', { class: 'zs-forpost', transform: `translate(${fp.x},${fp.y})` });
    f.append(svg('circle', { r: 70, fill: 'rgba(255,240,200,.25)', stroke: '#fff3d6', 'stroke-width': 6 }));
    this.castles.append(f);
    // фишка
    const node = v.where.k === 'map' ? v.where.node : v.where.node;
    if (this.shown < 0) this.place(node);
    this.shown = node;
    this.place(node);
    // развилки
    this.marks.replaceChildren();
    if (canGo && v.where.k === 'map') {
      const sites = new Set<number>([MAP.start, ...MAP.castles]);
      for (const path of forks(node, sites)) {
        const end = path[path.length - 1];
        const pts = path.map(P);
        this.marks.append(svg('polyline', { class: 'zs-route', points: pts.map((q) => `${q.x},${q.y}`).join(' ') }));
        const e = P(end);
        const c = svg('circle', { class: 'zs-go', cx: e.x, cy: e.y, r: sites.has(end) ? 90 : 50 });
        c.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.onGo?.(path);
        });
        this.marks.append(c);
      }
      // дальний выбор: щелчок по любому кружку — кратчайший путь
      for (const n of MAP.nodes) {
        if (n.id === node || ADJ[node].includes(n.id)) continue;
        const q = P(n.id);
        const c = svg('circle', { class: 'zs-far', cx: q.x, cy: q.y, r: n.kind === 'castle' ? 90 : 46 });
        c.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const r = route(node, n.id);
          if (r) this.onGo?.(r);
        });
        this.marks.prepend(c);
      }
    }
  }

  private place(n: number): void {
    const p = P(n);
    this.token.setAttribute('transform', `translate(${p.x},${p.y - 30})`);
  }

  /** Фишка проходит путь по кружкам. */
  async walk(path: number[], speed: number): Promise<void> {
    for (const n of path.slice(1)) {
      this.place(n);
      this.shown = n;
      void this.cam.frame([P(n)], [], false);
      await sleep(Math.max(60, 260 / Math.max(0.5, speed)));
    }
  }

  focus(): void {
    if (this.shown >= 0) void this.cam.frame([P(this.shown)], [], true);
  }
}
