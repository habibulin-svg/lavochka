// Колян в панели: ролики-реакции Wan 2.2 по облику года (studio/jobs/kommersy/09-kolyan-reactions.yaml → tools/videogen/pack_kolyan.mjs).
// Фон в роликах уже запечён цветом подложки портретов — вырезать на лету ничего не нужно.

import { CRASH_FROM, IT_FROM, m2 } from './s2data';
import type { Season } from './season';

const A = '/kommersy/a';

export type Reaction = 'idle' | 'think' | 'deal' | 'win' | 'lose';
const LOOP: Reaction[] = ['idle', 'think'];

/** Облик Коляна по году (первый сезон). */
export function kolyanLook(y: number): string {
  return String(y >= 2001 ? 2003 : y >= 1996 ? 1996 : y >= 1993 ? 1993 : y >= 1990 ? 1990 : 1988);
}

/** Облик второго сезона: клуб 2004 → крах 2008 → айтишник 2010 → борода 2015 → после болезни 2021 (studio/jobs/kommersy2). */
export function kolyanLook2(m: number, ill: boolean): string {
  return ill ? '2021' : m < CRASH_FROM ? '2004' : m < IT_FROM ? '2008' : m < m2(2015, 1) ? '2010' : '2015';
}

/** Облик по сезону и месяцу партии. */
export const lookOf = (z: Season, m: number, ill = false) => (z.id === 2 ? kolyanLook2(m, ill) : kolyanLook(z.yearOf(m)));

export const kolyanImg = (look: string) => `${A}/people/kolyan-${look}.webp`;

export class KolyanCam {
  readonly el: HTMLElement;
  private video: HTMLVideoElement;
  private look = '';
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

  /** Облик (lookOf) или null — панель скрыта; при смене облика — сразу новый. */
  set(look: string | null) {
    this.el.hidden = look === null;
    if (look === null) {
      this.video.pause();
      return;
    }
    if (look === this.look) return;
    this.look = look;
    this.video.poster = kolyanImg(look);
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
