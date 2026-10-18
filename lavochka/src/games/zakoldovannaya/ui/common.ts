/* Общее для отрисовки «Заколдованной страны»: пути к картинкам, тонировка ч/б портретов и планов, мелочи. */
import { store } from '../../../core/settings';
import { MONSTER } from '../monsters';

export const IMG = '/zakoldovannaya/';
export const monsterImg = (id: string) => `${IMG}monsters/${id}.webp`;
export const castleImg = (card: number) => `${IMG}castles/${card}.webp`;
export const classImg = (cls: string) => `${IMG}art/${cls}.webp`;

/** Вид: цветной (тонировка) или «как в 1990-м» (оригинальные ч/б). */
export const PREF_LOOK = 'zs.look';
export const PREF_MUSIC = 'zs.music';
export function look(): 'color' | 'orig' {
  return store.get<string>(PREF_LOOK, 'color') === 'orig' ? 'orig' : 'color';
}

/** Тема тонировки по существу: нежить — болотная зелень, огонь — багрянец, драконы — золото, вода — синь,
 * волшебники — фиолет, звери — охра, люди и полулюди — сепия. */
const THEME: Record<string, string> = {};
for (const id of ['gul', 'zombi', 'nekrofag', 'skelet', 'spektr', 'cherep', 'vulin', 'ten', 'lipuchka', 'stinking', 'dark']) THEME[id] = 'undead';
for (const id of ['foerbart', 'krasnyy_drakon', 'krasnaya_obezyana', 'blembiya', 'rudra']) THEME[id] = 'fire';
for (const id of ['zolotoy_drakon', 'zolotoy_zmey', 'zolotoy_minotavr', 'beliy_drakon', 'chernyy_drakon', 'kamennyy_drakon', 'tron']) THEME[id] = 'gold';
for (const id of ['galur', 'morskoy_zmey', 'letayushchaya_murena', 'glumor', 'blekvering']) THEME[id] = 'water';
for (const id of ['bargul', 'chernyy_mag', 'klurki_magi_krony', 'kor', 'gnum', 'vahnall', 'rakshas', 'durgaf', 'taurut', 'stakeys', 'elf_piksi', 'trurl', 'rot_monstr']) THEME[id] = 'magic';
for (const id of ['lev', 'medved_grizli', 'chernyy_medved', 'sablezubiy_tigr', 'volkolak', 'strig', 'kran', 'ston', 'edinorog', 'gigantskaya_pchela', 'kentavr', 'ptitsa_rog', 'chelovek_volk', 'chelovek_vepr', 'chelovek_medved', 'chelovek_tigr', 'zelenaya_obezyana']) THEME[id] = 'beast';
export function themeOf(id: string): string {
  return THEME[id] ?? (MONSTER[id]?.group === 'undead' ? 'undead' : 'sepia');
}

/** Градиентные карты: тень → полутон → свет. */
const MAPS: Record<string, [string, string, string]> = {
  sepia: ['#1d120a', '#8a5a33', '#f3e2c0'],
  undead: ['#0b140f', '#4f7d55', '#dfeccf'],
  fire: ['#1c0606', '#a8331c', '#ffd8a0'],
  gold: ['#1a1104', '#a5761d', '#fff0b8'],
  water: ['#06121d', '#2f6d8f', '#d6eef7'],
  magic: ['#130a1d', '#6b3f93', '#f0dcff'],
  beast: ['#170f06', '#7b5a2a', '#efe1c4'],
  plan: ['#2b2017', '#9c8a6e', '#f4ead2'],
};

function tableOf(c: string[], ch: 0 | 1 | 2): string {
  return c.map((hex) => (parseInt(hex.slice(1 + ch * 2, 3 + ch * 2), 16) / 255).toFixed(3)).join(' ');
}

/** Вставить фильтры тонировки в документ (один раз). Класс .zs-tint-<тема> красит картинку. */
export function ensureFilters(): void {
  if (document.getElementById('zs-filters')) return;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.id = 'zs-filters';
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  let defs = '';
  for (const [k, c] of Object.entries(MAPS)) {
    defs += `<filter id="zs-${k}" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/><feComponentTransfer>` +
      `<feFuncR type="table" tableValues="${tableOf(c, 0)}"/><feFuncG type="table" tableValues="${tableOf(c, 1)}"/><feFuncB type="table" tableValues="${tableOf(c, 2)}"/>` +
      `</feComponentTransfer></filter>`;
  }
  svg.innerHTML = `<defs>${defs}</defs>`;
  document.body.append(svg);
}

/** Стиль картинки по выбранному виду. */
export function tint(theme: string): string {
  return look() === 'color' ? `filter:url(#zs-${theme})` : 'filter:grayscale(1) contrast(1.05)';
}

export function portrait(id: string, cls = 'zs-por'): string {
  return `<img class="${cls}" src="${monsterImg(id)}" alt="" draggable="false" style="${tint(themeOf(id))}">`;
}
