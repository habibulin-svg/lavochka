/* Гобан для Го и Рэндзю: доска из кая (текстура tools/boards/go.py → public/tex/go), торец и тень,
 * сетка, хоси, координаты; камни — готовые картинки (сланец и раковина в нескольких вариантах) с мягкой тенью.
 * Координаты SVG: пункт (x, y) — в точке (x + 1, y + 1), поле — n + 1 единиц, снизу — торец доски. */

const TEX = `${import.meta.env.BASE_URL}tex/go/`;
const COLS = 'ABCDEFGHJKLMNOPQRST';
/** Толщина торца под доской, в клетках. */
const SIDE = 0.32;

/** viewBox всего гобана с торцом. */
export function gobanBox(n: number): string {
  const V = n + 1;
  return `-0.05 -0.05 ${V + 0.1} ${V + SIDE + 0.15}`;
}

/** Пропорции гобана для CSS aspect-ratio. */
export function gobanAspect(n: number): string {
  const V = n + 1;
  return `${V + 0.1} / ${V + SIDE + 0.15}`;
}

/** Пункт под курсором (или -1). */
export function pointAt(svg: SVGSVGElement, n: number, e: MouseEvent): number {
  const ctm = svg.getScreenCTM();
  if (!ctm) return -1;
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  const x = Math.round(pt.x - 1);
  const y = Math.round(pt.y - 1);
  return x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1;
}

export function gobanDefs(): string {
  return `<defs>
    <radialGradient id="gb-sh" cx="50%" cy="50%" r="50%"><stop offset="0.62" stop-color="#000" stop-opacity="0.42"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <linearGradient id="gb-side" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b98a45"/><stop offset="1" stop-color="#7d5524"/></linearGradient>
    <linearGradient id="gb-gloss" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#3a2000" stop-opacity="0.12"/></linearGradient>
  </defs>`;
}

/** Доска: торец, дерево, сетка, хоси и координаты. */
export function gobanBoard(n: number, hoshi: number[], cols: string | null = COLS): string {
  const V = n + 1;
  const L = (i: number) => i + 1;
  let o = `<rect x="0" y="${SIDE}" width="${V}" height="${V}" rx="0.14" fill="url(#gb-side)"/>`;
  o += `<clipPath id="gb-clip"><rect x="0" y="0" width="${V}" height="${V}" rx="0.14"/></clipPath>`;
  o += `<image href="${TEX}kaya.webp" x="0" y="0" width="${V}" height="${V}" preserveAspectRatio="none" clip-path="url(#gb-clip)"/>`;
  o += `<rect x="0" y="0" width="${V}" height="${V}" rx="0.14" fill="url(#gb-gloss)"/>`;
  o += `<rect x="0.02" y="0.02" width="${V - 0.04}" height="${V - 0.04}" rx="0.13" fill="none" stroke="#8a5e26" stroke-opacity="0.45" stroke-width="0.03"/>`;
  const sw = n >= 19 ? 0.038 : n >= 15 ? 0.042 : 0.05;
  let d = '';
  for (let i = 0; i < n; i++) d += `M${L(0)} ${L(i)}H${L(n - 1)}M${L(i)} ${L(0)}V${L(n - 1)}`;
  o += `<path d="${d}" stroke="#20160a" stroke-opacity="0.88" stroke-width="${sw}" stroke-linecap="square"/>`;
  o += `<rect x="${L(0)}" y="${L(0)}" width="${n - 1}" height="${n - 1}" fill="none" stroke="#20160a" stroke-opacity="0.92" stroke-width="${sw * 1.9}"/>`;
  const r = n >= 19 ? 0.11 : 0.1;
  for (const p of hoshi) o += `<circle cx="${L(p % n)}" cy="${L(Math.floor(p / n))}" r="${r}" fill="#20160a"/>`;
  if (cols) {
    const fs = n >= 19 ? 0.3 : 0.32;
    let t = '';
    for (let i = 0; i < n; i++) {
      t += `<text x="${L(i)}" y="${V - 0.18}" text-anchor="middle">${cols[i]}</text>`;
      t += `<text x="0.42" y="${L(i) + fs * 0.36}" text-anchor="middle">${n - i}</text>`;
    }
    o += `<g font-family="'PT Sans', system-ui, sans-serif" font-size="${fs}" font-weight="700" fill="#4a2f10" fill-opacity="0.7">${t}</g>`;
  }
  return o;
}

/** Небольшой устойчивый разброс по номеру пункта — камни лежат не идеально по сетке, как настоящие. */
function jitter(p: number): [number, number, number] {
  let h = (p + 1) * 2654435761;
  h ^= h >>> 13;
  const a = (h & 255) / 255;
  const b = ((h >>> 8) & 255) / 255;
  const c = (h >>> 16) & 255;
  return [(a - 0.5) * 0.06, (b - 0.5) * 0.06, c];
}

/** Камень с тенью. black — чёрный (сланец) или белый (раковина). */
export function stoneSvg(p: number, n: number, black: boolean, extra = ''): string {
  const [dx, dy, v] = jitter(p);
  const x = (p % n) + 1 + dx;
  const y = Math.floor(p / n) + 1 + dy;
  const src = black ? `slate${v % 2}` : `shell${v % 4}`;
  return (
    `<circle cx="${x + 0.06}" cy="${y + 0.1}" r="0.53" fill="url(#gb-sh)"/>` +
    `<image href="${TEX}${src}.webp" x="${x - 0.485}" y="${y - 0.485}" width="0.97" height="0.97"${extra}/>`
  );
}

/** Полупрозрачный камень под курсором. */
export function ghostSvg(p: number, n: number, black: boolean): string {
  const x = (p % n) + 1;
  const y = Math.floor(p / n) + 1;
  return `<image href="${TEX}${black ? 'slate0' : 'shell0'}.webp" x="${x - 0.47}" y="${y - 0.47}" width="0.94" height="0.94" opacity="0.5" pointer-events="none"/>`;
}

/** Метка последнего хода: кольцо контрастного цвета. */
export function lastMark(p: number, n: number, black: boolean): string {
  const [dx, dy] = jitter(p);
  return `<circle cx="${(p % n) + 1 + dx}" cy="${Math.floor(p / n) + 1 + dy}" r="0.19" fill="none" stroke="${black ? '#f3ecd8' : '#1c1c1c'}" stroke-width="0.07"/>`;
}

/** Подгрузить картинки заранее, чтобы первый камень не мигал. */
export function preloadGoban() {
  for (const f of ['kaya', 'slate0', 'slate1', 'shell0', 'shell1', 'shell2', 'shell3']) {
    const im = new Image();
    im.src = `${TEX}${f}.webp`;
  }
}
