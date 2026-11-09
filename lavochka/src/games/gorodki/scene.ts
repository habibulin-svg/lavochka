/* 3D-площадка городков (three.js) на общем наборе дворового спорта (core/dvorsport/yard3d.ts: рендерер, солнце, двор
 * из Blender — studio/blender/gorodki_yard.py, задник, плавная камера). Здесь — своё: городки и марка, бита в полёте,
 * прицел, лупа (окошко с городом крупно) и люди: пацаны бригад KayKit (core/dvorsport/toon.ts, по умолчанию) или прежние
 * гопники MakeHuman/MPFB2 (?pacan=0), people3d.ts. Ось игры (x, y — вглубь к городу, z — вверх) → three: (x, z, −y). */
import * as THREE from 'three';
import { DvorYard, W } from '../../core/dvorsport/yard3d';
import { BR, G as GRAV, LOFT, RELEASE_Z, RH, RR, speedOf } from './physics';
import { TOON, TOON_CAM } from './pacan3d';
import { Crowd } from './people3d';

export type CamMode = 'aim' | 'flight' | 'city' | 'over';

export interface RodPose {
  x: number;
  y: number;
  z: number;
  a: number;
  roll: number;
  stand: boolean;
}

export class Yard3D extends DvorYard<CamMode> {
  private lupaCam = new THREE.PerspectiveCamera(32, 1.3, 0.05, 50);
  private rods: THREE.Object3D[] = [];
  private rodProto: THREE.Object3D | null = null;
  private markProto: THREE.Object3D | null = null;
  private batProto: THREE.Object3D | null = null;
  private flyBat: THREE.Object3D | null = null;
  private lastRods: (RodPose & { mark?: boolean })[] = [];
  private lastBat: RodPose | null = null;
  readonly crowd: Crowd;
  private aimGroup = new THREE.Group();
  private aimDots: THREE.Mesh[] = [];
  private ring: THREE.Mesh;
  lupa = true;
  lupaWide = false;
  lupaShown = false;
  /** Кто бросает: место и позиция вдоль черты. */
  thrower = { seat: 0, x: 0, line: -13 };
  /** Фаза броска (null — стоит). */
  phase: number | null = null;

  constructor(host: HTMLElement) {
    super(host);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40), new THREE.MeshBasicMaterial({ color: '#ffe23a', transparent: true, opacity: 0.9, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2;
    this.aimGroup.add(this.ring);
    const dotGeo = new THREE.CircleGeometry(0.06, 12);
    const dotMat = new THREE.MeshBasicMaterial({ color: '#ff6a1a', transparent: true, opacity: 0.9, depthWrite: false });
    for (let i = 0; i < 26; i++) {
      const d = new THREE.Mesh(dotGeo, dotMat);
      d.rotation.x = -Math.PI / 2;
      this.aimDots.push(d);
      this.aimGroup.add(d);
    }
    this.aimGroup.visible = false;
    this.scene.add(this.aimGroup);
    this.crowd = new Crowd(() => this.batProto);
    this.scene.add(this.crowd.group);
    // ракурсы: прицел у черты, за битой в полёте, на город, общий план
    this.shots = {
      aim: () => {
        const t = this.thrower;
        // пацан ниже взрослого и с крупной головой: камера дальше и шире — он в полный рост слева внизу,
        // площадка и город — по центру, как раньше (смотрим в ту же точку)
        if (TOON) {
          const c = TOON_CAM;
          return { pos: [t.x + c.dx, t.line - c.back, c.h], look: [t.x * 0.3 + 0.15 + c.lookX, 1.2, c.lookZ], fov: c.fov };
        }
        return { pos: [t.x + 0.6, t.line - 3.9, 2.0], look: [t.x * 0.3 + 0.15, 1.2, 0.2] };
      },
      flight: (f: { x: number; y: number }) => ({ pos: [f.x * 0.4 + 0.9, f.y - 3.0, 1.9], look: [f.x * 0.6, f.y + 2, 0.3] }),
      city: () => ({ pos: [1.0, -3.3, 2.5], look: [0, 0.6, 0] }),
      over: () => ({ pos: [4.5, -9, 5], look: [0, -3, 0] }),
    };
    if (import.meta.env.DEV) (window as unknown as { __gk: Yard3D }).__gk = this;
  }

  protected override onLoaded() {
    const props = this.props;
    if (!props) return;
    const rod = props.getObjectByName('rod');
    const bat = props.getObjectByName('bat');
    if (rod) {
      rod.position.set(0, 0, 0);
      rod.traverse((o) => ((o as THREE.Mesh).castShadow = (o as THREE.Mesh).receiveShadow = true));
      this.rodProto = rod;
      // марка — та же чурка, но покрашена жёлтым
      const mk = rod.clone();
      mk.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const sm = m.material as THREE.MeshStandardMaterial;
        if (/side/.test(sm.name)) {
          const c = sm.clone();
          c.color = new THREE.Color('#ffc060');
          m.material = c;
        }
      });
      this.markProto = mk;
    }
    if (bat) {
      bat.position.set(0, 0, 0);
      bat.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.batProto = bat;
    }
    for (const r of this.rods) this.scene.remove(r);
    this.rods = [];
    this.setRods(this.lastRods);
    this.setBat(this.lastBat);
  }

  /** Люди: по человеку на место. */
  setSeats(seats: number[]) {
    this.crowd.setSeats(seats);
  }

  private newRod(): THREE.Object3D {
    const g = new THREE.Group();
    if (this.rodProto) {
      g.add(this.rodProto.clone());
      g.userData.mark = false;
    } else {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(RR, RR, RH * 2, 16), new THREE.MeshStandardMaterial({ color: '#e8d4a8', roughness: 0.7 }));
      m.castShadow = true;
      g.add(m);
    }
    this.scene.add(g);
    return g;
  }

  /** Городки: позы. */
  setRods(rods: (RodPose & { mark?: boolean })[]) {
    this.lastRods = rods;
    while (this.rods.length < rods.length) this.rods.push(this.newRod());
    this.rods.forEach((g, i) => {
      const r = rods[i];
      g.visible = !!r;
      if (!r) return;
      if (this.rodProto && this.markProto && !!g.userData.mark !== !!r.mark) {
        g.clear();
        g.add((r.mark ? this.markProto : this.rodProto).clone());
        g.userData.mark = !!r.mark;
      }
      const m = g.children[0];
      g.position.copy(W(r.x, r.y, r.stand ? r.z + RH : r.z));
      if (r.stand) {
        g.rotation.set(0, 0, 0);
        m.rotation.set(0, 0, 0);
      } else {
        g.rotation.set(0, r.a, 0);
        m.rotation.set(r.roll, 0, Math.PI / 2);
      }
    });
  }

  /** Бита в полёте (null — в руке у бросающего). */
  setBat(p: RodPose | null) {
    this.lastBat = p;
    if (!p) {
      if (this.flyBat) this.flyBat.visible = false;
      return;
    }
    if (!this.flyBat && this.batProto) {
      this.flyBat = this.batProto.clone();
      this.scene.add(this.flyBat);
    }
    const b = this.flyBat;
    if (!b) return;
    b.visible = true;
    b.position.copy(W(p.x, p.y, p.z));
    b.rotation.order = 'YXZ';
    b.rotation.set(0, p.a, Math.PI / 2);
  }

  /** Прицел: точки траектории и кольцо там, где бита коснётся земли. */
  setAim(a: { x: number; ang: number; pow: number; line: number; full: boolean } | null) {
    this.aimGroup.visible = !!a;
    if (!a) return;
    const v = speedOf(a.pow);
    const vh = v * Math.cos(LOFT);
    const vz = v * Math.sin(LOFT);
    const tLand = (vz + Math.sqrt(vz * vz + 2 * GRAV * (RELEASE_Z - BR))) / GRAV;
    const sa = Math.sin(a.ang);
    const ca = Math.cos(a.ang);
    const x0 = a.x + sa * 0.4;
    const y0 = a.line + ca * 0.4;
    const n = this.aimDots.length;
    this.aimDots.forEach((d, i) => {
      const t = (tLand * (i + 1)) / (n + 1);
      d.visible = a.full || i < n * 0.45;
      d.position.copy(W(x0 + sa * vh * t, y0 + ca * vh * t, 0.012));
    });
    this.ring.visible = a.full;
    this.ring.position.copy(W(x0 + sa * vh * tLand, y0 + ca * vh * tLand, 0.01));
  }

  /** Камера к ракурсу: aim, flight (focus — где бита), city, over. */
  override camTo(mode: CamMode, focus?: { x: number; y: number }, speed = 3) {
    if (mode === 'flight' && !focus) mode = 'over';
    this.shot({ ...this.shots[mode]!(focus as never), speed });
  }

  /** Кадр для превью: низко над пригородом, бита летит в фигуру. */
  shotCam() {
    this.camGoalPos.copy(W(1.1, -2.1, 0.62));
    this.camGoalLook.copy(W(-0.15, 0.35, 0.12));
    this.snapCam();
  }

  cheer() {
    this.crowd.cheer(this.thrower.seat);
  }

  protected override update(dt: number) {
    this.crowd.thrower = this.thrower;
    this.crowd.phase = this.phase;
    this.crowd.update(dt);
  }

  /** Лупа: окошко с городом крупно в углу, когда камера далеко. */
  protected override overlay(w: number, h: number) {
    const r = this.renderer;
    this.lupaShown = this.lupa && this.camPos.z > 4;
    if (this.lupaShown) {
      const lw = Math.round(Math.min(w * 0.3, 300));
      const lh = Math.round(lw * 0.72);
      const x = w - lw - 10;
      const y = h - lh - 10;
      this.lupaCam.aspect = lw / lh;
      this.lupaCam.updateProjectionMatrix();
      if (this.lupaWide) {
        this.lupaCam.position.copy(W(0, -1.6, 2.2));
        this.lupaCam.lookAt(W(0, 0.85, 0));
      } else {
        this.lupaCam.position.copy(W(0, -0.75, 0.75));
        this.lupaCam.lookAt(W(0, 0.32, 0));
      }
      const aim = this.aimGroup.visible;
      this.aimGroup.visible = false;
      r.setScissorTest(true);
      r.setScissor(x, y, lw, lh);
      r.setViewport(x, y, lw, lh);
      r.render(this.scene, this.lupaCam);
      r.setScissorTest(false);
      this.aimGroup.visible = aim;
    }
  }

  lupaRect(): { x: number; y: number; w: number; h: number } | null {
    if (!this.lupa) return null;
    const w = this.host.clientWidth;
    const lw = Math.round(Math.min(w * 0.3, 300));
    const lh = Math.round(lw * 0.72);
    return { x: w - lw - 10, y: 10, w: lw, h: lh };
  }

  override dispose() {
    this.crowd.dispose();
    super.dispose();
  }
}
