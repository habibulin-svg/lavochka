/* «География» — карта (SVG через d3-geo): слои из public/geo/*.json (TopoJSON), рамки континентов и стран,
 * масштаб колёсиком/двумя пальцами/кнопками, перетаскивание, кружки для крошечных стран, отметки ответов. */
import { geoAlbersUsa, geoAzimuthalEqualArea, geoBounds, geoCentroid, geoConicEqualArea, geoNaturalEarth1, geoPath, type GeoProjection } from 'd3-geo';
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from 'geojson';
import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { BY_ID, type Layer, REGION_COUNTRIES } from './data';

const BASE = import.meta.env.BASE_URL;
type F = Feature<Geometry, { id: string }>;

// ---------------------------------------------------------------- загрузка

const loaded = new Map<Layer | 'detail', Promise<void>>();
/** Подробные контуры мелочи (острова, карлики, кантоны) — для силуэтов. */
const DETAIL = new Map<string, F>();
const FEATS = new Map<string, F>();
/** Объекты слоя: world → [world, ovl], regions → [de, fr…]. */
const OBJ = new Map<string, F[]>();

export function loadLayer(layer: Layer | 'detail'): Promise<void> {
  let p = loaded.get(layer);
  if (!p) {
    p = fetch(`${BASE}geo/${layer}.json`)
      .then((r) => r.json())
      .then((topo: Topology) => {
        for (const [name, obj] of Object.entries(topo.objects)) {
          const fc = feature(topo, obj) as unknown as FeatureCollection<Geometry, { id: string }>;
          const list = fc.features.filter((f) => f.geometry);
          for (const f of list) {
            f.properties = { id: String(f.id ?? f.properties?.id) };
            if (f.properties.id.startsWith('_')) continue;
            if (layer === 'detail') DETAIL.set(f.properties.id, f);
            else FEATS.set(f.properties.id, f);
          }
          if (layer !== 'detail') OBJ.set(name.replace(/^in-/, ''), list);
        }
      });
    p.catch(() => loaded.delete(layer));
    loaded.set(layer, p);
  }
  return p;
}

export const featureOf = (id: string) => FEATS.get(id);
export const layerOf = (id: string): Layer => BY_ID[id]?.l ?? 'world';

// ---------------------------------------------------------------- рамки

interface FrameDef {
  proj(): GeoProjection;
  /** Рамка по широтам/долготам: [запад, юг, восток, север]. Нет — по объектам. */
  box?: [number, number, number, number];
  /** Объекты TopoJSON для рисования. */
  objs: string[];
  /** Подложка из мирового слоя (соседи серым). */
  backdrop?: boolean;
  /** Чья страна закрыта регионами — её не рисовать в подложке. */
  self?: string;
  /** Острова, перенесённые ближе (Канары): id → сдвиг в градусах. */
  shift?: Record<string, [number, number]>;
}

const az = (lon: number, lat: number) => () => geoAzimuthalEqualArea().rotate([-lon, -lat]);

const FRAMES: Record<string, FrameDef> = {
  world: { proj: () => geoNaturalEarth1(), objs: ['world', 'ovl'] },
  eu: { proj: az(15, 52), box: [-24, 34, 45, 71], objs: ['world', 'ovl'] },
  as: { proj: az(92, 34), box: [26, -10, 150, 62], objs: ['world', 'ovl'] },
  af: { proj: az(17, 2), box: [-26, -36, 58, 38], objs: ['world', 'ovl'] },
  na: { proj: az(-92, 40), box: [-168, 7, -30, 74], objs: ['world', 'ovl'] },
  sa: { proj: az(-60, -18), box: [-92, -56, -32, 13], objs: ['world', 'ovl'] },
  oc: { proj: az(165, -15), box: [112, -48, 212, 20], objs: ['world', 'ovl'] },
  ru: { proj: () => geoConicEqualArea().rotate([-100, 0]).parallels([52, 68]), objs: ['ru'], backdrop: true, self: 'RUS' },
  us: { proj: () => geoAlbersUsa(), objs: ['us'] },
};
for (const c of REGION_COUNTRIES) FRAMES[c.id] = { proj: () => geoAzimuthalEqualArea(), objs: [c.obj], backdrop: true, self: c.id };
FRAMES.ESP.shift = { 'ES-CN': [5, 7] };

export const layerOfFrame = (key: string): Layer => (key === 'ru' ? 'ru' : key === 'us' ? 'us' : FRAMES[key]?.objs[0] === 'world' ? 'world' : 'regions');

function shifted(f: F, d: [number, number]): F {
  const mv = (p: Position): Position => [p[0] + d[0], p[1] + d[1]];
  const g = f.geometry;
  if (g.type === 'Polygon') return { ...f, geometry: { type: 'Polygon', coordinates: g.coordinates.map((r) => r.map(mv)) } };
  if (g.type === 'MultiPolygon') return { ...f, geometry: { type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((r) => r.map(mv))) } };
  return f;
}

// ---------------------------------------------------------------- карта

const W = 1000;
const H = 640;
const SVGNS = 'http://www.w3.org/2000/svg';

export type Mark = 'ok' | 'bad' | 'ans' | 'other';

export class GeoMap {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private g: SVGGElement;
  private marks = new Map<string, Mark>();
  private nodes = new Map<string, SVGElement[]>();
  private centers = new Map<string, [number, number]>();
  private frame = '';
  private k = 1;
  private tx = 0;
  private ty = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private pinch: { d: number; k: number; cx: number; cy: number } | null = null;
  onPick: ((id: string) => void) | null = null;
  enabled = true;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'geo-map';
    this.el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><rect class="sea" x="-5000" y="-5000" width="11000" height="11000"/><g></g></svg>
      <div class="geo-zoom"><button data-z="in" title="Крупнее">+</button><button data-z="out" title="Мельче">−</button><button data-z="home" title="Всю карту">⟲</button></div>`;
    this.svg = this.el.querySelector('svg')!;
    this.g = this.svg.querySelector('g')!;
    this.el.querySelector('.geo-zoom')!.addEventListener('click', (e) => {
      const z = (e.target as HTMLElement).closest('button')?.dataset.z;
      if (z === 'in') this.zoomAt(W / 2, H / 2, 1.6);
      if (z === 'out') this.zoomAt(W / 2, H / 2, 1 / 1.6);
      if (z === 'home') this.reset();
    });
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = this.pt(e.clientX, e.clientY);
      this.zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0018)));
    }, { passive: false });
    this.svg.addEventListener('pointerdown', (e) => this.down(e));
    this.svg.addEventListener('pointermove', (e) => this.move(e));
    this.svg.addEventListener('pointerup', (e) => this.up(e));
    this.svg.addEventListener('pointercancel', (e) => this.ptrs.delete(e.pointerId));
  }

  /** Экранные координаты → координаты viewBox. */
  private pt(cx: number, cy: number): [number, number] {
    const r = this.svg.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H);
    const ox = (r.width - W * s) / 2;
    const oy = (r.height - H * s) / 2;
    return [(cx - r.left - ox) / s, (cy - r.top - oy) / s];
  }

  private apply() {
    this.g.setAttribute('transform', `translate(${this.tx} ${this.ty}) scale(${this.k})`);
    this.el.style.setProperty('--k', String(this.k));
    for (const c of this.g.querySelectorAll<SVGCircleElement>('circle.dot')) c.setAttribute('r', String(Number(c.dataset.r) / Math.sqrt(this.k)));
    for (const t of this.g.querySelectorAll<SVGTextElement>('text')) t.setAttribute('font-size', String(15 / this.k));
  }

  private zoomAt(x: number, y: number, f: number) {
    const k = Math.min(60, Math.max(1, this.k * f));
    f = k / this.k;
    this.tx = x - (x - this.tx) * f;
    this.ty = y - (y - this.ty) * f;
    this.k = k;
    this.clamp();
    this.apply();
  }

  private clamp() {
    // не уводить карту за край: хотя бы четверть остаётся в кадре
    const m = 0.75;
    this.tx = Math.min(W * m, Math.max(W * (1 - m) - W * this.k, this.tx));
    this.ty = Math.min(H * m, Math.max(H * (1 - m) - H * this.k, this.ty));
  }

  reset() {
    this.k = 1;
    this.tx = 0;
    this.ty = 0;
    this.apply();
  }

  /** Плавно навести на объект (после ответа — показать, где он). */
  focus(id: string) {
    const c = this.centers.get(id);
    if (!c) return;
    const [x, y] = c;
    const sx = x * this.k + this.tx;
    const sy = y * this.k + this.ty;
    if (sx > 40 && sx < W - 40 && sy > 40 && sy < H - 40) return;
    this.tx = W / 2 - x * this.k;
    this.ty = H / 2 - y * this.k;
    this.clamp();
    this.apply();
  }

  private down(e: PointerEvent) {
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.svg.setPointerCapture(e.pointerId);
    this.moved = 0;
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      const [cx, cy] = this.pt((a.x + b.x) / 2, (a.y + b.y) / 2);
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.k, cx, cy };
    }
  }

  private move(e: PointerEvent) {
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    const r = this.svg.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H);
    if (this.ptrs.size === 2 && this.pinch) {
      p.x = e.clientX;
      p.y = e.clientY;
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoomAt(this.pinch.cx, this.pinch.cy, (this.pinch.k * d) / this.pinch.d / this.k);
      this.moved += 10;
      return;
    }
    const dx = (e.clientX - p.x) / s;
    const dy = (e.clientY - p.y) / s;
    p.x = e.clientX;
    p.y = e.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);
    if (this.moved > 4) {
      this.tx += dx;
      this.ty += dy;
      this.clamp();
      this.apply();
    }
  }

  private up(e: PointerEvent) {
    const was = this.ptrs.size;
    this.ptrs.delete(e.pointerId);
    if (this.ptrs.size < 2) this.pinch = null;
    if (was !== 1 || this.moved > 6) return;
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGElement>('[data-id]');
    if (hit && this.enabled && hit.classList.contains('on')) this.onPick?.(hit.dataset.id!);
  }

  /** Нарисовать рамку: key — набор/страна, on — что можно нажимать. Перерисовывает, только если рамка или набор поменялись. */
  async show(key: string, on: Set<string>) {
    const sig = key + ':' + [...on].sort().join(',');
    if (sig === this.frame) return;
    const fr = FRAMES[key] ?? FRAMES.world;
    await loadLayer(layerOfFrame(key));
    if (fr.backdrop) await loadLayer('world');
    this.frame = sig;
    const pick = (f: F) => (fr.shift?.[f.properties.id] ? shifted(f, fr.shift[f.properties.id]) : f);
    const main = fr.objs.flatMap((o) => OBJ.get(o) ?? []).map(pick);
    const proj = fr.proj();
    const pad = 12;
    if (key === 'world') proj.fitExtent([[pad, pad], [W - pad, H - pad]], { type: 'Sphere' });
    else if (fr.box) {
      const [w, s, e, n] = fr.box;
      const pts: Position[] = [];
      for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) pts.push([w + ((e - w) * i) / 8, s + ((n - s) * j) / 8]);
      proj.fitExtent([[pad, pad], [W - pad, H - pad]], { type: 'MultiPoint', coordinates: pts });
    } else {
      const fit = main.filter((f) => on.has(f.properties.id));
      const fc = { type: 'FeatureCollection', features: fit.length ? fit : main } as FeatureCollection;
      if (key !== 'us' && key !== 'ru') proj.rotate([-geoCentroid(fc)[0], -geoCentroid(fc)[1]]);
      proj.fitExtent([[pad + 10, pad + 10], [W - pad - 10, H - pad - 10]], fc);
    }
    const path = geoPath(proj);
    this.g.innerHTML = '';
    this.nodes.clear();
    this.centers.clear();
    const add = (tag: string, attrs: Record<string, string>, parent: Element = this.g) => {
      const n = document.createElementNS(SVGNS, tag);
      for (const [a, v] of Object.entries(attrs)) n.setAttribute(a, v);
      parent.appendChild(n);
      return n as SVGElement;
    };
    if (key === 'world') add('path', { class: 'globe', d: path({ type: 'Sphere' }) ?? '' });
    if (fr.backdrop)
      for (const f of OBJ.get('world') ?? []) {
        if (f.properties.id === fr.self) continue;
        const d = path(f);
        if (d) add('path', { class: 'land back', d });
      }
    const dots: { id: string; x: number; y: number }[] = [];
    for (const f of main) {
      const id = f.properties.id;
      const ovl = BY_ID[id]?.ovl;
      if (ovl && !on.has(id)) continue;
      const d = path(f);
      if (!d) continue;
      const live = on.has(id);
      const n = add('path', { class: `land${live ? ' on' : ''}${ovl ? ' ovl' : ''}`, d });
      if (live) {
        n.dataset.id = id;
        this.nodes.set(id, [n]);
        const [[x0, y0], [x1, y1]] = path.bounds(f);
        const c = path.centroid(largest(f));
        this.centers.set(id, isFinite(c[0]) ? (c as [number, number]) : [(x0 + x1) / 2, (y0 + y1) / 2]);
        if (Math.max(x1 - x0, y1 - y0) < 7) dots.push({ id, x: this.centers.get(id)![0], y: this.centers.get(id)![1] });
      }
    }
    // рамка вокруг перенесённых островов
    for (const id of Object.keys(fr.shift ?? {})) {
      const f = main.find((x) => x.properties.id === id);
      if (!f) continue;
      const [[x0, y0], [x1, y1]] = path.bounds(f);
      add('rect', { class: 'inset', x: String(x0 - 8), y: String(y0 - 8), width: String(x1 - x0 + 16), height: String(y1 - y0 + 16) });
    }
    for (const d of dots) {
      const c = add('circle', { class: 'dot on', cx: String(d.x), cy: String(d.y), r: '6' });
      c.dataset.r = '6';
      c.dataset.id = d.id;
      this.nodes.get(d.id)!.push(c);
    }
    this.marks.clear();
    this.reset();
  }

  /** Отметки: верно/мимо/правильный ответ. */
  mark(id: string, m: Mark | null) {
    for (const n of this.nodes.get(id) ?? []) {
      n.classList.remove('ok', 'bad', 'ans', 'other');
      if (m) n.classList.add(m);
    }
    if (m) this.marks.set(id, m);
    else this.marks.delete(id);
  }

  clearMarks() {
    for (const id of [...this.marks.keys()]) this.mark(id, null);
    for (const n of this.g.querySelectorAll('.pulse, text')) n.remove();
  }

  /** Кольцо и подпись у объекта. */
  pulse(id: string, label?: string) {
    const c = this.centers.get(id);
    if (!c) return;
    const ring = document.createElementNS(SVGNS, 'circle');
    ring.setAttribute('class', 'pulse');
    ring.setAttribute('cx', String(c[0]));
    ring.setAttribute('cy', String(c[1]));
    ring.setAttribute('r', String(18 / Math.sqrt(this.k)));
    this.g.appendChild(ring);
    if (label) {
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', String(c[0]));
      t.setAttribute('y', String(c[1] - 22 / this.k));
      t.setAttribute('font-size', String(15 / this.k));
      t.textContent = label;
      this.g.appendChild(t);
    }
  }
}

// ---------------------------------------------------------------- контур одного объекта

/** Самый большой многоугольник — центр контура. */
function largest(f: F): F {
  const g = f.geometry;
  if (g.type !== 'MultiPolygon') return f;
  let best = g.coordinates[0];
  let ba = -1;
  for (const p of g.coordinates) {
    const [[x0, y0], [x1, y1]] = geoBounds({ type: 'Polygon', coordinates: p } as Polygon);
    const a = Math.abs((x1 - x0) * (y1 - y0));
    if (a > ba && a < 64000) {
      ba = a;
      best = p;
    }
  }
  return { ...f, geometry: { type: 'Polygon', coordinates: best } };
}

/** Контур без далёких островов (Аляска у США, Гвиана у Франции): только части не дальше 22° от главной. */
function mainland(f: F): F {
  const g = f.geometry;
  if (g.type !== 'MultiPolygon') return f;
  const [cx, cy] = geoCentroid(largest(f));
  const near = g.coordinates.filter((p) => {
    const [x, y] = geoCentroid({ type: 'Polygon', coordinates: p } as Polygon);
    const dx = Math.abs(((x - cx + 540) % 360) - 180) * Math.cos((cy * Math.PI) / 180);
    return Math.hypot(dx, y - cy) < 22;
  });
  return { ...f, geometry: { type: 'MultiPolygon', coordinates: near } as MultiPolygon };
}

/** SVG-контур объекта (силуэт), вписанный в w×h. */
export function outlineSvg(id: string, w = 240, h = 180, cls = 'geo-outline'): string {
  const f = DETAIL.get(id) ?? FEATS.get(id);
  if (!f) return `<svg class="${cls}" viewBox="0 0 ${w} ${h}"></svg>`;
  const m = mainland(f);
  const c = geoCentroid(largest(f));
  const proj = geoAzimuthalEqualArea().rotate([-c[0], -c[1]]).fitExtent([[6, 6], [w - 6, h - 6]], m);
  return `<svg class="${cls}" viewBox="0 0 ${w} ${h}"><path d="${geoPath(proj)(m) ?? ''}"/></svg>`;
}

/** Мини-карта «где это»: мир или страна-родитель серым, объект — красным, с кольцом. */
export function locatorSvg(id: string, w = 300, h = 170): string {
  const e = BY_ID[id];
  const f = FEATS.get(id);
  if (!e || !f) return '';
  const isWorld = e.l === 'world';
  const ctx = isWorld ? [...(OBJ.get('world') ?? [])] : e.l === 'ru' ? OBJ.get('ru') ?? [] : e.l === 'us' ? OBJ.get('us') ?? [] : OBJ.get(REGION_COUNTRIES.find((c) => c.id === e.p)?.obj ?? '') ?? [];
  const c = geoCentroid(largest(f));
  let proj: GeoProjection;
  if (isWorld) proj = geoNaturalEarth1().rotate([-c[0] * 0.6, 0]).fitExtent([[2, 2], [w - 2, h - 2]], { type: 'Sphere' });
  else if (e.l === 'us') proj = geoAlbersUsa().fitExtent([[4, 4], [w - 4, h - 4]], { type: 'FeatureCollection', features: ctx } as FeatureCollection);
  else {
    const fc = { type: 'FeatureCollection', features: ctx.filter((x) => !x.properties.id.startsWith('_') && !['FR-GF', 'FR-MQ', 'FR-GP', 'FR-RE', 'FR-YT'].includes(x.properties.id)) } as FeatureCollection;
    const cc = geoCentroid(fc);
    proj = (e.l === 'ru' ? geoConicEqualArea().rotate([-100, 0]).parallels([52, 68]) : geoAzimuthalEqualArea().rotate([-cc[0], -cc[1]])).fitExtent([[4, 4], [w - 4, h - 4]], fc);
  }
  const path = geoPath(proj);
  const parts = ctx.map((x) => `<path class="${x.properties.id === id ? 'me' : 'ctx'}" d="${path(x) ?? ''}"/>`).join('');
  const p = proj(c);
  const ring = p ? `<circle class="ring" cx="${p[0]}" cy="${p[1]}" r="9"/>` : '';
  return `<svg class="geo-locator" viewBox="0 0 ${w} ${h}">${isWorld ? `<path class="globe" d="${path({ type: 'Sphere' })}"/>` : ''}${parts}${ring}</svg>`;
}
