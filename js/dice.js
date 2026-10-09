/* Шиш-беш — 3D-кубики на CSS. */
(function () {
  const SH = (window.SH = window.SH || {});

  const PIPS = {
    1: [5],
    2: [3, 7],
    3: [3, 5, 7],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };
  // поворот куба, выводящий грань N вперёд
  const FACE_ROT = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };

  class Die {
    constructor(parent) {
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
      this.sx = 0;
      this.sy = 0;
      this.value = 1;
      this.set(1 + Math.floor(Math.random() * 6), false);
    }

    set(v, animate) {
      this.value = v;
      const [rx, ry] = FACE_ROT[v];
      if (animate) {
        this.sx += 360 * (2 + Math.floor(Math.random() * 2));
        this.sy += 360 * (1 + Math.floor(Math.random() * 2));
      }
      this.cube.style.transition = animate ? '' : 'none';
      this.cube.style.transform = `rotateX(${this.sx + rx}deg) rotateY(${this.sy + ry}deg)`;
    }

    setUsed(u) {
      this.wrap.classList.toggle('used', !!u);
    }
  }

  class DiceTray {
    constructor(el) {
      this.el = el;
      this.dice = [new Die(el), new Die(el)];
    }

    roll(values, speed = 1) {
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
      SH.Sound.diceRoll(dur / 1000);
      return new Promise((r) => setTimeout(r, dur + 60));
    }

    show(values, used) {
      this.dice.forEach((d, i) => {
        if (values && values[i]) {
          if (d.value !== values[i]) d.set(values[i], false);
        }
        d.setUsed(used ? used[i] : false);
      });
    }
  }

  SH.DiceTray = DiceTray;
})();
