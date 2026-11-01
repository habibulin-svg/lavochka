/* Отрисовка партии ГОПС на PixiJS v8: фон с параллаксом, ландшафт, кепки, бойцы из атласов бригад,
 * снаряды, эффекты, жидкость, прицел. Состояние берётся из World, эффекты — из событий кадра.
 * Логику не трогает: только читает мир (docs/gops/CODE.md). */
import { AnimatedSprite, Application, Assets, Container, Graphics, Rectangle, Sprite, type Spritesheet, Text, Texture } from 'pixi.js';
import { ANIM_ART, BRIGADES, FX_ART, WORLD_ART, atlasUrl, themeArt } from '../assets';
import { ONE, cosQ, sinQ, toPx } from '../sim/fx';
import { WEAPONS } from '../sim/weapons';
import { type SimEvent, type World, CHARGE_MAX, aimAngle, wormById } from '../sim/world';
import type { Worm } from '../sim/worm';
import { WORM_R } from '../sim/worm';
import { TerrainLayer } from './terrain';

/** Боец в атласе — кадр 192 px, рост ~130 px; в мире ~27 px. */
const WORM_SCALE = 0.21;

interface WormSprite {
  root: Container;
  body: AnimatedSprite;
  label: Text;
  anim: string;
  lastX: number;
}

interface Fx {
  g: Container;
  age: number;
  life: number;
  update(t: number): void;
}

export class GameView {
  readonly app = new Application();
  readonly world = new Container();
  private far = new Container();
  private near = new Container();
  private terrain!: TerrainLayer;
  private caps = new Container();
  private wormLayer = new Container();
  private projLayer = new Graphics();
  /** Картинки снарядов, ящиков, предметов (WORLD_ART); пул спрайтов на кадр. */
  private artLayer = new Container();
  private art: Record<string, Texture> = {};
  /** Ящик на земле — нижняя часть той же картинки, без парашюта/шариков. */
  private artLanded: Record<string, Texture> = {};
  private pool: Sprite[] = [];
  /** Кадры эффектов (FX_ART): взрыв, огонь, дым; нет — рисуем кодом. */
  private fxFrames: Record<string, Texture[]> = {};
  private used = 0;
  private fxLayer = new Container();
  private water = new Graphics();
  private aimG = new Graphics();
  private sheets: Spritesheet[] = [];
  private sprites = new Map<number, WormSprite>();
  private fx: Fx[] = [];
  /** Камера: центр (px мира) и масштаб; цель — куда плавно едем. */
  cam = { x: 0, y: 0, zoom: 1, tx: 0, ty: 0, follow: true };
  /** Зона «царя горы» (px), если миссия такая. */
  zone: [number, number, number] | null = null;
  private t = 0;

  constructor(private readonly host: HTMLElement) {}

  async init(w: World, brigades: string[], theme: string, time?: string): Promise<void> {
    await this.app.init({ resizeTo: this.host, background: themeArt(theme, time).sky, antialias: true, autoDensity: true, resolution: Math.min(2, devicePixelRatio) });
    this.host.appendChild(this.app.canvas);
    const art = themeArt(theme, time);
    const [ground, far, near, ...sheets] = await Promise.all([
      loadImage(art.ground),
      Assets.load<Texture>(art.far).catch(() => null),
      Assets.load<Texture>(art.near).catch(() => null),
      ...brigades.map((b) => Assets.load<Spritesheet>({ src: atlasUrl(b), data: { cachePrefix: `${b}/` } })),
    ]);
    this.sheets = sheets as Spritesheet[];
    await Promise.all(Object.entries({ ...FX_ART, ...ANIM_ART }).map(async ([k, base]) => {
      try {
        const meta = (await fetch(`${base}.json`).then((r) => r.json())) as { frames: number };
        const t = await Assets.load<Texture>(`${base}.png`);
        const fw = t.width / meta.frames;
        this.fxFrames[k] = Array.from({ length: meta.frames }, (_, i) => new Texture({ source: t.source, frame: new Rectangle(i * fw, 0, fw, t.height) }));
      } catch {
        /* нет эффекта — рисуем кодом */
      }
    }));
    // картинки в мире: нет файла — останется рисованная заглушка
    await Promise.all(Object.entries(WORLD_ART).map(async ([k, a]) => {
      const t = await Assets.load<Texture>(a.url).catch(() => null);
      if (!t) return;
      this.art[k] = t;
      if (k.startsWith('crate-')) {
        const f = t.frame;
        this.artLanded[k] = new Texture({ source: t.source, frame: new Rectangle(f.x, f.y + f.height * 0.56, f.width, f.height * 0.44) });
      }
    }));
    if (far) this.far.addChild(cover(far as Texture, w.mask.w, w.mask.h));
    if (near) {
      const s = cover(near as Texture, w.mask.w, w.mask.h);
      s.alpha = 0.9;
      this.near.addChild(s);
    }
    this.terrain = new TerrainLayer(w.mask, ground);
    this.world.addChild(this.near, this.terrain.sprite, this.caps, this.wormLayer, this.projLayer, this.artLayer, this.fxLayer, this.aimG, this.water);
    this.app.stage.addChild(this.far, this.world);
    this.drawWater(w, art.liquid);
    this.waterColor = art.liquid;
    this.cam.x = this.cam.tx = w.mask.w / 2;
    this.cam.y = this.cam.ty = w.mask.h / 2;
    this.cam.zoom = this.fitZoom(w);
  }

  private waterColor = 0x334455;

  /** Масштаб, при котором карта влезает по высоте (и не мельче, чем по ширине). */
  fitZoom(w: World): number {
    const sw = this.app.screen.width, sh = this.app.screen.height;
    return Math.max(sh / w.mask.h, sw / w.mask.w) * 0.98;
  }

  /** События кадра: эффекты и обновление ландшафта. */
  onEvents(w: World, evs: SimEvent[]): void {
    for (const e of evs) {
      if (e.t === 'explode') {
        this.terrain.carve(e.x, e.y, e.r);
        this.boom(e.x, e.y, e.r);
        this.shake = Math.min(14, this.shake + e.r / 5);
      } else if (e.t === 'shot') {
        this.terrain.carve(e.x1, e.y1, 10, false);
        this.tracer(e.x0, e.y0, e.x1, e.y1);
      } else if (e.t === 'carve') {
        this.terrain.carve(e.x, e.y, e.r, false);
      } else if (e.t === 'girder') {
        this.terrain.girder(e.x0, e.y0, e.x1, e.y1, e.r);
      } else if (e.t === 'freeze') {
        this.frost(e.x, e.y, e.r);
      } else if (e.t === 'fire' && (e.weapon === 'kukuruznik' || e.weapon === 'pochta' || e.weapon === 'napalm') && w.target) {
        this.flyby(w.target[0], Math.max(30, w.target[1] - 220));
      } else if (e.t === 'teleport') {
        this.boom(e.x, e.y, 10);
        this.cam.follow = true;
      } else if (e.t === 'splash') {
        this.splash(e.x, w.waterY);
      } else if (e.t === 'rise') {
        this.drawWater(w, this.waterColor);
      } else if (e.t === 'turn') {
        this.cam.follow = true;
      }
    }
  }

  private shake = 0;

  /** Кадр отрисовки. */
  draw(w: World, dt: number): void {
    this.t += dt;
    this.drawWorms(w);
    this.drawProjs(w);
    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
    this.drawAim(w);
    this.drawCaps(w);
    this.stepFx(dt);
    this.water.y = Math.sin(this.t / 600) * 2;
    this.moveCamera(w, dt);
  }

  private moveCamera(w: World, dt: number): void {
    const c = this.cam;
    if (c.follow) {
      // за летящим снарядом, иначе — за активным бойцом
      const p = w.projs.find((q) => q.state === 'fly' || q.state === 'fuse');
      const a = wormById(w, w.active);
      const flying = w.worms.find((x) => x.state === 'air' && x.id !== w.active);
      const target = p ?? (a && a.state !== 'dead' ? a : flying);
      if (target) {
        c.tx = toPx(target.x);
        c.ty = toPx(target.y);
      }
    }
    const k = 1 - Math.pow(0.002, dt / 1000);
    c.x += (c.tx - c.x) * k;
    c.y += (c.ty - c.y) * k;
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const z = c.zoom;
    // не уезжаем за карту (с запасом сверху — небо)
    const halfW = sw / 2 / z, halfH = sh / 2 / z;
    c.x = clamp(c.x, Math.min(halfW, w.mask.w / 2), Math.max(w.mask.w - halfW, w.mask.w / 2));
    c.y = clamp(c.y, Math.min(halfH - 200, w.mask.h / 2), Math.max(w.mask.h - halfH + 40, w.mask.h / 2));
    let sx = 0, sy = 0;
    if (this.shake > 0.3) {
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
      this.shake *= Math.pow(0.02, dt / 1000);
    }
    this.world.scale.set(z);
    this.world.position.set(sw / 2 - c.x * z + sx, sh / 2 - c.y * z + sy);
    // дальний фон — медленнее (параллакс), всегда закрывает экран
    const fz = Math.max(z * 0.8, sh / w.mask.h);
    this.far.scale.set(fz);
    this.far.position.set(sw / 2 - c.x * fz * 0.85 - (w.mask.w * fz * 0.15) / 2, sh / 2 - c.y * fz * 0.9 - (w.mask.h * fz * 0.1) / 2);
  }

  /** Экран → координаты мира (px). */
  toWorld(sx: number, sy: number): [number, number] {
    return [(sx - this.world.position.x) / this.cam.zoom, (sy - this.world.position.y) / this.cam.zoom];
  }

  private sprite(w: World, x: Worm): WormSprite {
    let s = this.sprites.get(x.id);
    if (!s) {
      const sheet = this.sheets[x.team];
      const body = new AnimatedSprite(sheet.animations.idle);
      body.anchor.set(0.5, 179.2 / 192);
      body.scale.set(WORM_SCALE);
      body.animationSpeed = 8 / 60;
      body.play();
      const color = BRIGADES.find((b) => b.id === BRIGADE_IDS[x.team])?.color ?? 0xffffff;
      const label = new Text({ text: '', style: { fontFamily: 'PT Sans', fontSize: 22, fontWeight: '700', fill: color, stroke: { color: 0x000000, width: 4 } } });
      label.anchor.set(0.5, 1);
      label.scale.set(0.5);
      const root = new Container();
      root.addChild(body, label);
      this.wormLayer.addChild(root);
      s = { root, body, label, anim: 'idle', lastX: x.x };
      this.sprites.set(x.id, s);
    }
    return s;
  }

  private drawWorms(w: World): void {
    for (const x of w.worms) {
      const s = this.sprite(w, x);
      if (x.state === 'dead') {
        s.root.visible = false;
        continue;
      }
      const px = x.x / ONE, py = x.y / ONE;
      s.root.position.set(px, py + WORM_R);
      s.body.scale.x = WORM_SCALE * x.facing;
      const active = x.id === w.active && (w.phase === 'turn' || w.phase === 'retreat');
      let anim = 'idle';
      s.root.alpha = w.teams[x.team].hidden ? 0.25 : 1;
      s.body.tint = x.frozen > 0 ? 0x9fd8ff : 0xffffff;
      if (x.state === 'rope') anim = 'rope-hang';
      else if (x.state === 'fly') anim = 'hurt-fly';
      else if (x.state === 'air') anim = x.bounce > 0 ? 'hurt-fly' : x.vy < 0 ? 'jump' : 'fall';
      else if (x.x !== s.lastX) anim = 'walk';
      else if (active && w.phase === 'turn' && WEAPONS[w.weapon]?.kind !== 'skip') anim = WEAPONS[w.weapon]?.kind === 'hitscan' ? 'aim-pistol' : 'aim';
      s.lastX = x.x;
      this.setAnim(s, x.team, anim);
      if (anim.startsWith('aim')) {
        // кадр прицела по наклону: 0 — вверх, середина — горизонт, последний — вниз
        const n = s.body.totalFrames;
        s.body.gotoAndStop(Math.round(((w.aim + 960) / 1920) * (n - 1)));
      }
      s.label.text = `${x.hp}`;
      s.label.position.set(0, -32);
    }
  }

  private setAnim(s: WormSprite, team: number, anim: string): void {
    if (s.anim === anim) return;
    const sheet = this.sheets[team];
    const frames = sheet.animations[anim];
    if (!frames) return;
    s.anim = anim;
    s.body.textures = frames;
    const meta = (sheet.data.meta as unknown as { anims?: Record<string, { fps: number; loop: boolean }> }).anims?.[anim];
    s.body.animationSpeed = (meta?.fps ?? 12) / 60;
    s.body.loop = meta?.loop ?? true;
    if (!anim.startsWith('aim')) s.body.gotoAndPlay(0);
  }

  private drawCaps(w: World): void {
    if (this.caps.children.length === w.caps.length) return;
    for (let i = this.caps.children.length; i < w.caps.length; i++) {
      const c = w.caps[i];
      const tex = this.sheets[c.team].animations.cap?.[0];
      if (!tex) continue;
      const s = new Sprite(tex);
      s.anchor.set(0.5, 179.2 / 192);
      s.scale.set(WORM_SCALE);
      s.position.set(c.x, c.y + WORM_R);
      this.caps.addChild(s);
    }
  }

  /** Спрайт из пула с картинкой key: по центру (x, y), высота по WORLD_ART, поворот, отражение. */
  private put(key: string, x: number, y: number, rot = 0, flip = false, landed = false): boolean {
    const tex = landed ? this.artLanded[key] : this.art[key];
    if (!tex) return false;
    return this.putTex(tex, x, y, WORLD_ART[key].h * (landed ? 0.44 : 1), rot, flip);
  }

  /** Спрайт из пула: текстура tex высотой h по центру (x, y). */
  private putTex(tex: Texture, x: number, y: number, h: number, rot = 0, flip = false): boolean {
    let s = this.pool[this.used];
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      this.pool.push(s);
      this.artLayer.addChild(s);
    }
    this.used++;
    s.visible = true;
    s.texture = tex;
    const k = h / tex.height;
    s.scale.set(flip ? -k : k, k);
    s.rotation = rot;
    s.position.set(x, y);
    return true;
  }

  private drawProjs(w: World): void {
    const g = this.projLayer.clear();
    this.used = 0;
    for (const c of w.crates) {
      const key = c.kind === 'weapon' ? 'crate-weapon' : c.kind === 'health' ? 'crate-health' : 'crate-util';
      // падает — с парашютом (низ картинки — ящик), лежит — только ящик
      const ok = c.falling ? this.put(key, c.x / ONE, c.y / ONE - WORLD_ART[key].h * 0.28, 0) : this.put(key, c.x / ONE, c.y / ONE - 1, 0, false, true);
      if (!ok) this.drawCrate(g, c.x / ONE, c.y / ONE, c.kind, c.falling);
    }
    this.drawObjs(g, w);
    const a = wormById(w, w.active);
    if (a && w.thrust) {
      // огонь из сопла ранца
      const fx = a.x / ONE - a.facing * 6, fy = a.y / ONE + 6;
      g.moveTo(fx - 3, fy).lineTo(fx, fy + 10 + Math.random() * 6).lineTo(fx + 3, fy).fill({ color: 0xffb703, alpha: 0.9 });
      g.circle(fx, fy + 14, 3 + Math.random() * 2).fill({ color: 0xdddddd, alpha: 0.5 });
    }
    for (const p of w.projs) {
      const x = p.x / ONE, y = p.y / ONE;
      const kind = WEAPONS[p.weapon].kind;
      const art = WORLD_ART[p.weapon];
      if (art) {
        const moving = Math.abs(p.vx) + Math.abs(p.vy) > 60;
        let rot = 0;
        if (art.turn && moving) rot = Math.atan2(p.vy, p.vx) + (art.turn === 'up' ? Math.PI / 2 : 0);
        else if (art.turn === 'up' && kind === 'missile') rot = Math.PI / 2;
        else if (kind === 'grenade' || p.weapon === 'holodilnik') rot = p.age * 0.15 * Math.sign(p.vx || 1) * (moving ? 1 : 0);
        // бабка нарисована лицом влево, остальные — вправо
        const flip = kind === 'walker' ? (p.dir < 0) !== (p.weapon === 'babka') : kind === 'flyer' && p.weapon !== 'kite' ? Math.cos((p.ang / 4096) * Math.PI * 2) < 0 : false;
        const bob = kind === 'walker' ? -((p.age >> 2) & 1) : 0;
        // бегуна ставим ногами на землю: низ картинки — по низу тела; есть анимация — кадрами
        const yy = y + bob - (kind === 'walker' ? art.h / 2 - p.r - 1 : 0);
        const anim = this.fxFrames[p.weapon];
        if (anim ? this.putTex(anim[(p.age >> 2) % anim.length], x, yy - bob, art.h, rot, flip) : this.put(p.weapon, x, yy, rot, flip)) {
          if (p.weapon === 'tnt' && (p.fuse >> 3) & 1) g.circle(x, y - 8, 2).fill(0xffd166);
          if (p.weapon === 'mine' && (p.state === 'armed' || (p.state === 'fuse' && (p.fuse >> 2) & 1))) g.circle(x, y - 3, 1.4).fill(0xff2222);
          continue;
        }
      }
      if (kind === 'walker') {
        // заглушки до спрайтов: дворняга, бабка, коза
        const d = p.dir, bob = (p.age >> 2) & 1;
        if (p.weapon === 'babka') {
          g.roundRect(x - 4, y - 9 - bob, 8, 13, 3).fill(0x6a4c93);
          g.circle(x + d * 1, y - 11 - bob, 3).fill(0xf1d3b3);
          g.moveTo(x - 4, y - 13 - bob).arc(x + d * 1, y - 12 - bob, 3.4, Math.PI, 0).fill(0xc1121f);
          g.rect(x + d * 5, y - 4, 4, 5).stroke({ color: 0x2b9348, width: 1 });
        } else {
          const col = p.weapon === 'kozy' ? 0xf1f1e6 : 0x8d6e4a;
          g.ellipse(x, y - 1 - bob, 6, 3.5).fill(col);
          g.circle(x + d * 6, y - 4 - bob, 2.6).fill(col);
          g.moveTo(x - 4, y + 1).lineTo(x - 4, y + 4).moveTo(x + 4, y + 1).lineTo(x + 4, y + 4).stroke({ color: 0x3b2a1a, width: 1 });
          if (p.weapon === 'kozy') g.moveTo(x + d * 6, y - 6).lineTo(x + d * 4, y - 10).stroke({ color: 0x777777, width: 1 });
          else g.rect(x - 1, y - 7, 3, 4).fill(0xd62828);
        }
      } else if (kind === 'flyer') {
        const ang = (p.ang / 4096) * Math.PI * 2;
        if (p.weapon === 'kite') {
          const c = Math.cos(ang), s = Math.sin(ang);
          g.moveTo(x + c * 8, y + s * 8).lineTo(x - s * 6, y + c * 6).lineTo(x - c * 8, y - s * 8).lineTo(x + s * 6, y - c * 6).fill(0xffd166).stroke({ color: 0xd62828, width: 1 });
          g.moveTo(x - c * 8, y - s * 8).quadraticCurveTo(x - c * 14, y - s * 14 + 5, x - c * 20, y - s * 20).stroke({ color: 0xd62828, width: 1 });
          g.rect(x - 2, y + 6, 4, 4).fill(0x222222);
        } else {
          const flap = (p.age >> 2) & 1 ? 4 : -4;
          g.ellipse(x, y, 5, 3).fill(0x8d99ae);
          g.moveTo(x - 2, y).lineTo(x - 5, y + flap).lineTo(x + 2, y).fill(0x5c677d);
          g.circle(x + Math.cos(ang) * 5, y + Math.sin(ang) * 5, 2).fill(0x5c677d);
          g.rect(x - 1, y + 2, 2, 3).fill(0xd62828);
        }
      } else if (kind === 'flame' && this.fxFrames.fire && this.putTex(this.fxFrames.fire[(p.age >> 2) % this.fxFrames.fire.length], x, y - 5, p.state === 'fuse' ? 14 : 9)) {
        // огонь — кадрами ролика
      } else if (kind === 'flame') {
        const r = p.state === 'fuse' ? 2.5 + Math.random() * 2 : 2;
        g.circle(x, y - r / 2, r).fill({ color: Math.random() < 0.5 ? 0xf77f00 : 0xffb703, alpha: 0.9 });
      } else if (p.weapon === 'auger') {
        const a2 = Math.atan2(p.vy, p.vx);
        const c = Math.cos(a2), s = Math.sin(a2);
        g.moveTo(x + c * 7, y + s * 7).lineTo(x - s * 3, y + c * 3).lineTo(x + s * 3, y - c * 3).fill(0x9aa5b1);
      } else if (p.weapon === 'holodilnik') {
        g.roundRect(x - 3, y - 4, 6, 8, 1).fill(0xe8f1f2).stroke({ color: 0x5fa8d3, width: 1 });
      } else if (p.weapon === 'kite-bomb') {
        g.circle(x, y, 3.5).fill(0x222222);
      } else if (p.weapon === 'brick') {
        g.rect(x - 4, y - 2.5, 8, 5).fill(0xa4442b).stroke({ color: 0x5a2416, width: 0.8 });
      } else if (p.weapon === 'vanna-drop') {
        g.roundRect(x - 9, y - 5, 18, 10, 4).fill(0xf4f1ea).stroke({ color: 0x777777, width: 1 });
      } else if (p.weapon === 'shard' || p.weapon === 'petarda') {
        g.circle(x, y, p.weapon === 'petarda' ? 2.6 : 1.8).fill(p.weapon === 'petarda' ? 0xd62828 : 0x555555);
      } else if (p.weapon === 'posylka') {
        g.rect(x - 4, y - 4, 8, 8).fill(0xc8a26b).stroke({ color: 0x6b4f2a, width: 0.8 });
      } else if (kind === 'missile') {
        const a = Math.atan2(p.vy, p.vx);
        const dx = Math.cos(a) * 7, dy = Math.sin(a) * 7;
        g.moveTo(x - dx, y - dy).lineTo(x + dx, y + dy).stroke({ color: 0x4b5320, width: 4, cap: 'round' });
        g.circle(x - dx * 1.3, y - dy * 1.3, 2.5).fill({ color: 0xffb703, alpha: 0.9 });
      } else if (kind === 'grenade') {
        const col = p.weapon === 'samogon' ? 0xdfe7e1 : p.weapon === 'carbide' ? 0xb0b6bb : p.weapon === 'korsar' ? 0xd62828 : 0x3a5a40;
        g.circle(x, y, p.r + 0.5).fill(col).stroke({ color: 0x111111, width: 1 });
      } else if (kind === 'placed') {
        g.rect(x - 2.5, y - 6, 5, 10).fill(0xc1121f);
        if ((p.fuse >> 3) & 1) g.circle(x, y - 7, 2).fill(0xffd166);
      } else if (kind === 'mine') {
        g.circle(x, y, 3.5).fill(0x222222);
        if (p.state === 'armed' || (p.state === 'fuse' && (p.fuse >> 2) & 1)) g.circle(x, y - 2, 1.4).fill(0xff2222);
      } else {
        g.circle(x, y, 2).fill(0x9a8c7a);
      }
    }
  }

  /** Предметы миссии и зона (заглушки до спрайтов): флажки, мишени, бочки, подопечный, свои в беде. */
  private drawObjs(g: Graphics, w: World): void {
    if (this.zone) {
      const [cx, cy, r] = this.zone;
      g.circle(cx, cy, r).fill({ color: 0xffd166, alpha: 0.08 }).stroke({ color: 0xffd166, width: 2, alpha: 0.6 });
    }
    const flags = w.objs.filter((o) => o.kind === 'flag' && o.alive);
    for (const o of w.objs) {
      const { x, y } = o;
      if (o.kind === 'flag') {
        if (!o.alive) continue;
        const next = o === flags[0];
        g.moveTo(x, y + 8).lineTo(x, y - 18).stroke({ color: 0xdddddd, width: 1.5 });
        if (o.look === 'finish') {
          for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) g.rect(x + i * 3, y - 18 + j * 3, 3, 3).fill((i + j) & 1 ? 0x111111 : 0xffffff);
        } else g.moveTo(x, y - 18).lineTo(x + 12, y - 14).lineTo(x, y - 10).fill(next ? 0xe63946 : 0x8d99ae);
        if (next) g.circle(x, y, 14).stroke({ color: 0xffd166, width: 1.5, alpha: 0.5 + 0.4 * Math.sin(this.t / 200) });
        continue;
      }
      if (!o.alive) continue;
      if (o.kind === 'barrel' && this.put('barrel', x, y)) continue;
      if (o.kind === 'target' && o.look === 'plate' && this.put('plate', x, y + 4)) continue;
      if (o.kind === 'target' && (o.look === 'barrel' || o.look === 'gas') && this.put(o.look, x, y)) continue;
      if (o.kind === 'target') {
        if (o.look === 'can' || o.look === 'keg') {
          g.roundRect(x - 4, y - 6, 8, 12, 1.5).fill(o.look === 'can' ? 0xb0b6bb : 0x8d6e4a).stroke({ color: 0x333333, width: 0.8 });
        } else if (o.look === 'plate') {
          g.moveTo(x, y + 6).lineTo(x, y + 14).stroke({ color: 0x555555, width: 1.5 });
          g.circle(x, y, 6).fill(0xffffff).circle(x, y, 4).fill(0xe63946).circle(x, y, 2).fill(0xffffff);
        } else {
          // разнести: котёл, трансформатор, холодильник… — коробка своего цвета
          const col: Record<string, number> = { barrel: 0xc1121f, boiler: 0x6c757d, transformer: 0x52796f, fridge: 0xe9ecef, gas: 0xd62828 };
          g.roundRect(x - 9, y - 10, 18, 20, 3).fill(col[o.look] ?? 0x9a8c7a).stroke({ color: 0x222222, width: 1 });
        }
      } else if (o.kind === 'barrel') {
        g.roundRect(x - 6, y - 8, 12, 16, 2).fill(0xc1121f).stroke({ color: 0x5a0a0a, width: 1 });
        g.rect(x - 6, y - 3, 12, 1.5).rect(x - 6, y + 2, 12, 1.5).fill(0x7a0c0c);
      } else if (o.kind === 'ward') {
        const lookCol: Record<string, number> = { babka: 0x6a4c93, beehive: 0xe9c46a, locomotive: 0x2a9d8f };
        if (o.look === 'locomotive') g.roundRect(x - 22, y - 12, 44, 24, 4).fill(lookCol.locomotive).stroke({ color: 0x111111, width: 1.2 });
        else if (o.look === 'beehive') g.roundRect(x - 10, y - 14, 20, 28, 6).fill(lookCol.beehive).stroke({ color: 0x6b4f2a, width: 1 });
        else {
          g.roundRect(x - 6, y - 10, 12, 22, 4).fill(lookCol.babka);
          g.circle(x, y - 13, 5).fill(0xf1d3b3);
          g.moveTo(x - 6, y - 15).arc(x, y - 14, 6, Math.PI, 0).fill(0xc1121f);
        }
        const k = Math.max(0, o.hp) / (o.look === 'locomotive' ? 200 : o.look === 'beehive' ? 150 : 120);
        g.rect(x - 14, y - 26, 28, 4).fill(0x000000).rect(x - 14, y - 26, 28 * Math.min(1, k), 4).fill(0x52b788);
      } else if (o.kind === 'hostage') {
        g.circle(x, y, 9).fill(0xcfd8dc).stroke({ color: 0x333333, width: 1 });
        g.moveTo(x, y - 26).lineTo(x, y - 17).stroke({ color: 0xffd166, width: 3 });
        g.circle(x, y - 13, 1.6).fill(0xffd166);
      }
    }
  }

  /** Ящик (заглушка до спрайтов из 23-common): оружие — на полосатом зонте, аптечка — на шариках, утилиты — на простыне. */
  private drawCrate(g: Graphics, x: number, y: number, kind: string, falling: boolean): void {
    const top = y - 26;
    if (falling) {
      if (kind === 'weapon') {
        for (let i = 0; i < 6; i++) {
          const a0 = Math.PI + (i / 6) * Math.PI, a1 = Math.PI + ((i + 1) / 6) * Math.PI;
          g.moveTo(x, top).arc(x, top, 15, a0, a1).lineTo(x, top).fill(i % 2 ? 0xffffff : 0xd62828);
        }
        g.moveTo(x - 15, top).lineTo(x - 5, y - 6).moveTo(x + 15, top).lineTo(x + 5, y - 6).stroke({ color: 0x333333, width: 0.8 });
      } else if (kind === 'health') {
        for (const [dx, col] of [[-6, 0xe63946], [0, 0x2ec4b6], [6, 0xffd166]] as const) {
          g.moveTo(x + dx, top + 6).lineTo(x, y - 6).stroke({ color: 0x555555, width: 0.7 });
          g.ellipse(x + dx, top - 2 + Math.abs(dx) / 3, 4.5, 5.5).fill(col);
        }
      } else {
        g.moveTo(x - 14, top + 4).quadraticCurveTo(x, top - 10, x + 14, top + 4).lineTo(x + 10, top + 8).lineTo(x - 10, top + 8).fill(0xf1f1e6);
        g.moveTo(x - 10, top + 8).lineTo(x - 5, y - 6).moveTo(x + 10, top + 8).lineTo(x + 5, y - 6).stroke({ color: 0x555555, width: 0.7 });
      }
    }
    const col = kind === 'weapon' ? 0x8d6e4a : kind === 'health' ? 0xf1f1f1 : 0x4f6b8a;
    g.roundRect(x - 7, y - 6, 14, 13, 1.5).fill(col).stroke({ color: 0x2b2118, width: 1 });
    if (kind === 'health') g.rect(x - 1.5, y - 4, 3, 9).rect(x - 4.5, y - 1, 9, 3).fill(0xd62828);
    else g.moveTo(x - 7, y - 6).lineTo(x + 7, y + 7).moveTo(x + 7, y - 6).lineTo(x - 7, y + 7).stroke({ color: 0x2b2118, width: 0.8, alpha: 0.6 });
  }

  private drawAim(w: World): void {
    const g = this.aimG.clear();
    const a = wormById(w, w.active);
    if (a && w.rope && a.state === 'rope') {
      const hx = a.x / ONE, hy = a.y / ONE - 6;
      g.moveTo(hx, hy).lineTo(w.rope.ax / ONE, w.rope.ay / ONE).stroke({ color: 0xd8c3a5, width: 1.6 });
      g.circle(w.rope.ax / ONE, w.rope.ay / ONE, 2.2).fill(0x777777);
    }
    const canAim = a && (a.state === 'stand' || (a.state !== 'dead' && WEAPONS[w.weapon]?.kind === 'rope'));
    if (!a || w.phase !== 'turn' || !canAim) return;
    const def = WEAPONS[w.weapon];
    if (!def) return;
    if (def.target && w.target) {
      // выбранная точка: крестик; у плиты — сама плита-призрак по прицелу
      const [tx, ty] = w.target;
      if (def.kind === 'girder') {
        const ang = aimAngle(w, a), r = def.range!;
        const ux = (cosQ(ang) / 16384) * r, uy = (sinQ(ang) / 16384) * r;
        g.moveTo(tx - ux, ty - uy).lineTo(tx + ux, ty + uy).stroke({ color: 0xb9b6ad, width: 9, alpha: 0.45, cap: 'round' });
      }
      g.moveTo(tx - 7, ty - 7).lineTo(tx + 7, ty + 7).moveTo(tx + 7, ty - 7).lineTo(tx - 7, ty + 7).stroke({ color: 0xff3b30, width: 2 });
      g.circle(tx, ty, 10).stroke({ color: 0xff3b30, width: 1, alpha: 0.6 });
    }
    if (w.laser && (def.kind === 'hitscan' || def.kind === 'missile' || def.kind === 'stone')) {
      const ang = aimAngle(w, a);
      g.moveTo(a.x / ONE, a.y / ONE).lineTo(a.x / ONE + (cosQ(ang) / 16384) * 600, a.y / ONE + (sinQ(ang) / 16384) * 600).stroke({ color: 0xff2020, width: 1, alpha: 0.55 });
    }
    const noAim = ['skip', 'surrender', 'placed', 'mine', 'strike', 'teleport', 'buff', 'select', 'justice', 'flood', 'walker'];
    if (w.ctrl) return;
    if (noAim.includes(def.kind) || (def.kind === 'dig' && def.down)) return;
    if (def.kind === 'rope' && a.state === 'rope') return;
    const ang = aimAngle(w, a);
    const cx = a.x / ONE, cy = a.y / ONE;
    const ux = cosQ(ang) / 16384, uy = sinQ(ang) / 16384;
    const d = 46;
    g.circle(cx + ux * d, cy + uy * d, 4).stroke({ color: 0xff3b30, width: 1.5 });
    g.moveTo(cx + ux * (d - 7), cy + uy * (d - 7)).lineTo(cx + ux * (d + 7), cy + uy * (d + 7)).stroke({ color: 0xff3b30, width: 1 });
    if (def.charged && w.charge > 0) {
      const k = w.charge / CHARGE_MAX;
      for (let i = 0; i < 10; i++) {
        if (i / 10 > k) break;
        const r = 2 + i * 0.6;
        const dd = 12 + i * 5;
        g.circle(cx + ux * dd, cy + uy * dd, r).fill({ color: i < 4 ? 0xffd166 : i < 7 ? 0xf77f00 : 0xd62828, alpha: 0.85 });
      }
    }
  }

  private drawWater(w: World, color: number): void {
    const g = this.water;
    const y = w.waterY;
    g.clear();
    g.rect(-2000, y + 4, w.mask.w + 4000, 2000).fill({ color, alpha: 0.92 });
    for (let x = -2000; x < w.mask.w + 2000; x += 24) {
      g.moveTo(x, y + 4).quadraticCurveTo(x + 6, y - 1, x + 12, y + 4).quadraticCurveTo(x + 18, y + 8, x + 24, y + 4);
    }
    g.stroke({ color: lighten(color, 1.6), width: 2, alpha: 0.9 });
  }

  // --- эффекты (процедурные заглушки до спрайт-листов из 25-videos)
  /** Заморозка: голубой круг инея (заглушка до спрайта). */
  private frost(x: number, y: number, r: number): void {
    const g = new Graphics();
    g.circle(x, y, r).fill({ color: 0xbde0fe, alpha: 0.35 }).stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
    this.fxLayer.addChild(g);
    let t = 0;
    const tick = () => {
      t += 1 / 60;
      g.alpha = Math.max(0, 1 - t);
      if (t < 1) requestAnimationFrame(tick);
      else g.destroy();
    };
    requestAnimationFrame(tick);
  }

  /** Проиграть полосу кадров один раз: размер — по ширине, в конце гаснет; dy — снос вверх за жизнь (дым). */
  private playFx(key: string, x: number, y: number, width: number, life: number, dy = 0): boolean {
    const frames = this.fxFrames[key];
    if (!frames || this.fxLayer.destroyed) return false;
    const s = new Sprite(frames[0]);
    s.anchor.set(0.5, 0.6);
    s.scale.set(width / frames[0].width);
    s.position.set(x, y);
    this.fxLayer.addChild(s);
    this.fx.push({
      g: s, age: 0, life,
      update(t) {
        const k = t / life;
        s.texture = frames[Math.min(frames.length - 1, Math.floor(k * frames.length))];
        s.alpha = k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35);
        s.y = y - dy * k;
      },
    });
    return true;
  }

  /** Кукурузник пролетает над точкой слева направо (1,6 с). */
  private flyby(x: number, y: number): void {
    const frames = this.fxFrames.plane;
    if (!frames || this.fxLayer.destroyed) return;
    const s = new Sprite(frames[0]);
    s.anchor.set(0.5);
    s.scale.set(70 / frames[0].width);
    this.fxLayer.addChild(s);
    const life = 1600;
    this.fx.push({
      g: s, age: 0, life,
      update(t) {
        const k = t / life;
        s.texture = frames[Math.floor(t / 60) % frames.length];
        s.position.set(x - 420 + 840 * k, y - Math.sin(k * Math.PI) * 12);
      },
    });
  }

  private boom(x: number, y: number, r: number): void {
    if (this.playFx('boom', x, y, r * 2.8, 700)) {
      // дым — после вспышки
      if (r >= 40) window.setTimeout(() => this.playFx('smoke', x, y - r * 0.3, r * 1.6, 1600, r * 0.8), 250);
      return;
    }
    const g = new Graphics();
    this.fxLayer.addChild(g);
    this.fx.push({
      g, age: 0, life: 650,
      update(t) {
        const k = t / 650;
        g.clear();
        g.circle(x, y, r * (0.5 + k * 0.9)).fill({ color: 0xfff1c1, alpha: Math.max(0, 0.9 - k * 2.2) });
        g.circle(x, y, r * (0.4 + k)).stroke({ color: 0xff8c1a, width: 6 * (1 - k), alpha: 1 - k });
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2 + r;
          g.circle(x + Math.cos(a) * r * k * 1.1, y + Math.sin(a) * r * k * 0.9 - k * 20, r * 0.25 * (0.6 + k)).fill({ color: 0x555555, alpha: 0.5 * (1 - k) });
        }
      },
    });
  }

  private tracer(x0: number, y0: number, x1: number, y1: number): void {
    const g = new Graphics();
    this.fxLayer.addChild(g);
    this.fx.push({
      g, age: 0, life: 160,
      update(t) {
        g.clear().moveTo(x0, y0).lineTo(x1, y1).stroke({ color: 0xffe08a, width: 1.5, alpha: 1 - t / 160 });
        g.circle(x1, y1, 4 * (1 - t / 160)).fill({ color: 0xffffff, alpha: 1 - t / 160 });
      },
    });
  }

  private splash(x: number, wy: number): void {
    const g = new Graphics();
    const c = lighten(this.waterColor, 1.8);
    this.fxLayer.addChild(g);
    this.fx.push({
      g, age: 0, life: 700,
      update(t) {
        const k = t / 700;
        g.clear();
        for (let i = -3; i <= 3; i++) g.circle(x + i * 5 * (1 + k * 2), wy - Math.sin(k * Math.PI) * (30 - Math.abs(i) * 6), 3).fill({ color: c, alpha: 1 - k });
      },
    });
  }

  private stepFx(dt: number): void {
    for (const f of this.fx.slice()) {
      f.age += dt;
      if (f.age >= f.life) {
        f.g.destroy();
        this.fx.splice(this.fx.indexOf(f), 1);
      } else f.update(f.age);
    }
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
  }
}

/** Бригады партии по индексу команды (заполняет игра перед init). */
export const BRIGADE_IDS: string[] = [];

function cover(tex: Texture, w: number, h: number): Sprite {
  const s = new Sprite(tex);
  const k = Math.max(w / tex.width, h / tex.height);
  s.scale.set(k);
  return s;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function lighten(c: number, k: number): number {
  const r = Math.min(255, ((c >> 16) & 255) * k), g = Math.min(255, ((c >> 8) & 255) * k), b = Math.min(255, (c & 255) * k);
  return (r << 16) | (g << 8) | b;
}

