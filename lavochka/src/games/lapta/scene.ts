/* Лапта — 3D-пустырь за гаражами на общем наборе дворового спорта (core/dvorsport/yard3d.ts): поле из Blender
 * (studio/blender/dvor_field.py → public/dvorsport/field.glb, без разметки), мяч и бита-лапта (lapta.glb), разметка мелом
 * по правилам партии (дом, кон, контрольная, боковые), две команды пацанов KayKit (core/dvorsport/toon.ts), прицел удара,
 * кольца выбора под ногами. Оси игры: x — поперёк, y — от дома к кону, z — вверх → three (x, z, −y). */
import * as THREE from 'three';
import { DvorYard, W } from '../../core/dvorsport/yard3d';
import { ToonLoader, type Toon } from '../../core/dvorsport/toon';
import { yKon, type Cfg } from './engine';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export type CamMode = 'bat' | 'field' | 'follow' | 'kon';

const BASE = `${import.meta.env.BASE_URL}dvorsport/`;
/** Бригады команд: Затулинка и Затон (олимпийки ГОПС). */
export const TEAM_BRIGADE = ['zatulinka', 'zaton'];

export interface Man {
  toon: Toon | null;
  /** Где стоит/бежит (оси игры) и куда смотрит. */
  x: number;
  y: number;
  /** Кольцо под ногами (выбор). */
  ring: THREE.Mesh;
}

export class LaptaYard extends DvorYard<CamMode> {
  private lines = new THREE.Group();
  readonly ball: THREE.Object3D;
  readonly bat = new THREE.Group();
  private aimGroup = new THREE.Group();
  private aimDots: THREE.Mesh[] = [];
  private aimRing: THREE.Mesh;
  private landRing: THREE.Mesh;
  /** Команды: men[команда][игрок]. */
  men: Man[][] = [[], []];
  private loader = new ToonLoader();
  private disposed = false;
  private cfg: Cfg | null = null;
  /** Сколько пацанов ещё грузится. */
  pending = 0;

  constructor(host: HTMLElement) {
    super(host, { yard: `${BASE}field.glb?v=1`, props: `${BASE}lapta.glb?v=1`, center: [0, 25], backdropR: 88, shadow: [-46, 46, 52, -52] });
    const ball = new THREE.Group();
    ball.add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), new THREE.MeshStandardMaterial({ color: '#d8301e', roughness: 0.55 })));
    ball.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    this.ball = ball;
    this.scene.add(ball, this.bat);
    const dotGeo = new THREE.CircleGeometry(0.06, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.85, depthWrite: false });
    for (let i = 0; i < 30; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      this.aimDots.push(d);
      this.aimGroup.add(d);
    }
    this.aimRing = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.75, 40), new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.9, depthWrite: false }));
    this.aimRing.rotation.x = -Math.PI / 2;
    this.aimGroup.add(this.aimRing);
    this.aimGroup.visible = false;
    this.landRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.68, 40), new THREE.MeshBasicMaterial({ color: '#ff7a2a', transparent: true, opacity: 0.85, depthWrite: false }));
    this.landRing.rotation.x = -Math.PI / 2;
    this.landRing.visible = false;
    this.scene.add(this.aimGroup, this.landRing, this.lines);
    this.shots = {
      bat: () => ({ pos: [2.6, -8.6, 2.9], look: [0, 9, 0.6], fov: 4 }),
      field: () => {
        const L = this.cfg?.L ?? 50;
        return { pos: [0, -11 - L * 0.3, 6.5 + L * 0.3], look: [0, L * 0.3, 0], fov: 6 };
      },
      follow: (f: { x: number; y: number }) => ({ pos: [f.x * 0.5, f.y - 17, 12], look: [f.x * 0.8, f.y + 1, 0.5], fov: 4 }),
      kon: () => {
        const L = this.cfg?.L ?? 50;
        return { pos: [0, L * 0.45, 12], look: [0, L * 0.8, 0] };
      },
    };
    if (import.meta.env.DEV) (window as unknown as { __lp: LaptaYard }).__lp = this;
  }

  protected override onLoaded() {
    const props = this.props;
    if (!props) return;
    const b = props.getObjectByName('ball');
    if (b) {
      b.position.set(0, 0, 0);
      b.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.ball.clear();
      this.ball.add(b.clone());
    }
    const bat = props.getObjectByName('lapta');
    if (bat) {
      bat.position.set(0, 0, 0);
      bat.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.bat.clear();
      this.bat.add(bat.clone());
    }
  }

  /** Разметка мелом по правилам партии: дом, кон, контрольная, боковые, круг подачи. */
  setField(c: Cfg) {
    if (this.cfg && this.cfg.L === c.L && this.cfg.W === c.W && this.cfg.ctrl === c.ctrl) return;
    this.cfg = c;
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
    const hw = c.W / 2;
    strip(-hw, 0, hw, 0, 0.1);
    strip(-hw, c.L, hw, c.L, 0.1);
    strip(-hw, 0, -hw, c.L);
    strip(hw, 0, hw, c.L);
    // контрольная — пунктиром
    for (let x = -hw; x < hw - 0.5; x += 1.6) strip(x, c.ctrl, Math.min(hw, x + 0.9), c.ctrl, 0.06);
    const circ = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.27, 32), chalk);
    circ.rotation.x = -Math.PI / 2;
    circ.position.copy(W(0.7, 0.7, 0.006));
    this.lines.add(circ);
    // флажки по углам кона
    const pole = new THREE.MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.7 });
    const cloth = new THREE.MeshStandardMaterial({ color: '#e0402a', roughness: 0.8, side: THREE.DoubleSide });
    for (const s of [-1, 1])
      for (const y of [0, yKon(c) - 0.4]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.2, 8), pole);
        p.position.copy(W(s * hw, y, 0.6));
        p.castShadow = true;
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.22), cloth);
        f.position.copy(W(s * hw + 0.17, y, 1.08));
        f.castShadow = true;
        this.lines.add(p, f);
      }
  }

  /** Команды по n пацанов (бригада на команду). */
  setTeams(n: number) {
    for (let t = 0; t < 2; t++) {
      while (this.men[t].length < n) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 32), new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.9, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.visible = false;
        this.scene.add(ring);
        const man: Man = { toon: null, x: 0, y: -3, ring };
        this.men[t].push(man);
        const k = this.men[t].length - 1;
        this.pending++;
        void this.loader
          .make(TEAM_BRIGADE[t], t * 7 + k)
          .then((toon) => {
            if (this.disposed) return;
            man.toon = toon;
            toon.root.position.copy(W(man.x, man.y));
            this.scene.add(toon.root);
          })
          .catch((e) => console.warn('лапта: пацан не загрузился', e))
          .finally(() => this.pending--);
      }
      for (let k = n; k < this.men[t].length; k++) this.men[t][k].toon?.root.removeFromParent();
    }
  }

  /** Поставить пацана в точку (оси игры), лицом к точке face. */
  put(t: number, k: number, x: number, y: number, face?: [number, number]) {
    const m = this.men[t][k];
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

  /** Кольцо под пацаном: цвет или null — убрать. */
  mark(t: number, k: number, color: string | null) {
    const m = this.men[t][k];
    if (!m) return;
    m.ring.visible = !!color;
    if (color) (m.ring.material as THREE.MeshBasicMaterial).color.set(color);
  }

  clearMarks() {
    for (const team of this.men) for (const m of team) m.ring.visible = false;
  }

  /** Мяч в точке (оси игры); null — спрятать. */
  setBall(p: [number, number, number] | null) {
    this.ball.visible = !!p;
    if (p) this.ball.position.copy(W(p[0], p[1], p[2]));
  }

  /** Бита: в руках у бьющего (toon) или лежит на земле у дома. */
  batIn(toon: Toon | null, rot = 1) {
    if (toon) toon.placeBat(this.bat, 0.45, rot, [-0.6, 0.7, 0.3]);
    else {
      this.bat.position.copy(W(-0.6, -0.6, 0.035));
      this.bat.rotation.set(Math.PI / 2, 0, 0.4);
    }
  }

  /** Прицел: точки полёта и кольцо падения (точки — оси игры). */
  setAim(pts: [number, number, number][] | null, land: [number, number] | null) {
    this.aimGroup.visible = !!pts;
    if (!pts) return;
    const n = this.aimDots.length;
    this.aimDots.forEach((d, i) => {
      const p = pts[Math.min(pts.length - 1, Math.floor(((i + 1) * pts.length) / (n + 1)))];
      d.visible = !!p;
      if (p) {
        d.position.copy(W(p[0], p[1], p[2]));
        d.lookAt(this.camera.position);
      }
    });
    this.aimRing.visible = !!land;
    if (land) this.aimRing.position.copy(W(land[0], land[1], 0.02));
  }

  /** Куда упадёт отбитый мяч (видно всем, пока решают). */
  setLand(p: [number, number] | null) {
    this.landRing.visible = !!p;
    if (p) this.landRing.position.copy(W(p[0], p[1], 0.02));
  }

  /** Камера к ракурсу. */
  override camTo(mode: CamMode, focus?: { x: number; y: number }, speed = 2.5) {
    if (mode === 'follow' && !focus) mode = 'field';
    this.shot({ ...this.shots[mode]!(focus as never), speed });
  }

  protected override update(dt: number) {
    const tt = performance.now() / 1000;
    for (const team of this.men)
      for (const m of team) {
        m.toon?.update(dt);
        if (m.ring.visible) {
          m.ring.position.copy(W(m.x, m.y, 0.03));
          const s = 1 + Math.sin(tt * 6) * 0.08;
          m.ring.scale.set(s, s, s);
        }
      }
    // мячик 7 см издалека не разглядеть — чем дальше от камеры, тем крупнее (до ×6)
    const d = this.ball.position.distanceTo(this.camera.position);
    this.ball.scale.setScalar(clamp(d / 9, 1, 6));
    const lr = this.landRing;
    if (lr.visible) lr.rotation.z += dt * 1.5;
  }

  override dispose() {
    this.disposed = true;
    super.dispose();
  }
}
