/* Холдем 3D — комната 90-х вокруг стола: паркет «ёлочкой», обои, ковёр на стене, окно с ночным двором и тюлем,
 * сервант с хрусталём, телевизор на тумбе, абажур с бахромой над столом, стулья. 1 единица ≈ 25 см, стол — y = 0, пол — y = FLOOR. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { silkTex, tulleTex } from './tex3d';
import { normalOnly, pbr } from './pbr';

export const FLOOR = -3;
export const CEIL = 8;
const RX = 13;
const RZ_FAR = -12;
const RZ_NEAR = 15;

const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);

// ---------------------------------------------------------------- модели мебели

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const models = new Map<string, Promise<THREE.Object3D>>();
let onLoad: () => void = () => {};
/** Кого дёрнуть, когда догрузилась модель или картинка (перерисовать кадр). */
export function onRoomLoad(f: () => void) {
  onLoad = f;
}

function model(name: string): Promise<THREE.Object3D> {
  let p = models.get(name);
  if (!p) {
    p = loader.loadAsync(`${import.meta.env.BASE_URL}models/room/${name}.glb`).then((g) => {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.castShadow = true;
          m.receiveShadow = true;
        }
      });
      return g.scene;
    });
    models.set(name, p);
  }
  return p;
}

interface Place {
  x: number;
  z: number;
  ry: number;
  /** Высота модели в единицах сцены (масштаб подгоняется). */
  h: number;
  /** Низ модели — на этой высоте (по умолчанию пол). */
  y?: number;
}

/** Поставить модель: масштаб по высоте, низ — на пол (или y), повернуть. done — когда встала. */
function placeModel(parent: THREE.Object3D, name: string, at: Place, done?: (o: THREE.Object3D) => void) {
  model(name)
    .then((src) => {
      const o = src.clone();
      o.rotation.y = at.ry;
      const box = new THREE.Box3().setFromObject(o);
      const k = at.h / Math.max(0.001, box.max.y - box.min.y);
      o.scale.setScalar(k);
      o.updateMatrixWorld(true);
      const b2 = new THREE.Box3().setFromObject(o);
      o.position.set(at.x - (b2.min.x + b2.max.x) / 2, (at.y ?? FLOOR) - b2.min.y, at.z - (b2.min.z + b2.max.z) / 2);
      parent.add(o);
      o.updateMatrixWorld(true);
      done?.(o);
      onLoad();
    })
    .catch((e) => console.warn('холдем: модель', name, e));
}

function box(w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  return mesh;
}

/** Комната целиком. Возвращает группу и свет абажура (им светит стол). */
export function buildRoom(): { group: THREE.Group; lamp: THREE.SpotLight; shade: THREE.Object3D } {
  const g = new THREE.Group();
  const W = RX * 2;
  const D = RZ_NEAR - RZ_FAR;
  const H = CEIL - FLOOR;
  const midZ = (RZ_NEAR + RZ_FAR) / 2;

  // пол
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std({ ...pbr('parquet', [W / 4.5, D / 4.5]), roughness: 0.85, metalness: 0, normalScale: new THREE.Vector2(0.8, 0.8) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR, midZ);
  floor.receiveShadow = true;
  g.add(floor);
  // потолок — побелка по штукатурке (фото), тёплый белый
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std({ ...pbr('ceiling', [W / 7, D / 7]), color: '#fff6ea', roughness: 1, normalScale: new THREE.Vector2(0.5, 0.5) }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, CEIL, midZ);
  ceil.receiveShadow = true;
  g.add(ceil);
  // потолочная розетка над абажуром и галтель по периметру
  {
    const plaster = std({ ...pbr('ceiling', [2, 2]), color: '#fffaf0', roughness: 0.95 });
    const rose = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          [0, 0],
          [0.25, -0.02],
          [0.32, -0.12],
          [0.55, -0.14],
          [0.62, -0.08],
          [0.95, -0.07],
          [1.05, -0.03],
          [1.1, 0],
        ].map(([x, y]) => new THREE.Vector2(x, y)),
        48
      ),
      plaster
    );
    rose.position.set(0, CEIL - 0.001, 0);
    g.add(rose);
    const cove = (len: number, x: number, z: number, ry: number) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, len, 12, 1, true, 0, Math.PI / 2), plaster);
      m.rotation.set(0, ry, Math.PI / 2);
      m.position.set(x, CEIL, z);
      g.add(m);
    };
    cove(W, 0, RZ_FAR, 0);
    cove(W, 0, RZ_NEAR, Math.PI);
    cove(D, -RX, midZ, Math.PI / 2);
    cove(D, RX, midZ, -Math.PI / 2);
  }
  // стены
  // обои: фото обойной бумаги (ambientCG, CC0) с напечатанным узором; одно полотно — 53 см (≈2,1 единицы), стыки видны
  const paper = (w: number) => std({ ...pbr('wall', [w / 2.12, H / 2.12]), roughness: 0.95, normalScale: new THREE.Vector2(0.8, 0.8) });
  const skirting = (w: number, x: number, z: number, ry: number) => {
    const sk = box(w, 0.45, 0.12, std({ ...pbr('walnut', [6, 0.2]), roughness: 0.7 }), 0, 0, 0, false);
    sk.position.set(x + Math.sin(ry) * 0.06, FLOOR + 0.22, z + Math.cos(ry) * 0.06);
    sk.rotation.y = ry;
    g.add(sk);
  };
  const wall = (w: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), paper(w));
    m.position.set(x, FLOOR + H / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    g.add(m);
    skirting(w, x, z, ry);
  };
  wall(W, 0, RZ_FAR, 0);
  wall(W, 0, RZ_NEAR, Math.PI);
  wall(D, RX, midZ, -Math.PI / 2);

  // окно на левой стене: проём с откосами, за ним — ночной двор (фото), стекло, подоконник, батарея, тюль и портьеры
  {
    const wz = -3;
    const wy = 2.6;
    const WW = 6;
    const WH = 6.4;
    // левая стена — с проёмом под окно (локальная x стены = −(z − midZ))
    const lx = -(wz - midZ);
    const ly = wy - (FLOOR + H / 2);
    const V = (x: number, y: number) => new THREE.Vector2(x, y);
    const shape = new THREE.Shape([V(-D / 2, -H / 2), V(D / 2, -H / 2), V(D / 2, H / 2), V(-D / 2, H / 2)]);
    shape.holes.push(new THREE.Path([V(lx - WW / 2, ly - WH / 2), V(lx - WW / 2, ly + WH / 2), V(lx + WW / 2, ly + WH / 2), V(lx + WW / 2, ly - WH / 2)]));
    const geo = new THREE.ShapeGeometry(shape);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const p = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / D + 0.5, p.getY(i) / H + 0.5);
    const lw = new THREE.Mesh(geo, paper(D));
    lw.position.set(-RX, FLOOR + H / 2, midZ);
    lw.rotation.y = Math.PI / 2;
    lw.receiveShadow = true;
    lw.castShadow = true;
    g.add(lw);
    skirting(D, -RX, midZ, Math.PI / 2);
    // откосы — толщина стены
    const slope = std({ ...pbr('ceiling', [1, 1]), color: '#f3eee4', roughness: 1 });
    const T = 0.9;
    g.add(box(T, 0.04, WW, slope, -RX - T / 2, wy + WH / 2, wz, false));
    g.add(box(T, 0.04, WW, slope, -RX - T / 2, wy - WH / 2, wz, false));
    g.add(box(T, WH, 0.04, slope, -RX - T / 2, wy, wz - WW / 2, false));
    g.add(box(T, WH, 0.04, slope, -RX - T / 2, wy, wz + WW / 2, false));
    // двор за окном (фото): подальше от стены — при движении камеры дома «стоят» снаружи, а не нарисованы на стекле
    const viewTex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}tex/holdem/window_night.webp`, () => onLoad());
    viewTex.colorSpace = THREE.SRGBColorSpace;
    const view = new THREE.Mesh(new THREE.PlaneGeometry(17, 18.5), new THREE.MeshBasicMaterial({ map: viewTex, toneMapped: false }));
    view.position.set(-RX - 7, wy + 0.6, wz);
    view.rotation.y = Math.PI / 2;
    g.add(view);
    // рама: две створки и форточка
    const frameM = std({ color: '#f1ede2', roughness: 0.5 });
    const fx = -RX - T + 0.25;
    const fr = (w: number, h: number, y: number, z: number) => g.add(box(0.16, h, w, frameM, fx, y, z, false));
    fr(WW, 0.26, wy + WH / 2 - 0.13, wz);
    fr(WW, 0.26, wy - WH / 2 + 0.13, wz);
    fr(0.26, WH, wy, wz - WW / 2 + 0.13);
    fr(0.26, WH, wy, wz + WW / 2 - 0.13);
    fr(0.18, WH, wy, wz);
    fr(WW, 0.16, wy + 1.4, wz);
    // стекло — чуть отражает комнату
    const glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.1, envMapIntensity: 1.2, depthWrite: false });
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(WW - 0.4, WH - 0.4), glass);
    pane.position.set(fx + 0.02, wy, wz);
    pane.rotation.y = Math.PI / 2;
    g.add(pane);
    g.add(box(1.2, 0.14, WW + 0.8, std({ color: '#f4f0e6', roughness: 0.35 }), -RX - T / 2 + 0.4, wy - WH / 2 - 0.05, wz, true));
    // батарея под окном
    const rad = std({ color: '#e9e4d6', roughness: 0.5, metalness: 0.2 });
    for (let i = 0; i < 12; i++) g.add(box(0.35, 2.2, 0.28, rad, -RX + 0.3, FLOOR + 1.6, wz - 2.2 + i * 0.4, false));
    // тюль — от карниза до пола мягкими складками; сквозь него виден двор
    const th = CEIL - 0.5 - (FLOOR + 0.3);
    const tg = new THREE.PlaneGeometry(WW + 2.4, th, 60, 1);
    const tp = tg.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) {
      const x = tp.getX(i);
      tp.setZ(i, Math.sin(x * 5.2) * 0.07 + Math.sin(x * 1.7 + 1) * 0.05);
    }
    tg.computeVertexNormals();
    const tulle = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ map: tulleTex(), transparent: true, side: THREE.DoubleSide, roughness: 1, depthWrite: false }));
    tulle.position.set(-RX + 0.35, FLOOR + 0.3 + th / 2, wz);
    tulle.rotation.y = Math.PI / 2;
    g.add(tulle);
    // портьеры — тяжёлый бархат (фото), глубокие неровные складки, низ ложится на пол; сверху ламбрекен фестонами
    const curtainM = std({ ...pbr('velvet', [2.2, 6]), color: '#8c3a30', roughness: 1, side: THREE.DoubleSide });
    const ch = CEIL - 0.45 - FLOOR;
    for (const side of [-1, 1]) {
      const cw = 2.6;
      const cg = new THREE.PlaneGeometry(cw, ch, 48, 12);
      const cp = cg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < cp.count; i++) {
        const x = cp.getX(i);
        const t = (cp.getY(i) + ch / 2) / ch; // 0 — пол, 1 — карниз
        // складки глубже внизу (ткань свободнее), шаг чуть сбит
        const fold = Math.sin(x * 6.3 + Math.sin(x * 2.1) * 0.8) * (0.16 + 0.1 * (1 - t));
        cp.setZ(i, fold + (t < 0.03 ? (0.03 - t) * 4 : 0));
      }
      cg.computeVertexNormals();
      const c = new THREE.Mesh(cg, curtainM);
      c.position.set(-RX + 0.65, FLOOR + ch / 2, wz + side * (WW / 2 + 0.9));
      c.rotation.y = Math.PI / 2;
      c.castShadow = true;
      c.receiveShadow = true;
      g.add(c);
    }
    {
      const vw = WW + 6;
      const vg = new THREE.PlaneGeometry(vw, 1.1, 80, 6);
      const vp = vg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < vp.count; i++) {
        const x = vp.getX(i);
        const y = vp.getY(i);
        const sag = (1 - Math.abs(Math.cos((x / vw) * Math.PI * 4))) * 0.35;
        if (y < 0) vp.setY(i, y - sag);
        vp.setZ(i, Math.sin(x * 9) * 0.05);
      }
      vg.computeVertexNormals();
      const val = new THREE.Mesh(vg, curtainM);
      val.position.set(-RX + 0.9, CEIL - 0.85, wz);
      val.rotation.y = Math.PI / 2;
      g.add(val);
    }
    g.add(box(0.12, 0.12, WW + 6.5, std({ color: '#8a6a3a', metalness: 0.6, roughness: 0.4 }), -RX + 0.75, CEIL - 0.4, wz, false));
  }

  // ковёр на дальней стене
  // настоящий ковёр (фото «Товуз-Казах», Кавказ, XIX век — общественное достояние; белый фон вокруг неровных краёв
  // вырезан в прозрачность), повешен как «три на два» — 3 × 1,9 м над диваном; висит чуть волной
  const CW = 12;
  const CH = CW / (1874 / 1180);
  const carpetGeo = new THREE.PlaneGeometry(CW, CH, 48, 6);
  const cp = carpetGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, 0.05 + Math.sin(cp.getX(i) * 1.1) * 0.035 + (cp.getY(i) > CH / 2 - 0.1 ? -0.025 : 0));
  carpetGeo.computeVertexNormals();
  const carpetMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}tex/holdem/carpet_col.webp`, () => onLoad());
  carpetMap.colorSpace = THREE.SRGBColorSpace;
  carpetMap.anisotropy = 8;
  const carpet = new THREE.Mesh(carpetGeo, std({ map: carpetMap, alphaTest: 0.5, normalMap: normalOnly('velvet', [8, 5]), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1 }));
  carpet.position.set(0, FLOOR + 3.4 + CH / 2, RZ_FAR + 0.03);
  carpet.receiveShadow = true;
  g.add(carpet);

  // мебель — фотосканы Poly Haven (CC0): сервант, телевизор на тумбе, кресло-качалка, бутылки
  placeModel(g, 'vintage_cabinet_01', { x: RX - 1.6, z: -3, ry: -Math.PI / 2, h: 8.2 }, (cab) => {
    // бутылки — на столешнице серванта, по её середине (а не где придётся: иначе крайняя висит в воздухе)
    const b = new THREE.Box3().setFromObject(cab);
    placeModel(g, 'wine_bottles_01', { x: (b.min.x + b.max.x) / 2 - 0.15, z: (b.min.z + b.max.z) / 2, ry: -Math.PI / 2, h: 1.35, y: FLOOR + 3.62 });
  });
  placeModel(g, 'vintage_wooden_drawer_01', { x: -9.3, z: -9.6, ry: 0.55, h: 3.2 }, (stand) => {
    const top = new THREE.Box3().setFromObject(stand).max.y;
    placeModel(g, 'television_02', { x: -9.3, z: -9.5, ry: 0.55, h: 2.9, y: top });
  });
  placeModel(g, 'Rockingchair_01', { x: 9.0, z: 9.5, ry: -2.4, h: 4.6 });
  {
    // свечение экрана телевизора
    const glow = new THREE.PointLight('#7a9ae0', 2.5, 7, 2);
    glow.position.set(-8.0, FLOOR + 4.3, -8.0);
    g.add(glow);
  }

  // абажур с бахромой над столом: шёлк сборкой (складки и в геометрии, и на ткани), светится изнутри; подкладка ярче
  const shade = new THREE.Group();
  {
    const prof = [
      [0.55, 1.15],
      [0.75, 1.1],
      [1.25, 0.92],
      [2.05, 0.42],
      [2.5, 0.08],
      [2.6, 0],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const pleat = (geo: THREE.BufferGeometry, k: number) => {
      const p = geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const r = 1 + Math.sin(Math.atan2(z, x) * 48) * k;
        p.setX(i, x * r);
        p.setZ(i, z * r);
      }
      geo.computeVertexNormals();
    };
    const outerGeo = new THREE.LatheGeometry(prof, 192);
    pleat(outerGeo, 0.018);
    const silk = silkTex();
    const outer = new THREE.Mesh(outerGeo, new THREE.MeshStandardMaterial({ map: silk, emissiveMap: silk, emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.75 }));
    shade.add(outer);
    // подкладка изнутри — светлее (на неё прямо светит лампочка)
    const inner = new THREE.Mesh(new THREE.LatheGeometry(prof.map((v) => new THREE.Vector2(v.x * 0.985, v.y)), 96), new THREE.MeshBasicMaterial({ color: '#ffd9a0', side: THREE.BackSide }));
    shade.add(inner);
    // каркасное кольцо по низу
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.035, 6, 96), std({ color: '#7a3a14', roughness: 0.8 }));
    ring.rotation.x = Math.PI / 2;
    shade.add(ring);
    // бахрома — густые нити чуть разной длины
    const N = 360;
    const fringeM = std({ color: '#c8641e', emissive: '#a04812', emissiveIntensity: 0.35, roughness: 1 });
    const fr = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.01, 0.006, 1, 3), fringeM, N);
    const mm = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      const len = 0.75 + Math.sin(i * 12.9898) * 0.06;
      q.setFromEuler(new THREE.Euler(Math.sin(i * 7.1) * 0.05, 0, Math.cos(i * 3.3) * 0.05));
      mm.compose(new THREE.Vector3(Math.cos(a) * 2.6, -len / 2, Math.sin(a) * 2.6), q, new THREE.Vector3(1, len, 1));
      fr.setMatrixAt(i, mm);
    }
    shade.add(fr);
    // лампочка и шнур
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshBasicMaterial({ color: '#fff4d0' }));
    bulb.position.y = 0.5;
    shade.add(bulb);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 4, 6), std({ color: '#222', roughness: 0.8 }));
    cord.position.y = 1.1 + 1.2;
    shade.add(cord);
    shade.scale.setScalar(0.72);
    shade.position.set(0, 6.3, 0);
    g.add(shade);
  }
  // ключевой свет — абажур: тёплый, с мягким краем пятна (стол светлый, комната уходит в полумрак, но не в черноту)
  const lamp = new THREE.SpotLight('#ffd49a', 240, 30, 1.0, 0.85, 1.5);
  lamp.position.set(0, 6.5, 0);
  lamp.target.position.set(0, 0, 0.2);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(2048, 2048);
  lamp.shadow.bias = -0.0003;
  lamp.shadow.normalBias = 0.02;
  lamp.shadow.radius = 5;
  lamp.shadow.camera.near = 1;
  lamp.shadow.camera.far = 14;
  g.add(lamp, lamp.target);
  // свет абажура вверх — тёплое пятно на потолке
  const up = new THREE.PointLight('#ffc080', 40, 14, 1.6);
  up.position.set(0, 7.3, 0);
  g.add(up);

  // торшер у кресла-качалки — второй тёплый источник в углу: стены не проваливаются в черноту
  {
    const x = RX - 2.2;
    const z = RZ_NEAR - 2.4;
    const brass = std({ color: '#8a6a3a', metalness: 0.8, roughness: 0.35 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6.2, 10), brass);
    pole.position.set(x, FLOOR + 3.1, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.12, 28), brass);
    base.position.set(x, FLOOR + 0.06, z);
    const fabric = new THREE.MeshStandardMaterial({ color: '#e8cf9a', emissive: '#ffb860', emissiveIntensity: 0.9, roughness: 1, side: THREE.DoubleSide });
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.1, 1.3, 32, 1, true), fabric);
    sh.position.set(x, FLOOR + 6.4, z);
    g.add(pole, base, sh);
    const fl = new THREE.PointLight('#ffc070', 30, 14, 1.8);
    fl.position.set(x, FLOOR + 6.2, z);
    g.add(fl);
  }
  // свет со двора (фонари, небо): холодный, через окно на пол; стена с проёмом даёт ему тень — светит только в окно
  {
    const moon = new THREE.SpotLight('#9fb6ff', 60, 30, 0.5, 0.9, 1.4);
    moon.castShadow = true;
    moon.shadow.mapSize.set(512, 512);
    moon.shadow.radius = 6;
    moon.position.set(-RX - 6, 6, -3);
    moon.target.position.set(-RX + 6, FLOOR, -1);
    g.add(moon, moon.target);
  }
  return { group: g, lamp, shade };
}

/** Стул (фотоскан — кожаный стул). Сиденье смотрит к столу (−z стула), спинка — от стола (+z). */
export function makeChair(): THREE.Group {
  const g = new THREE.Group();
  // модель смотрит сиденьем к +z — разворачиваем
  placeModel(g, 'dining_chair_02', { x: 0, z: 0.1, ry: Math.PI, h: 4.0, y: FLOOR });
  return g;
}
