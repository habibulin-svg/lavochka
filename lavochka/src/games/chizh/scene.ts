/* Чиж — 3D-пустырь за гаражами на общем наборе дворового спорта (core/dvorsport/yard3d.ts): поле из Blender
 * (public/dvorsport/field.glb, без разметки), чиж и бита (studio/blender/dvor_chizh.py → public/dvorsport/chizh.glb),
 * разметка мелом по правилам партии (кон — круг или квадрат-город, черта), пацаны KayKit — у каждого игрока своя бригада.
 * Оси игры: x — вбок, y — от кона в поле, z — вверх → three (x, z, −y). */
import * as THREE from 'three';
import { DvorYard, W } from '../../core/dvorsport/yard3d';
import { PLACES, type Place } from '../../core/dvorsport/places';
import { BRIGADES, ToonLoader, type Toon } from '../../core/dvorsport/toon';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const BASE = `${import.meta.env.BASE_URL}dvorsport/`;

export interface Man {
  toon: Toon | null;
  x: number;
  y: number;
  ring: THREE.Mesh;
}

export class ChizhYard extends DvorYard<'field' | 'tee'> {
  private lines = new THREE.Group();
  readonly chizh = new THREE.Group();
  readonly bat = new THREE.Group();
  private batProto: THREE.Object3D | null = null;
  private aimGroup = new THREE.Group();
  private aimDots: THREE.Mesh[] = [];
  private aimRing: THREE.Mesh;
  private landRing: THREE.Mesh;
  private tape = new THREE.Group();
  private tapeKey = '';
  men: Man[] = [];
  private loader = new ToonLoader();
  private disposed = false;
  private fieldKey = '';
  pending = 0;
  batColor = '#222';
  /** Чиж «в поясе» — подсветка (момент бить). */
  glow = 0;
  private glowMesh: THREE.Mesh;

  constructor(host: HTMLElement, place: Place = PLACES[0]) {
    super(host, { yard: place.yard, backdrop: place.backdrop, look: place.look, props: `${BASE}chizh.glb?v=1`, center: [0, 14], backdropR: 80, shadow: [-30, 30, 40, -30] });
    // пока грузится — болванка-чиж, потом модель из Blender
    const tmp = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.14, 8), new THREE.MeshStandardMaterial({ color: '#c8a070' }));
    this.chizh.add(tmp);
    this.glowMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), new THREE.MeshBasicMaterial({ color: '#7dff5a', transparent: true, opacity: 0, depthWrite: false }));
    this.chizh.add(this.glowMesh);
    this.scene.add(this.chizh, this.bat, this.tape);
    // слои земли field.glb разнесены на сантиметры — ближняя плоскость 0,4 м, чтобы не мерцали
    this.camera.near = 0.4;
    this.camera.far = 230;
    this.camera.updateProjectionMatrix();
    const dotGeo = new THREE.CircleGeometry(0.06, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.85, depthWrite: false });
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      this.aimDots.push(d);
      this.aimGroup.add(d);
    }
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 36), new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.9, depthWrite: false }));
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimGroup.add(this.aimRing);
    this.aimGroup.visible = false;
    this.landRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.72, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false }));
    this.landRing.rotation.x = -Math.PI / 2;
    this.landRing.visible = false;
    this.scene.add(this.aimGroup, this.lines, this.landRing);
    this.shots = {
      tee: () => ({ pos: [1.2, -5.5, 2.6], look: [0, 9, 0.4], fov: 4 }),
      field: () => ({ pos: [3, -9, 9], look: [0, 14, 0], fov: 10 }),
    };
    if (import.meta.env.DEV) (window as unknown as { __cz: ChizhYard }).__cz = this;
  }

  protected override onLoaded() {
    const props = this.props;
    if (!props) return;
    const ch = props.getObjectByName('chizh');
    if (ch) {
      ch.position.set(0, 0, 0);
      ch.rotation.set(0, 0, 0);
      ch.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.chizh.children.filter((c) => c !== this.glowMesh).forEach((c) => this.chizh.remove(c));
      this.chizh.add(ch.clone(true));
    }
    const bt = props.getObjectByName('bita');
    if (bt) {
      bt.position.set(0, 0, 0);
      bt.rotation.set(0, 0, 0);
      bt.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.batProto = bt;
      this.dressBat(this.batColor);
    }
  }

  /** Бита — с изолентой цвета бьющего. */
  dressBat(color: string) {
    this.batColor = color;
    if (!this.batProto) return;
    this.bat.clear();
    const b = this.batProto.clone(true);
    b.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && /tape/.test(m.name)) {
        m.material = (m.material as THREE.MeshStandardMaterial).clone();
        (m.material as THREE.MeshStandardMaterial).color.set(color);
      }
    });
    this.bat.add(b);
  }

  /** Разметка мелом: кон (круг или квадрат-город) и черта. */
  setField(shape: 'circle' | 'square', r: number, line: number) {
    const key = `${shape}|${r}|${line}`;
    if (key === this.fieldKey) return;
    this.fieldKey = key;
    this.lines.clear();
    const chalk = new THREE.MeshStandardMaterial({ color: '#f4f1e6', roughness: 0.9, transparent: true, opacity: 0.88, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false });
    const strip = (x0: number, y0: number, x1: number, y1: number, w = 0.07) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len + w, w), chalk);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      m.position.copy(W((x0 + x1) / 2, (y0 + y1) / 2, 0.03));
      this.lines.add(m);
    };
    if (shape === 'circle') {
      const c = new THREE.Mesh(new THREE.RingGeometry(r - 0.04, r + 0.03, 48), chalk);
      c.rotation.x = -Math.PI / 2;
      c.position.copy(W(0, 0, 0.03));
      this.lines.add(c);
    } else {
      strip(-r, -r, r, -r);
      strip(r, -r, r, r);
      strip(r, r, -r, r);
      strip(-r, r, -r, -r);
      // город расчерчен крест-накрест — как во дворе
      strip(-r, 0, r, 0, 0.04);
      strip(0, -r, 0, r, 0.04);
    }
    strip(-5, line, 5, line, 0.09);
  }

  setPlayers(n: number) {
    while (this.men.length < n) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 32), new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.9, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2;
      ring.visible = false;
      this.scene.add(ring);
      const man: Man = { toon: null, x: 0, y: 8, ring };
      this.men.push(man);
      const k = this.men.length - 1;
      this.pending++;
      void this.loader
        .make(BRIGADES[k % BRIGADES.length], k * 7 + 3)
        .then((toon) => {
          if (this.disposed) return;
          man.toon = toon;
          toon.root.position.copy(W(man.x, man.y));
          this.scene.add(toon.root);
        })
        .catch((e) => console.warn('чиж: пацан не загрузился', e))
        .finally(() => this.pending--);
    }
    for (let k = n; k < this.men.length; k++) this.men[k].toon?.root.removeFromParent();
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

  /** Чиж: где (оси игры, z — высота центра), угол вращения в полёте; лёжа — с приподнятым концом. */
  setChizh(x: number, y: number, z: number, a: number, yaw: number, lying: boolean) {
    this.chizh.position.copy(W(x, y, lying ? 0.016 : z));
    this.chizh.rotation.set(0, 0, 0);
    this.chizh.rotation.y = yaw;
    // модель стоит вдоль вертикали: лёжа — на бок (конец чуть приподнят — так по нему и бьют), в полёте — кувырком
    this.chizh.rotateX(lying ? Math.PI / 2 - 0.16 : a);
    this.chizh.visible = true;
  }

  /** Чиж в руке (несёт / замахнулся бросить). */
  chizhInHand(toon: Toon) {
    const p = toon.handPos();
    this.chizh.position.copy(p);
    this.chizh.rotation.set(0.4, 0, 0.3);
  }

  /** Бита у бьющего (в руке) или спрятана. */
  batIn(toon: Toon | null) {
    if (!toon) {
      this.bat.visible = false;
      return;
    }
    this.bat.visible = true;
    toon.placeBat(this.bat, 0.3, 1, [-0.55, 0.8, 0.25]);
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
    if (land) this.aimRing.position.copy(W(land[0], land[1], 0.045));
  }

  /** Кольцо падения отбитого чижа (водящим — куда бежать). */
  setLand(p: [number, number] | null) {
    this.landRing.visible = !!p;
    if (p) this.landRing.position.copy(W(p[0], p[1], 0.05));
  }

  /** Замер: мелом от кона до чижа, засечка на каждую биту. */
  setTape(to: [number, number] | null, bat = 0.6) {
    const key = to ? `${to[0].toFixed(2)},${to[1].toFixed(2)}` : '';
    if (key === this.tapeKey) return;
    this.tapeKey = key;
    this.tape.clear();
    if (!to) return;
    const d = Math.hypot(to[0], to[1]);
    if (d < 0.3) return;
    const ux = to[0] / d;
    const uy = to[1] / d;
    const mat = new THREE.MeshBasicMaterial({ color: '#fff6c8', transparent: true, opacity: 0.85, depthWrite: false });
    const line = new THREE.Mesh(new THREE.PlaneGeometry(d, 0.05), mat);
    line.rotation.x = -Math.PI / 2;
    line.rotation.z = Math.atan2(uy, ux);
    line.position.copy(W(to[0] / 2, to[1] / 2, 0.05));
    this.tape.add(line);
    const tick = new THREE.PlaneGeometry(0.05, 0.32);
    for (let k = 1; k * bat <= d; k++) {
      const m = new THREE.Mesh(tick, mat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.atan2(uy, ux);
      m.position.copy(W(ux * k * bat, uy * k * bat, 0.05));
      this.tape.add(m);
    }
  }

  override camTo(mode: 'field' | 'tee', _f?: unknown, speed = 2.5) {
    this.shot({ ...this.shots[mode]!(), speed });
  }

  protected override update(dt: number) {
    const tt = performance.now() / 1000;
    for (const m of this.men) {
      m.toon?.update(dt);
      if (m.ring.visible) {
        m.ring.position.copy(W(m.x, m.y, 0.045));
        const s = 1 + Math.sin(tt * 6) * 0.08;
        m.ring.scale.set(s, s, s);
      }
    }
    if (this.landRing.visible) this.landRing.scale.setScalar(1 + Math.sin(tt * 5) * 0.06);
    // чиж 14 см издалека теряется — крупнее с расстояния
    const d = this.chizh.position.distanceTo(this.camera.position);
    this.chizh.scale.setScalar(clamp(d / 3.5, 1.5, 3.6));
    (this.glowMesh.material as THREE.MeshBasicMaterial).opacity = this.glow * 0.45;
  }

  override dispose() {
    this.disposed = true;
    super.dispose();
  }
}
