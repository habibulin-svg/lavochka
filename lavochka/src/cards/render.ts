/* Отрисовка карт (SVG) в трёх стилях: атласные, славянские, «Русский стиль».
 * Карта 250×350. Фигуры — двухголовые, как на русских колодах; рисунок пока условный, детальнее — в волне карточных игр. */
import type { DeckStyle } from '../core/settings';
import { isRed, rankLabel, type Card, type Suit } from './deck';

const W = 250;
const H = 350;

// Масти в квадрате 100×100.
const SUIT_PATH: Record<Suit, string> = {
  H: 'M50 90 C22 68 4 50 4 30 C4 14 16 4 30 4 C40 4 47 10 50 19 C53 10 60 4 70 4 C84 4 96 14 96 30 C96 50 78 68 50 90Z',
  D: 'M50 3 L86 50 L50 97 L14 50Z',
  S: 'M50 4 C36 24 8 40 8 60 C8 74 19 82 31 82 C39 82 45 78 47 73 C46 83 42 90 34 96 L66 96 C58 90 54 83 53 73 C55 78 61 82 69 82 C81 82 92 74 92 60 C92 40 64 24 50 4Z',
  C: 'M50 8 a19 19 0 1 1 -0.1 0Z M27 40 a19 19 0 1 1 -0.1 0Z M73 40 a19 19 0 1 1 -0.1 0Z M44 50 L56 50 L56 62 L44 62Z M47 60 C46 78 42 89 34 96 L66 96 C58 89 54 78 53 60Z',
};

interface Palette {
  paper: string;
  red: string;
  black: string;
  frame: string;
  accent: string;
  accent2: string;
  skin: string;
  back: string;
  backInk: string;
  font: string;
}

const PALETTES: Record<DeckStyle, Palette> = {
  atlas: { paper: '#fbfaf5', red: '#c8102e', black: '#14141a', frame: '#1c3f94', accent: '#e8b81a', accent2: '#1c3f94', skin: '#f6d8b8', back: '#1c3f94', backInk: '#e9eefc', font: 'PT Serif, Georgia, serif' },
  slavic: { paper: '#fbf3e0', red: '#b5221b', black: '#1d1410', frame: '#b5221b', accent: '#d9a521', accent2: '#2f5d3a', skin: '#f3d3b0', back: '#8f1d16', backInk: '#f6dfb0', font: 'PT Serif, Georgia, serif' },
  russian: { paper: '#f7eedb', red: '#a3241c', black: '#20180f', frame: '#9a7a2e', accent: '#c9a43b', accent2: '#3b5a3a', skin: '#efcfa8', back: '#2f4a33', backInk: '#d8c07a', font: 'PT Serif, Georgia, serif' },
};

function suit(s: Suit, x: number, y: number, size: number, color: string, flip = false) {
  const k = size / 100;
  const rot = flip ? ` rotate(180 50 50)` : '';
  return `<g transform="translate(${x - size / 2},${y - size / 2}) scale(${k})"><path d="${SUIT_PATH[s]}" fill="${color}" transform="${rot}"/></g>`;
}

// Раскладка значков для 2..10 (координаты в долях поля карты).
const PIP_LAYOUT: Record<number, [number, number][]> = {
  2: [[0.5, 0.15], [0.5, 0.85]],
  3: [[0.5, 0.15], [0.5, 0.5], [0.5, 0.85]],
  4: [[0.27, 0.15], [0.73, 0.15], [0.27, 0.85], [0.73, 0.85]],
  5: [[0.27, 0.15], [0.73, 0.15], [0.5, 0.5], [0.27, 0.85], [0.73, 0.85]],
  6: [[0.27, 0.15], [0.73, 0.15], [0.27, 0.5], [0.73, 0.5], [0.27, 0.85], [0.73, 0.85]],
  7: [[0.27, 0.15], [0.73, 0.15], [0.5, 0.32], [0.27, 0.5], [0.73, 0.5], [0.27, 0.85], [0.73, 0.85]],
  8: [[0.27, 0.15], [0.73, 0.15], [0.5, 0.32], [0.27, 0.5], [0.73, 0.5], [0.5, 0.68], [0.27, 0.85], [0.73, 0.85]],
  9: [[0.27, 0.12], [0.73, 0.12], [0.27, 0.37], [0.73, 0.37], [0.5, 0.5], [0.27, 0.63], [0.73, 0.63], [0.27, 0.88], [0.73, 0.88]],
  10: [[0.27, 0.12], [0.73, 0.12], [0.5, 0.25], [0.27, 0.37], [0.73, 0.37], [0.27, 0.63], [0.73, 0.63], [0.5, 0.75], [0.27, 0.88], [0.73, 0.88]],
};

function frame(st: DeckStyle, p: Palette) {
  if (st === 'slavic') {
    // красная кайма с ромбиками — вышивка
    let s = `<rect x="9" y="9" width="${W - 18}" height="${H - 18}" rx="10" fill="none" stroke="${p.red}" stroke-width="2.5"/>`;
    for (let x = 22; x < W - 14; x += 14) s += `<path d="M${x} 15 l5 -4 l5 4 l-5 4Z" fill="${p.red}" opacity=".8"/><path d="M${x} ${H - 15} l5 -4 l5 4 l-5 4Z" fill="${p.red}" opacity=".8"/>`;
    return s;
  }
  if (st === 'russian') {
    return `<rect x="8" y="8" width="${W - 16}" height="${H - 16}" rx="12" fill="none" stroke="${p.frame}" stroke-width="3"/>
      <rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="9" fill="none" stroke="${p.frame}" stroke-width="1" stroke-dasharray="2 3"/>`;
  }
  return '';
}

/** Условная фигура (полкарты): голова, убор, одежда, предмет. Нижняя половина — отражение. */
function figureHalf(c: Card, st: DeckStyle, p: Palette) {
  const robe = isRed(c) ? p.red : p.accent2;
  const robe2 = isRed(c) ? p.accent2 : p.red;
  const gold = p.accent;
  const cx = W / 2;
  let hat = '';
  if (c.r === 13) {
    hat =
      st === 'russian'
        ? `<path d="M${cx - 30} 82 Q${cx} 40 ${cx + 30} 82Z" fill="${robe2}" stroke="${p.black}" stroke-width="2"/><rect x="${cx - 33}" y="78" width="66" height="10" rx="4" fill="#6b4a2a" stroke="${p.black}" stroke-width="2"/>`
        : `<path d="M${cx - 28} 84 L${cx - 30} 56 L${cx - 15} 70 L${cx} 50 L${cx + 15} 70 L${cx + 30} 56 L${cx + 28} 84Z" fill="${gold}" stroke="${p.black}" stroke-width="2"/>`;
  } else if (c.r === 12) {
    hat =
      st === 'atlas'
        ? `<path d="M${cx - 26} 84 L${cx - 22} 62 L${cx - 8} 74 L${cx} 58 L${cx + 8} 74 L${cx + 22} 62 L${cx + 26} 84Z" fill="${gold}" stroke="${p.black}" stroke-width="2"/>`
        : `<path d="M${cx - 30} 86 Q${cx} 34 ${cx + 30} 86Z" fill="${robe2}" stroke="${p.black}" stroke-width="2"/><circle cx="${cx}" cy="62" r="5" fill="${gold}"/>`;
  } else {
    hat = `<path d="M${cx - 26} 82 Q${cx - 4} 52 ${cx + 30} 74 L${cx + 26} 84Z" fill="${robe2}" stroke="${p.black}" stroke-width="2"/><path d="M${cx + 18} 70 q16 -18 24 -6" stroke="${gold}" stroke-width="4" fill="none"/>`;
  }
  const beard = c.r === 13 ? `<path d="M${cx - 16} 104 Q${cx} 140 ${cx + 16} 104Z" fill="#7a5a3a" stroke="${p.black}" stroke-width="1.5"/>` : '';
  const hair = c.r === 12 ? `<path d="M${cx - 22} 92 q-6 30 6 44 M${cx + 22} 92 q6 30 -6 44" stroke="#5a3a1a" stroke-width="7" fill="none" stroke-linecap="round"/>` : '';
  const item =
    c.r === 13
      ? `<line x1="${cx + 40}" y1="175" x2="${cx + 52}" y2="70" stroke="${gold}" stroke-width="5"/><circle cx="${cx + 52}" cy="66" r="7" fill="${gold}" stroke="${p.black}" stroke-width="1.5"/>`
      : c.r === 12
        ? `<line x1="${cx - 40}" y1="175" x2="${cx - 48}" y2="120" stroke="#3a6a2a" stroke-width="3"/><circle cx="${cx - 48}" cy="114" r="8" fill="${p.red}" stroke="${p.black}" stroke-width="1.5"/>`
        : `<line x1="${cx + 44}" y1="175" x2="${cx + 44}" y2="58" stroke="#6b4a2a" stroke-width="4"/><path d="M${cx + 44} 50 l8 14 h-16Z" fill="#9aa4b0" stroke="${p.black}" stroke-width="1.5"/>`;
  return `
    <path d="M${cx - 62} 175 L${cx - 52} 128 Q${cx} 112 ${cx + 52} 128 L${cx + 62} 175Z" fill="${robe}" stroke="${p.black}" stroke-width="2"/>
    <path d="M${cx - 40} 175 L${cx - 30} 132 Q${cx} 124 ${cx + 30} 132 L${cx + 40} 175Z" fill="${p.paper}" opacity=".35"/>
    <path d="M${cx} 122 L${cx} 175" stroke="${gold}" stroke-width="5"/>
    ${[0, 1, 2].map((i) => `<circle cx="${cx}" cy="${136 + i * 13}" r="3" fill="${p.black}"/>`).join('')}
    ${hair}
    <ellipse cx="${cx}" cy="98" rx="19" ry="22" fill="${p.skin}" stroke="${p.black}" stroke-width="2"/>
    <circle cx="${cx - 7}" cy="95" r="2" fill="${p.black}"/><circle cx="${cx + 7}" cy="95" r="2" fill="${p.black}"/>
    <path d="M${cx - 5} 108 q5 4 10 0" stroke="${p.black}" stroke-width="1.5" fill="none"/>
    ${beard}${hat}${item}`;
}

function court(c: Card, st: DeckStyle, p: Palette, ink: string) {
  const half = figureHalf(c, st, p);
  return `<g>
    <rect x="34" y="40" width="${W - 68}" height="${H - 80}" rx="6" fill="none" stroke="${ink}" stroke-width="1.5"/>
    <clipPath id="ct"><rect x="35" y="41" width="${W - 70}" height="${H - 82}" rx="5"/></clipPath>
    <g clip-path="url(#ct)">${half}<g transform="rotate(180 ${W / 2} ${H / 2})">${half}</g></g>
    <line x1="35" y1="${H / 2}" x2="${W - 35}" y2="${H / 2}" stroke="${ink}" stroke-width="1"/>
    ${suit(c.s, 58, 64, 26, ink)}${suit(c.s, W - 58, H - 64, 26, ink, true)}
  </g>`;
}

function ace(c: Card, st: DeckStyle, p: Palette, ink: string) {
  let deco = '';
  if (st !== 'atlas' || c.s === 'S') {
    deco = `<circle cx="${W / 2}" cy="${H / 2}" r="74" fill="none" stroke="${st === 'russian' ? p.frame : ink}" stroke-width="1.5" stroke-dasharray="${st === 'slavic' ? '6 4' : '1 0'}"/>`;
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6;
      deco += `<circle cx="${(W / 2 + Math.cos(a) * 74).toFixed(1)}" cy="${(H / 2 + Math.sin(a) * 74).toFixed(1)}" r="4" fill="${p.accent}"/>`;
    }
  }
  return deco + suit(c.s, W / 2, H / 2, c.s === 'S' && st === 'atlas' ? 120 : 96, ink);
}

function pips(c: Card, ink: string) {
  const L = PIP_LAYOUT[c.r];
  const x0 = 50;
  const y0 = 42;
  const w = W - 100;
  const hh = H - 84;
  return L.map(([fx, fy]) => suit(c.s, x0 + fx * w, y0 + fy * hh, 42, ink, fy > 0.55)).join('');
}

function index(c: Card, ink: string, font: string) {
  const lab = rankLabel(c.r);
  const one = `<text x="22" y="40" font-family="${font}" font-weight="700" font-size="${lab.length > 1 ? 28 : 32}" fill="${ink}" text-anchor="middle">${lab}</text>${suit(c.s, 22, 58, 20, ink)}`;
  return one + `<g transform="rotate(180 ${W / 2} ${H / 2})">${one}</g>`;
}

export function cardFace(c: Card, st: DeckStyle): string {
  const p = PALETTES[st];
  const ink = isRed(c) ? p.red : p.black;
  let body: string;
  if (c.r === 15) body = `<text x="${W / 2}" y="${H / 2 + 20}" font-size="70" text-anchor="middle" fill="${ink}" font-family="${p.font}">★</text><text x="${W / 2}" y="${H / 2 + 70}" font-size="22" text-anchor="middle" fill="${ink}" font-family="${p.font}">ДЖОКЕР</text>`;
  else if (c.r >= 11 && c.r <= 13) body = court(c, st, p, ink);
  else if (c.r === 14) body = ace(c, st, p, ink);
  else body = pips(c, ink);
  return `<rect width="${W}" height="${H}" rx="16" fill="${p.paper}"/>${frame(st, p)}${body}${index(c, ink, p.font)}`;
}

export function cardBack(st: DeckStyle): string {
  const p = PALETTES[st];
  let pat = '';
  if (st === 'atlas') {
    for (let y = 30; y < H - 20; y += 16) for (let x = 30; x < W - 20; x += 16) pat += `<path d="M${x} ${y - 6} l6 6 l-6 6 l-6 -6Z" fill="none" stroke="${p.backInk}" stroke-width="1.2" opacity=".75"/>`;
  } else if (st === 'slavic') {
    for (let y = 36; y < H - 30; y += 28) for (let x = 36; x < W - 30; x += 28)
      pat += `<path d="M${x} ${y - 10} l10 10 l-10 10 l-10 -10Z M${x} ${y - 4} l4 4 l-4 4 l-4 -4Z" fill="${p.backInk}" fill-rule="evenodd" opacity=".85"/>`;
  } else {
    for (let y = 40; y < H - 30; y += 34) for (let x = 40; x < W - 30; x += 34)
      pat += `<path d="M${x} ${y - 12} C${x + 12} ${y - 6} ${x + 12} ${y + 6} ${x} ${y + 12} C${x - 12} ${y + 6} ${x - 12} ${y - 6} ${x} ${y - 12}Z" fill="none" stroke="${p.backInk}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="3" fill="${p.backInk}"/>`;
  }
  return `<rect width="${W}" height="${H}" rx="16" fill="${p.paper}"/><rect x="10" y="10" width="${W - 20}" height="${H - 20}" rx="10" fill="${p.back}"/>
    <rect x="16" y="16" width="${W - 32}" height="${H - 32}" rx="8" fill="none" stroke="${p.backInk}" stroke-width="2"/>${pat}`;
}

let uidN = 0;
/** Полный SVG карты. null — рубашка. */
export function cardSVG(c: Card | null, st: DeckStyle, cls = 'card'): string {
  const inner = c ? cardFace(c, st) : cardBack(st);
  // уникальные id для clipPath — карт на странице много
  const u = 'c' + ++uidN;
  return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${inner.replace(/id="ct"/g, `id="ct${u}"`).replace(/url\(#ct\)/g, `url(#ct${u})`)}</svg>`;
}

export const DECK_STYLES: { id: DeckStyle; title: string; hint: string }[] = [
  { id: 'atlas', title: 'Атласные', hint: 'классическая советская колода' },
  { id: 'slavic', title: 'Славянские', hint: 'красная вышивка и орнамент' },
  { id: 'russian', title: 'Русский стиль', hint: 'бояре, золото и зелень' },
];
