/* Дворовый спорт — метки на земле (three.js): кольца (куда упадёт мяч, кем управляешь, на кого переключишься)
 * и стрелка к цели (куда бежать, куда кинуть). Каждый кадр: marks.begin(); marks.ring('land', x, y, …); marks.arrow(…);
 * marks.end() — что в этом кадре не назвали, прячется. Оси игры (x, y — по земле) → three (x, z, −y), как в yard3d.ts. */
import * as THREE from 'three';

export class GroundMarks {
  readonly group = new THREE.Group();
  private rings = new Map<string, THREE.Mesh>();
  private arrows = new Map<string, THREE.Group>();
  private used = new Set<string>();
  private t = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
  }

  begin(dt = 1 / 60) {
    this.t += dt;
    this.used.clear();
  }

  /** Кольцо радиуса r на земле; pulse — дышит; spin — бегущая полоса (куда упадёт мяч). */
  ring(id: string, x: number, y: number, color: string, r = 0.55, o: { pulse?: boolean; dashed?: boolean } = {}) {
    let m = this.rings.get(id);
    if (!m) {
      const geo = o.dashed ? new THREE.RingGeometry(0.82, 1, 48, 1, 0, Math.PI * 1.6) : new THREE.RingGeometry(0.78, 1, 48);
      m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 3;
      this.group.add(m);
      this.rings.set(id, m);
    }
    (m.material as THREE.MeshBasicMaterial).color.set(color);
    const s = r * (o.pulse ? 1 + Math.sin(this.t * 6) * 0.1 : 1);
    m.scale.set(s, s, s);
    if (o.dashed) m.rotation.z = this.t * 1.8;
    m.position.set(x, 0.035, -y);
    m.visible = true;
    this.used.add(id);
  }

  /** Стрелка по земле от точки к цели (длина до max), с наконечником. */
  arrow(id: string, x0: number, y0: number, x1: number, y1: number, color: string, max = 6) {
    let g = this.arrows.get(id);
    if (!g) {
      g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
      const shaft = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.16), mat);
      shaft.name = 'shaft';
      const head = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0.32), new THREE.Vector2(0.5, 0), new THREE.Vector2(0, -0.32)])), mat);
      head.name = 'head';
      for (const p of [shaft, head]) {
        p.rotation.x = -Math.PI / 2;
        p.renderOrder = 3;
      }
      g.add(shaft, head);
      this.group.add(g);
      this.arrows.set(id, g);
    }
    const dx = x1 - x0;
    const dy = y1 - y0;
    const d = Math.hypot(dx, dy);
    if (d < 0.8) {
      g.visible = false;
      this.used.add(id);
      return;
    }
    const len = Math.min(max, d) - 0.6;
    ((g.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).color.set(color);
    const shaft = g.getObjectByName('shaft')!;
    const head = g.getObjectByName('head')!;
    shaft.scale.set(Math.max(0.1, len - 0.5), 1, 1);
    shaft.position.set((0.6 + (len - 0.5) / 2), 0.04, 0);
    head.position.set(0.6 + len - 0.5, 0.04, 0);
    g.position.set(x0, 0, -y0);
    g.rotation.set(0, Math.atan2(dy, dx), 0);
    g.visible = true;
    this.used.add(id);
  }

  end() {
    for (const [id, m] of this.rings) if (!this.used.has(id)) m.visible = false;
    for (const [id, g] of this.arrows) if (!this.used.has(id)) g.visible = false;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.group.removeFromParent();
  }
}
