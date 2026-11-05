/* Отрисовка боя на PixiJS v8 (DESIGN.md §10): сцена 1920×1080, вписанная в окно. Логику не трогает: показывает события act() по очереди,
 * у отрядов свой показанный вид (клетка, число), поэтому сохранение и сеть рисуются тем же кодом. */
import { type Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { Audio2 } from '../audio';
import { releaseApp, takeApp } from './pixi';
import { type BattleEvent, type BattleState, type HitInfo, type Unit, cellsOf } from '../sim/battle';
import { CREATURES, hasAb } from '../sim/creatures';
import { CELLS, FIELD_W, cellX, cellY } from '../sim/hex';
import { SPELLS, type School } from '../sim/spells';

export const STAGE_W = 1920;
export const STAGE_H = 1080;
const HEX_W = 94;
const ROW_H = 60;
const FIELD_X = (STAGE_W - (FIELD_W + 0.5) * HEX_W) / 2;
const FIELD_Y = 232;
/** Рост на поле по ступеням, px сцены; в атласе фигура ~133 px. */
const TIER_H = [92, 100, 108, 122, 136, 166, 200];
const OBST: Record<string, number[]> = { meadow: [1, 2, 3, 4, 9, 10], swamp: [1, 3, 4, 5, 9], ash: [1, 6, 8, 10], pine: [1, 2, 3, 4, 7, 10] };
const SCHOOL_COLOR: Record<School, number> = { fire: 0xff7a2a, water: 0x58b8ff, earth: 0xb9a15a, air: 0xc9e4ff };

export function cellCenter(c: number): { x: number; y: number } {
  const y = cellY(c);
  return { x: FIELD_X + (cellX(c) + (y & 1 ? 0.5 : 0)) * HEX_W + HEX_W / 2, y: FIELD_Y + y * ROW_H + ROW_H / 2 };
}

interface Atlas {
  frame: number;
  origin: [number, number];
  muzzle: [number, number];
  top: [number, number];
  anims: Record<string, { row: number; fps: number; loop: boolean; frames: number }>;
}
type Anim = 'idle' | 'move' | 'shoot' | 'hit' | 'defend' | 'death';

/** Кадры существа: один раз на вид. */
const loaded = new Map<string, Promise<{ meta: Atlas; frames: Record<string, Texture[]> }>>();
export function loadCreature(id: string) {
  let p = loaded.get(id);
  if (!p) {
    p = (async () => {
      // мипмапы: младшие ступени стоят мельче кадра, без них они рябят
      const got = await Promise.all([
        fetch(`/geroi/a/creatures/${id}.json`).then((r) => r.json() as Promise<Atlas>),
        Assets.load<Texture>({ src: `/geroi/a/creatures/${id}.webp`, data: { autoGenerateMipmaps: true } }),
      ]).catch(() => null);
      // атласа ещё нет (вторая волна генерируется): пустой спрайт, игра идёт
      if (!got) {
        console.warn(`geroi: нет атласа существа ${id}`);
        const one = { row: 0, fps: 1, loop: true, frames: 1 };
        const meta: Atlas = { frame: 1, origin: [0, 0], muzzle: [0, 0], top: [0, 0], anims: { idle: one, move: one, shoot: one, hit: one, defend: one, death: { ...one, loop: false } } };
        return { meta, frames: Object.fromEntries(Object.keys(meta.anims).map((k) => [k, [Texture.EMPTY]])) };
      }
      const [meta, tex] = got;
      const frames: Record<string, Texture[]> = {};
      for (const [name, a] of Object.entries(meta.anims)) {
        frames[name] = Array.from({ length: a.frames }, (_, i) => new Texture({ source: tex.source, frame: new Rectangle(i * meta.frame, a.row * meta.frame, meta.frame, meta.frame) }));
      }
      return { meta, frames };
    })();
    loaded.set(id, p);
  }
  return p;
}

class UnitSprite {
  root = new Container();
  body = new Sprite();
  badge = new Container();
  private plate = new Graphics();
  private label = new Text({ text: '', style: { fontFamily: 'Geroi Num, sans-serif', fontSize: 22, fontWeight: '700', fill: 0xfff4d8 } });
  private veil = new Container();
  private veilMist = new Graphics();
  private veilLabel = new Text({ text: '', style: { fontFamily: 'Geroi Num, sans-serif', fontSize: 19, fontWeight: '600', fill: 0xeaf4f0, stroke: { color: 0x1a2420, width: 4 } } });
  anim: Anim = 'idle';
  private t = 0;
  private fps = 8;
  private list: Texture[] = [];
  private loop = true;
  private done: (() => void) | null = null;
  cell = 0;
  count = 0;
  dead = false;

  constructor(
    readonly u: Unit,
    private readonly art: { meta: Atlas; frames: Record<string, Texture[]> },
    private readonly sideColor: number,
  ) {
    const c = CREATURES[u.cre];
    const k = TIER_H[c.tier - 1] / (art.meta.origin[1] - art.meta.top[1]);
    this.body.anchor.set(art.meta.origin[0] / art.meta.frame, art.meta.origin[1] / art.meta.frame);
    this.body.scale.set(u.side === 0 ? k : -k, k);
    this.badge.addChild(this.plate, this.label);
    this.label.anchor.set(0.5);
    this.veilLabel.anchor.set(0.5);
    this.veilLabel.position.set(0, -TIER_H[c.tier - 1] - 8);
    this.veil.addChild(this.veilMist, this.veilLabel);
    this.veil.visible = false;
    this.root.addChild(this.body, this.veil, this.badge);
    this.setCount(u.count);
    this.play('idle');
  }

  /** Отряд стоит, но ударить его нельзя: дымка у ног и подпись, сам он виден ясно. */
  setVeil(text: string | null): void {
    this.veil.visible = !!text;
    if (!text) return;
    this.veilLabel.text = text;
    this.veilMist.clear();
    for (const [x, y, rx, ry] of [[-34, -6, 40, 15], [26, -2, 44, 16], [-4, -20, 52, 17]]) this.veilMist.ellipse(x, y, rx, ry).fill({ color: 0xdfe8e4, alpha: 0.42 });
  }

  setCount(n: number): void {
    this.count = n;
    this.label.text = String(n);
    const w = Math.max(38, this.label.width + 16);
    const dir = this.u.side === 0 ? 1 : -1;
    this.badge.position.set(dir * (hasAb(CREATURES[this.u.cre], 'big') ? 34 : 24), -8);
    this.plate.clear().roundRect(-w / 2, -14, w, 28, 6).fill({ color: 0x241c14, alpha: 0.92 }).stroke({ color: this.sideColor, width: 2.5 });
  }

  /** Сыграть анимацию; у неповторяющейся — обещание конца. */
  play(a: Anim): Promise<void> {
    const info = this.art.meta.anims[a] ?? this.art.meta.anims.idle;
    this.anim = a;
    this.list = this.art.frames[this.art.meta.anims[a] ? a : 'idle'];
    this.fps = info.fps;
    this.loop = info.loop;
    this.t = 0;
    this.body.texture = this.list[0];
    this.done?.();
    this.done = null;
    if (this.loop) return Promise.resolve();
    return new Promise((res) => (this.done = res));
  }

  update(dt: number): void {
    this.t += dt;
    const n = this.list.length;
    let i = Math.floor(this.t * this.fps);
    if (i >= n) {
      if (this.loop) i %= n;
      else {
        i = n - 1;
        if (this.done) {
          const d = this.done;
          this.done = null;
          d();
        }
      }
    }
    this.body.texture = this.list[i];
  }

  /** Сколько выше ног вылетает снаряд и насколько вперёд. */
  muzzle(): { x: number; y: number } {
    const m = this.art.meta;
    const k = Math.abs(this.body.scale.y);
    return { x: this.root.x + (m.muzzle[0] - m.origin[0]) * k * (this.u.side === 0 ? 1 : -1), y: this.root.y + (m.muzzle[1] - m.origin[1]) * k };
  }
}

export interface Pointer {
  /** Клетка под мышью, −1 — вне поля. */
  cell: number;
  x: number;
  y: number;
}

export class BattleView {
  app!: Application;
  private readonly canvasEvents = new AbortController();
  private readonly onTick = (t: { deltaMS: number }): void => this.tick(t.deltaMS / 1000);
  private stage = new Container();
  private grid = new Graphics();
  private marks = new Graphics();
  private unitsLayer = new Container();
  private fx = new Container();
  private sprites = new Map<number, UnitSprite>();
  private wallSprites = new Map<number, Sprite>();
  private tweens = new Set<(dt: number) => boolean>();
  /** Без показа: автобой ×∞ и прогон по адресу (?fast=1). */
  instant = false;
  speed = 1;
  onPointer: (p: Pointer) => void = () => {};
  onClick: (p: Pointer, right: boolean) => void = () => {};
  private readonly resize = (): void => this.fit();

  constructor(private readonly host: HTMLElement, private readonly audio: Audio2) {}

  async init(s: BattleState): Promise<void> {
    this.app = await takeApp(this.host);
    this.app.stage.addChild(this.stage);
    const bg = new Sprite(await Assets.load<Texture>(`/geroi/a/fields/${s.field}.webp`));
    bg.width = STAGE_W;
    bg.height = STAGE_H;
    this.stage.addChild(bg);
    this.drawGround(s);
    this.stage.addChild(this.grid, this.marks);
    const arts = OBST[s.field] ?? OBST.meadow;
    await Promise.all(s.obstacles.map(async (o) => {
      const sp = new Sprite(await Assets.load<Texture>(`/geroi/a/obstacles/${arts[o.art % arts.length]}.webp`));
      const p = cellCenter(o.cell);
      const k = 112 / Math.max(sp.texture.width, sp.texture.height);
      sp.anchor.set(0.5, 0.72);
      sp.scale.set(k);
      sp.position.set(p.x, p.y);
      sp.zIndex = p.y;
      this.unitsLayer.addChild(sp);
    }));
    this.unitsLayer.sortableChildren = true;
    this.stage.addChild(this.unitsLayer, this.fx);
    await Promise.all((s.walls ?? []).map(async (w) => {
      const part = w.gate ? 'gate' : w.tower ? 'tower' : 'wall';
      const tex = await Assets.load<Texture>(`/geroi/a/siege/${part}-${s.siegeFaction}.webp`);
      const sp = new Sprite(tex);
      const p = cellCenter(w.cell);
      sp.anchor.set(0.5, 0.8);
      sp.scale.set((w.tower ? 130 : 118) / tex.width);
      sp.position.set(p.x, p.y);
      sp.zIndex = p.y;
      this.unitsLayer.addChild(sp);
      this.wallSprites.set(w.cell, sp);
    }));
    if (s.walls) this.refreshWalls(s);
    await Promise.all(s.units.map(async (u) => {
      const art = await loadCreature(u.cre);
      const sp = new UnitSprite(u, art, u.side === 0 ? 0x4aa3ff : 0xff5d4a);
      this.place(sp, u.cell);
      sp.count = u.count;
      if (u.count === 0) {
        sp.dead = true;
        sp.root.visible = false;
      }
      this.sprites.set(u.id, sp);
      this.unitsLayer.addChild(sp.root);
    }));
    this.app.ticker.add(this.onTick);
    window.addEventListener('resize', this.resize);
    this.fit();
    const canvas = this.app.canvas;
    const at = (e: MouseEvent): Pointer => {
      const r = canvas.getBoundingClientRect();
      const k = this.stage.scale.x;
      const x = (e.clientX - r.left - this.stage.x) / k;
      const y = (e.clientY - r.top - this.stage.y) / k;
      return { x, y, cell: this.cellAt(x, y) };
    };
    const { signal } = this.canvasEvents;
    canvas.addEventListener('pointermove', (e) => this.onPointer(at(e)), { signal });
    canvas.addEventListener('pointerleave', () => this.onPointer({ cell: -1, x: 0, y: 0 }), { signal });
    canvas.addEventListener('pointerdown', (e) => this.onClick(at(e), e.button === 2), { signal });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
  }

  destroy(): void {
    window.removeEventListener('resize', this.resize);
    this.canvasEvents.abort();
    if (!this.app) return;
    this.app.ticker.remove(this.onTick);
    releaseApp(this.app);
  }

  /** Сцена вписана в окно целиком (16:9, поля по краям). */
  private fit(): void {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const k = Math.min(w / STAGE_W, h / STAGE_H);
    this.stage.scale.set(k);
    this.stage.position.set((w - STAGE_W * k) / 2, (h - STAGE_H * k) / 2);
  }

  /** Экранный прямоугольник сцены: интерфейс HTML стоит ровно поверх неё. */
  stageRect(): { x: number; y: number; k: number } {
    return { x: this.stage.x, y: this.stage.y, k: this.stage.scale.x };
  }

  cellAt(x: number, y: number): number {
    let best = -1;
    let bestD = Infinity;
    for (let c = 0; c < CELLS; c++) {
      const p = cellCenter(c);
      const dx = (x - p.x) / HEX_W;
      const dy = (y - p.y) / (ROW_H * 1.15);
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return bestD < 0.5 ? best : -1;
  }

  private hexPath(g: Graphics, c: number, inset = 0): Graphics {
    const p = cellCenter(c);
    const w = HEX_W / 2 - inset;
    const t = (ROW_H * 2) / 3 - inset * 0.7;
    const m = ROW_H / 3 - inset * 0.3;
    return g.poly([p.x, p.y - t, p.x + w, p.y - m, p.x + w, p.y + m, p.x, p.y + t, p.x - w, p.y + m, p.x - w, p.y - m]);
  }

  private drawGround(s: BattleState): void {
    const ground = new Graphics();
    for (const c of s.bog) this.hexPath(ground, c, 2).fill({ color: 0x25351d, alpha: 0.72 });
    for (const c of s.bog) this.hexPath(ground, c, 8).stroke({ color: 0x6f8f4a, width: 2, alpha: 0.5 });
    this.stage.addChild(ground);
    for (let c = 0; c < CELLS; c++) this.hexPath(this.grid, c).stroke({ color: 0xfff2d0, width: 1, alpha: 0.2 });
  }

  private place(sp: UnitSprite, cell: number): void {
    sp.cell = cell;
    const big = hasAb(CREATURES[sp.u.cre], 'big');
    const p = cellCenter(cell);
    const x = big ? p.x + (sp.u.side === 0 ? -HEX_W / 2 : HEX_W / 2) : p.x;
    sp.root.position.set(x, p.y + 10);
    sp.root.zIndex = p.y;
  }

  /** Подсветка хода: куда дойти, активный отряд, цель под мышью. */
  highlight(o: { reach?: number[]; active?: Unit | null; attackFrom?: number; target?: Unit | null; hover?: number; area?: number[]; targets?: Unit[] }): void {
    const g = this.marks.clear();
    for (const c of o.reach ?? []) this.hexPath(g, c, 2).fill({ color: 0xfff2d0, alpha: 0.26 });
    for (const u of o.targets ?? []) for (const c of cellsOf(u)) this.hexPath(g, c, 2).fill({ color: 0xff5d4a, alpha: 0.2 });
    if (o.active) for (const c of cellsOf(o.active)) this.hexPath(g, c, 1).fill({ color: 0xffd25a, alpha: 0.32 }).stroke({ color: 0xffd25a, width: 3 });
    if (o.hover !== undefined && o.hover >= 0) this.hexPath(g, o.hover, 1).stroke({ color: 0xffffff, width: 3, alpha: 0.85 });
    if (o.attackFrom !== undefined) this.hexPath(g, o.attackFrom, 1).fill({ color: 0xffd25a, alpha: 0.35 });
    if (o.target) for (const c of cellsOf(o.target)) this.hexPath(g, c, 1).fill({ color: 0xff5d4a, alpha: 0.45 }).stroke({ color: 0xff8d7a, width: 3 });
    for (const c of o.area ?? []) this.hexPath(g, c, 2).fill({ color: 0xff9a3a, alpha: 0.4 });
  }

  private tick(dt: number): void {
    for (const sp of this.sprites.values()) sp.update(dt * this.speed);
    for (const t of this.tweens) if (t(dt * this.speed)) this.tweens.delete(t);
  }

  private tween(sec: number, fn: (k: number) => void): Promise<void> {
    if (this.instant) {
      fn(1);
      return Promise.resolve();
    }
    return new Promise((res) => {
      let t = 0;
      this.tweens.add((dt) => {
        t += dt;
        const k = Math.min(1, t / sec);
        fn(k);
        if (k >= 1) res();
        return k >= 1;
      });
    });
  }

  private floatText(x: number, y: number, text: string, color: number, size = 30): void {
    if (this.instant) return;
    const t = new Text({ text, style: { fontFamily: 'Geroi Num, sans-serif', fontSize: size, fontWeight: '700', fill: color, stroke: { color: 0x120d08, width: 5 } } });
    t.anchor.set(0.5);
    t.position.set(x, y);
    this.fx.addChild(t);
    void this.tween(1.1, (k) => {
      t.y = y - 56 * k;
      t.alpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      if (k >= 1) t.destroy();
    });
  }

  private headOf(sp: UnitSprite): { x: number; y: number } {
    return { x: sp.root.x, y: sp.root.y - TIER_H[CREATURES[sp.u.cre].tier - 1] * 0.75 };
  }

  private async moveAlong(sp: UnitSprite, path: number[]): Promise<void> {
    const c = CREATURES[sp.u.cre];
    if (this.instant) return this.place(sp, path[path.length - 1]);
    const fly = hasAb(c, 'fly');
    this.audio.sfx(c.sfx.move, 0.45);
    void sp.play('move');
    const secPerStep = fly ? 0.11 : 0.2;
    const big = hasAb(c, 'big');
    const off = big ? (sp.u.side === 0 ? -HEX_W / 2 : HEX_W / 2) : 0;
    for (let i = 1; i < path.length; i++) {
      const from = { x: sp.root.x, y: sp.root.y };
      const to = cellCenter(path[i]);
      const steps = fly ? Math.max(1, Math.hypot(to.x - from.x, to.y - from.y) / HEX_W) : 1;
      await this.tween(secPerStep * steps, (k) => {
        const h = fly ? Math.sin(k * Math.PI) * 26 : 0;
        sp.root.position.set(from.x + (to.x + off - from.x) * k, from.y + (to.y + 10 - from.y) * k - h);
        sp.root.zIndex = sp.root.y;
      });
    }
    this.place(sp, path[path.length - 1]);
    void sp.play('idle');
  }

  private woundShown(h: HitInfo, retal: boolean, luck: boolean): void {
    const t = this.sprites.get(h.t);
    if (!t) return;
    t.setCount(h.left);
    const p = this.headOf(t);
    this.floatText(p.x, p.y, `−${Math.round(h.dmg)}${h.kills ? ` (†${h.kills})` : ''}`, luck ? 0xffd25a : retal ? 0xffb38a : 0xffe6d0);
    if (h.left > 0) void t.play('hit').then(() => {
      if (t.anim === 'hit') void t.play('idle');
    });
  }

  private async die(id: number): Promise<void> {
    const sp = this.sprites.get(id);
    if (!sp || sp.dead) return;
    sp.dead = true;
    sp.badge.visible = false;
    this.audio.sfx(CREATURES[sp.u.cre].sfx.death);
    if (!this.instant) await sp.play('death');
    // павший остаётся лежать на земле полупрозрачным, под живыми
    sp.root.alpha = 0.55;
    sp.root.zIndex = 0;
  }

  private async projectile(sp: UnitSprite, to: { x: number; y: number }, color: number): Promise<void> {
    if (this.instant) return;
    const from = sp.muzzle();
    const g = new Graphics().circle(0, 0, 7).fill(color).circle(0, 0, 12).fill({ color, alpha: 0.3 });
    this.fx.addChild(g);
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    await this.tween(Math.max(0.12, dist / 1700), (k) => g.position.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * dist * 0.06));
    g.destroy();
  }

  private burst(x: number, y: number, color: number, r = 90): void {
    if (this.instant) return;
    const parts: { g: Graphics; a: number; d: number }[] = [];
    for (let i = 0; i < 16; i++) {
      const g = new Graphics().circle(0, 0, 3 + (i % 4)).fill(color);
      g.position.set(x, y);
      this.fx.addChild(g);
      parts.push({ g, a: (i / 16) * Math.PI * 2, d: r * (0.55 + ((i * 7) % 5) * 0.1) });
    }
    const ring = new Graphics();
    this.fx.addChild(ring);
    void this.tween(0.55, (k) => {
      for (const p of parts) {
        p.g.position.set(x + Math.cos(p.a) * p.d * k, y + Math.sin(p.a) * p.d * k * 0.6 - 18 * k);
        p.g.alpha = 1 - k;
      }
      ring.clear().ellipse(x, y, r * k, r * k * 0.6).stroke({ color, width: 5 * (1 - k), alpha: 1 - k });
      if (k >= 1) {
        for (const p of parts) p.g.destroy();
        ring.destroy();
      }
    });
  }

  /** Показать события действия по порядку. */
  async play(events: BattleEvent[]): Promise<void> {
    for (const e of events) await this.show(e);
  }

  private async show(e: BattleEvent): Promise<void> {
    switch (e.e) {
      case 'move':
        return this.moveAlong(this.sprites.get(e.u)!, e.path);
      case 'hit': {
        const a = this.sprites.get(e.u)!;
        const c = CREATURES[a.u.cre];
        const first = this.sprites.get(e.hits[0].t);
        if (e.shot) {
          this.audio.sfx(c.sfx.shot);
          const swing = this.instant ? Promise.resolve() : a.play('shoot');
          if (first) await this.projectile(a, this.headOf(first), 0xffe8b0);
          this.audio.sfx('impact-arrow', 0.5);
          e.hits.forEach((h) => this.woundShown(h, false, !!e.luck));
          await swing;
          if (!this.instant) void a.play('idle');
          return;
        }
        const face = first && first.root.x < a.root.x ? -1 : 1;
        a.body.scale.x = Math.abs(a.body.scale.x) * face;
        const lunge = a.root.x;
        const dir = first ? Math.sign(first.root.x - a.root.x) || face : face;
        const swing = this.instant ? Promise.resolve() : a.play('shoot');
        await this.tween(0.16, (k) => (a.root.x = lunge + dir * 18 * k));
        this.audio.sfx(c.sfx.hit);
        if (Math.random() < 0.35) this.audio.sfx(c.sfx.voice, 0.4);
        e.hits.forEach((h) => this.woundShown(h, !!e.retal, !!e.luck));
        if (e.luck) this.audio.sfx('luck', 0.6);
        await this.tween(0.16, (k) => (a.root.x = lunge + dir * 18 * (1 - k)));
        await swing;
        a.body.scale.x = Math.abs(a.body.scale.x) * (a.u.side === 0 ? 1 : -1);
        if (!this.instant) void a.play('idle');
        return;
      }
      case 'die':
        return this.die(e.u);
      case 'skip': {
        const sp = this.sprites.get(e.u)!;
        const p = this.headOf(sp);
        this.floatText(p.x, p.y, e.why === 'stun' ? 'пропускает ход' : 'дрогнул', 0xc8d6ff, 24);
        if (e.why === 'morale') this.audio.sfx('badmorale');
        return this.tween(0.45, () => {});
      }
      case 'morale': {
        const sp = this.sprites.get(e.u)!;
        const p = this.headOf(sp);
        this.floatText(p.x, p.y, 'боевой дух: ещё ход!', 0xffd25a, 24);
        this.audio.sfx('morale');
        return this.tween(0.5, () => {});
      }
      case 'wait': {
        const sp = this.sprites.get(e.u)!;
        const p = this.headOf(sp);
        this.floatText(p.x, p.y, 'ждёт', 0xfff2d0, 22);
        return;
      }
      case 'defend': {
        const sp = this.sprites.get(e.u)!;
        this.audio.sfx('defend', 0.5);
        const p = this.headOf(sp);
        this.floatText(p.x, p.y, 'защита', 0xbfe0ff, 22);
        if (!this.instant) {
          await sp.play('defend');
          void sp.play('idle');
        }
        return;
      }
      case 'spell': {
        const sp = SPELLS[e.spell];
        const kind = sp.kind === 'heal' ? 'spell-heal' : sp.kind === 'buff' ? 'spell-buff' : sp.kind === 'curse' ? 'spell-curse' : `spell-${sp.school}`;
        this.audio.sfx(kind);
        const color = SCHOOL_COLOR[sp.school];
        const p = cellCenter(e.cell);
        this.burst(p.x, p.y, color, sp.kind === 'aoe' ? 170 : 90);
        this.floatText(p.x, p.y - 70, sp.name, color, 26);
        await this.tween(0.32, () => {});
        e.hits.forEach((h) => this.woundShown(h, false, false));
        for (const h of e.heals) {
          this.sprites.get(h.t)?.setCount(h.left);
          const t = this.sprites.get(h.t);
          if (t) this.floatText(this.headOf(t).x, this.headOf(t).y, 'лечение', 0x9dffb0, 24);
        }
        return this.tween(0.3, () => {});
      }
      case 'aid': {
        const t = this.sprites.get(e.t);
        const a = this.sprites.get(e.u);
        if (t && a) {
          this.audio.sfx(e.curse ? 'spell-curse' : 'spell-heal');
          if (!this.instant) void a.play('shoot').then(() => a.play('idle'));
          await this.projectile(a, this.headOf(t), e.curse ? 0x8fd6a0 : 0x9dffb0);
          t.setCount(e.left);
          this.floatText(this.headOf(t).x, this.headOf(t).y, e.curse ? 'замедлен' : 'лечение', e.curse ? 0xb0e0a0 : 0x9dffb0, 24);
        }
        return;
      }
      case 'proc': {
        const t = this.sprites.get(e.t);
        if (!t) return;
        const text = { poison: 'яд', blind: 'ослеплён', root: 'опутан', swallow: 'схвачен!', mist: 'в тумане', storm: 'буря!', trap: 'ловушка!', pull: 'гарпун', steal: '+семки' }[e.k];
        this.floatText(this.headOf(t).x + 20, this.headOf(t).y + 26, text, 0xc9ffa8, 22);
        return;
      }
      case 'poison': {
        const t = this.sprites.get(e.t);
        if (!t) return;
        t.setCount(e.left);
        this.floatText(this.headOf(t).x, this.headOf(t).y, `яд −${e.dmg}`, 0xa8ff7a, 24);
        return this.tween(0.25, () => {});
      }
      case 'wall': {
        const sp = this.wallSprites.get(e.cell);
        this.audio.sfx(e.hp > 0 ? 'catapult' : 'wall-break');
        if (sp) {
          this.floatText(sp.x, sp.y - 60, e.hp > 0 ? 'таран!' : 'пролом!', 0xffd9a0, 26);
          this.showWall(sp, e.hp);
        }
        return this.tween(0.3, () => {});
      }
      case 'tower': {
        const t = this.sprites.get(e.t);
        if (!t) return;
        this.audio.sfx('tower-shot');
        t.setCount(e.left);
        this.floatText(this.headOf(t).x, this.headOf(t).y, `башня −${e.dmg}`, 0xffb08a, 24);
        return this.tween(0.25, () => {});
      }
      case 'round':
        return;
      case 'turn':
      case 'over':
        return;
    }
  }

  /** После загрузки сохранения или рассинхрона: показанное = состояние. */
  sync(s: BattleState): void {
    for (const u of s.units) {
      const sp = this.sprites.get(u.id);
      if (!sp) continue;
      this.place(sp, u.cell);
      sp.setCount(u.count);
      sp.dead = u.count === 0;
      sp.root.visible = true;
      sp.badge.visible = u.count > 0;
      sp.root.alpha = u.count === 0 ? 0.55 : 1;
      void sp.play(u.count === 0 ? 'death' : 'idle');
    }
  }

  private showWall(sp: Sprite, hp: number): void {
    // разбитый кусок лежит тёмной грудой, а не исчезает
    if (hp <= 0) {
      sp.tint = 0x5a5048;
      sp.alpha = 0.55;
      sp.scale.y = Math.abs(sp.scale.x) * 0.45;
      sp.zIndex = 0;
    } else if (hp === 1) sp.tint = 0xb8a890;
  }

  private refreshWalls(s: BattleState): void {
    for (const w of s.walls ?? []) {
      const sp = this.wallSprites.get(w.cell);
      if (sp) this.showWall(sp, w.hp);
    }
  }

  /** Метка отряда, которого нельзя ударить: ушёл в туман или схвачен. */
  refreshStates(s: BattleState): void {
    for (const u of s.units) {
      const sp = this.sprites.get(u.id);
      if (!sp || u.count <= 0) continue;
      const hidden = u.effects.some((e) => e.k === 'hidden');
      sp.setVeil(!hidden ? null : u.effects.some((e) => e.k === 'stun') ? 'схвачен' : 'в тумане');
    }
  }
}
