/* Дартс — экран: стена бара, шкафчик со створками, мишень. Бросок жестом: навёл прицел (рука чуть дрожит) — смахнул вверх
 * (или «рогаткой»: потянул вниз и отпустил; с клавиатуры — пробел и шкала силы). Полёт переигрывается по той же физике, что у
 * комнаты; дротики торчат до конца подхода, отскочившие падают. Табло мелом на створках. Звуки — синтез, музыка бара. */
import { audioOut, click, Sound, tone } from '../../core/audio';
import { segRow } from '../../core/rtview';
import { store } from '../../core/settings';
import { esc, h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { checkout, target } from './ai';
import { art, loadArt, META } from './art';
import { aimFor, label, R, type Hit } from './board';
import { SEATS } from './def';
import { CRICKET, markSym, modeName, targetName, type Event, type State } from './engine';
import { DART_LEN, flight, OCHE, V0, VMAX, VMIN, type Frame, type Stuck } from './physics';
import './darts.css';
import { padOff, padOn } from '../../core/gamepad';

const PREF_MUSIC = 'darts.music';
const PREF_MODE = 'darts.throw';
const PREF_POW = 'darts.power';
const TRACKS = ['bar', 'jukebox', 'bar2'];

/** Камера — на черте, чуть позади, на высоте центра мишени. */
const ZC = OCHE + 0.25;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Сила по «ошибке» жеста e (0 — как надо): мягко около нуля, круче к краям. */
export function powerOf(e: number): number {
  const x = clamp(e, -1, 1.2);
  return clamp(V0 + 1.0 * Math.sign(x) * Math.abs(x) ** 1.5, VMIN, VMAX);
}

// ---------------------------------------------------------------- звуки (синтез)

function thunk() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  click(t, { freq: 1100, q: 1.4, dur: 0.05, gain: 0.7 });
  tone(t, { freq: 210, to: 95, dur: 0.08, gain: 0.45 });
}
function ping() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  tone(t, { freq: 2600, to: 2300, dur: 0.18, gain: 0.18, type: 'triangle' });
  tone(t, { freq: 3900, to: 3500, dur: 0.12, gain: 0.08, type: 'sine' });
  click(t, { freq: 5200, q: 4, dur: 0.03, gain: 0.5 });
}
function clack() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  click(t, { freq: 3000, q: 3, dur: 0.04, gain: 0.55 });
  tone(t, { freq: 1500, to: 1100, dur: 0.06, gain: 0.15, type: 'square' });
}
function wood() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  tone(t, { freq: 420, to: 260, dur: 0.09, gain: 0.35, type: 'triangle' });
  click(t, { freq: 1700, q: 2, dur: 0.05, gain: 0.5 });
}
function floor() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  for (let k = 0; k < 3; k++) {
    click(t + k * 0.09 + Math.random() * 0.03, { freq: 2600 - k * 400, q: 3, dur: 0.03, gain: 0.3 / (k + 1) });
    tone(t + k * 0.09, { freq: 900 - k * 150, to: 700, dur: 0.04, gain: 0.08 / (k + 1), type: 'square' });
  }
}
function whoosh() {
  const o = audioOut();
  if (!o) return;
  const t = o.ctx.currentTime;
  for (let k = 0; k < 5; k++) click(t + k * 0.03, { freq: 700 + k * 180, q: 0.7, dur: 0.06, gain: 0.05 });
}

interface Faller {
  seat: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  t0: number;
}

interface Pt {
  t: number;
  x: number;
  y: number;
}

export function createView(): GameView<State, Event> {
  let ctx: ViewCtx;
  let root: HTMLElement;
  let wrap: HTMLElement;
  let cv: HTMLCanvasElement;
  let g: CanvasRenderingContext2D;
  let scoreEl: HTMLElement;
  let turnEl: HTMLElement;
  let banner: HTMLElement;
  let tipEl: HTMLElement;
  let meter: HTMLElement;
  let raf = 0;
  let v: State | null = null;
  let act: number | null = null;
  let busy = false;
  /** Прицел (м на мишени) и дрожь руки. */
  let aim = { x: 0, y: 0 };
  let aimT0 = performance.now();
  let holding = false;
  let samples: Pt[] = [];
  let flickFrom: Pt | null = null;
  let pullFrom: { x: number; y: number } | null = null;
  let charge: number | null = null;
  let lastPower: string | null = null;
  // что на мишени
  let shown: Stuck[] = [];
  let fallers: Faller[] = [];
  let fly: { frames: Frame[]; t0: number; seat: number; slow: number; end: number } | null = null;
  let fade = 1;
  let floats: { x: number; y: number; text: string; t0: number; color: string }[] = [];
  let hudCur: number | null = null;
  let turnHits: Hit[] | null = null;
  let bannerT = 0;
  let music: HTMLAudioElement | null = null;
  let track = 0;
  const cleanup: (() => void)[] = [];
  let turnArgs: [number[], number[]] | null = null;
  // раскладка
  let W = 0;
  let H = 0;
  let dpr = 1;
  let bx = 0;
  let by = 0;
  let ppm = 1000;

  const throwMode = () => store.get<string>(PREF_MODE, 'flick');
  const evenPow = () => store.get<string>(PREF_POW, 'real') === 'even';
  const musicOn = () => store.get<string>(PREF_MUSIC, 'on') !== 'off';

  function syncMusic() {
    const want = musicOn() && !ctx.demo && !!v && !v.over && !v.shot && !document.hidden;
    if (!want) {
      music?.pause();
      return;
    }
    if (!music) {
      music = new Audio(`/darts/music/${TRACKS[track % TRACKS.length]}.ogg`);
      music.volume = 0.28;
      music.onended = () => {
        track++;
        music = null;
        syncMusic();
      };
    }
    if (music.paused) void music.play().catch(() => {});
  }

  // ---------------------------------------------------------------- раскладка и проекция

  function layout() {
    const r = wrap.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(200, r.width);
    H = Math.max(200, r.height);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    cv.style.width = `${W}px`;
    cv.style.height = `${H}px`;
    const C = META.cabinet;
    const mPerPx = R.board / C.r;
    // весь шкафчик со створками, если мишень при этом не мельче 36 % экрана; иначе — крупнее, створки уходят за край
    const B = C.box;
    const fit = Math.min((W * 0.98) / ((B.x1 - B.x0) * mPerPx), (H * 0.97) / ((B.y1 - B.y0) * mPerPx));
    const m = Math.min(W, H);
    // шкафчик целиком — если мишень при этом не мельче 26 % экрана, иначе мишень крупно (40 %), створки за краем
    const shot = wrap.classList.contains('shot');
    const whole = fit * R.board >= m * 0.26 || shot;
    ppm = shot ? (m * 0.215) / R.board : whole ? fit : (m * 0.4) / R.board;
    if (whole) {
      // середина видимой части шкафчика — в середину экрана
      const s = ppm * mPerPx;
      bx = W / 2 - ((B.x0 + B.x1) / 2 - C.cx) * s;
      by = H / 2 - ((B.y0 + B.y1) / 2 - C.cy) * s;
    } else {
      bx = W / 2;
      // телефон стоймя: над мишенью — табло, мишень ниже середины
      by = H > W * 1.15 ? Math.max(H * 0.46, Math.min(H * 0.58, H - R.board * ppm - 24)) : H * 0.52;
    }
    wrap.classList.toggle('small', Math.min(W, H) < 440);
    placeHud();
  }

  /** Точка мира → экран; k — во сколько раз ближе мишени (масштаб размеров). */
  function proj(x: number, y: number, z: number) {
    const k = ZC / Math.max(0.15, ZC - z);
    return { X: bx + x * ppm * k, Y: by - y * ppm * k, k };
  }

  function toBoard(px: number, py: number) {
    return { x: (px - bx) / ppm, y: (by - py) / ppm };
  }

  /** Где на экране доски створок (если шкафчик виден целиком). */
  function doorRect(side: 'left' | 'right') {
    const C = META.cabinet;
    const s = (ppm * R.board) / C.r;
    const d = C[side];
    return { x: bx + (d.x - C.cx) * s, y: by + (d.y - C.cy) * s, w: d.w * s, h: d.h * s };
  }

  function placeHud() {
    const L = doorRect('left');
    const Rr = doorRect('right');
    const doors = L.x >= 0 && Rr.x + Rr.w <= W && Rr.w >= 110 && L.y >= 0 && L.y + L.h <= H;
    wrap.classList.toggle('doors', doors);
    const put = (el: HTMLElement, r: { x: number; y: number; w: number; h: number } | null) => {
      if (!r) {
        el.style.left = el.style.top = el.style.width = el.style.height = '';
        return;
      }
      el.style.left = `${r.x}px`;
      el.style.top = `${r.y}px`;
      el.style.width = `${r.w}px`;
      el.style.height = `${r.h}px`;
      el.style.fontSize = `${clamp(r.w / 8.5, 13, 28)}px`;
    };
    put(scoreEl, doors ? L : null);
    put(turnEl, doors ? Rr : null);
  }

  // ---------------------------------------------------------------- рисование

  function drawDart(seat: number, X: number, Y: number, k: number, inc: number, lat: number, bxm: number, alpha = 1, rot: number | null = null) {
    const lenPx = DART_LEN * ppm * 0.52 * k;
    let ang: number;
    if (rot != null) ang = rot;
    else {
      // хвост — к зрителю: на экране вверх и чуть в сторону, откуда прилетел
      const dx = 0.3 + lat * 2.4 + bxm * 1.1;
      const dy = -(0.62 + clamp(inc, -0.3, 0.8) * 1.5);
      ang = Math.atan2(dy, dx);
    }
    g.save();
    g.globalAlpha = alpha;
    g.translate(X, Y);
    g.rotate(ang);
    const im = art(`dart-${seat % 4}`);
    if (im) {
      const D = META.dart[seat % 4];
      const iw = im.naturalWidth;
      const ih = im.naturalHeight;
      const sx = lenPx / (iw * (1 - D.tipU));
      const sy = (DART_LEN * ppm * k * D.aspect) / ih;
      g.drawImage(im, -D.tipU * iw * sx, -D.tipV * ih * sy, iw * sx, ih * sy);
    } else {
      g.strokeStyle = '#ccc';
      g.lineWidth = 2 * k;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(lenPx * 0.7, 0);
      g.stroke();
      g.fillStyle = SEATS[seat % 4].color;
      g.beginPath();
      g.moveTo(lenPx * 0.65, 0);
      g.lineTo(lenPx, -8 * k);
      g.lineTo(lenPx, 8 * k);
      g.fill();
    }
    g.restore();
  }

  function sway(now: number) {
    if (!holding && charge == null) return { x: 0, y: 0 };
    const t = (now - aimT0) / 1000;
    const a = 0.0032 + clamp((t - 2.5) * 0.003, 0, 0.009);
    return {
      x: a * (Math.sin(t * 2.3) * 0.7 + Math.sin(t * 5.1 + 1.3) * 0.3),
      y: a * (Math.sin(t * 1.7 + 0.4) * 0.6 + Math.sin(t * 4.3 + 2.1) * 0.4),
    };
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    if (bannerT && now > bannerT) {
      banner.style.opacity = '0';
      bannerT = 0;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // фон бара — во весь экран, приглушённо
    const bg = art('bg');
    if (bg) {
      const s = Math.max(W / bg.naturalWidth, H / bg.naturalHeight) * 1.04;
      g.globalAlpha = 1;
      g.drawImage(bg, (W - bg.naturalWidth * s) / 2, (H - bg.naturalHeight * s) / 2, bg.naturalWidth * s, bg.naturalHeight * s);
      g.fillStyle = 'rgba(10,6,4,0.35)';
      g.fillRect(0, 0, W, H);
    } else {
      g.fillStyle = '#2a1a10';
      g.fillRect(0, 0, W, H);
    }
    const C = META.cabinet;
    const cs = (ppm * R.board) / C.r;
    const cab = art('cabinet');
    if (cab) g.drawImage(cab, bx - C.cx * cs, by - C.cy * cs, C.w * cs, C.h * cs);
    const bd = art('board');
    const bs = (ppm * R.board) / META.board.r;
    if (bd) g.drawImage(bd, bx - (META.board.size / 2) * bs, by - (META.board.size / 2) * bs, META.board.size * bs, META.board.size * bs);
    else {
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(bx, by, R.board * ppm, 0, Math.PI * 2);
      g.fill();
    }
    // торчащие дротики
    for (const d of shown) {
      const p = proj(d.x, d.y, 0);
      drawDart(d.seat, p.X, p.Y, 1, d.inc, d.lat, d.x, fade);
    }
    // прицел
    if (act != null && !busy && !fly) {
      const sw = sway(now);
      const ax = aim.x + sw.x;
      const ay = aim.y + sw.y;
      const p = proj(ax, ay, 0);
      const rr = clamp(ppm * 0.012, 7, 16);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = 1.6;
      g.shadowColor = 'rgba(0,0,0,0.8)';
      g.shadowBlur = 4;
      g.beginPath();
      g.arc(p.X, p.Y, rr, 0, Math.PI * 2);
      g.moveTo(p.X - rr * 1.7, p.Y);
      g.lineTo(p.X - rr * 0.4, p.Y);
      g.moveTo(p.X + rr * 0.4, p.Y);
      g.lineTo(p.X + rr * 1.7, p.Y);
      g.moveTo(p.X, p.Y - rr * 1.7);
      g.lineTo(p.X, p.Y - rr * 0.4);
      g.moveTo(p.X, p.Y + rr * 0.4);
      g.lineTo(p.X, p.Y + rr * 1.7);
      g.stroke();
      g.shadowBlur = 0;
      g.fillStyle = SEATS[act % 4].light;
      g.beginPath();
      g.arc(p.X, p.Y, 2, 0, Math.PI * 2);
      g.fill();
      // дротик в руке — внизу справа
      const hk = clamp(H / (ppm * 0.6), 1.6, 3.2);
      drawDart(act, W * 0.66, H - 8, hk * 0.9, -0.05, 0.05, 0, holding ? 1 : 0.75, Math.atan2(-(H - 8 - p.Y), -(W * 0.66 - p.X)) + Math.PI);
    }
    // полёт
    if (fly) {
      const t = ((now - fly.t0) / 1000) * fly.slow;
      const fr = fly.frames;
      let k = 0;
      while (k < fr.length - 1 && fr[k + 1].t <= t) k++;
      const f = fr[k];
      const p = proj(f.x, f.y, f.z);
      const inc = Math.atan2(-f.vy, -f.vz);
      const lat = Math.atan2(f.vx, -f.vz);
      drawDart(fly.seat, p.X, p.Y, p.k, inc, lat, f.x);
    }
    // падающие
    const nowS = now / 1000;
    fallers = fallers.filter((d) => {
      const t = (nowS - d.t0) * 0.8;
      const x = d.x + d.vx * t;
      const y = d.y + d.vy * t - 4.9 * t * t;
      if (y < -1.2 || t > 2.5) return false;
      const p = proj(x, y, 0.05);
      drawDart(d.seat, p.X, p.Y, 1.05, 0, 0, x, clamp(1.6 - t, 0, 1), d.rot + d.vr * t);
      return true;
    });
    // всплывающие подписи
    floats = floats.filter((f) => {
      const t = (now - f.t0) / 1000;
      if (t > 1.6) return false;
      const p = proj(f.x, f.y, 0);
      g.globalAlpha = clamp(1.6 - t, 0, 1);
      g.font = `bold ${clamp(ppm * 0.03, 16, 30)}px 'Russo One', 'PT Sans', sans-serif`;
      g.textAlign = 'center';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      const Y = p.Y - 30 - t * 40;
      g.strokeText(f.text, p.X, Y);
      g.fillStyle = f.color;
      g.fillText(f.text, p.X, Y);
      g.globalAlpha = 1;
      return true;
    });
    // шкала силы (клавиатура)
    if (charge != null) {
      const gv = gauge(now);
      meter.style.display = '';
      (meter.firstElementChild as HTMLElement).style.height = `${gv * 100}%`;
    } else if (!holding) meter.style.display = 'none';
  }

  function gauge(now: number) {
    if (charge == null) return 0;
    const t = ((now - charge) / 1000) % 1.6;
    return t < 0.8 ? t / 0.8 : 2 - t / 0.8;
  }

  // ---------------------------------------------------------------- табло

  function say(big: string, small = '', ms = 1400) {
    banner.innerHTML = `<b>${big}</b>${small ? `<span>${small}</span>` : ''}`;
    banner.style.opacity = '1';
    bannerT = performance.now() + ms / Math.max(0.5, ctx.speed());
  }

  function drawHud() {
    if (!v) return;
    const s = v;
    const c = s.cfg;
    const cur = hudCur ?? s.cur;
    const name = (k: number) => `<i style="background:${SEATS[s.seats[k] % 4].color}"></i><span class="nm">${ctx.name(s.seats[k])}</span>`;
    let html = `<div class="dt-mode">${esc(modeName(c))}${c.mode === 'x01' && c.legs > 1 ? ` · лег ${s.leg}` : ''}${c.mode === 'shanghai' ? ` · раунд ${Math.min(s.round, c.rounds)}/${c.rounds}` : ` · раунд ${s.round}`}</div>`;
    if (c.mode === 'cricket') {
      html += `<table class="dt-cr"><tr><th></th>${s.seats.map((seat) => `<th style="color:${SEATS[seat % 4].light}">${esc(String(ctx.name(seat)).replace(/<[^>]+>/g, '').slice(0, 6))}</th>`).join('')}</tr>`;
      CRICKET.forEach((n, k) => {
        const closedAll = s.p.every((p) => p.marks[k] >= 3);
        html += `<tr class="${closedAll ? 'dead' : ''}"><td>${n === 25 ? 'Б' : n}</td>${s.p.map((p) => `<td>${markSym(p.marks[k])}</td>`).join('')}</tr>`;
      });
      html += `<tr class="pts"><td>оч.</td>${s.p.map((p, i) => `<td class="${i === cur ? 'cur' : ''}">${p.score}</td>`).join('')}</tr></table>`;
    } else {
      html += s.p
        .map((p, i) => {
          let big = '';
          let sub = '';
          if (c.mode === 'x01') {
            big = String(p.score);
            sub = `${c.legs > 1 ? `легов ${p.legs} · ` : ''}${!p.opened ? 'не открыт' : p.legDarts && p.score < c.start ? `в среднем ${((((c.start - p.score) / Math.max(1, p.legDarts)) * 3) | 0)}` : ''}`;
          } else if (c.mode === 'clock') {
            big = p.target > 25 ? '✔' : targetName(p.target);
            sub = 'нужен сектор';
          } else if (c.mode === 'shanghai') {
            big = String(p.score);
          } else {
            big = p.out ? '☠' : '♥'.repeat(Math.max(0, p.lives));
            sub = `число ${p.num}${p.killer ? ' · убийца' : ''}`;
          }
          return `<div class="dt-row${i === cur && !s.over ? ' cur' : ''}${p.out ? ' off' : ''}">${name(i)}<b>${big}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
        })
        .join('');
    }
    scoreEl.innerHTML = html;
    // подход: три дротика и подсказка
    const hits = turnHits ?? s.hits;
    const p = s.p[cur];
    const slots = [0, 1, 2].map((k) => `<span class="${k < hits.length ? 'on' : ''}">${k < hits.length ? esc(label(hits[k])) : '·'}</span>`).join('');
    let hint = '';
    if (!s.over) {
      if (c.mode === 'x01') {
        const left = 3 - hits.length;
        const r = p.opened && left > 0 ? checkout(p.score, left, c.dout) : null;
        hint = !p.opened ? 'открыть удвоением' : r ? `закрытие: ${r.hits.map(label).join(' ')}` : `осталось ${p.score}`;
      } else if (c.mode === 'clock') hint = p.target > 25 ? '' : `бить в ${targetName(p.target)}`;
      else if (c.mode === 'shanghai') hint = `бить в ${Math.min(s.round, c.rounds)}`;
      else if (c.mode === 'killer') hint = p.killer ? 'бей удвоения соперников' : `стать убийцей: D${p.num}`;
      else hint = 'закрывать 15…20 и быка';
    }
    const sum = hits.reduce((a, x) => a + x.n * x.m, 0);
    turnEl.innerHTML = `<div class="dt-who">${s.over ? 'Партия окончена' : name(cur)}</div><div class="dt-slots">${slots}</div>
      ${c.mode === 'x01' || c.mode === 'shanghai' ? `<div class="dt-sum">${sum}</div>` : ''}<div class="dt-hint">${esc(hint)}</div>${lastPower ? `<div class="dt-pow">${esc(lastPower)}</div>` : ''}`;
  }

  // ---------------------------------------------------------------- бросок

  function release(vv: number, side: number) {
    if (act == null || busy || !v) return;
    const sw = sway(performance.now());
    const seat = act;
    const t = { x: clamp(aim.x + sw.x, -0.5, 0.5), y: clamp(aim.y + sw.y, -0.5, 0.5), v: evenPow() ? V0 : vv, side: evenPow() ? 0 : side };
    const d = t.v - V0;
    lastPower = Math.abs(d) < 0.25 ? 'сила: как надо' : d < 0 ? `сила: слабовато (${d.toFixed(1)})` : `сила: сильно (+${d.toFixed(1)})`;
    act = null;
    holding = false;
    charge = null;
    meter.style.display = 'none';
    Sound.unlock();
    ctx.act(seat, { type: 'throw', ...t });
  }

  function bindInput() {
    const off = () => (touchScreen() ? 70 : 0);
    const setAim = (px: number, py: number) => {
      const b = toBoard(px, py - off());
      const r = Math.hypot(b.x, b.y);
      const lim = 0.3;
      aim = r > lim ? { x: (b.x / r) * lim, y: (b.y / r) * lim } : b;
    };
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener('pointerdown', (e) => {
      if (act == null || busy) return;
      const q = pos(e);
      cv.setPointerCapture(e.pointerId);
      holding = true;
      aimT0 = performance.now();
      samples = [{ t: performance.now(), ...q }];
      flickFrom = null;
      pullFrom = null;
      if (throwMode() === 'sling') {
        setAim(q.x, q.y);
        pullFrom = q;
      } else setAim(q.x, q.y);
      e.preventDefault();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!holding) return;
      const q = pos(e);
      const now = performance.now();
      samples.push({ t: now, ...q });
      while (samples.length > 2 && now - samples[0].t > 200) samples.shift();
      if (throwMode() === 'sling') {
        const d = (q.y - (pullFrom?.y ?? q.y)) / H;
        meter.style.display = d > 0.02 ? '' : 'none';
        (meter.firstElementChild as HTMLElement).style.height = `${clamp(d / 0.44, 0, 1) * 100}%`;
        return;
      }
      // быстрое движение вверх — взмах: прицел замирает там, где взмах начался
      const a = samples.find((p) => now - p.t <= 60) ?? samples[0];
      const up = (a.y - q.y) / Math.max(1, now - a.t) / (H / 1000);
      if (up > 0.9) {
        flickFrom ??= a;
      } else if (!flickFrom) setAim(q.x, q.y);
    });
    const up = (e: PointerEvent) => {
      if (!holding) return;
      const q = pos(e);
      const now = performance.now();
      holding = false;
      if (throwMode() === 'sling') {
        meter.style.display = 'none';
        const d = (q.y - (pullFrom?.y ?? q.y)) / H;
        if (d > 0.06) release(powerOf((d - 0.22) / 0.22), clamp(((pullFrom!.x - q.x) / W) * 0.12, -0.08, 0.08));
        return;
      }
      if (!flickFrom) return;
      const a = samples.find((p) => now - p.t <= 90) ?? samples[0];
      const dt = Math.max(8, now - a.t);
      const sp = (a.y - q.y) / dt / (H / 1000);
      if (sp < 0.7) {
        flickFrom = null;
        return;
      }
      const dx = q.x - flickFrom.x;
      const dy = Math.max(1, flickFrom.y - q.y);
      release(powerOf((sp - 2.2) / 2.2), clamp(Math.atan2(dx, dy) * 0.06, -0.08, 0.08));
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', () => (holding = false));
    const key = (e: KeyboardEvent) => {
      if (act == null || busy) return;
      const tgt = e.target as HTMLElement;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA')) return;
      const st = e.shiftKey ? 0.01 : 0.003;
      let used = true;
      if (e.code === 'ArrowLeft') aim.x = clamp(aim.x - st, -0.3, 0.3);
      else if (e.code === 'ArrowRight') aim.x = clamp(aim.x + st, -0.3, 0.3);
      else if (e.code === 'ArrowUp') aim.y = clamp(aim.y + st, -0.3, 0.3);
      else if (e.code === 'ArrowDown') aim.y = clamp(aim.y - st, -0.3, 0.3);
      else if (e.code === 'Space' || e.code === 'Enter') {
        if (charge == null && !e.repeat) {
          charge = performance.now();
          aimT0 = performance.now();
        }
      } else used = false;
      if (used) e.preventDefault();
    };
    const keyUp = (e: KeyboardEvent) => {
      if ((e.code === 'Space' || e.code === 'Enter') && charge != null) {
        const gv = gauge(performance.now());
        charge = null;
        release(powerOf((gv - 0.5) * 2), 0);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', key);
    padOn(key, { map: { keys: { a: 'Space', rt: 'Space' } }, hint: 'стик — прицел · <b>Ⓐ</b>/<b>RT</b> держать — замах, отпустить — бросок' });
    window.addEventListener('keyup', keyUp);
    cleanup.push(() => (window.removeEventListener('keydown', key), padOff(key)));
    cleanup.push(() => window.removeEventListener('keyup', keyUp));
  }

  function controls() {
    const box = ctx.controls;
    if (!box || ctx.demo) return;
    box.innerHTML = '';
    box.appendChild(
      segRow(
        'Бросок',
        [
          ['flick', 'взмахом вверх'],
          ['sling', 'рогаткой'],
        ],
        throwMode,
        (x) => {
          store.set(PREF_MODE, x);
          syncTip();
        }
      )
    );
    box.appendChild(
      segRow(
        'Сила',
        [
          ['real', 'по жесту'],
          ['even', 'всегда ровная'],
        ],
        () => (evenPow() ? 'even' : 'real'),
        (x) => store.set(PREF_POW, x)
      )
    );
    box.appendChild(
      segRow(
        '♪ Музыка',
        [
          ['on', 'вкл'],
          ['off', 'выкл'],
        ],
        () => (musicOn() ? 'on' : 'off'),
        (x) => {
          store.set(PREF_MUSIC, x);
          syncMusic();
        }
      )
    );
  }

  function syncTip() {
    if (!tipEl) return;
    tipEl.textContent = throwMode() === 'sling' ? 'Нажмите в цель, потяните вниз и отпустите' : 'Наведите на цель и смахните вверх';
    tipEl.classList.toggle('on', act != null && !busy);
  }

  // ---------------------------------------------------------------- проигрывание

  async function playThrow(ev: Extract<Event, { k: 'throw' }>) {
    const sp = Math.max(0.25, ctx.speed());
    const f = flight(ev.t, true);
    const L = ev.land;
    // слабый бросок, упавший на пол, — показываем, пока не ушёл за низ экрана
    let frames = f.frames;
    if (!f.at) {
      const cut = frames.findIndex((q) => q.y < -0.9);
      if (cut > 0) frames = frames.slice(0, cut);
    }
    const slow = 0.42 * sp;
    const end = frames[frames.length - 1].t;
    whoosh();
    fly = { frames, t0: performance.now(), seat: ev.seat, slow, end };
    await sleep((end / slow) * 1000);
    fly = null;
    const nowS = performance.now() / 1000;
    if (L.res === 'stick' && ev.stuck) {
      thunk();
      shown.push(ev.stuck);
      const col = ev.hit.n === 0 ? '#ddd' : ev.hit.m >= 2 || ev.hit.n === 25 ? '#ffd24a' : '#fff';
      floats.push({ x: ev.stuck.x, y: ev.stuck.y, text: ev.hit.n ? label(ev.hit) : 'мимо', t0: performance.now(), color: col });
    } else if (L.x != null && L.y != null) {
      if (L.res === 'wire') ping();
      else if (L.res === 'dart') clack();
      else if (L.res === 'off') wood();
      else floor();
      fallers.push({ seat: ev.seat, x: L.x, y: L.y, vx: (Math.random() - 0.5) * 0.4, vy: 0.5 + Math.random() * 0.4, rot: -1.2, vr: 6 + Math.random() * 4, t0: nowS });
      floats.push({ x: L.x, y: L.y, text: L.res === 'wire' ? 'отскок!' : L.res === 'dart' ? 'в дротик!' : L.res === 'off' ? 'мимо' : 'не воткнулся', t0: performance.now(), color: '#ff9a7a' });
      if (L.res !== 'weak') setTimeout(floor, 650 / sp);
    } else {
      setTimeout(floor, 100);
      floats.push({ x: 0, y: -0.2, text: 'не долетел', t0: performance.now(), color: '#ff9a7a' });
    }
    (turnHits ??= []).push(ev.hit);
    hudCur = v ? v.seats.indexOf(ev.seat) : null;
    drawHud();
    await sleep(380 / sp);
  }

  function showState(s: State) {
    v = s;
    shown = s.stuck.map((d) => ({ ...d }));
    fade = 1;
    hudCur = null;
    turnHits = null;
    drawHud();
  }

  const view: GameView<State, Event> = {
    mount(el, c) {
      ctx = c;
      root = el;
      wrap = h(`<div class="dt-wrap${ctx.demo ? ' demo' : ''}"><canvas></canvas><div class="dt-score dt-chalk"></div><div class="dt-turn dt-chalk"></div><div class="dt-banner"></div>
        <div class="dt-meter" style="display:none"><i></i><u></u></div>${ctx.demo ? '' : '<div class="dt-tip"></div>'}</div>`);
      root.appendChild(wrap);
      cv = wrap.querySelector('canvas') as HTMLCanvasElement;
      g = cv.getContext('2d') as CanvasRenderingContext2D;
      scoreEl = wrap.querySelector('.dt-score') as HTMLElement;
      turnEl = wrap.querySelector('.dt-turn') as HTMLElement;
      banner = wrap.querySelector('.dt-banner') as HTMLElement;
      meter = wrap.querySelector('.dt-meter') as HTMLElement;
      tipEl = wrap.querySelector('.dt-tip') as HTMLElement;
      ctx.hold?.(15000);
      void loadArt().then(() => ctx.hold?.(0));
      const ro = new ResizeObserver(() => layout());
      ro.observe(wrap);
      cleanup.push(() => ro.disconnect());
      layout();
      if (!ctx.demo) bindInput();
      controls();
      syncTip();
      const vis = () => syncMusic();
      document.addEventListener('visibilitychange', vis);
      cleanup.push(() => document.removeEventListener('visibilitychange', vis));
      raf = requestAnimationFrame(frame);
    },
    setView(s) {
      showState(s);
      if (s.shot) {
        wrap.classList.add('shot');
        tipEl?.remove();
        layout();
        // превью: третий дротик в полёте — к утроению 20
        const fr = flight({ ...aimFor(20, 3), v: V0, side: 0 }, true).frames;
        const one = fr[Math.floor(fr.length * 0.3)];
        fly = { frames: [one], t0: performance.now(), seat: s.seats[s.cur], slow: 1, end: 0 };
      }
      // ход мог прийти раньше позиции (продолжение сохранённой партии)
      if (turnArgs && act == null) view.setTurn(turnArgs[0], turnArgs[1]);
      syncMusic();
    },
    async play(events, s) {
      busy = true;
      act = null;
      syncTip();
      Sound.unlock();
      const sp = () => Math.max(0.25, ctx.speed());
      const prev = v;
      v = s;
      if (prev) {
        // табло — по итоговому состоянию, но подход показываем того, кто бросал
        hudCur = null;
        turnHits = prev.hits.slice();
      }
      for (const ev of events) {
        if (ev.k === 'throw') await playThrow(ev);
        else if (ev.k === 'bust') {
          Sound.nomove();
          say('Перебор!', `${esc(ev.why)} — снова ${ev.back}`, 1800);
          await sleep(1100 / sp());
        } else if (ev.k === 'open') {
          say('Открылся!', 'удвоение — счёт пошёл', 1200);
          await sleep(500 / sp());
        } else if (ev.k === 'close') {
          say(`${ev.n === 25 ? 'Бык' : ev.n} закрыт`, '', 1000);
          await sleep(300 / sp());
        } else if (ev.k === 'killer') {
          Sound.capture();
          say('Убийца!', `${ctx.name(ev.seat)} может снимать жизни`, 1500);
          await sleep(800 / sp());
        } else if (ev.k === 'life') {
          Sound.capture();
          say('−1 жизнь', `у ${ctx.name(ev.victim)} осталось ${ev.lives}`, 1400);
          await sleep(700 / sp());
        } else if (ev.k === 'dead') {
          say('Выбыл', ctx.name(ev.seat), 1400);
          await sleep(700 / sp());
        } else if (ev.k === 'shanghai') {
          Sound.win();
          say('Шанхай!', `одиночное, удвоение и утроение ${ev.n}`, 2200);
          await sleep(1400 / sp());
        } else if (ev.k === 'leg') {
          Sound.win();
          say('Лег!', `${ctx.name(ev.seat)} — за ${ev.darts} дрот.`, 2000);
          await sleep(1300 / sp());
        } else if (ev.k === 'turn') {
          // дротики торчат до конца подхода — посмотреть и вынуть
          await sleep(900 / sp());
          for (let k = 0; k < 8; k++) {
            fade = 1 - (k + 1) / 8;
            await sleep(35);
          }
          shown = [];
          fade = 1;
          lastPower = null;
          hudCur = null;
          turnHits = [];
          drawHud();
          if (!s.over && s.p.length > 1) say(`Бросает ${ctx.name(ev.seat)}`, esc(ev.text), 1000);
          await sleep(500 / sp());
        } else if (ev.k === 'end') {
          Sound.win();
          const w = ev.winners.map((x) => ctx.name(x)).join(', ');
          say('Победа!', w, 2600);
          await sleep(900 / sp());
        }
      }
      showState(s);
      busy = false;
      syncTip();
      syncMusic();
    },
    setTurn(toAct, interactive) {
      turnArgs = [toAct, interactive];
      const mine = interactive.find((x) => toAct.includes(x));
      act = v && !v.over && !ctx.demo && !v.shot && mine != null ? mine : null;
      if (act != null && v) {
        // прицел — в поле, куда разумно бить (как подсказал бы сосед), дальше игрок сам
        const t = target(v, v.cur, 2);
        aim = aimFor(t.n, t.m);
        aimT0 = performance.now();
      }
      syncTip();
    },
    status(s, toAct, interactive) {
      if (s.over) return 'Партия окончена';
      const mine = interactive.includes(toAct[0]);
      return mine ? `Ваш бросок: ${s.dart + 1}-й дротик` : `Бросает ${ctx.name(toAct[0])}…`;
    },
    playerStats(s, seat) {
      const k = s.seats.indexOf(seat);
      if (k < 0) return '';
      const p = s.p[k];
      const c = s.cfg;
      if (c.mode === 'x01') return `осталось ${p.score}${c.legs > 1 ? ` · легов ${p.legs}` : ''}`;
      if (c.mode === 'clock') return p.target > 25 ? 'круг пройден' : `нужен ${targetName(p.target)}`;
      if (c.mode === 'killer') return p.out ? 'выбыл' : `число ${p.num} · жизней ${p.lives}${p.killer ? ' · убийца' : ''}`;
      if (c.mode === 'cricket') return `очков ${p.score} · закрыто ${p.marks.filter((m) => m >= 3).length}/7`;
      return `очков ${p.score}`;
    },
    saveTitle(s) {
      return `${modeName(s.cfg)} · раунд ${s.round}`;
    },
    destroy() {
      cancelAnimationFrame(raf);
      cleanup.forEach((f) => f());
      music?.pause();
      music = null;
    },
  };
  return view;
}
