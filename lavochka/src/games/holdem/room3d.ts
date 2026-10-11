/* Холдем 3D — комната 90-х вокруг стола: паркет «ёлочкой», обои, ковёр на стене, окно с ночным двором и тюлем,
 * сервант с хрусталём, телевизор на тумбе, абажур с бахромой над столом, стулья. 1 единица ≈ 25 см, стол — y = 0, пол — y = FLOOR. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { nightTex, tulleTex, wallpaperTex } from './tex3d';
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
  // потолок
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), std({ ...pbr('plaster', [W / 8, D / 8]), color: '#f2ead8', roughness: 1 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(0, CEIL, midZ);
  g.add(ceil);
  // стены
  const paper = (w: number) => std({ ...pbr('plaster', [w / 7, H / 7], false), map: wallpaperTex([w / 4, H / 4]), roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) });
  const wall = (w: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, H), paper(w));
    m.position.set(x, FLOOR + H / 2, z);
    m.rotation.y = ry;
    m.receiveShadow = true;
    g.add(m);
    // плинтус
    const sk = box(w, 0.45, 0.12, std({ ...pbr('walnut', [6, 0.2]), roughness: 0.7 }), 0, 0, 0, false);
    sk.position.set(x + Math.sin(ry) * 0.06, FLOOR + 0.22, z + Math.cos(ry) * 0.06);
    sk.rotation.y = ry;
    g.add(sk);
  };
  wall(W, 0, RZ_FAR, 0);
  wall(W, 0, RZ_NEAR, Math.PI);
  wall(D, -RX, midZ, Math.PI / 2);
  wall(D, RX, midZ, -Math.PI / 2);

  // ковёр на дальней стене
  // настоящий ковёр (фото «Товуз-Казах», Кавказ, XIX век — общественное достояние), 2,17 × 1,34 м; висит чуть волной
  const carpetGeo = new THREE.PlaneGeometry(8.7, 5.4, 40, 4);
  const cp = carpetGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < cp.count; i++) cp.setZ(i, 0.05 + Math.sin(cp.getX(i) * 1.3) * 0.03 + (cp.getY(i) > 2.6 ? -0.02 : 0));
  carpetGeo.computeVertexNormals();
  const carpetMap = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}tex/holdem/carpet_col.webp`, () => onLoad());
  carpetMap.colorSpace = THREE.SRGBColorSpace;
  carpetMap.anisotropy = 8;
  const carpet = new THREE.Mesh(carpetGeo, std({ map: carpetMap, normalMap: normalOnly('velvet', [6, 4]), normalScale: new THREE.Vector2(0.7, 0.7), roughness: 1 }));
  carpet.position.set(0, 3.4, RZ_FAR + 0.03);
  carpet.receiveShadow = true;
  g.add(carpet);

  // окно на левой стене: ночной двор, рама, подоконник, тюль и шторы
  {
    const wz = -3;
    const wy = 2.6;
    const night = new THREE.Mesh(new THREE.PlaneGeometry(6, 6.4), new THREE.MeshBasicMaterial({ map: nightTex() }));
    night.position.set(-RX + 0.02, wy, wz);
    night.rotation.y = Math.PI / 2;
    g.add(night);
    const frameM = std({ color: '#f1ede2', roughness: 0.5 });
    const fr = (w: number, h: number, y: number, z: number) => {
      const b = box(0.2, h, w, frameM, -RX + 0.1, y, z, false);
      g.add(b);
    };
    fr(6.4, 0.3, wy + 3.2, wz);
    fr(6.4, 0.3, wy - 3.2, wz);
    fr(0.3, 6.4, wy, wz - 3);
    fr(0.3, 6.4, wy, wz + 3);
    fr(0.18, 6.4, wy, wz);
    fr(6.0, 0.18, wy + 1.3, wz);
    g.add(box(0.9, 0.18, 7.2, std({ color: '#f4f0e6', roughness: 0.4 }), -RX + 0.45, wy - 3.35, wz, true));
    // батарея под окном
    const rad = std({ color: '#e9e4d6', roughness: 0.5, metalness: 0.2 });
    for (let i = 0; i < 12; i++) g.add(box(0.35, 2.2, 0.28, rad, -RX + 0.45, FLOOR + 1.6, wz - 2.2 + i * 0.4, false));
    // тюль
    const tulle = new THREE.Mesh(
      new THREE.PlaneGeometry(7.4, 7.4, 30, 1),
      new THREE.MeshStandardMaterial({ map: tulleTex(), transparent: true, opacity: 0.85, side: THREE.DoubleSide, roughness: 1, depthWrite: false })
    );
    const tp = tulle.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < tp.count; i++) tp.setZ(i, Math.sin(tp.getX(i) * 4) * 0.12);
    tulle.geometry.computeVertexNormals();
    tulle.position.set(-RX + 0.55, wy + 0.2, wz);
    tulle.rotation.y = Math.PI / 2;
    g.add(tulle);
    // тяжёлые шторы по бокам
    const curtainM = std({ ...pbr('velvet', [1.2, 5]), color: '#c0504a', roughness: 1, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 10.4, 16, 1), curtainM);
      const cp = c.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < cp.count; i++) cp.setZ(i, Math.sin(cp.getX(i) * 7) * 0.18);
      c.geometry.computeVertexNormals();
      c.position.set(-RX + 0.7, FLOOR + 5.6, wz + side * 4.4);
      c.rotation.y = Math.PI / 2;
      c.castShadow = false;
      g.add(c);
    }
    g.add(box(0.12, 0.12, 12, std({ color: '#8a6a3a', metalness: 0.6, roughness: 0.4 }), -RX + 0.7, FLOOR + 10.8, wz, false));
  }

  // мебель — фотосканы Poly Haven (CC0): сервант, телевизор на тумбе, кресло-качалка, бутылки
  placeModel(g, 'vintage_cabinet_01', { x: RX - 1.6, z: -3, ry: -Math.PI / 2, h: 8.2 });
  placeModel(g, 'vintage_wooden_drawer_01', { x: -9.3, z: -9.6, ry: 0.55, h: 3.2 }, (stand) => {
    const top = new THREE.Box3().setFromObject(stand).max.y;
    placeModel(g, 'television_02', { x: -9.3, z: -9.5, ry: 0.55, h: 2.9, y: top });
  });
  placeModel(g, 'Rockingchair_01', { x: 9.0, z: 9.5, ry: -2.4, h: 4.6 });
  placeModel(g, 'wine_bottles_01', { x: RX - 1.9, z: -0.6, ry: -Math.PI / 2, h: 1.35, y: FLOOR + 3.62 });
  {
    // свечение экрана телевизора
    const glow = new THREE.PointLight('#7a9ae0', 2.5, 7, 2);
    glow.position.set(-8.0, FLOOR + 4.3, -8.0);
    g.add(glow);
  }

  // абажур с бахромой над столом
  const shade = new THREE.Group();
  {
    const prof = [
      [0.6, 1.1],
      [1.2, 0.95],
      [2.2, 0.35],
      [2.6, 0],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    const silk = new THREE.MeshStandardMaterial({
      color: '#e0782a',
      emissive: '#ff8a30',
      emissiveIntensity: 0.55,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const cone = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), silk);
    shade.add(cone);
    // бахрома — короткие нити по кругу
    const fringeM = std({ color: '#d0681e', emissive: '#c0581a', emissiveIntensity: 0.3, roughness: 1 });
    const fr = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 3), fringeM, 140);
    const mm = new THREE.Matrix4();
    for (let i = 0; i < 140; i++) {
      const a = (i / 140) * Math.PI * 2;
      mm.makeTranslation(Math.cos(a) * 2.58, -0.3, Math.sin(a) * 2.58);
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
  const lamp = new THREE.SpotLight('#ffd9a0', 300, 28, 0.95, 0.6, 1.5);
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
  // свет абажура вверх — на потолок
  const up = new THREE.PointLight('#ffb070', 14, 9, 2);
  up.position.set(0, 7.0, 0);
  g.add(up);
  return { group: g, lamp, shade };
}

/** Стул (фотоскан — кожаный стул). Сиденье смотрит к столу (−z стула), спинка — от стола (+z). */
export function makeChair(): THREE.Group {
  const g = new THREE.Group();
  // модель смотрит сиденьем к +z — разворачиваем
  placeModel(g, 'dining_chair_02', { x: 0, z: 0.1, ry: Math.PI, h: 4.0, y: FLOOR });
  return g;
}
