// Колян в панели: ролики-реакции Wan 2.2 по облику года (studio/jobs/kommersy/09-kolyan-reactions.yaml → tools/videogen/pack_kolyan.mjs).
// Фон в роликах уже запечён цветом подложки портретов — вырезать на лету ничего не нужно.

const A = '/kommersy/a';

export type Reaction = 'idle' | 'think' | 'deal' | 'win' | 'lose';
const LOOP: Reaction[] = ['idle', 'think'];

/** Облик Коляна по году. */
export function kolyanLook(y: number): number {
  return y >= 2001 ? 2003 : y >= 1996 ? 1996 : y >= 1993 ? 1993 : y >= 1990 ? 1990 : 1988;
}

export const kolyanImg = (y: number) => `${A}/people/kolyan-${kolyanLook(y)}.webp`;

export class KolyanCam {
  readonly el: HTMLElement;
  private video: HTMLVideoElement;
  private look = 0;
  private cur: Reaction = 'idle';

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'km-kolyan';
    this.el.hidden = true;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.setAttribute('disablepictureinpicture', '');
    this.el.appendChild(this.video);
    this.video.onended = () => this.play('idle');
  }

  /** Показать или спрятать; при смене облика — сразу новый. */
  /** Год партии (облик) или null — панель скрыта. */
  set(y: number | null) {
    this.el.hidden = y === null;
    if (y === null) {
      this.video.pause();
      return;
    }
    const look = kolyanLook(y);
    if (look === this.look) return;
    this.look = look;
    this.video.poster = kolyanImg(y);
    this.play(this.cur === 'think' ? 'think' : 'idle');
  }

  get now() {
    return this.cur;
  }

  play(r: Reaction) {
    if (!this.look || this.el.hidden) return;
    if (r === this.cur && LOOP.includes(r) && this.video.src) return;
    this.cur = r;
    this.video.loop = LOOP.includes(r);
    this.video.src = `${A}/kolyan/${this.look}-${r}.mp4`;
    this.video.play().catch(() => {});
  }

  stop() {
    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();
  }
}
