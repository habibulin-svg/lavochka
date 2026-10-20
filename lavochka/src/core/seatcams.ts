/* Камеры на поле (пати-игры): видео каждого игрока — над его аватаром на доске, главного (чей ход, а без него — кто говорит) — крупно.
 * Игра лишь помечает аватар места атрибутом [data-cam="<место>"] (может перерисовывать его как угодно): слой камер лежит поверх доски
 * и каждый кадр подстраивается под положение аватара, видео не пересоздаются. [data-cam-place="over"] — камера накрывает аватар
 * (сетка мест: тесно сверху), иначе — над ним (под ним, если сверху нет места). */
import type { VoiceTile } from './voice';
import { h } from './util';

interface Cam {
  el: HTMLElement;
  video: HTMLVideoElement;
  tile: VoiceTile;
  /** Аватар, к которому стоит камера, и его цвет (читать стиль каждый кадр дорого). */
  anchor?: HTMLElement;
  color?: string;
  css?: string;
}

/** Говорящий становится главным, если говорит дольше этого, и остаётся им ещё столько после паузы. */
const TALK_ON = 600;
const TALK_HOLD = 2500;

export class SeatCams {
  private layer: HTMLElement;
  private cams = new Map<number, Cam>();
  private raf = 0;
  private focus: number | null = null;
  private hidden: number | null = null;
  private talk = new Map<number, number>();
  private speaker: { seat: number; until: number } | null = null;

  constructor(private board: HTMLElement) {
    this.layer = h('<div class="seat-cams"></div>');
    board.appendChild(this.layer);
  }

  /** tiles — участники голоса; focus — главное место по игре; hidden — место, чьё видео уже показано крупно в другом месте (крокодил). */
  update(tiles: VoiceTile[], focus: number | null, hidden: number | null) {
    this.focus = focus;
    this.hidden = hidden;
    const now = performance.now();
    const seen = new Set<number>();
    for (const t of tiles) {
      if (t.seat == null || !t.video || !t.stream?.getVideoTracks().length) continue;
      seen.add(t.seat);
      let c = this.cams.get(t.seat);
      if (!c) {
        const el = h('<div class="seat-cam"><video autoplay playsinline muted></video></div>');
        c = { el, video: el.querySelector('video') as HTMLVideoElement, tile: t };
        this.cams.set(t.seat, c);
        this.layer.appendChild(el);
      }
      c.tile = t;
      if (c.video.srcObject !== t.stream) {
        c.video.srcObject = t.stream;
        void c.video.play().catch(() => {});
      }
      const talking = t.level > 0.08 && !t.muted;
      c.el.classList.toggle('me', t.me);
      c.el.classList.toggle('talk', talking);
      // кто говорит дольше TALK_ON — тот и главный (если игра не назвала своего)
      if (talking) {
        const since = this.talk.get(t.seat) ?? now;
        this.talk.set(t.seat, since);
        if (now - since > TALK_ON && (!this.speaker || this.speaker.seat === t.seat || this.speaker.until < now)) this.speaker = { seat: t.seat, until: now + TALK_HOLD };
      } else this.talk.delete(t.seat);
    }
    for (const [seat, c] of [...this.cams]) {
      if (seen.has(seat)) continue;
      c.video.srcObject = null;
      c.el.remove();
      this.cams.delete(seat);
    }
    if (this.speaker && (this.speaker.until < now || !seen.has(this.speaker.seat))) this.speaker = null;
    if (this.cams.size && !this.raf) this.raf = requestAnimationFrame(this.place);
  }

  private main(): number | null {
    if (this.focus != null) return this.focus;
    return this.speaker?.seat ?? null;
  }

  /** Каждый кадр: поставить камеры к аватарам (поле могло перерисоваться, прокрутиться, сжаться). */
  private place = () => {
    this.raf = 0;
    if (!this.cams.size || !this.board.isConnected) return;
    const br = this.board.getBoundingClientRect();
    const main = this.main();
    const small = Math.max(56, Math.min(150, br.width * 0.12));
    // главная: на ПК — до 380 px, на телефоне — 40% ширины поля, но не выше половины его высоты
    const big = Math.min(380, Math.max(130, br.width * 0.4), br.height * 0.5 * (4 / 3));
    for (const [seat, c] of this.cams) {
      const a = this.board.querySelector<HTMLElement>(`[data-cam="${seat}"]`);
      const r = a?.getBoundingClientRect();
      if (!a || !r || !r.width || seat === this.hidden) {
        c.el.hidden = true;
        continue;
      }
      c.el.hidden = false;
      // свою камеру крупно не показываем: себя видеть большим незачем, а поле она закроет
      const isMain = seat === main && !c.tile.me;
      const over = a.closest('[data-cam-place="over"]') != null;
      const w = isMain ? big : over ? Math.max(48, Math.min(small, (a.parentElement?.getBoundingClientRect().width ?? r.width) - 4)) : small;
      const hgt = (w * 3) / 4;
      const cx = r.left + r.width / 2 - br.left;
      let top: number;
      if (over && !isMain) top = r.bottom - br.top - hgt;
      else {
        top = r.top - br.top - hgt - 6;
        if (top < 4) top = r.bottom - br.top + 6;
      }
      const left = Math.max(4, Math.min(br.width - w - 4, cx - w / 2));
      top = Math.max(4, Math.min(br.height - hgt - 4, top));
      if (c.anchor !== a) {
        c.anchor = a;
        c.color = getComputedStyle(a).getPropertyValue('--c').trim() || '#888';
      }
      c.el.classList.toggle('main', isMain);
      const css = `left:${left.toFixed(1)}px;top:${top.toFixed(1)}px;width:${w.toFixed(1)}px;height:${hgt.toFixed(1)}px;--c:${c.color}`;
      if (c.css !== css) c.el.style.cssText = c.css = css;
    }
    this.raf = requestAnimationFrame(this.place);
  };

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const c of this.cams.values()) c.video.srcObject = null;
    this.cams.clear();
    this.layer.remove();
  }
}
