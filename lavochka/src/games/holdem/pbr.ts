/* Холдем 3D — фотографические PBR-текстуры (Poly Haven, CC0) из public/tex/holdem: цвет, нормали, шероховатость.
 * Грузятся лениво; одна картинка на всех, повтор — у каждого материала свой (клон текстуры). */
import * as THREE from 'three';

const BASE = `${import.meta.env.BASE_URL}tex/holdem/`;
const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
let onLoad: () => void = () => {};

/** Кого дёрнуть, когда догрузилась картинка (перерисовать кадр). */
export function onTextureLoad(f: () => void) {
  onLoad = f;
}

function base(file: string, color: boolean): THREE.Texture {
  let t = cache.get(file);
  if (!t) {
    t = loader.load(BASE + file, (tx) => {
      // клоны получают картинку вместе с оригиналом
      for (const c of clones.get(file) ?? []) {
        c.image = tx.image;
        c.needsUpdate = true;
      }
      onLoad();
    });
    if (color) t.colorSpace = THREE.SRGBColorSpace;
    cache.set(file, t);
  }
  return t;
}

const clones = new Map<string, THREE.Texture[]>();

function tex(file: string, color: boolean, repeat: [number, number], aniso: number): THREE.Texture {
  const b = base(file, color);
  const t = b.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = aniso;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (b.image) t.needsUpdate = true;
  const list = clones.get(file) ?? [];
  list.push(t);
  clones.set(file, list);
  return t;
}

export interface PbrSet {
  map?: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/** Набор карт для материала: name_col / name_nor / name_rough.webp. withColor=false — свой цвет (рисованная карта), только рельеф. */
export function pbr(name: string, repeat: [number, number], withColor = true, aniso = 8): PbrSet {
  return {
    map: withColor ? tex(`${name}_col.webp`, true, repeat, aniso) : undefined,
    normalMap: tex(`${name}_nor.webp`, false, repeat, aniso),
    roughnessMap: tex(`${name}_rough.webp`, false, repeat, aniso),
  };
}

/** Только карта нормалей (ткань сукна). */
export function normalOnly(name: string, repeat: [number, number]): THREE.Texture {
  return tex(`${name}_nor.webp`, false, repeat, 8);
}

export const HDRI = `${BASE}room_1k.hdr`;
