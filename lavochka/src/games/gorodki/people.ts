/* Весёлые человечки (three.js): большая голова, глаза-точки, румянец, причёска или кепка, майка цвета места.
 * Рука с битой машет по фазе броска: замах назад → бросок вперёд → провожание. Всё из простых фигур, без моделей. */
import * as THREE from 'three';

export interface Style {
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  /** 'cap' — кепка, 'short' — ёжик, 'bob' — каре, 'pan' — панама. */
  hat: 'cap' | 'short' | 'bob' | 'pan';
  hatColor?: string;
}

export const STYLES: Style[] = [
  { shirt: '#d8402e', pants: '#2a3550', skin: '#f2c9a0', hair: '#5a3418', hat: 'cap', hatColor: '#f4f0e6' },
  { shirt: '#2f6ad0', pants: '#3a3a40', skin: '#e8b88a', hair: '#e0b050', hat: 'short' },
  { shirt: '#2f9a48', pants: '#2a3550', skin: '#f5d2b0', hair: '#2a1a10', hat: 'bob' },
  { shirt: '#e0a020', pants: '#4a3a2a', skin: '#d9a57a', hair: '#8a4a20', hat: 'pan', hatColor: '#f0ead8' },
];

const mat = (c: string, rough = 0.7) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: 0 });

export class Person {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private armR = new THREE.Group();
  private armL = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private head = new THREE.Group();
  /** Бита в руке (показывается, пока не бросил). */
  readonly handBat: THREE.Object3D;
  private t = Math.random() * 10;

  constructor(st: Style, bat: THREE.Object3D) {
    const shirt = mat(st.shirt, 0.8);
    const pants = mat(st.pants, 0.85);
    const skin = mat(st.skin, 0.6);
    const hair = mat(st.hair, 0.9);
    const shoe = mat('#222428', 0.6);
    // ноги
    for (const [g, x] of [
      [this.legL, -0.11],
      [this.legR, 0.11],
    ] as const) {
      g.position.set(x, 0.62, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.42, 4, 10), pants);
      leg.position.y = -0.28;
      leg.castShadow = true;
      g.add(leg);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 8), shoe);
      foot.scale.set(1, 0.6, 1.5);
      foot.position.set(0, -0.58, 0.05);
      foot.castShadow = true;
      g.add(foot);
      this.root.add(g);
    }
    // туловище
    this.body.position.y = 0.62;
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.34, 6, 14), shirt);
    torso.position.y = 0.32;
    torso.scale.set(1, 1, 0.75);
    torso.castShadow = true;
    this.body.add(torso);
    // голова
    this.head.position.y = 0.86;
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.21, 24, 18), skin);
    face.castShadow = true;
    this.head.add(face);
    const eyeM = mat('#1a1a1a', 0.3);
    for (const x of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), eyeM);
      eye.position.set(x, 0.03, 0.19);
      eye.scale.set(1, 1.35, 0.6);
      this.head.add(eye);
      const blush = new THREE.Mesh(new THREE.CircleGeometry(0.03, 12), new THREE.MeshBasicMaterial({ color: '#ff8a80', transparent: true, opacity: 0.45 }));
      blush.position.set(x * 1.6, -0.04, 0.185);
      blush.rotation.y = x > 0 ? 0.5 : -0.5;
      this.head.add(blush);
    }
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), skin);
    nose.position.set(0, -0.01, 0.21);
    this.head.add(nose);
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 6, 16, Math.PI), eyeM);
    smile.position.set(0, -0.075, 0.185);
    smile.rotation.z = Math.PI;
    this.head.add(smile);
    // причёска / головной убор
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.218, 24, 12, 0, Math.PI * 2, 0, Math.PI * (st.hat === 'bob' ? 0.62 : 0.48)), hair);
    cap.rotation.x = -0.18;
    this.head.add(cap);
    if (st.hat === 'cap' || st.hat === 'pan') {
      const hm = mat(st.hatColor ?? '#eee', 0.8);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.225, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), hm);
      crown.rotation.x = -0.15;
      crown.position.y = 0.02;
      this.head.add(crown);
      if (st.hat === 'cap') {
        const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.015, 20, 1, false, -Math.PI / 2, Math.PI), hm);
        visor.position.set(0, 0.11, 0.15);
        visor.rotation.x = 0.15;
        this.head.add(visor);
      } else {
        const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.012, 24), hm);
        brim.position.y = 0.1;
        this.head.add(brim);
      }
    }
    this.body.add(this.head);
    // руки: плечо — точка поворота
    for (const [g, x] of [
      [this.armL, -0.27],
      [this.armR, 0.27],
    ] as const) {
      g.position.set(x, 0.5, 0);
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.32, 4, 10), shirt);
      arm.position.y = -0.2;
      arm.castShadow = true;
      g.add(arm);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), skin);
      hand.position.y = -0.43;
      g.add(hand);
      this.body.add(g);
    }
    this.armL.rotation.z = 0.12;
    this.armR.rotation.z = -0.12;
    this.handBat = bat;
    bat.position.set(0, -0.45, 0.02);
    bat.rotation.set(Math.PI / 2, 0, 0);
    this.armR.add(bat);
    this.root.add(this.body);
  }

  /** Поза броска: фаза 0 — стоит с битой, 0…0.55 — замах, 0.55…0.7 — бросок, дальше — провожает. */
  pose(phase: number | null, dt: number) {
    this.t += dt;
    const bob = Math.sin(this.t * 2.2) * 0.012;
    this.body.position.y = 0.62 + bob;
    this.head.rotation.z = Math.sin(this.t * 1.3) * 0.04;
    if (phase == null) {
      this.armR.rotation.set(0.35 + Math.sin(this.t * 2.2) * 0.04, 0, -0.18);
      this.armL.rotation.set(0, 0, 0.12 + Math.sin(this.t * 2.2) * 0.03);
      this.body.rotation.set(0, 0, 0);
      this.legL.rotation.x = 0;
      this.legR.rotation.x = 0;
      return;
    }
    const p = Math.max(0, Math.min(1, phase));
    const ease = (v: number) => v * v * (3 - 2 * v);
    // бросок сбоку, плашмя: рука уходит в сторону и назад, корпус закручивается и раскручивается
    let raise: number;
    let twist: number;
    let lean: number;
    if (p < 0.55) {
      const k = ease(p / 0.55);
      raise = k;
      twist = -k * 1.25;
      lean = -k * 0.1;
    } else if (p < 0.7) {
      const k = ease((p - 0.55) / 0.15);
      raise = 1;
      twist = -1.25 + k * 2.2;
      lean = -0.1 + k * 0.38;
    } else {
      const k = ease((p - 0.7) / 0.3);
      raise = 1 - k * 0.7;
      twist = 0.95 - k * 0.85;
      lean = 0.28 - k * 0.22;
    }
    this.armR.rotation.set(0.1, 0, -0.18 - raise * 1.25);
    this.armL.rotation.set(0, 0, 0.3 + raise * 0.5);
    this.body.rotation.set(lean, twist, 0);
    this.legL.rotation.x = -lean * 1.2;
    this.legR.rotation.x = lean * 0.8;
  }

  /** Радость: подпрыгнуть и поднять руки (k — 0…1). */
  cheer(k: number) {
    const j = Math.sin(k * Math.PI * 3) * 0.08 * (1 - k);
    this.root.position.y = Math.max(0, j);
    this.armR.rotation.set(-2.6 * (1 - k * 0.3), 0, -0.3);
    this.armL.rotation.set(-2.6 * (1 - k * 0.3), 0, 0.3);
  }
}
