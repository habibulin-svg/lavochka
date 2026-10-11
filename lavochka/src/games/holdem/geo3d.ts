/* Холдем 3D — геометрия: карта со скруглёнными углами (лицо, рубашка, торец), обод вокруг овала по профилю
 * (кожаный валик борта, деревянный кант, юбка стола). */
import * as THREE from 'three';

/** Скруглённый прямоугольник w×h с радиусом r, центр в нуле. */
function roundRect(w: number, h: number, r: number, seg = 6): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const cx = w / 2 - r;
  const cy = h / 2 - r;
  const corner = (ox: number, oy: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push(new THREE.Vector2(ox + Math.cos(a) * r, oy + Math.sin(a) * r));
    }
  };
  corner(cx, cy, 0);
  corner(-cx, cy, Math.PI / 2);
  corner(-cx, -cy, Math.PI);
  corner(cx, -cy, (3 * Math.PI) / 2);
  return pts;
}

/**
 * Карта: тонкая пластинка в плоскости XZ (лицо смотрит вверх, +Y), верх картинки — к −Z.
 * Группы материалов: 0 — лицо, 1 — рубашка, 2 — торец.
 */
export function cardGeometry(w: number, h: number, t: number, r: number): THREE.BufferGeometry {
  const outline = roundRect(w, h, r);
  const n = outline.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const g = new THREE.BufferGeometry();
  // лицо (веер из центра), y = +t/2
  const face = (y: number, ny: number, mirror: boolean) => {
    const base = pos.length / 3;
    pos.push(0, y, 0);
    nor.push(0, ny, 0);
    uv.push(0.5, 0.5);
    for (const p of outline) {
      // точка контура (x, z = −p.y): верх картинки (p.y > 0) — дальний край (−Z)
      pos.push(p.x, y, -p.y);
      nor.push(0, ny, 0);
      const u = p.x / w + 0.5;
      uv.push(mirror ? 1 - u : u, p.y / h + 0.5);
    }
    const start = idx.length;
    for (let i = 0; i < n; i++) {
      const a = base + 1 + i;
      const b = base + 1 + ((i + 1) % n);
      if (ny > 0) idx.push(base, a, b);
      else idx.push(base, b, a);
    }
    return [start, idx.length - start] as const;
  };
  const [f0, fc] = face(t / 2, 1, false);
  const [b0, bc] = face(-t / 2, -1, true);
  // торец
  const base = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % n];
    const d = new THREE.Vector2(q.x - p.x, q.y - p.y).normalize();
    const nx = d.y;
    const nz = d.x; // нормаль наружу в XZ (z = −y)
    for (const [pp, y] of [
      [p, t / 2],
      [q, t / 2],
      [q, -t / 2],
      [p, -t / 2],
    ] as [THREE.Vector2, number][]) {
      pos.push(pp.x, y, -pp.y);
      nor.push(nx, 0, nz);
      uv.push(0, 0);
    }
  }
  const s0 = idx.length;
  for (let i = 0; i < n; i++) {
    const k = base + i * 4;
    idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.addGroup(f0, fc, 0);
  g.addGroup(b0, bc, 1);
  g.addGroup(s0, idx.length - s0, 2);
  return g;
}

/**
 * Обод вокруг эллипса rx×rz: профиль [d, y] — d отступ наружу от эллипса по нормали, y высота.
 * U идёт вдоль обода (repeatU раз за круг), V — по профилю от первой точки к последней.
 */
export function sweepEllipse(rx: number, rz: number, profile: [number, number][], repeatU: number, seg = 220): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // длина профиля для V
  const acc = [0];
  for (let i = 1; i < profile.length; i++) acc.push(acc[i - 1] + Math.hypot(profile[i][0] - profile[i - 1][0], profile[i][1] - profile[i - 1][1]));
  const L = acc[acc.length - 1] || 1;
  const m = profile.length;
  for (let s = 0; s <= seg; s++) {
    const a = (s / seg) * Math.PI * 2;
    const ex = Math.cos(a) * rx;
    const ez = Math.sin(a) * rz;
    let nx = Math.cos(a) * rz;
    let nz = Math.sin(a) * rx;
    const nl = Math.hypot(nx, nz);
    nx /= nl;
    nz /= nl;
    for (let j = 0; j < m; j++) {
      const [d, y] = profile[j];
      pos.push(ex + nx * d, y, ez + nz * d);
      uv.push((s / seg) * repeatU, acc[j] / L);
    }
  }
  for (let s = 0; s < seg; s++)
    for (let j = 0; j < m - 1; j++) {
      const a = s * m + j;
      const b = (s + 1) * m + j;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Профиль мягкого валика: полуовал шириной w и высотой h, начиная с d0 и высоты y0. */
export function bolsterProfile(d0: number, w: number, h: number, y0: number, steps = 18): [number, number][] {
  const out: [number, number][] = [[d0, y0 - 0.02]];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - (i / steps) * Math.PI;
    // чуть «подушкой»: верх плоский, бока круглые
    const c = Math.cos(a);
    const s = Math.pow(Math.sin(a), 0.6);
    out.push([d0 + w / 2 + (c * w) / 2, y0 + s * h]);
  }
  out.push([d0 + w, y0 - 0.25]);
  return out;
}
