/* Отрисовка карты приключений на PixiJS v8 (DESIGN.md §7.6): грунт и туман — одним шейдером на весь квад, объекты и герои — спрайтами с сортировкой по глубине, камера.
 * Логику не трогает: показывает мир глазами текущего игрока. */
import { type Application, Assets, BufferImageSource, Container, Geometry, Graphics, Mesh, Rectangle, Shader, Sprite, Text, Texture } from 'pixi.js';
import type { Audio2 } from '../audio';
import { CREATURES } from '../sim/creatures';
import { MOUNT_W, ROAD_ART, TERRAINS, TOWN_SIZE, TOWN_W, WATER } from '../sim/adv/data';
import type { AdvHero } from '../sim/adv/hero';
import { type MapObject, type World, defOf, heroHiddenFrom, isStack, xOf, yOf } from '../sim/adv/world';
import { releaseApp, takeApp } from './pixi';
import { loadCreature } from './view';

export const TILE = 64;
/** Сцена считается в размере 1080p: на другом экране всё просто крупнее или мельче. */
const STAGE_H = 1080;
export const PLAYER_COLORS = [0x3f8fe0, 0xd8533f, 0x57b05a, 0xe0b23f, 0x9a62d4, 0x3fc3c3, 0xe07fb0, 0x8f8f8f];
const HERO_H = 104;

const VERT = `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAG = `
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uIds;
uniform sampler2D uFog;
uniform sampler2D uT0; uniform sampler2D uT1; uniform sampler2D uT2; uniform sampler2D uT3;
uniform sampler2D uT4; uniform sampler2D uT5; uniform sampler2D uT6; uniform sampler2D uT7;
uniform sampler2D uR1; uniform sampler2D uR2; uniform sampler2D uR3;
uniform vec2 uSize;
uniform float uTime;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.1 + 3.7) + 0.15 * vnoise(p * 4.3 + 9.1); }

vec3 sampleT(int id, vec2 uv) {
  if (id == 0) return texture(uT0, uv).rgb;
  if (id == 1) return texture(uT1, uv).rgb;
  if (id == 2) return texture(uT2, uv).rgb;
  if (id == 3) return texture(uT3, uv).rgb;
  if (id == 4) return texture(uT4, uv).rgb;
  if (id == 5) return texture(uT5, uv).rgb;
  if (id == 6) return texture(uT6, uv + vec2(sin(uTime * 0.35 + uv.y * 9.0), cos(uTime * 0.28 + uv.x * 8.0)) * 0.006).rgb;
  return texture(uT7, uv).rgb;
}
/* Узор: две выборки в разном масштабе, чтобы текстура не читалась плиткой. */
vec3 terrain(int id, vec2 cell) {
  /* сдвиг низкой частотой ломает ряды, второй слой повёрнут и другого масштаба */
  vec2 drift = vec2(fbm(cell * 0.11), fbm(cell * 0.11 + 31.7)) * 2.4;
  vec3 a = sampleT(id, (cell + drift) / 6.0);
  vec2 turned = vec2(cell.x * 0.82 - cell.y * 0.57, cell.x * 0.57 + cell.y * 0.82);
  vec3 b = sampleT(id, (turned - drift) / 8.5 + 0.37);
  return mix(a, b, smoothstep(0.32, 0.68, fbm(cell * 0.17 + 3.3)));
}

void main() {
  vec2 cell = vUV * uSize;
  /* граница местности не по сетке: сдвигаем точку шумом */
  vec2 warp = vec2(fbm(cell * 0.9), fbm(cell * 0.9 + 17.3)) - 0.5;
  vec2 q = cell + warp * 0.85 - 0.5;
  vec2 base = floor(q);
  vec2 f = smoothstep(0.28, 0.72, fract(q));
  vec2 px = 1.0 / uSize;
  vec4 c00 = texture(uIds, (base + vec2(0.5, 0.5)) * px);
  vec4 c10 = texture(uIds, (base + vec2(1.5, 0.5)) * px);
  vec4 c01 = texture(uIds, (base + vec2(0.5, 1.5)) * px);
  vec4 c11 = texture(uIds, (base + vec2(1.5, 1.5)) * px);
  int i00 = int(c00.r * 255.0 + 0.5); int i10 = int(c10.r * 255.0 + 0.5);
  int i01 = int(c01.r * 255.0 + 0.5); int i11 = int(c11.r * 255.0 + 0.5);
  float w00 = (1.0 - f.x) * (1.0 - f.y); float w10 = f.x * (1.0 - f.y);
  float w01 = (1.0 - f.x) * f.y; float w11 = f.x * f.y;
  vec3 col;
  if (i00 == i10 && i00 == i01 && i00 == i11) col = terrain(i00, cell);
  else {
    col = terrain(i00, cell) * w00 + terrain(i10, cell) * w10 + terrain(i01, cell) * w01 + terrain(i11, cell) * w11;
  }
  /* пена у берега */
  float waterW = (i00 == 6 ? w00 : 0.0) + (i10 == 6 ? w10 : 0.0) + (i01 == 6 ? w01 : 0.0) + (i11 == 6 ? w11 : 0.0);
  if (waterW > 0.02 && waterW < 0.98) {
    float band = smoothstep(0.1, 0.5, waterW) * (1.0 - smoothstep(0.5, 0.95, waterW));
    col = mix(col, vec3(0.86, 0.9, 0.86), band * 0.35 * (0.6 + 0.4 * sin(uTime * 0.8 + cell.x * 3.0 + cell.y * 2.0)));
  }
  /* дорога: мягкая полоса поверх */
  int r00 = int(c00.g * 255.0 + 0.5); int r10 = int(c10.g * 255.0 + 0.5);
  int r01 = int(c01.g * 255.0 + 0.5); int r11 = int(c11.g * 255.0 + 0.5);
  float roadW = (r00 > 0 ? w00 : 0.0) + (r10 > 0 ? w10 : 0.0) + (r01 > 0 ? w01 : 0.0) + (r11 > 0 ? w11 : 0.0);
  if (roadW > 0.01) {
    int kind = r00 > 0 ? r00 : r10 > 0 ? r10 : r01 > 0 ? r01 : r11;
    vec2 uv = cell / 2.5;
    vec3 road = kind == 1 ? texture(uR1, uv).rgb : kind == 2 ? texture(uR2, uv).rgb : texture(uR3, uv).rgb;
    col = mix(col, road, smoothstep(0.36, 0.62, roadW + (vnoise(cell * 3.1) - 0.5) * 0.2));
  }
  /* тёплая дымка неровности: грунт не плоский */
  col *= 0.94 + 0.12 * fbm(cell * 0.35 + 5.0);
  /* туман */
  float fog = texture(uFog, vUV).r;
  float seen = smoothstep(0.3, 0.72, fog + (fbm(cell * 1.3) - 0.5) * 0.34);
  finalColor = vec4(mix(vec3(0.045, 0.037, 0.03), col, seen), 1.0);
}`;

interface MountArt {
  frame: number;
  origin: [number, number];
  top: [number, number];
  frames: Texture[][];
}
const mounts = new Map<string, Promise<MountArt>>();
function loadMount(cls: string): Promise<MountArt> {
  let p = mounts.get(cls);
  if (!p) {
    p = (async () => {
      const [meta, tex] = await Promise.all([
        fetch(`/geroi/a/mounts/${cls}.json`).then((r) => r.json() as Promise<{ frame: number; origin: [number, number]; top: [number, number] }>),
        Assets.load<Texture>({ src: `/geroi/a/mounts/${cls}.webp`, data: { autoGenerateMipmaps: true } }),
      ]);
      const frames: Texture[][] = [];
      for (let d = 0; d < 8; d++) {
        frames.push(Array.from({ length: 16 }, (_, i) => new Texture({ source: tex.source, frame: new Rectangle(i * meta.frame, d * meta.frame, meta.frame, meta.frame) })));
      }
      return { ...meta, frames };
    })();
    mounts.set(cls, p);
  }
  return p;
}

const artTexture = (art: string): Promise<Texture> => Assets.load<Texture>({ src: `/geroi/a/map/${art}.webp`, data: { autoGenerateMipmaps: true } });

class HeroSprite {
  root = new Container();
  body = new Sprite();
  flag = new Graphics();
  boat = new Sprite();
  t = Math.random();
  moving = false;
  dir = 6;
  constructor(readonly id: number, readonly art: MountArt, color: number) {
    const k = HERO_H / (art.origin[1] - art.top[1]);
    this.body.anchor.set(art.origin[0] / art.frame, art.origin[1] / art.frame);
    this.body.scale.set(k);
    this.flag.moveTo(0, 0).lineTo(0, -34).stroke({ color: 0x2a1e12, width: 3 }).poly([0, -34, 24, -28, 0, -20]).fill(color);
    this.flag.position.set(20, -HERO_H + 14);
    this.boat.anchor.set(0.5, 0.75);
    this.boat.visible = false;
    this.root.addChild(this.boat, this.body, this.flag);
  }
  update(dt: number): void {
    this.t += dt;
    const row = this.art.frames[this.dir];
    const i = this.moving ? 8 + (Math.floor(this.t * 12) % 8) : Math.floor(this.t * 6) % 8;
    this.body.texture = row[i];
  }
}

export class MapView {
  app!: Application;
  private readonly canvasEvents = new AbortController();
  private readonly onTick = (t: { deltaMS: number }): void => this.tick(t.deltaMS / 1000);
  private world = new Container();
  private ground: Mesh<Geometry, Shader> | null = null;
  private objs = new Container();
  private overlay = new Graphics();
  private cursor = new Graphics();
  private fxLayer = new Container();
  private objSprites = new Map<number, Container>();
  private decorSprites: { sp: Sprite; cell: number }[] = [];
  private townSprites = new Map<number, Container>();
  private heroSprites = new Map<number, HeroSprite>();
  private stackSprites: { sp: Sprite; frames: Texture[]; t: number }[] = [];
  private idsData!: Uint8Array;
  private fogData!: Uint8Array;
  private idsSource!: BufferImageSource;
  private fogSource!: BufferImageSource;
  private uniforms!: { uniforms: { uTime: number } };
  private time = 0;
  private w!: World;
  private keys = new Set<string>();
  private edge = { x: 0, y: 0 };
  private tweens = new Set<(dt: number) => boolean>();
  private dragging: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private zoom = 1;
  /** Полоса справа под панелью: камера учитывает её при центрировании. */
  panelW = 320;
  onHover: (cell: number) => void = () => {};
  onClick: (cell: number, right: boolean) => void = () => {};
  onCamera: () => void = () => {};
  /** Окна поверх: карта не прокручивается и не слушает клавиши. */
  frozen = false;
  private readonly keyDown = (e: KeyboardEvent): void => {
    if (e.code.startsWith('Arrow')) this.keys.add(e.code);
  };
  private readonly keyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
  private readonly fitCam = (): void => this.clamp();

  constructor(private readonly host: HTMLElement, private readonly audio: Audio2) {}

  async init(w: World): Promise<void> {
    this.w = w;
    this.app = await takeApp(this.host);
    this.app.stage.addChild(this.world);
    await this.buildGround(w);
    this.objs.sortableChildren = true;
    this.world.addChild(this.cursor, this.objs, this.overlay, this.fxLayer);
    await this.buildDecor(w);
    await this.syncObjects(w);
    await this.syncHeroes(w);
    this.app.ticker.add(this.onTick);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('resize', this.fitCam);
    const canvas = this.app.canvas;
    const { signal } = this.canvasEvents;
    canvas.addEventListener('pointermove', (e) => this.pointerMove(e), { signal });
    canvas.addEventListener('pointerleave', () => {
      this.edge = { x: 0, y: 0 };
      this.onHover(-1);
    }, { signal });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 1) {
        this.dragging = { x: e.clientX, y: e.clientY, cx: this.world.x, cy: this.world.y, moved: false };
        e.preventDefault();
        return;
      }
      if (e.button === 0 || e.button === 2) this.onClick(this.cellAt(e), e.button === 2);
    }, { signal });
    window.addEventListener('pointerup', this.endDrag);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const next = Math.max(0.55, Math.min(1.5, this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const before = this.scale();
      const wx = (mx - this.world.x) / before;
      const wy = (my - this.world.y) / before;
      this.zoom = next;
      this.world.scale.set(this.scale());
      this.world.x = mx - wx * this.scale();
      this.world.y = my - wy * this.scale();
      this.clamp();
    }, { passive: false, signal });
    this.world.scale.set(this.scale());
  }

  private readonly endDrag = (): void => {
    this.dragging = null;
  };

  private scale(): number {
    return (this.app.screen.height / STAGE_H) * this.zoom;
  }

  private cellAt(e: MouseEvent): number {
    const r = this.app.canvas.getBoundingClientRect();
    const k = this.scale();
    const x = Math.floor((e.clientX - r.left - this.world.x) / k / TILE);
    const y = Math.floor((e.clientY - r.top - this.world.y) / k / TILE);
    if (x < 0 || y < 0 || x >= this.w.w || y >= this.w.h) return -1;
    return x + y * this.w.w;
  }

  private pointerMove(e: PointerEvent): void {
    const r = this.app.canvas.getBoundingClientRect();
    if (this.dragging) {
      this.world.x = this.dragging.cx + e.clientX - this.dragging.x;
      this.world.y = this.dragging.cy + e.clientY - this.dragging.y;
      this.clamp();
      return;
    }
    const m = 8;
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    this.edge.x = px < m ? -1 : px > r.width - m ? 1 : 0;
    this.edge.y = py < m ? -1 : py > r.height - m ? 1 : 0;
    this.onHover(this.cellAt(e));
  }

  private async buildGround(w: World): Promise<void> {
    const load = (name: string): Promise<Texture> => Assets.load<Texture>({ src: `/geroi/a/map/ground-${name}.webp`, data: { autoGenerateMipmaps: true, addressMode: 'repeat' } });
    const [terr, roads] = await Promise.all([Promise.all(TERRAINS.map((t) => load(t.id))), Promise.all(ROAD_ART.slice(1).map(load))]);
    for (const t of [...terr, ...roads]) {
      t.source.addressMode = 'repeat';
      t.source.style.update();
    }
    const n = w.w * w.h;
    this.idsData = new Uint8Array(n * 4);
    this.fogData = new Uint8Array(n * 4);
    for (let c = 0; c < n; c++) {
      this.idsData[c * 4] = w.terrain[c];
      this.idsData[c * 4 + 1] = w.road[c];
      this.idsData[c * 4 + 3] = 255;
      this.fogData[c * 4 + 3] = 255;
    }
    this.idsSource = new BufferImageSource({ resource: this.idsData, width: w.w, height: w.h, format: 'rgba8unorm', scaleMode: 'nearest', alphaMode: 'no-premultiply-alpha' });
    this.fogSource = new BufferImageSource({ resource: this.fogData, width: w.w, height: w.h, format: 'rgba8unorm', scaleMode: 'linear', alphaMode: 'no-premultiply-alpha' });
    const W = w.w * TILE;
    const H = w.h * TILE;
    const geometry = new Geometry({
      attributes: { aPosition: [0, 0, W, 0, W, H, 0, H], aUV: [0, 0, 1, 0, 1, 1, 0, 1] },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    this.uniforms = { uniforms: { uTime: 0 } };
    const resources: Record<string, unknown> = {
      uIds: this.idsSource, uFog: this.fogSource,
      groundUniforms: { uSize: { value: [w.w, w.h], type: 'vec2<f32>' }, uTime: { value: 0, type: 'f32' } },
    };
    terr.forEach((t, i) => (resources[`uT${i}`] = t.source));
    roads.forEach((t, i) => (resources[`uR${i + 1}`] = t.source));
    const shader = Shader.from({ gl: { vertex: VERT, fragment: FRAG }, resources });
    this.uniforms = shader.resources.groundUniforms as { uniforms: { uTime: number } };
    this.ground = new Mesh({ geometry, shader });
    this.world.addChildAt(this.ground, 0);
  }

  private async buildDecor(w: World): Promise<void> {
    await Promise.all(w.decor.map(async (d) => {
      const tex = await artTexture(d.art);
      const sp = new Sprite(tex);
      const k = (d.size * TILE) / tex.width;
      sp.anchor.set(0.5, 1);
      sp.scale.set(k);
      const big = d.art.startsWith('mountain');
      const x = xOf(w, d.cell);
      const y = yOf(w, d.cell);
      sp.position.set((x + (big ? MOUNT_W / 2 : 0.5)) * TILE, (y + 1) * TILE - (big ? 0 : 4));
      sp.zIndex = (y + 1) * TILE;
      this.decorSprites.push({ sp, cell: d.cell });
      this.objs.addChild(sp);
    }));
  }

  /** Поставить или обновить спрайты объектов и городов под нынешний мир. */
  async syncObjects(w: World): Promise<void> {
    this.w = w;
    const seen = new Set<number>();
    for (const o of w.objects) {
      seen.add(o.id);
      let root = this.objSprites.get(o.id);
      if (!root) {
        root = await this.makeObject(w, o);
        this.objSprites.set(o.id, root);
        this.objs.addChild(root);
      }
      this.drawFlag(root, o.owner, defOf(o).w);
    }
    for (const [id, sp] of this.objSprites) {
      if (!seen.has(id)) {
        sp.destroy({ children: true });
        this.objSprites.delete(id);
        this.stackSprites = this.stackSprites.filter((s) => !s.sp.destroyed);
      }
    }
    for (const t of w.towns) {
      let root = this.townSprites.get(t.id);
      if (!root) {
        root = new Container();
        const tex = await artTexture(`town-${t.faction}`);
        const sp = new Sprite(tex);
        sp.anchor.set(0.5, 1);
        sp.scale.set((TOWN_SIZE * TILE) / tex.width);
        root.addChild(sp);
        root.position.set((xOf(w, t.cell) + 0.5) * TILE, (yOf(w, t.cell) + 1) * TILE);
        root.zIndex = (yOf(w, t.cell) + 1) * TILE;
        this.townSprites.set(t.id, root);
        this.objs.addChild(root);
      }
      this.drawFlag(root, t.owner, TOWN_W);
    }
  }

  private drawFlag(root: Container, owner: number, wCells: number): void {
    let flag = root.getChildByLabel('flag') as Graphics | null;
    if (owner < 0) {
      flag?.destroy();
      return;
    }
    if (!flag) {
      flag = new Graphics();
      flag.label = 'flag';
      flag.position.set((wCells * TILE) / 2 - 22, -TILE * 0.9);
      root.addChild(flag);
    }
    flag.clear().moveTo(0, 0).lineTo(0, -36).stroke({ color: 0x2a1e12, width: 3 }).poly([0, -36, 26, -29, 0, -21]).fill(PLAYER_COLORS[owner]);
  }

  private async makeObject(w: World, o: MapObject): Promise<Container> {
    const def = defOf(o);
    const root = new Container();
    const x = xOf(w, o.cell);
    const y = yOf(w, o.cell);
    const left = x - (def.w >> 1);
    root.position.set((left + def.w / 2) * TILE, (y + 1) * TILE - 2);
    root.zIndex = (y + 1) * TILE;
    if (isStack(o)) {
      const cre = o.army?.find((s) => s)?.cre;
      if (cre) {
        const art = await loadCreature(cre);
        const sp = new Sprite(art.frames.idle[0]);
        const c = CREATURES[cre];
        const h = 74 + c.tier * 6;
        const k = h / (art.meta.origin[1] - art.meta.top[1]);
        sp.anchor.set(art.meta.origin[0] / art.meta.frame, art.meta.origin[1] / art.meta.frame);
        sp.scale.set(-k, k);
        sp.y = -8;
        root.addChild(sp);
        this.stackSprites.push({ sp, frames: art.frames.idle, t: Math.random() * 3 });
      }
    } else {
      const tex = await artTexture(def.art);
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 1);
      sp.scale.set((def.size * TILE) / tex.width);
      root.addChild(sp);
      if (def.effect.t === 'boat') root.y -= 6;
    }
    return root;
  }

  async syncHeroes(w: World): Promise<void> {
    this.w = w;
    const seen = new Set<number>();
    for (const h of w.heroes) {
      seen.add(h.id);
      let sp = this.heroSprites.get(h.id);
      if (!sp) {
        sp = new HeroSprite(h.id, await loadMount(h.pick.cls), PLAYER_COLORS[h.owner]);
        const boat = await artTexture('obj-boat');
        sp.boat.texture = boat;
        sp.boat.scale.set((1.9 * TILE) / boat.width);
        this.heroSprites.set(h.id, sp);
        this.objs.addChild(sp.root);
      }
      this.placeHero(sp, h);
    }
    for (const [id, sp] of this.heroSprites) {
      if (!seen.has(id)) {
        sp.root.destroy({ children: true });
        this.heroSprites.delete(id);
      }
    }
  }

  private placeHero(sp: HeroSprite, h: AdvHero): void {
    sp.dir = h.dir;
    sp.boat.visible = h.boat;
    sp.body.y = h.boat ? -12 : 0;
    const c = this.cellCenter(h.cell);
    sp.root.position.set(c.x, c.y);
    sp.root.zIndex = yOf(this.w, h.cell) * TILE + TILE + 1;
  }

  cellCenter(c: number): { x: number; y: number } {
    return { x: (xOf(this.w, c) + 0.5) * TILE, y: (yOf(this.w, c) + 0.82) * TILE };
  }

  /** Туман и кто виден текущему игроку. */
  syncFog(w: World, player: number): void {
    this.w = w;
    const ex = w.players[player].explored;
    for (let c = 0; c < w.w * w.h; c++) this.fogData[c * 4] = ex[c] ? 255 : 0;
    this.fogSource.update();
    for (const d of this.decorSprites) d.sp.visible = !!ex[d.cell];
    for (const o of w.objects) {
      const sp = this.objSprites.get(o.id);
      if (sp) sp.visible = !!ex[o.cell];
    }
    for (const t of w.towns) {
      const sp = this.townSprites.get(t.id);
      if (sp) sp.visible = !!ex[t.cell];
    }
    for (const h of w.heroes) {
      const sp = this.heroSprites.get(h.id);
      if (sp) sp.root.visible = !!ex[h.cell] && !heroHiddenFrom(w, h, player);
    }
  }

  /** Лента пути: зелёные — сегодня, жёлтые — позже, крест — куда идём. */
  showPath(path: number[], days: number[], fight: boolean): void {
    const g = this.overlay;
    g.clear();
    path.forEach((c, i) => {
      const x = (xOf(this.w, c) + 0.5) * TILE;
      const y = (yOf(this.w, c) + 0.5) * TILE;
      const color = days[i] === 0 ? 0x7fdc6a : days[i] === 1 ? 0xe8cf58 : 0xd98a4a;
      if (i === path.length - 1) {
        const r = 13;
        const col = fight ? 0xff5d4a : color;
        g.moveTo(x - r, y - r).lineTo(x + r, y + r).moveTo(x + r, y - r).lineTo(x - r, y + r).stroke({ color: 0x1a120a, width: 8 }).moveTo(x - r, y - r).lineTo(x + r, y + r).moveTo(x + r, y - r).lineTo(x - r, y + r).stroke({ color: col, width: 4.5 });
      } else g.circle(x, y, 9).fill({ color: 0x1a120a, alpha: 0.85 }).circle(x, y, 6).fill(color);
    });
  }

  clearPath(): void {
    this.overlay.clear();
  }

  /** Подсветка выбранного героя. */
  selectHero(h: AdvHero | null): void {
    const g = this.cursor;
    g.clear();
    if (!h) return;
    const c = this.cellCenter(h.cell);
    g.ellipse(c.x, c.y, 34, 15).stroke({ color: 0xffe08a, width: 3, alpha: 0.9 });
  }

  /** Вести героя по шагам. */
  async walk(h: AdvHero, cells: { to: number; from: number; dir: number }[], fast: boolean): Promise<void> {
    const sp = this.heroSprites.get(h.id);
    if (!sp) return;
    this.cursor.clear();
    sp.moving = true;
    for (let i = 0; i < cells.length; i++) {
      const s = cells[i];
      sp.dir = s.dir;
      const a = this.cellCenter(s.from);
      const b = this.cellCenter(s.to);
      if (i % 2 === 0) this.audio.sfx(TERRAINS[this.w.terrain[s.to]].step, 0.35);
      if (fast) {
        sp.root.position.set(b.x, b.y);
      } else {
        await this.tween(0.17, (k) => {
          sp.root.position.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
          sp.root.zIndex = sp.root.y + 11;
          this.follow(sp.root.x, sp.root.y);
        });
      }
    }
    sp.moving = false;
    if (!sp.root.destroyed) this.follow(sp.root.x, sp.root.y);
  }

  /** Держать точку в середине части экрана, если она ушла к краю. */
  private follow(x: number, y: number): void {
    const k = this.scale();
    const vw = this.app.screen.width - this.panelW * (this.app.screen.height / STAGE_H);
    const vh = this.app.screen.height;
    const sx = this.world.x + x * k;
    const sy = this.world.y + y * k;
    const mx = vw * 0.28;
    const my = vh * 0.28;
    if (sx < mx) this.world.x += mx - sx;
    else if (sx > vw - mx) this.world.x -= sx - (vw - mx);
    if (sy < my) this.world.y += my - sy;
    else if (sy > vh - my) this.world.y -= sy - (vh - my);
    this.clamp();
  }

  centerOn(c: number): void {
    const p = this.cellCenter(c);
    const k = this.scale();
    const vw = this.app.screen.width - this.panelW * (this.app.screen.height / STAGE_H);
    this.world.x = vw / 2 - p.x * k;
    this.world.y = this.app.screen.height / 2 - p.y * k;
    this.clamp();
  }

  /** Сколько клеток видно: рамка на мини-карте. */
  viewRect(): { x: number; y: number; w: number; h: number } {
    const k = this.scale() * TILE;
    return { x: -this.world.x / k, y: -this.world.y / k, w: (this.app.screen.width - this.panelW * (this.app.screen.height / STAGE_H)) / k, h: this.app.screen.height / k };
  }

  centerAt(cx: number, cy: number): void {
    const k = this.scale() * TILE;
    const vw = this.app.screen.width - this.panelW * (this.app.screen.height / STAGE_H);
    this.world.x = vw / 2 - cx * k;
    this.world.y = this.app.screen.height / 2 - cy * k;
    this.clamp();
  }

  private clamp(): void {
    if (!this.ground) return;
    this.world.scale.set(this.scale());
    const k = this.scale() * TILE;
    const vw = this.app.screen.width - this.panelW * (this.app.screen.height / STAGE_H);
    const vh = this.app.screen.height;
    const W = this.w.w * k;
    const H = this.w.h * k;
    const margin = 2 * k;
    this.world.x = W + margin * 2 <= vw ? (vw - W) / 2 : Math.min(margin, Math.max(vw - W - margin, this.world.x));
    this.world.y = H + margin * 2 <= vh ? (vh - H) / 2 : Math.min(margin, Math.max(vh - H - margin, this.world.y));
    this.onCamera();
  }

  private tween(sec: number, fn: (k: number) => void): Promise<void> {
    return new Promise((res) => {
      let t = 0;
      this.tweens.add((dt) => {
        t += dt;
        const k = Math.min(1, t / sec);
        fn(k);
        if (k >= 1) {
          res();
          return false;
        }
        return true;
      });
    });
  }

  private tick(dt: number): void {
    this.time += dt;
    this.uniforms.uniforms.uTime = this.time;
    for (const t of [...this.tweens]) if (!t(dt)) this.tweens.delete(t);
    for (const sp of this.heroSprites.values()) sp.update(dt);
    for (const s of this.stackSprites) {
      if (s.sp.destroyed) continue;
      s.t += dt;
      s.sp.texture = s.frames[Math.floor(s.t * 6) % s.frames.length];
    }
    if (this.frozen) return;
    const speed = 900 * dt * (this.app.screen.height / STAGE_H);
    let dx = this.edge.x;
    let dy = this.edge.y;
    if (this.keys.has('ArrowLeft')) dx = -1;
    if (this.keys.has('ArrowRight')) dx = 1;
    if (this.keys.has('ArrowUp')) dy = -1;
    if (this.keys.has('ArrowDown')) dy = 1;
    if (dx || dy) {
      this.world.x -= dx * speed;
      this.world.y -= dy * speed;
      this.clamp();
    }
  }

  /** Мини-карта: каждая клетка — точка своего цвета; что не видно — темно. */
  drawMinimap(canvas: HTMLCanvasElement, w: World, player: number): void {
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w.w, w.h);
    const ex = w.players[player].explored;
    const put = (c: number, color: number): void => {
      img.data[c * 4] = (color >> 16) & 255;
      img.data[c * 4 + 1] = (color >> 8) & 255;
      img.data[c * 4 + 2] = color & 255;
      img.data[c * 4 + 3] = 255;
    };
    for (let c = 0; c < w.w * w.h; c++) {
      if (!ex[c]) put(c, 0x0c0a08);
      else if (w.block[c] && w.terrain[c] !== WATER) put(c, 0x2c2a22);
      else put(c, w.road[c] ? 0xb09a68 : TERRAINS[w.terrain[c]].color);
    }
    for (const o of w.objects) {
      if (o.owner >= 0 && ex[o.cell]) put(o.cell, PLAYER_COLORS[o.owner]);
    }
    for (const t of w.towns) {
      if (ex[t.cell]) {
        for (const c of [t.cell, t.cell - 1, t.cell + 1, t.cell - w.w, t.cell - w.w - 1, t.cell - w.w + 1]) put(c, t.owner >= 0 ? PLAYER_COLORS[t.owner] : 0xc9c2a8);
      }
    }
    for (const h of w.heroes) if (ex[h.cell] && !heroHiddenFrom(w, h, player)) put(h.cell, 0xffffff);
    canvas.width = w.w;
    canvas.height = w.h;
    ctx.putImageData(img, 0, 0);
  }

  floatText(cell: number, text: string, color = 0xfff0c0): void {
    const p = this.cellCenter(cell);
    const t = new Text({ text, style: { fontFamily: 'Geroi Num, sans-serif', fontSize: 26, fontWeight: '700', fill: color, stroke: { color: 0x1a120a, width: 5 } } });
    t.anchor.set(0.5);
    t.position.set(p.x, p.y - 70);
    this.fxLayer.addChild(t);
    void this.tween(1.2, (k) => {
      t.y = p.y - 70 - k * 46;
      t.alpha = k < 0.7 ? 1 : (1 - k) / 0.3;
    }).then(() => t.destroy());
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('resize', this.fitCam);
    window.removeEventListener('pointerup', this.endDrag);
    this.canvasEvents.abort();
    if (!this.app) return;
    this.app.ticker.remove(this.onTick);
    releaseApp(this.app);
  }
}
