/* Шахматные фигуры — советский точёный набор: светлые из лакированного бука, тёмные — под чёрным лаком.
 * Точёные фигуры строятся по профилю (половина силуэта справа от оси, как резец на токарном станке),
 * конь — резная голова. Каждая фигура — <symbol> с viewBox 0 0 100 100, подставляется через <use>. */

type Pt = [number, number];

/** Профиль: точки (полуширина от оси, высота) снизу вверх; «c» — сглаженный поворот через контрольную точку. */
type Prof = (Pt | { c: Pt; to: Pt })[];

function lathe(prof: Prof): string {
  // правая половина сверху вниз → левая снизу вверх (зеркально)
  const right: string[] = [];
  const left: string[] = [];
  let first = true;
  for (const p of prof) {
    if (Array.isArray(p)) {
      right.push(`${first ? 'M' : 'L'}${50 + p[0]} ${p[1]}`);
      left.unshift(`${50 - p[0]} ${p[1]}`);
    } else {
      right.push(`Q${50 + p.c[0]} ${p.c[1]} ${50 + p.to[0]} ${p.to[1]}`);
      left.unshift(`${50 - p.c[0]} ${p.c[1]}`, `${50 - p.to[0]} ${p.to[1]}`);
    }
    first = false;
  }
  // левая половина: обходим в обратную сторону, кривые — тоже через Q
  const back: string[] = [];
  const pts = [...prof].reverse();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const next = pts[i + 1];
    if (!next) break;
    if (Array.isArray(p) && Array.isArray(next)) back.push(`L${50 - next[0]} ${next[1]}`);
    else if (!Array.isArray(p)) {
      const to = Array.isArray(next) ? next : next.to;
      back.push(`Q${50 - p.c[0]} ${p.c[1]} ${50 - to[0]} ${to[1]}`);
    } else if (!Array.isArray(next)) back.push(`L${50 - next.to[0]} ${next.to[1]}`);
  }
  void left;
  const top = pts[0];
  const topPt = Array.isArray(top) ? top : top.to;
  return right.join(' ') + ` L${50 - topPt[0]} ${topPt[1]} ` + back.join(' ') + ' Z';
}

// общее основание — подставка с двумя поясками
const BASE: Prof = [
  [0, 93],
  [31, 93],
  { c: [33, 91], to: [31, 88] },
  [29, 87],
  { c: [31, 85], to: [28, 83] },
  [22, 82],
];

const PROFILES: Record<string, Prof> = {
  P: [
    ...BASE,
    { c: [14, 80], to: [12, 72] },
    [11, 64],
    { c: [19, 63], to: [18, 60] },
    [10, 58],
    { c: [15, 54], to: [14, 46] },
    { c: [14, 33], to: [0, 31] },
  ],
  R: [
    ...BASE,
    { c: [19, 80], to: [17, 72] },
    [16, 44],
    { c: [22, 42], to: [22, 38] },
    [22, 26],
    [22, 18],
    [14, 18],
    [14, 23],
    [7, 23],
    [7, 18],
    [0, 18],
  ],
  B: [
    ...BASE,
    { c: [16, 80], to: [12, 70] },
    [9, 52],
    { c: [18, 51], to: [17, 48] },
    [9, 46],
    { c: [17, 40], to: [14, 28] },
    { c: [10, 18], to: [4, 15] },
    { c: [7, 11], to: [0, 9] },
  ],
  Q: [
    ...BASE,
    { c: [17, 80], to: [13, 68] },
    [9, 44],
    { c: [19, 43], to: [18, 39] },
    [10, 37],
    [12, 33],
    { c: [20, 28], to: [19, 22] },
    [13, 22],
    { c: [9, 20], to: [6, 17] },
    { c: [8, 12], to: [0, 10] },
  ],
  K: [
    ...BASE,
    { c: [17, 80], to: [13, 68] },
    [10, 42],
    { c: [20, 41], to: [19, 37] },
    [11, 35],
    [13, 31],
    { c: [19, 26], to: [17, 21] },
    [5, 21],
    [5, 17],
    [0, 17],
  ],
};

/** Пояски-бороздки (высоты), где резец оставил след. */
const GROOVES: Record<string, number[]> = {
  P: [87, 82, 60],
  R: [87, 82, 44, 38],
  B: [87, 82, 50, 47],
  Q: [87, 82, 41, 36, 22],
  K: [87, 82, 39, 34],
  N: [87, 82],
};

/** Резная голова коня (смотрит влево) на точёной подставке. */
const KNIGHT_HEAD =
  'M29 82 C27 72 30 64 37 57 C31 57 25 55 21 52 C16 49 14 45 17 41 C21 35 26 30 31 25 ' +
  'C34 21 39 18 43 17 L44 9 C48 11 51 14 52 18 C61 20 68 27 71 37 C74 47 73 60 71 72 L71 82 Z';

interface Look {
  light: string;
  mid: string;
  dark: string;
  edge: string;
  line: string;
  shine: number;
}

const LOOKS: Record<'w' | 'b', Look> = {
  w: { light: '#fbe6bf', mid: '#e7bf82', dark: '#ae7a3f', edge: '#5a3714', line: '#8a5a28', shine: 0.55 },
  b: { light: '#6b5244', mid: '#2e1f18', dark: '#0e0806', edge: '#000', line: '#000', shine: 0.32 },
};

function defs(c: 'w' | 'b') {
  const L = LOOKS[c];
  return `<linearGradient id="pc${c}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${L.mid}"/><stop offset=".3" stop-color="${L.light}"/><stop offset=".55" stop-color="${L.mid}"/><stop offset="1" stop-color="${L.dark}"/>
    </linearGradient>
    <linearGradient id="pk${c}" x1="0" y1="0" x2="1" y2=".25">
      <stop offset="0" stop-color="${L.light}"/><stop offset=".45" stop-color="${L.mid}"/><stop offset="1" stop-color="${L.dark}"/>
    </linearGradient>`;
}

function piece(kind: string, c: 'w' | 'b'): string {
  const L = LOOKS[c];
  let s = '';
  // тень под фигурой
  s += `<ellipse cx="50" cy="93.5" rx="30" ry="3.2" fill="#000" opacity=".28"/>`;
  if (kind === 'N') {
    s += `<path d="${lathe(BASE)}" fill="url(#pc${c})" stroke="${L.edge}" stroke-width="1.6" stroke-linejoin="round"/>`;
    s += `<path d="${KNIGHT_HEAD}" fill="url(#pk${c})" stroke="${L.edge}" stroke-width="1.6" stroke-linejoin="round"/>`;
    // грива, глаз, ноздря, рот
    s += `<path d="M52 19 C60 24 64 30 66 38 M55 24 C61 30 63 38 64 46 M58 31 C63 38 64 48 64 56 M60 42 C63 50 63 60 62 68" fill="none" stroke="${L.line}" stroke-width="1.6" stroke-linecap="round" opacity=".75"/>`;
    s += `<ellipse cx="36" cy="29" rx="3.2" ry="2.2" fill="${c === 'w' ? '#3a2410' : '#c9a27a'}" transform="rotate(-25 36 29)"/>`;
    s += `<circle cx="20.5" cy="44.5" r="1.6" fill="${L.edge}"/><path d="M22 51 C26 52 30 52 33 50" fill="none" stroke="${L.edge}" stroke-width="1.3"/>`;
    s += `<path d="M37 57 C41 60 45 62 49 62" fill="none" stroke="${L.line}" stroke-width="1.4" opacity=".7"/>`;
    s += `<path d="M30 74 C30 60 38 50 40 34" fill="none" stroke="#fff" stroke-width="3" opacity="${L.shine * 0.5}" stroke-linecap="round"/>`;
  } else {
    s += `<path d="${lathe(PROFILES[kind])}" fill="url(#pc${c})" stroke="${L.edge}" stroke-width="1.6" stroke-linejoin="round"/>`;
    // блик лака вдоль фигуры
    s += `<path d="M42 88 L42 ${kind === 'P' ? 40 : 30}" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity="${L.shine * 0.45}"/>`;
    if (kind === 'B') s += `<path d="M44 34 L56 22" stroke="${L.edge}" stroke-width="2.4" stroke-linecap="round"/>`;
    if (kind === 'K') s += `<path d="M50 4 V17 M44 9 H56" stroke="${L.edge}" stroke-width="7" stroke-linecap="round"/><path d="M50 4 V17 M44 9 H56" stroke="url(#pc${c})" stroke-width="4" stroke-linecap="round"/>`;
    if (kind === 'Q') for (const x of [-14, -7, 0, 7, 14]) s += `<circle cx="${50 + x}" cy="${22 - (14 - Math.abs(x)) * 0.25}" r="2.2" fill="url(#pc${c})" stroke="${L.edge}" stroke-width="1"/>`;
  }
  for (const y of GROOVES[kind]) s += `<path d="M${50 - 26} ${y} Q50 ${y + 1.6} ${50 + 26} ${y}" fill="none" stroke="${L.line}" stroke-width=".9" opacity=".55" clip-path="url(#pclip${kind}${c})"/>`;
  const clip = kind === 'N' ? lathe(BASE) : lathe(PROFILES[kind]);
  return `<clipPath id="pclip${kind}${c}"><path d="${clip}"/></clipPath><symbol id="pc-${c}${kind}" viewBox="0 0 100 100" overflow="visible">${s}</symbol>`;
}

/** Все определения фигур — вставить в <defs> доски один раз. */
export function pieceDefs(): string {
  let s = defs('w') + defs('b');
  for (const c of ['w', 'b'] as const) for (const k of ['P', 'N', 'B', 'R', 'Q', 'K']) s += piece(k, c);
  return s;
}

/** id символа для фигуры FEN-буквой. */
export function pieceRef(p: string): string {
  const c = p === p.toUpperCase() ? 'w' : 'b';
  return `#pc-${c}${p.toUpperCase()}`;
}
