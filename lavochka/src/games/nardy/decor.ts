/* Нарды — «ручная работа»: пункты-копья, медальоны, резьба по рамке, арки, желоба, латунные петли (SVG-строки). */

export const BURN = '#2a1206';
const f1 = (v: number) => Math.round(v * 10) / 10;

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

/** Латунная петля с винтами. */
export function hinge(x: number, y: number) {
  let s = `<g transform="translate(${x},${y})"><rect x="-13" y="-46" width="26" height="92" rx="4" fill="url(#ndBrass)" stroke="#5a4010" stroke-width="1.5"/>`;
  s += `<rect x="-2" y="-46" width="4" height="92" fill="#5a4010" opacity=".5"/>`;
  for (const yy of [-34, -12, 12, 34]) s += `<circle cx="${yy % 24 === 0 ? -7 : 7}" cy="${yy}" r="3.4" fill="#c9a24a" stroke="#4a3008" stroke-width="1"/><path d="M${(yy % 24 === 0 ? -7 : 7) - 2.4},${yy} h4.8" stroke="#4a3008" stroke-width="1"/>`;
  return s + `</g>`;
}

/**
 * Пункт-«копьё», как на резных нардах: скруглённая головка у борта, длинное остриё к середине.
 * base — y борта, dir = 1 — остриё вниз (верхний ряд), -1 — вверх.
 */
export function spearPath(x: number, base: number, len: number, w: number, dir: 1 | -1) {
  const hw = w / 2;
  const y = (v: number) => f1(base + dir * v);
  return `M${x},${y(len)} C${f1(x + hw * 0.18)},${y(len * 0.55)} ${f1(x + hw)},${y(w * 1.5)} ${f1(x + hw)},${y(w * 0.62)} C${f1(x + hw)},${y(w * 0.1)} ${f1(x + hw * 0.5)},${y(2)} ${x},${y(2)} C${f1(x - hw * 0.5)},${y(2)} ${f1(x - hw)},${y(w * 0.1)} ${f1(x - hw)},${y(w * 0.62)} C${f1(x - hw)},${y(w * 1.5)} ${f1(x - hw * 0.18)},${y(len * 0.55)} ${x},${y(len)}Z`;
}

/** Узор внутри копья: цветок в головке, «ёлочка» вдоль оси. */
export function spearFiligree(x: number, base: number, len: number, w: number, dir: 1 | -1, color: string) {
  const y = (v: number) => f1(base + dir * v);
  const cy = base + dir * w * 0.6;
  let s = '';
  for (let i = 0; i < 8; i++) {
    const a = i * 45;
    s += `<ellipse cx="${x}" cy="${f1(cy - 6)}" rx="2.1" ry="4.6" transform="rotate(${a} ${x} ${f1(cy)})" fill="${color}" opacity=".8"/>`;
  }
  s += `<circle cx="${x}" cy="${f1(cy)}" r="2.4" fill="${color}"/><circle cx="${x}" cy="${f1(cy)}" r="11.5" fill="none" stroke="${color}" stroke-width=".9" opacity=".6"/>`;
  let d = `M${x},${y(w * 1.25)} L${x},${y(len * 0.86)}`;
  for (let t = w * 1.5; t < len * 0.8; t += 13) {
    const hw = (w / 2) * (1 - t / len) * 0.75;
    d += ` M${f1(x - hw)},${y(t - 5)} L${x},${y(t)} L${f1(x + hw)},${y(t - 5)}`;
  }
  s += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.3" opacity=".8"/>`;
  return s;
}

/** Восьмиконечная звезда-инкрустация: каждый луч из светлой и тёмной половинки. */
export function star8(cx: number, cy: number, r: number, light: string, dark: string, edge: string) {
  let s = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const tip = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    const side = (k: number) => {
      const b = a + (k * Math.PI) / 8;
      return [cx + Math.cos(b) * r * 0.42, cy + Math.sin(b) * r * 0.42];
    };
    const l = side(-1);
    const rr = side(1);
    s += `<path d="M${f1(cx)},${f1(cy)} L${f1(l[0])},${f1(l[1])} L${f1(tip[0])},${f1(tip[1])}Z" fill="${light}" stroke="${edge}" stroke-width="1.2"/>`;
    s += `<path d="M${f1(cx)},${f1(cy)} L${f1(rr[0])},${f1(rr[1])} L${f1(tip[0])},${f1(tip[1])}Z" fill="${dark}" stroke="${edge}" stroke-width="1.2"/>`;
  }
  return s;
}

/** Выжженная розетка-медальон: лепестки в два яруса, зубчатый пояс, сердцевина. */
export function rosette(cx: number, cy: number, r: number) {
  let s = `<g transform="translate(${f1(cx)},${f1(cy)})" fill="none" stroke="${BURN}">`;
  // внешний фигурный контур: 12 лопастей
  let d = '';
  const lobes = 12;
  for (let i = 0; i <= lobes; i++) {
    const a = (i / lobes) * Math.PI * 2;
    const a2 = ((i + 0.5) / lobes) * Math.PI * 2;
    const p = [Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86];
    const c = [Math.cos(a2) * r * 1.08, Math.sin(a2) * r * 1.08];
    const n = [Math.cos(((i + 1) / lobes) * Math.PI * 2) * r * 0.86, Math.sin(((i + 1) / lobes) * Math.PI * 2) * r * 0.86];
    if (i === 0) d += `M${f1(p[0])},${f1(p[1])}`;
    if (i < lobes) d += ` Q${f1(c[0])},${f1(c[1])} ${f1(n[0])},${f1(n[1])}`;
  }
  s += `<path d="${d}Z" stroke-width="2.4"/>`;
  s += `<circle r="${f1(r * 0.78)}" stroke-width="1.2"/>`;
  // лепестки
  for (let i = 0; i < 8; i++) {
    const a = i * 45;
    s += `<g transform="rotate(${a})"><path d="M0,${f1(-r * 0.2)} C${f1(r * 0.16)},${f1(-r * 0.35)} ${f1(r * 0.14)},${f1(-r * 0.62)} 0,${f1(-r * 0.72)} C${f1(-r * 0.14)},${f1(-r * 0.62)} ${f1(-r * 0.16)},${f1(-r * 0.35)} 0,${f1(-r * 0.2)}Z" stroke-width="1.8"/>`;
    s += `<path d="M0,${f1(-r * 0.28)} L0,${f1(-r * 0.62)}" stroke-width="1"/><circle cy="${f1(-r * 0.46)}" r="2.2" fill="${BURN}" stroke="none"/></g>`;
    s += `<g transform="rotate(${a + 22.5})"><path d="M0,${f1(-r * 0.3)} q${f1(r * 0.08)},${f1(-r * 0.14)} 0,${f1(-r * 0.3)} q${f1(-r * 0.08)},${f1(r * 0.14)} 0,${f1(r * 0.3)}Z" fill="${BURN}" fill-opacity=".5" stroke-width="1"/></g>`;
  }
  // зубчатый пояс и сердцевина
  let z = '';
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    const rr = i % 2 ? r * 0.2 : r * 0.14;
    z += (i ? 'L' : 'M') + f1(Math.cos(a) * rr) + ',' + f1(Math.sin(a) * rr);
  }
  s += `<path d="${z}" stroke-width="1.4"/><circle r="${f1(r * 0.08)}" fill="${BURN}"/>`;
  return s + `</g>`;
}

/** Желоб для снятых шашек на борту — длинная овальная выемка. */
export function slot(cx: number, y0: number, y1: number, w: number) {
  const r = w / 2;
  return `<rect x="${f1(cx - r)}" y="${f1(y0)}" width="${f1(w)}" height="${f1(y1 - y0)}" rx="${f1(r)}" fill="#140802" opacity=".7"/>
    <rect x="${f1(cx - r + 2)}" y="${f1(y0 + 2)}" width="${f1(w - 4)}" height="${f1(y1 - y0 - 4)}" rx="${f1(r - 2)}" fill="none" stroke="#000" stroke-opacity=".7" stroke-width="7" filter="url(#ndInset)"/>
    <rect x="${f1(cx - r)}" y="${f1(y0)}" width="${f1(w)}" height="${f1(y1 - y0)}" rx="${f1(r)}" fill="none" stroke="#e2b77c" stroke-opacity=".25" stroke-width="1.5"/>`;
}

/** Круглая лунка на борту (для кубиков). */
export function cup(cx: number, cy: number, r: number) {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#140802" opacity=".7"/><circle cx="${cx}" cy="${cy}" r="${r - 2}" fill="none" stroke="#000" stroke-opacity=".7" stroke-width="6" filter="url(#ndInset)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e2b77c" stroke-opacity=".25" stroke-width="1.5"/>`;
}
