/* Нарды — «ручная работа»: выжженные картины, резьба по рамке, арки, латунные петли (SVG-строки). */

export const BURN = '#2a1206';
const f1 = (v: number) => Math.round(v * 10) / 10;

function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Фильтр «выжигатель»: дрожащая линия с подпалиной вокруг. */
export const burnDefs = `
  <filter id="ndBurn" x="-5%" y="-5%" width="110%" height="110%">
    <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="3" result="n"/>
    <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feMorphology in="d" operator="dilate" radius="0.8" result="thick"/>
    <feGaussianBlur in="thick" stdDeviation="2" result="blur"/>
    <feFlood flood-color="#5a2a0a" flood-opacity="0.35"/>
    <feComposite in2="blur" operator="in" result="halo"/>
    <feGaussianBlur in="d" stdDeviation="0.35" result="core"/>
    <feMerge><feMergeNode in="halo"/><feMergeNode in="core"/></feMerge>
  </filter>
  <filter id="ndSoft"><feGaussianBlur stdDeviation="6"/></filter>
  <pattern id="ndLattice" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
    <rect width="18" height="18" fill="none"/>
    <path d="M0,0 V18 M0,0 H18" stroke="#1a0a02" stroke-width="2.2" opacity=".55"/>
    <path d="M2,2 L16,2 L16,16 L2,16Z" fill="#fff" opacity=".05"/>
  </pattern>
  <linearGradient id="ndBrass" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#8a6a20"/><stop offset=".45" stop-color="#f2d27a"/><stop offset=".6" stop-color="#d8b050"/><stop offset="1" stop-color="#7a5a18"/>
  </linearGradient>`;

/** Резная рамка: ромбовая насечка, «канат» по внутреннему краю, зубчики снаружи. */
export function carvedFrame(W: number, H: number, F: number) {
  let s = `<path d="M0,0H${W}V${H}H0Z M${F - 6},${F - 6}V${H - F + 6}H${W - F + 6}V${F - 6}Z" fill-rule="evenodd" fill="url(#ndLattice)"/>`;
  // «канат»: косые насечки вдоль внутреннего края
  let rope = '';
  const ropeSide = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.floor(len / 9);
    const dx = (x2 - x1) / n;
    const dy = (y2 - y1) / n;
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    for (let i = 0; i < n; i++) {
      const x = x1 + dx * (i + 0.5);
      const y = y1 + dy * (i + 0.5);
      rope += `<ellipse cx="${f1(x)}" cy="${f1(y)}" rx="6" ry="2.6" transform="rotate(${f1(ang + 45)} ${f1(x)} ${f1(y)})"/>`;
    }
  };
  const r = F - 12;
  ropeSide(r, r, W - r, r);
  ropeSide(W - r, r, W - r, H - r);
  ropeSide(W - r, H - r, r, H - r);
  ropeSide(r, H - r, r, r);
  s += `<g fill="none" stroke="${BURN}" stroke-width="1.6" opacity=".75">${rope}</g>`;
  // зубчатый внешний край
  let teeth = '';
  for (let x = 30; x < W - 20; x += 26) teeth += `<path d="M${x - 9},3 Q${x},13 ${x + 9},3" /><path d="M${x - 9},${H - 3} Q${x},${H - 13} ${x + 9},${H - 3}" />`;
  for (let y = 30; y < H - 20; y += 26) teeth += `<path d="M3,${y - 9} Q13,${y} 3,${y + 9}" /><path d="M${W - 3},${y - 9} Q${W - 13},${y} ${W - 3},${y + 9}" />`;
  s += `<g fill="none" stroke="#e2b77c" stroke-width="2" opacity=".35">${teeth}</g>`;
  return s;
}

/** Ряд арок-зубцов у торца половины (как прорезь на ручных досках). dir = 1 — арки вниз от верхнего края. */
export function arches(x0: number, w: number, y: number, dir: 1 | -1, n = 6) {
  const step = w / n;
  let d = `M${x0},${y}`;
  for (let i = 0; i < n; i++) {
    const a = x0 + i * step;
    d += ` Q${f1(a + step / 2)},${f1(y + dir * step * 0.62)} ${f1(a + step)},${y}`;
  }
  let dots = '';
  for (let i = 0; i < n; i++) dots += `<circle cx="${f1(x0 + i * step + step / 2)}" cy="${f1(y + dir * step * 0.62 + dir * 9)}" r="2.6" fill="${BURN}"/>`;
  for (let i = 1; i < n; i++) dots += `<path d="M${f1(x0 + i * step)},${y} l0,${dir * 12}" stroke="${BURN}" stroke-width="1.6"/>`;
  return `<path d="${d}" fill="none" stroke="${BURN}" stroke-width="2.6"/>${dots}`;
}

/** «Язычок пламени» — выжженный орнамент у основания пункта. */
export function flame(x: number, base: number, dir: 1 | -1, h = 54) {
  const y0 = base + dir * 8;
  const y1 = y0 + dir * h;
  return `<path d="M${x},${y1} C${x + 11},${f1(y0 + dir * h * 0.55)} ${x + 9},${f1(y0 + dir * 10)} ${x},${y0} C${x - 9},${f1(y0 + dir * 10)} ${x - 11},${f1(y0 + dir * h * 0.55)} ${x},${y1}Z" fill="${BURN}" opacity=".55"/>
    <path d="M${x},${f1(y1 - dir * 12)} C${x + 4},${f1(y0 + dir * h * 0.5)} ${x + 3},${f1(y0 + dir * 16)} ${x},${f1(y0 + dir * 12)}" fill="none" stroke="#e8c48a" stroke-width="1.3" opacity=".7"/>`;
}

/** Латунная петля с винтами. */
export function hinge(x: number, y: number) {
  let s = `<g transform="translate(${x},${y})"><rect x="-13" y="-46" width="26" height="92" rx="4" fill="url(#ndBrass)" stroke="#5a4010" stroke-width="1.5"/>`;
  s += `<rect x="-2" y="-46" width="4" height="92" fill="#5a4010" opacity=".5"/>`;
  for (const yy of [-34, -12, 12, 34]) s += `<circle cx="${yy % 24 === 0 ? -7 : 7}" cy="${yy}" r="3.4" fill="#c9a24a" stroke="#4a3008" stroke-width="1"/><path d="M${(yy % 24 === 0 ? -7 : 7) - 2.4},${yy} h4.8" stroke="#4a3008" stroke-width="1"/>`;
  return s + `</g>`;
}

/** Лоза: волнистый стебель с листьями и завитками вдоль средней полосы (ширина w, центр по y = 0). */
export function vine(w: number, seed: number) {
  const rnd = mulberry32(seed);
  const n = 6;
  const step = (w - 40) / n;
  let d = `M20,0`;
  for (let i = 0; i < n; i++) {
    const x = 20 + i * step;
    const dir = i % 2 ? 1 : -1;
    d += ` C${f1(x + step * 0.3)},${dir * 14} ${f1(x + step * 0.7)},${dir * 14} ${f1(x + step)},0`;
  }
  let s = `<path d="${d}" fill="none" stroke="${BURN}" stroke-width="2.2"/>`;
  for (let i = 0; i < n; i++) {
    const x = 20 + i * step + step / 2;
    const dir = i % 2 ? 1 : -1;
    const y = dir * 10.5;
    const a = dir * (35 + rnd() * 20);
    // лист
    s += `<path d="M${f1(x)},${f1(y)} c6,${dir * 2} 12,${dir * 9} 12,${dir * 18} c-8,${dir * -1} -12,${dir * -8} -12,${dir * -18}Z" fill="${BURN}" fill-opacity=".55" stroke="${BURN}" stroke-width="1" transform="rotate(${f1(a * 0.4)} ${f1(x)} ${f1(y)})"/>`;
    // завиток с другой стороны
    s += `<path d="M${f1(x - step * 0.25)},${f1(-dir * 6)} q${f1(-6)},${f1(-dir * 10)} ${f1(2)},${f1(-dir * 14)} q7,${f1(dir * 2)} 2,${f1(dir * 7)}" fill="none" stroke="${BURN}" stroke-width="1.4"/>`;
    s += `<circle cx="${f1(x + step * 0.3)}" cy="${f1(-dir * 9)}" r="2.2" fill="${BURN}"/>`;
  }
  return s;
}
