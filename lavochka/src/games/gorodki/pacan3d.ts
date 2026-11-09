/* Городки — пацаны «дворового спорта» (класс Toon и загрузчик — общие, core/dvorsport/toon.ts): стилизованный пацан (KayKit Adventurers «Ranger», CC0, перекрашен в олимпийку
 * бригады — studio/blender/dvor_pacan.py) с готовыми анимациями KayKit (CC0) вместо поз кодом.
 * По умолчанию (решение 2026-11-09: «этот вариант значительно лучше»); ?pacan=0 — назад к людям MakeHuman (запоминается).
 * Модели бригад — public/gorodki/pacan/<бригада>.glb без анимаций, клипы — общий anims.glb (по именам костей). Клипы: idle, hold2h, throw, cheer, sit, wave …
 * Бросок — клип «throw» (из-за правого плеча вперёд: по замеру кисть в самой быстрой точке идёт вперёд, +Z модели),
 * поэтому бросающий стоит почти лицом к городу. Время клипа идёт за фазой броска игры: выпуск биты (фаза RELEASE)
 * совмещён с самой быстрой точкой (ищется по клипу). Горизонтальный взмах «swing1h» не годится — он наотмашь, слева
 * направо. Бита — в кости handslot.r (ось Y кости — вдоль биты). */
export { Toon, TOON_BASE, TOON_V } from '../../core/dvorsport/toon';


/** Пацаны — по умолчанию; ?pacan=0 — прежние люди (запоминается в браузере: адрес партии меняется на ?igra), ?pacan — обратно. */
export const TOON = ((): boolean => {
  if (typeof location === 'undefined') return true;
  const v = new URLSearchParams(location.search).get('pacan');
  try {
    if (v != null) localStorage.setItem('gk-pacan', v === '0' ? '0' : '1');
    return localStorage.getItem('gk-pacan') !== '0';
  } catch {
    return v !== '0';
  }
})();
/** Клип броска и стойка с битой у черты (разработка: __toon({ swing, ready, turn, sit })). */
export const TOON_CFG = { swing: 'throw', ready: 'holding', turn: 0.3, sit: 0.12, readyDir: [-0.55, 0.8, 0.25] as [number, number, number] };
if (import.meta.env.DEV) (globalThis as unknown as { __toon: (c: Partial<typeof TOON_CFG>) => void }).__toon = (c) => Object.assign(TOON_CFG, c);

/** Камера прицела для пацанов (scene.ts camTo('aim')): сдвиг вправо, назад от черты, высота, добавка к углу обзора (°). */
export const TOON_CAM = { dx: 1.25, back: 5.8, h: 1.85, fov: 5, lookX: 0, lookZ: 0.2 };
if (import.meta.env.DEV) (globalThis as unknown as { __toonCam: (c: Partial<typeof TOON_CAM>) => void }).__toonCam = (c) => Object.assign(TOON_CAM, c);

export type ToonRole = 'throw' | 'sit' | 'stand';
