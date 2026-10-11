/* Холдем 3D — соперники-видео, как в Apple poker: короткие ролики живых людей на хромакее (public/video/holdem/<перс>/<реакция>.mp4,
 * сняты ИИ по docs/holdem-video.md, упакованы tools/videogen/pack.mjs). Каждый ролик начинается и кончается одной позой, поэтому
 * «ждёт» крутится по кругу, а реакция (колл, пас, выигрыш…) играет один раз и плавно (треть секунды) переходит обратно.
 * Человек — изогнутая плоскость: туловище стоит за кожаным валиком (валик закрывает низ), предплечья и кисти «перекинуты»
 * через валик на сукно — как в Apple poker. Фон и стол из ролика вырезает шейдер.
 * Ролики грузятся в память (blob) — сначала «ждёт» у всех, потом остальные; не загрузилась реакция — человек просто ждёт дальше. */
import * as THREE from 'three';
import { DEALER, type DealerAct, type Gesture, type People, type PersonPlace } from './people3d';

const BASE = `${import.meta.env.BASE_URL}video/holdem/`;
/** Кто на каком месте (по порядку SEATS). */
const CHARS = ['vovka', 'lenka', 'seryoga', 'tanka', 'dimon', 'kolyan', 'svetka', 'zheka', 'mihalych'];
/** Где в кадре край стола (доля высоты сверху) — по нему ролик стыкуется с нашим бортом. */
const EDGE: Record<string, number> = { vovka: 0.78, lenka: 0.8, seryoga: 0.81, tanka: 0.81, dimon: 0.8, kolyan: 0.77, svetka: 0.83, zheka: 0.87, mihalych: 0.81, dealer: 0.81 };
/** Порядок загрузки: сначала то, что нужно в первой же раздаче. */
const CLIPS = ['idle', 'look', 'think', 'call', 'check', 'fold', 'raise', 'win', 'lose', 'allin', 'bluff'];
/** Крупье Марина (набор «Крупье» в tools/videogen). */
const DEALER_CLIPS: DealerAct[] = ['idle', 'hello', 'deal', 'flop', 'card', 'point_front', 'push_front', 'push_left', 'push_right', 'collect', 'gather', 'point_left', 'point_right', 'allin'];
type Clip = string;
const clipsOf = (who: string): Clip[] => (who === 'dealer' ? DEALER_CLIPS : CLIPS);
const FROM: Record<Gesture, Clip> = { bet: 'call', call: 'call', raise: 'raise', check: 'check', fold: 'fold', allin: 'allin', win: 'win', lose: 'lose', think: 'think', look: 'look' };

/** Высота кадра в единицах сцены (1 ед. ≈ 25 см): от макушки до края стола ≈ 75 см. */
const SIZE = 4.6;
/** Ширина кадра к высоте: при упаковке по бокам срезано по 3%. */
const ASPECT = 0.94;
/** Где стоит кадр: от центра стула до внутреннего плеча валика (стул — в 1,25 от края стола, середина валика — ещё 0,39). */
const TO_RAIL = 1.25 + 0.39 + 0.3;
/** Высота линии стола в кадре — вровень с верхом валика: туловище будто за ним, валик виден под грудью между рук. */
const BEND_Y = 0.46;
/** Низ кадра — крутым скатом перед валиком к камере (камера низко — плоское на сукне сплющилось бы и «утопило» пальцы):
 * на скат целиком ложится полоса кистей (HANDS доли кадра под краем стола, до кончиков пальцев), ниже — пустой стол
 * ролика, он уходит по сукну. */
const HANDS = 0.16;
const SLOPE = (70 * Math.PI) / 180;
const SLOPE_Y = 0.05;
/** Столбцов сетки кадра (для изгиба по бортику). */
const COLS = 12;
/** Переход между роликами, с. */
const FADE = 0.3;

// ---------------------------------------------------------------- загрузка

const blobs = new Map<string, Promise<string | null>>();
const queue: { url: string; prio: number; done: (u: string | null) => void }[] = [];
let active = 0;
let scheduled = false;

function pump() {
  while (active < 4 && queue.length) {
    queue.sort((a, b) => a.prio - b.prio);
    const job = queue.shift()!;
    active++;
    fetch(job.url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`${r.status}`))))
      .then((b) => job.done(URL.createObjectURL(b)))
      .catch((e) => {
        console.warn('холдем: ролик', job.url, e);
        job.done(null);
      })
      .finally(() => {
        active--;
        pump();
      });
  }
}

/** Ролик в память; повторный запрос — тот же. */
function clip(who: string, c: Clip): Promise<string | null> {
  const url = `${BASE}${who}/${c}.mp4`;
  let p = blobs.get(url);
  if (!p) {
    p = new Promise((done) => queue.push({ url, prio: clipsOf(who).indexOf(c), done }));
    blobs.set(url, p);
    // все, кто сел за стол, успеют встать в очередь — тогда первыми пойдут «ждёт» у всех
    if (!scheduled) {
      scheduled = true;
      setTimeout(() => {
        scheduled = false;
        pump();
      }, 0);
    }
  }
  return p;
}
const ready = new Map<string, string>();
function want(who: string, c: Clip) {
  void clip(who, c).then((u) => u && ready.set(`${who}/${c}`, u));
}

// ---------------------------------------------------------------- шейдер

const VERT = /* glsl */ `
uniform float tilt;
uniform float curve;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  // верх кадра откидывается назад, когда камера смотрит сверху
  if (p.y > 0.0) { float c = cos(tilt), s = sin(tilt); p = vec3(p.x, p.y * c, -p.y * s); }
  // бортик — эллипс: края кадра выгибаем к середине стола по его кривизне, чтобы валик не срезал локти
  p.z += curve * p.x * p.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */ `
uniform sampler2D mapA;
uniform sampler2D mapB;
uniform float mixK;
uniform float bright;
uniform float fade;
varying vec2 vUv;
vec4 key(vec3 c) {
  float m = max(c.r, c.b);
  // зелёный перевешивает — фон (и тени на нём: считаем относительно яркости)
  float k = (c.g - m) / (c.g + 0.1);
  float a = 1.0 - smoothstep(0.12, 0.26, k);
  // зелёная кайма и рефлексы: где зелень заметна (края волос) — гасим до среднего красного и синего, иначе — слегка
  c.g = min(c.g, m + 0.01);
  c.g = mix(c.g, min(c.g, (c.r + c.b) * 0.5 + 0.02), smoothstep(-0.02, 0.12, k));
  return vec4(c, a);
}
void main() {
  vec4 a = key(texture2D(mapA, vUv).rgb);
  vec4 b = key(texture2D(mapB, vUv).rgb);
  float al = mix(a.a, b.a, mixK);
  vec3 col = mix(a.rgb * a.a, b.rgb * b.a, mixK) / max(al, 1e-3);
  // края кадра — мягко в ноль
  al *= smoothstep(0.0, 0.015, vUv.x) * smoothstep(1.0, 0.985, vUv.x) * smoothstep(1.0, 0.9, vUv.y);
  al *= fade;
  if (al < 0.03) discard;
  gl_FragColor = vec4(col * bright, al);
}`;

/** Кадр: верх стоит (y вверх), низ перекинут через валик (вперёд по +z). Начало координат — на линии стола в кадре. */
function frameGeometry(edge: number): THREE.BufferGeometry {
  const ve = 1 - edge;
  // низ: скат с кистями (чуть ужат по высоте, если длиннее ската), дальше — по сукну
  const vh = Math.max(0.001, ve - HANDS);
  const sz = (BEND_Y - SLOPE_Y) / Math.tan(SLOPE);
  const low = [
    { v: 0, y: SLOPE_Y - BEND_Y, z: sz + vh * SIZE * 0.6 },
    { v: vh, y: SLOPE_Y - BEND_Y, z: sz },
    { v: ve, y: 0, z: 0 },
  ];
  const rows = [...low, ...[ve + 0.02, 0.5, 1].map((v) => ({ v, y: (v - ve) * SIZE, z: 0 }))];
  const pos: number[] = [];
  const uv: number[] = [];
  for (const r of rows)
    for (let i = 0; i <= COLS; i++) {
      const u = i / COLS;
      pos.push((u - 0.5) * SIZE * ASPECT, r.y, r.z);
      uv.push(u, r.v);
    }
  const idx: number[] = [];
  const W = COLS + 1;
  for (let r = 0; r < rows.length - 1; r++)
    for (let i = 0; i < COLS; i++) {
      const a = r * W + i;
      idx.push(a, a + 1, a + W, a + 1, a + W + 1, a + W);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// ---------------------------------------------------------------- человек

interface Deck {
  el: HTMLVideoElement;
  tex: THREE.VideoTexture;
  clip: Clip | null;
}

interface Person {
  seat: number;
  who: string;
  edge: number;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  decks: [Deck, Deck];
  /** Какая дека на экране (0/1); вторая — та, на которую переходим. */
  cur: number;
  /** Переход: 0 → 1, null — нет. */
  fading: number | null;
  /** Что играет сейчас и что хотим. */
  playing: Clip | null;
  /** Разовая реакция: играет, пока не кончится. */
  oneShot: boolean;
  pending: { clip: Clip; at: number } | null;
  /** Виден в кадре «один на один» (0..1, плавно). */
  solo: number;
  /** Ролики заказаны (только когда человека видно: себя не грузим). */
  asked: boolean;
  place: PersonPlace;
  shown: number;
}

function makeDeck(): Deck {
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.setAttribute('playsinline', '');
  el.setAttribute('muted', '');
  el.preload = 'auto';
  el.crossOrigin = 'anonymous';
  const tex = new THREE.VideoTexture(el);
  tex.colorSpace = THREE.NoColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { el, tex, clip: null };
}

const _v = new THREE.Vector3();

class VideoPeople implements People {
  kind = 'video' as const;
  group = new THREE.Group();
  private list = new Map<number, Person>();
  private focus: number | null = null;
  private time = 0;
  private cam = new THREE.Vector3(0, 10, 12);
  private solo: number | null = null;

  sync(list: PersonPlace[]) {
    const seen = new Set<number>();
    for (const pl of list) {
      seen.add(pl.seat);
      let p = this.list.get(pl.seat);
      if (!p) p = this.spawn(pl);
      p.place = pl;
      this.placeMesh(p);
    }
    for (const [k, p] of [...this.list])
      if (!seen.has(k)) {
        this.drop(p);
        this.list.delete(k);
      }
  }

  private spawn(pl: PersonPlace): Person {
    const who = pl.seat === DEALER ? 'dealer' : CHARS[pl.seat % CHARS.length];
    const edge = EDGE[who] ?? 0.8;
    const decks: [Deck, Deck] = [makeDeck(), makeDeck()];
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        mapA: { value: decks[0].tex },
        mapB: { value: decks[1].tex },
        mixK: { value: 0 },
        bright: { value: 1 },
        fade: { value: 0 },
        tilt: { value: 0 },
        curve: { value: pl.curve ?? 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      // руки лежат на валике вплотную — чуть ближе к камере, чтобы валик их не резал
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(frameGeometry(edge), mat);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    const p: Person = { seat: pl.seat, who, edge, mesh, mat, decks, cur: 0, fading: null, playing: null, oneShot: false, pending: null, solo: 1, asked: false, place: pl, shown: 0 };
    this.list.set(pl.seat, p);
    return p;
  }

  private drop(p: Person) {
    this.group.remove(p.mesh);
    p.mesh.geometry.dispose();
    p.mat.dispose();
    for (const d of p.decks) {
      d.el.pause();
      d.el.removeAttribute('src');
      d.el.load();
      d.tex.dispose();
    }
  }

  /** Край стола перед стулом — там стоит кадр; лицом — к камере. */
  private placeMesh(p: Person) {
    const pl = p.place;
    const fwd = _v.set(Math.sin(pl.face), 0, Math.cos(pl.face));
    p.mesh.position.set(pl.pos.x, BEND_Y, pl.pos.z).addScaledVector(fwd, TO_RAIL);
    p.mesh.visible = !pl.hidden;
    this.aim(p);
  }

  private aim(p: Person) {
    const m = p.mesh;
    const dx = this.cam.x - m.position.x;
    const dz = this.cam.z - m.position.z;
    // вдоль бортика (лицом к середине стола), к камере — лишь наполовину: иначе кадр расходится с изгибом бортика
    const face = p.place.face;
    let d = Math.atan2(dx, dz) - face;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    m.rotation.y = face + THREE.MathUtils.clamp(d * 0.5, -0.5, 0.5);
    p.mat.uniforms.curve.value = (p.place.curve ?? 0) + 0.02;
    // камера сверху — верх кадра откидываем назад, чтобы человек не сплющивался
    const pitch = Math.atan2(this.cam.y - m.position.y - SIZE * 0.5, Math.hypot(dx, dz));
    p.mat.uniforms.tilt.value = THREE.MathUtils.clamp((pitch - 0.45) * 0.7, 0, 0.55);
  }

  lookAt(_target: THREE.Vector3, focus: number | null) {
    this.focus = focus;
  }

  gesture(seat: number, kind: Gesture, delay = 0) {
    const p = this.list.get(seat);
    if (!p) return;
    const c = FROM[kind];
    if (delay > 0) p.pending = { clip: c, at: this.time + delay };
    else this.play(p, c, true);
  }

  ready(): number {
    const vis = [...this.list.values()].filter((p) => !p.place.hidden);
    if (!vis.length) return 0;
    const live = (p: Person) => p.decks.some((d) => d.clip && d.el.readyState >= 2);
    return vis.reduce((a, p) => a + (live(p) ? 1 : ready.has(`${p.who}/idle`) ? 0.6 : 0.1), 0) / vis.length;
  }

  only(seat: number | null) {
    this.solo = seat;
  }

  dealer(act: DealerAct) {
    const p = this.list.get(DEALER);
    if (p) this.play(p, act, act !== 'idle');
  }

  head(seat: number): THREE.Vector3 | null {
    const p = this.list.get(seat);
    if (!p || !p.mesh.visible) return null;
    return p.mesh.position.clone().setY(p.mesh.position.y + SIZE * (p.edge - 0.3) * Math.cos(p.mat.uniforms.tilt.value));
  }

  /** Включить ролик: на свободной деке, с переходом. Не загружен — пропускаем. */
  private play(p: Person, c: Clip, oneShot: boolean): boolean {
    const url = ready.get(`${p.who}/${c}`);
    if (!url) return false;
    // идёт переход — досрочно его завершаем (к той деке, которой уже больше на экране)
    if (p.fading != null) {
      if (p.fading >= 0.5) {
        p.decks[p.cur].el.pause();
        p.cur = 1 - p.cur;
      }
      p.fading = null;
      p.mat.uniforms.mixK.value = p.cur;
    }
    const next = p.decks[1 - p.cur];
    p.playing = c;
    p.oneShot = oneShot;
    p.fading = null;
    next.clip = c;
    next.el.loop = !oneShot;
    if (next.el.src !== url) next.el.src = url;
    next.el.currentTime = 0;
    const go = () => {
      if (next.clip !== c || p.playing !== c) return;
      if (p.decks[p.cur].clip) p.fading = 0;
      else {
        // первый ролик — без перехода (на пустой деке ничего нет)
        p.cur = 1 - p.cur;
        p.mat.uniforms.mixK.value = p.cur;
      }
    };
    next.el
      .play()
      .then(() => {
        if (next.el.readyState >= 2) go();
        else next.el.addEventListener('loadeddata', go, { once: true });
      })
      .catch(() => {});
    return true;
  }

  /** Что играть, когда разовая реакция кончилась. */
  private base(p: Person): Clip {
    if (this.focus === p.seat && !p.place.out) return Math.random() < 0.3 ? 'bluff' : 'think';
    return 'idle';
  }

  update(dt: number, cam?: THREE.Vector3): boolean {
    this.time += dt;
    if (cam) this.cam.copy(cam);
    let any = false;
    for (const p of this.list.values()) {
      const vis = !p.place.hidden;
      p.mesh.visible = vis;
      const shownEl = p.decks[p.cur].el;
      if (!vis) {
        // спрятан (это мы сами) — стоп; покажется снова — начнёт с «ждёт»
        for (const d of p.decks) {
          if (!d.el.paused) d.el.pause();
          d.clip = null;
        }
        p.playing = null;
        p.oneShot = false;
        p.fading = null;
        p.pending = null;
        p.shown = 0;
        continue;
      }
      any = true;
      if (!p.asked) {
        p.asked = true;
        for (const c of clipsOf(p.who)) want(p.who, c);
      }
      this.aim(p);
      // первый запуск — как только загрузится «ждёт»
      if (!p.playing) this.play(p, 'idle', false);
      if (p.pending && this.time >= p.pending.at) {
        const c = p.pending.clip;
        p.pending = null;
        this.play(p, c, true);
      }
      // переход между деками
      if (p.fading != null) {
        p.fading = Math.min(1, p.fading + dt / FADE);
        const k = p.fading * p.fading * (3 - 2 * p.fading);
        p.mat.uniforms.mixK.value = p.cur === 0 ? k : 1 - k;
        if (p.fading >= 1) {
          p.fading = null;
          shownEl.pause();
          p.cur = 1 - p.cur;
        }
      } else {
        // ход за столом сменился — «думает» / обратно «ждёт»
        const thinking = this.focus === p.seat && !p.place.out;
        const looping = !p.oneShot;
        if (looping && thinking !== (p.playing === 'think' || p.playing === 'bluff')) this.play(p, thinking ? 'think' : 'idle', thinking);
        // разовая реакция доиграла — к основному ролику (переход начинаем чуть заранее)
        const el = p.decks[p.cur].el;
        if (p.oneShot && p.playing === p.decks[p.cur].clip && el.duration && el.currentTime > el.duration - FADE - 0.05) {
          const b = this.base(p);
          if (!this.play(p, b, b !== 'idle')) this.play(p, 'idle', false);
        }
      }
      // проявиться, когда пошёл первый ролик; выбывший — в полутени
      const live = p.decks.some((d) => d.el.readyState >= 2 && !d.el.paused);
      p.shown = Math.min(1, p.shown + (live ? dt * 2 : 0));
      // слишком близко к камере (она снимает кого-то через стол) — растворяется, чтобы не заслонять
      const near = THREE.MathUtils.smoothstep(this.cam.distanceTo(p.mesh.position), 2.6, 3.8);
      const solo = this.solo == null || this.solo === p.seat ? 1 : 0;
      p.solo += (solo - p.solo) * Math.min(1, dt * 5);
      p.mat.uniforms.fade.value = p.shown * near * p.solo;
      const dim = p.place.out ? 0.45 : 1;
      const br = p.mat.uniforms.bright as { value: number };
      br.value += (dim - br.value) * Math.min(1, dt * 3);
    }
    return any;
  }

  dispose() {
    for (const p of this.list.values()) this.drop(p);
    this.list.clear();
  }
}

/**
 * Видео-люди, если браузер их потянет: пробный ролик должен заиграть (в режиме энергосбережения iOS видео само не играет).
 * null — остаёмся на 3D-людях.
 */
export async function loadVideoPeople(): Promise<People | null> {
  // пробуем на крупье — её «ждёт» нужно в любой партии
  const url = await clip('dealer', 'idle');
  if (!url) return null;
  ready.set('dealer/idle', url);
  const el = document.createElement('video');
  el.muted = true;
  el.playsInline = true;
  el.setAttribute('playsinline', '');
  el.src = url;
  try {
    await Promise.race([el.play(), new Promise((_, no) => setTimeout(() => no(new Error('таймаут')), 4000))]);
  } catch (e) {
    console.warn('холдем: видео не играет — люди будут 3D', e);
    return null;
  } finally {
    el.pause();
    el.removeAttribute('src');
    el.load();
  }
  return new VideoPeople();
}
