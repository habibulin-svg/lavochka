/* Шиш-беш — синтезированные звуки (Web Audio API, без файлов). */
(function () {
  const SH = (window.SH = window.SH || {});
  let ctx = null;
  let master = null;
  let noiseBuf = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.8;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const Sound = {
    enabled: true,
    unlock() {
      ensure();
    },
  };

  function on() {
    return Sound.enabled && ensure();
  }

  // Короткий шумовой щелчок через полосовой фильтр — «дерево/кость».
  function click(t, { freq = 2500, q = 3, dur = 0.03, gain = 0.5 } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(master);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  function tone(t, { freq = 200, to = null, dur = 0.12, gain = 0.4, type = 'sine' } = {}) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // Удар деревянной фишки о доску.
  function knock(t, strength = 1) {
    tone(t, { freq: 190 + Math.random() * 40, to: 90, dur: 0.09, gain: 0.35 * strength });
    click(t, { freq: 1100 + Math.random() * 500, q: 2.5, dur: 0.045, gain: 0.45 * strength });
  }

  Sound.diceRoll = function (duration = 0.9) {
    if (!on()) return;
    const t0 = ctx.currentTime;
    // тряска в ладонях
    for (let i = 0; i < 7; i++) {
      const t = t0 + i * 0.045 + Math.random() * 0.02;
      click(t, { freq: 3000 + Math.random() * 2000, q: 4, dur: 0.02, gain: 0.25 });
    }
    // кубики катятся и стукаются о лоток, удары реже и тише
    let t = t0 + 0.35;
    let gap = 0.04;
    let g = 0.7;
    while (t < t0 + duration) {
      click(t, { freq: 1800 + Math.random() * 2200, q: 3, dur: 0.035, gain: g });
      if (Math.random() < 0.35) tone(t, { freq: 140 + Math.random() * 60, to: 80, dur: 0.06, gain: g * 0.3 });
      t += gap + Math.random() * 0.03;
      gap *= 1.18;
      g *= 0.86;
    }
  };

  Sound.step = function () {
    if (!on()) return;
    knock(ctx.currentTime, 0.55);
  };

  Sound.place = function () {
    if (!on()) return;
    knock(ctx.currentTime, 1);
  };

  Sound.enter = function () {
    if (!on()) return;
    const t = ctx.currentTime;
    knock(t, 1);
    tone(t + 0.02, { freq: 392, dur: 0.18, gain: 0.12, type: 'triangle' });
    tone(t + 0.12, { freq: 587, dur: 0.25, gain: 0.12, type: 'triangle' });
  };

  Sound.jump = function () {
    if (!on()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(400, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + 0.25);
    bp.frequency.exponentialRampToValueAtTime(700, t + 0.45);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(bp).connect(g).connect(master);
    src.start(t, 0, 0.5);
    tone(t, { freq: 300, to: 900, dur: 0.3, gain: 0.08, type: 'sine' });
  };

  Sound.capture = function () {
    if (!on()) return;
    const t = ctx.currentTime;
    knock(t, 1.2);
    knock(t + 0.07, 0.9);
    tone(t + 0.08, { freq: 520, to: 130, dur: 0.45, gain: 0.18, type: 'sawtooth' });
    click(t + 0.08, { freq: 600, q: 1, dur: 0.25, gain: 0.25 });
  };

  Sound.home = function () {
    if (!on()) return;
    const t = ctx.currentTime;
    knock(t, 0.8);
    [523, 659, 784].forEach((f, i) => tone(t + 0.05 + i * 0.08, { freq: f, dur: 0.5, gain: 0.1, type: 'triangle' }));
  };

  Sound.turn = function () {
    if (!on()) return;
    const t = ctx.currentTime;
    tone(t, { freq: 880, dur: 0.35, gain: 0.07, type: 'sine' });
    tone(t + 0.09, { freq: 1320, dur: 0.4, gain: 0.05, type: 'sine' });
  };

  Sound.nomove = function () {
    if (!on()) return;
    const t = ctx.currentTime;
    tone(t, { freq: 330, to: 250, dur: 0.25, gain: 0.08, type: 'triangle' });
    tone(t + 0.15, { freq: 250, to: 200, dur: 0.3, gain: 0.08, type: 'triangle' });
  };

  Sound.win = function () {
    if (!on()) return;
    const t = ctx.currentTime;
    const notes = [523, 659, 784, 1047, 784, 1047, 1319];
    notes.forEach((f, i) => {
      tone(t + i * 0.13, { freq: f, dur: 0.4, gain: 0.12, type: 'triangle' });
      tone(t + i * 0.13, { freq: f / 2, dur: 0.3, gain: 0.06, type: 'sine' });
    });
  };

  SH.Sound = Sound;
})();
