/* Пекарь — 3D-пустырь за гаражами на общем наборе дворового спорта (core/dvorsport/yard3d.ts): поле лапты из Blender
 * (public/dvorsport/field.glb, без разметки), банка и биты-палки (studio/blender/dvor_pekar.py → public/dvorsport/pekar.glb),
 * разметка мелом по правилам партии (черта, кон-кружок банки, черты званий), пацаны KayKit — у каждого игрока своя бригада,
 * палки с изолентой его цвета. Оси игры: x — вбок, y — от черты (0) к банке, z — вверх → three (x, z, −y). */
import * as THREE from 'three';
import { DvorYard, W } from '../../core/dvorsport/yard3d';
import { BRIGADES, ToonLoader, type Toon } from '../../core/dvorsport/toon';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type CamMode = 'throw' | 'field' | 'can' | 'follow';

const BASE = `${import.meta.env.BASE_URL}dvorsport/`;

export interface Man {
  toon: Toon | null;
  x: number;
  y: number;
  /** Кольцо под ногами (выбор). */
  ring: THREE.Mesh;
}

export interface FieldLines {
  /** Банка (кон) от черты, м. */
  dist: number;
  /** Черты званий: от черты рядового к банке, м (пусто — одна черта). */
  ranks: number[];
}

export class PekarYard extends DvorYard<CamMode> {
  private lines = new THREE.Group();
  readonly can = new THREE.Group();
  /** Палки игроков: sticks[игрок]. */
  sticks: THREE.Group[] = [];
  private stickProto: THREE.Object3D | null = null;
  private aimGroup = new THREE.Group();
  private aimDots: THREE.Mesh[] = [];
  private aimRing: THREE.Mesh;
  men: Man[] = [];
  private loader = new ToonLoader();
  private disposed = false;
  private fieldKey = '';
  private dist = 12;
  pending = 0;
  colors: string[] = [];

  constructor(host: HTMLElement) {
    super(host, { yard: `${BASE}field.glb?v=1`, props: `${BASE}pekar.glb?v=1`, center: [0, 8], backdropR: 70, shadow: [-24, 24, 30, -26] });
    // пока грузится — простая банка-болванка, потом её сменит модель из Blender
    const tmp = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 20), new THREE.MeshStandardMaterial({ color: '#b8b8b0', metalness: 0.8, roughness: 0.35 }));
    tmp.position.y = 0.06;
    this.can.add(tmp);
    this.scene.add(this.can);
    const dotGeo = new THREE.CircleGeometry(0.045, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.85, depthWrite: false });
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      this.aimDots.push(d);
      this.aimGroup.add(d);
    }
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 36), new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.9, depthWrite: false }));
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimGroup.add(this.aimRing);
    this.aimGroup.visible = false;
    this.scene.add(this.aimGroup, this.lines);
    this.shots = {
      // из-за спины бросающего на черте: банка далеко впереди
      throw: (f?: { x: number; y: number }) => {
        const x = f?.x ?? 0;
        const y = f?.y ?? 0;
        return { pos: [x + 0.7, y - 5.2, 3.0], look: [x * 0.4, y + (this.dist - y) * 0.7, 0.2], fov: 2 };
      },
      field: () => ({ pos: [1.5, -7.5, 6 + this.dist * 0.3], look: [0, this.dist * 0.5, 0], fov: 8 }),
      can: () => ({ pos: [2.5, this.dist - 5, 3.2], look: [0, this.dist + 0.5, 0.2], fov: 2 }),
      follow: (f: { x: number; y: number }) => ({ pos: [f.x * 0.5 + 5, f.y - 9, 7.5], look: [f.x * 0.8, f.y + 0.5, 0.4], fov: 4 }),
    };
    if (import.meta.env.DEV) (window as unknown as { __pk: PekarYard }).__pk = this;
  }

  protected override onLoaded() {
    const props = this.props;
    if (!props) return;
    const can = props.getObjectByName('can');
    if (can) {
      can.position.set(0, 0, 0);
      can.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.can.clear();
      this.can.add(can.clone());
    }
    const st = props.getObjectByName('palka');
    if (st) {
      st.position.set(0, 0, 0);
      st.rotation.set(0, 0, 0);
      st.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.stickProto = st;
      this.sticks.forEach((g, i) => this.dressStick(g, i));
    }
  }

  private dressStick(g: THREE.Group, i: number) {
    if (!this.stickProto) return;
    g.clear();
    const s = this.stickProto.clone(true);
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /tape/.test(m.name)) {
        m.material = (m.material as THREE.MeshStandardMaterial).clone();
        (m.material as THREE.MeshStandardMaterial).color.set(this.colors[i] ?? '#222');
      }
    });
    g.add(s);
  }

  /** Разметка мелом: черта рядового, кружок банки, черты званий (ближе к банке — выше звание). */
  setField(f: FieldLines) {
    const key = `${f.dist}|${f.ranks.join(',')}`;
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    this.dist = f.dist;
    this.lines.clear();
    const chalk = new THREE.MeshStandardMaterial({ color: '#f4f1e6', roughness: 0.9, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false });
    const strip = (x0: number, y0: number, x1: number, y1: number, w = 0.08) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len + w, w), chalk);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      m.position.copy(W((x0 + x1) / 2, (y0 + y1) / 2, 0.006));
      m.receiveShadow = true;
      this.lines.add(m);
    };
    strip(-5, 0, 5, 0, 0.1);
    // черты званий — короче и ближе к банке (кто выше званием, бросает с дальней)
    for (const d of f.ranks) if (d > 0.3) strip(-1.6, d, 1.6, d, 0.06);
    const circ = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.48, 40), chalk);
    circ.rotation.x = -Math.PI / 2;
    circ.position.copy(W(0, f.dist, 0.006));
    this.lines.add(circ);
  }

  /** Игроки (по одному пацану на игрока, бригада — по месту) и их палки. */
  setPlayers(n: number, colors: string[]) {
    this.colors = colors;
    while (this.men.length < n) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 32), new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.9, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.scene.add(ring);
      const man: Man = { toon: null, x: 0, y: -3, ring };
      this.men.push(man);
      const k = this.men.length - 1;
      const g = new THREE.Group();
      this.sticks.push(g);
      this.scene.add(g);
      this.dressStick(g, k);
      this.pending++;
      void this.loader
        .make(BRIGADES[k % BRIGADES.length], k * 5 + 1)
        .then((toon) => {
          if (this.disposed) return;
          man.toon = toon;
          toon.root.position.copy(W(man.x, man.y));
          this.scene.add(toon.root);
        })
        .catch((e) => console.warn('пекарь: пацан не загрузился', e))
        .finally(() => this.pending--);
    }
    for (let k = n; k < this.men.length; k++) {
      this.men[k].toon?.root.removeFromParent();
      this.sticks[k].visible = false;
    }
  }

  put(k: number, x: number, y: number, face?: [number, number]) {
    const m = this.men[k];
    if (!m) return;
    m.x = x;
    m.y = y;
    const tn = m.toon;
    if (!tn) return;
    tn.root.position.copy(W(x, y));
    if (face) {
      const f = W(face[0], face[1]);
      tn.face(f.x, f.z);
    }
  }

  mark(k: number, color: string | null) {
    const m = this.men[k];
    if (!m) return;
    m.ring.visible = !!color;
    if (color) (m.ring.material as THREE.MeshBasicMaterial).color.set(color);
  }

  clearMarks() {
    for (const m of this.men) m.ring.visible = false;
  }

  /** Банка: стоит (лёжа = false) или лежит на боку, повёрнута на ang. */
  setCan(x: number, y: number, lying = false, ang = 0, z = 0) {
    this.can.position.copy(W(x, y, lying ? 0.05 + z : z));
    this.can.rotation.set(0, 0, 0);
    if (lying) {
      this.can.rotation.y = ang;
      this.can.rotateX(Math.PI / 2);
    }
  }

  /** Банка в руке пекаря (несёт к кону). */
  canInHand(toon: Toon) {
    const p = toon.handPos();
    this.can.position.copy(p).add(new THREE.Vector3(0, -0.06, 0));
    this.can.rotation.set(0, 0, 0);
  }

  /** Палка лежит на земле (оси игры), повёрнута на ang (рад вокруг вертикали). */
  stickAt(k: number, x: number, y: number, z = 0.025, ang = 0, tilt = Math.PI / 2) {
    const g = this.sticks[k];
    if (!g) return;
    g.visible = true;
    g.position.copy(W(x, y, z));
    g.rotation.set(0, 0, 0);
    g.rotation.y = ang;
    g.rotateX(tilt);
  }

  /** Палка в руке (на плече у ждущего, в кулаке у бросающего). */
  stickIn(k: number, toon: Toon | null, rot = 1) {
    const g = this.sticks[k];
    if (!g || !toon) return;
    g.visible = true;
    toon.placeBat(g, 0.375, rot, [-0.55, 0.8, 0.25]);
  }

  hideStick(k: number) {
    const g = this.sticks[k];
    if (g) g.visible = false;
  }

  setAim(pts: [number, number, number][] | null, land: [number, number] | null) {
    this.aimGroup.visible = !!pts;
    if (!pts) return;
    const n = this.aimDots.length;
    this.aimDots.forEach((d, i) => {
      const p = pts[Math.min(pts.length - 1, Math.floor(((i + 1) * pts.length) / (n + 1)))];
      d.visible = !!p;
      if (p) {
        d.position.copy(W(p[0], p[1], p[2] + 0.02));
        d.lookAt(this.camera.position);
      }
    });
    this.aimRing.visible = !!land;
    if (land) this.aimRing.position.copy(W(land[0], land[1], 0.02));
  }

  override camTo(mode: CamMode, focus?: { x: number; y: number }, speed = 2.5) {
    if (mode === 'follow' && !focus) mode = 'field';
    this.shot({ ...this.shots[mode]!(focus as never), speed });
  }

  protected override update(dt: number) {
    const tt = performance.now() / 1000;
    for (const m of this.men) {
      m.toon?.update(dt);
      if (m.ring.visible) {
        m.ring.position.copy(W(m.x, m.y, 0.03));
        const s = 1 + Math.sin(tt * 6) * 0.08;
        m.ring.scale.set(s, s, s);
      }
    }
    // банка 12 см издалека теряется — чуть крупнее с расстояния
    const d = this.can.position.distanceTo(this.camera.position);
    this.can.scale.setScalar(clamp(d / 7, 1, 3));
  }

  override dispose() {
    this.disposed = true;
    super.dispose();
  }
}
