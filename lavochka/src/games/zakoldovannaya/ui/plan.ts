/* План замка: скан из книги ведущего (или своя схема для достроенного подземелья), туман для героев — открыты только
 * пройденные комнаты; переходы из текущей комнаты — значками. Ведущий видит план целиком с номерами. */
import type { View } from '../engine';
import { planOf, type Plan, type PlanRoom } from '../world';
import { IMG, look } from './common';

const KIND_ICON: Record<string, string> = { door: '🚪', open: '•', secret: '〰', up: '▲', down: '▼', gate: '⛩' };
const KIND_NAME: Record<string, string> = { door: 'дверь', open: 'проход', secret: 'потайная дверь', up: 'лестница наверх', down: 'ход вниз', gate: 'ворота' };

export class PlanView {
  el: HTMLElement;
  private sheet: HTMLElement;
  private site = '';
  private plan: Plan | undefined;
  private offs: number[] = [];
  private scale = 3;
  /** Приблизить к отряду (иначе — весь план). */
  private near = true;
  private herePos: { x: number; y: number } | null = null;
  onRoom: ((id: string) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'zs-plan';
    this.sheet = document.createElement('div');
    this.sheet.className = 'zs-plan-sheet';
    const zoom = document.createElement('button');
    zoom.className = 'zs-plan-zoom';
    zoom.textContent = '⤢ Весь план';
    zoom.onclick = () => {
      this.near = !this.near;
      zoom.textContent = this.near ? '⤢ Весь план' : '🔍 Ближе';
      this.fit();
    };
    this.el.append(this.sheet, zoom);
    parent.append(this.el);
    new ResizeObserver(() => this.fit()).observe(this.el);
  }

  set(v: View, canMove: boolean): void {
    if (v.where.k !== 'site') return;
    const site = v.where.site;
    const plan = planOf(v as never, site);
    this.plan = plan;
    if (!plan) {
      this.sheet.innerHTML = `<div class="zs-plan-none">${v.scene?.title ?? ''}</div>`;
      return;
    }
    if (site !== this.site) {
      this.site = site;
      this.build(plan, site);
    }
    this.paint(v, plan, canMove);
    this.fit();
  }

  private build(plan: Plan, site: string): void {
    this.sheet.replaceChildren();
    this.offs = [];
    let x = 0;
    plan.images.forEach((img, i) => {
      const [w, h] = plan.sizes[i];
      const part = document.createElement('div');
      part.className = 'zs-plan-part';
      part.style.left = `${x}px`;
      part.style.width = `${w * this.scale}px`;
      part.style.height = `${h * this.scale}px`;
      if (img) part.innerHTML = `<img src="${IMG}plans/${img}" alt="" draggable="false" class="zs-plan-img ${look() === 'color' ? 'tinted' : ''}">`;
      else part.innerHTML = this.schematic(plan, i, w, h);
      this.sheet.append(part);
      this.offs.push(x);
      x += w * this.scale + 30;
    });
    const H = Math.max(...plan.sizes.map((s) => s[1])) * this.scale;
    this.sheet.style.width = `${x - 30}px`;
    this.sheet.style.height = `${H}px`;
    // туман и метки поверх
    const fog = document.createElement('canvas');
    fog.className = 'zs-fog';
    fog.width = Math.ceil((x - 30) / 2);
    fog.height = Math.ceil(H / 2);
    this.sheet.append(fog);
    const marks = document.createElement('div');
    marks.className = 'zs-plan-marks';
    this.sheet.append(marks);
    void site;
  }

  /** Достроенная часть: комнаты рамками на пергаменте, ходы — линиями. */
  private schematic(plan: Plan, img: number, w: number, h: number): string {
    const rooms = plan.rooms.filter((r) => (r.img ?? 0) === img);
    const ids = new Set(rooms.map((r) => r.id));
    const lines = plan.links
      .filter((l) => ids.has(l.a) && ids.has(l.b))
      .map((l) => {
        const a = rooms.find((r) => r.id === l.a)!;
        const b = rooms.find((r) => r.id === l.b)!;
        return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="zs-sch-${l.kind}"/>`;
      })
      .join('');
    const boxes = rooms.map((r) => `<rect x="${r.x - 22}" y="${r.y - 18}" width="44" height="36" rx="3"/><text x="${r.x}" y="${r.y + 5}">${r.id}</text>`).join('');
    return `<svg class="zs-sch" viewBox="0 0 ${w} ${h}" width="100%" height="100%"><rect width="${w}" height="${h}" class="zs-sch-bg"/>${lines}${boxes}<text x="${w / 2}" y="${h - 8}" class="zs-sch-note">достроено: на плане книги не нарисовано</text></svg>`;
  }

  private pos(r: PlanRoom): { x: number; y: number } {
    return { x: this.offs[r.img ?? 0] + r.x * this.scale, y: r.y * this.scale };
  }

  private paint(v: View, plan: Plan, canMove: boolean): void {
    const site = this.site;
    const room = v.where.k === 'site' ? v.where.room : '';
    const visited = new Set(v.world.visited.filter((x) => x.startsWith(site + ':')).map((x) => x.slice(site.length + 1)));
    const fog = this.sheet.querySelector('.zs-fog') as HTMLCanvasElement;
    const g = fog.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, fog.width, fog.height);
    if (!v.gm) {
      g.fillStyle = look() === 'color' ? '#2a1d12' : '#1c1c1c';
      g.fillRect(0, 0, fog.width, fog.height);
      g.globalCompositeOperation = 'destination-out';
      const hole = (r: PlanRoom, k: number) => {
        const p = this.pos(r);
        const rad = (Math.max(14, Number(r.r) || 0) * this.scale * k) / 2;
        const gr = g.createRadialGradient(p.x / 2, p.y / 2, 0, p.x / 2, p.y / 2, rad);
        gr.addColorStop(0, 'rgba(0,0,0,1)');
        gr.addColorStop(0.62, 'rgba(0,0,0,1)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.arc(p.x / 2, p.y / 2, rad, 0, Math.PI * 2);
        g.fill();
      };
      for (const r of plan.rooms) if (visited.has(r.id)) hole(r, 3);
      // соседние — чуть-чуть, как в полумраке
      for (const e of v.exits) {
        const r = plan.rooms.find((x) => x.id === e.to);
        if (r && !visited.has(r.id)) hole(r, 1.6);
      }
    }
    const marks = this.sheet.querySelector('.zs-plan-marks') as HTMLElement;
    marks.replaceChildren();
    const here = plan.rooms.find((r) => r.id === room);
    this.herePos = here ? this.pos(here) : null;
    if (here) {
      const p = this.pos(here);
      const m = document.createElement('div');
      m.className = 'zs-here';
      m.style.left = `${p.x}px`;
      m.style.top = `${p.y}px`;
      marks.append(m);
    }
    for (const e of v.exits) {
      const r = plan.rooms.find((x) => x.id === e.to);
      if (!r) continue;
      const p = this.pos(r);
      const b = document.createElement('button');
      b.className = `zs-exit k-${e.kind}${e.hidden ? ' hidden' : ''}`;
      b.style.left = `${p.x}px`;
      b.style.top = `${p.y}px`;
      b.title = `${KIND_NAME[e.kind] ?? 'проход'}${visited.has(r.id) ? ` — ${/^\d/.test(r.id) ? 'комната ' + r.id : 'пройдено'}` : ''}`;
      b.textContent = KIND_ICON[e.kind] ?? '•';
      b.disabled = !canMove || !!e.hidden;
      b.onclick = () => this.onRoom?.(e.to);
      marks.append(b);
    }
    if (v.gm) for (const r of plan.rooms) if (/^\d/.test(r.id)) {
      const p = this.pos(r);
      const t = document.createElement('span');
      t.className = 'zs-num' + (visited.has(r.id) ? ' seen' : '') + (v.world.done.includes(`site:${site}:${r.id}`) ? ' done' : '');
      t.style.left = `${p.x}px`;
      t.style.top = `${p.y}px`;
      t.textContent = r.id;
      marks.append(t);
    }
  }

  private fit(): void {
    if (!this.plan) return;
    const sw = parseFloat(this.sheet.style.width) || 1;
    const sh = parseFloat(this.sheet.style.height) || 1;
    const W = this.el.clientWidth;
    const H = this.el.clientHeight;
    const kAll = Math.min(W / sw, H / sh, 1.6);
    if (!this.near || !this.herePos) {
      this.sheet.style.transform = `translate(${(W - sw * kAll) / 2}px, ${(H - sh * kAll) / 2}px) scale(${kAll})`;
      return;
    }
    // ближе: комната отряда в середине, видно соседей
    const k = Math.max(kAll, Math.min(1.25, (Math.min(W, H) / 520) * 1.0));
    let x = W / 2 - this.herePos.x * k;
    let y = H / 2 - this.herePos.y * k;
    x = Math.min(Math.max(x, W - sw * k - 20), 20);
    y = Math.min(Math.max(y, H - sh * k - 20), 20);
    if (sw * k < W) x = (W - sw * k) / 2;
    if (sh * k < H) y = (H - sh * k) / 2;
    this.sheet.style.transition = 'transform .45s ease';
    this.sheet.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  }
}
