/* 3D-кубики на CSS: лоток с броском. Общие для всех игр с костями. */
import { Sound } from './audio';

const PIPS: Record<number, number[]> = {
  1: [5],
  2: [3, 7],
  3: [3, 5, 7],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};
// поворот куба, выводящий грань N вперёд
const FACE_ROT: Record<number, [number, number]> = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };

class Die {
  wrap: HTMLDivElement;
  cube: HTMLDivElement;
  sx = 0;
  sy = 0;
  value = 1;
  constructor(parent: HTMLElement) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'die-wrap';
    this.cube = document.createElement('div');
    this.cube.className = 'die';
    for (let f = 1; f <= 6; f++) {
      const face = document.createElement('div');
      face.className = 'face f' + f;
      for (let i = 1; i <= 9; i++) {
        const c = document.createElement('span');
        if (PIPS[f].includes(i)) c.className = 'pip';
        face.appendChild(c);
      }
      this.cube.appendChild(face);
    }
    this.wrap.appendChild(this.cube);
    parent.appendChild(this.wrap);
    this.set(1 + Math.floor(Math.random() * 6), false);
  }

  set(v: number, animate: boolean) {
    this.value = v;
    const [rx, ry] = FACE_ROT[v] ?? [0, 0];
    if (animate) {
      this.sx += 360 * (2 + Math.floor(Math.random() * 2));
      this.sy += 360 * (1 + Math.floor(Math.random() * 2));
    }
    this.cube.style.transition = animate ? '' : 'none';
    this.cube.style.transform = `rotateX(${this.sx + rx}deg) rotateY(${this.sy + ry}deg)`;
  }

  setUsed(u: boolean) {
    this.wrap.classList.toggle('used', !!u);
  }
}

export class DiceTray {
  dice: Die[];
  constructor(
    public el: HTMLElement,
    count = 2
  ) {
    el.classList.add('dice-tray');
    this.dice = Array.from({ length: count }, () => new Die(el));
  }

  roll(values: number[], speed = 1): Promise<void> {
    const dur = Math.round(1000 / Math.max(0.5, speed));
    this.el.style.setProperty('--roll-ms', dur + 'ms');
    this.dice.forEach((d, i) => {
      d.setUsed(false);
      const dx = (Math.random() * 30 + 50) * (i ? 1 : -1) * 0.3;
      const tilt = Math.random() * 40 - 20;
      d.wrap.animate(
        [
          { transform: `translate(${-120 + dx}px, -40px) rotate(${tilt - 90}deg)`, offset: 0 },
          { transform: `translate(${-30 + dx}px, 10px) rotate(${tilt - 30}deg)`, offset: 0.45 },
          { transform: `translate(${dx * 0.2}px, -8px) rotate(${tilt - 8}deg)`, offset: 0.7 },
          { transform: `translate(0px, 0px) rotate(${tilt * 0.15}deg)`, offset: 1 },
        ],
        { duration: dur, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }
      );
      d.set(values[i], true);
    });
    Sound.diceRoll(dur / 1000);
    return new Promise((r) => setTimeout(r, dur + 60));
  }

  /** Показать значения без анимации (null — оставить как есть) и отметить использованные кубики. */
  show(values: number[] | null, used?: boolean[]) {
    this.dice.forEach((d, i) => {
      if (values && values[i] && d.value !== values[i]) d.set(values[i], false);
      d.setUsed(used ? used[i] : false);
    });
  }
}
