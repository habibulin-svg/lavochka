/* Выгрузка всего, что ведущий говорит вслух в «Заколдованной стране»: шаги рассказа, заголовки сцен и мест,
 * «после», финалы кампаний, неизменные фразы движка. Выход — lines.json: [{key, text, kind, src, prev}].
 * npx tsx tools/zakoldovannaya/voice/extract.ts */
import { writeFileSync } from 'node:fs';
import { BOOK_SITES, CAMPAIGNS, ROAD } from '../../../src/games/zakoldovannaya/content';
import { BOOK_TITLES } from '../../../src/games/zakoldovannaya/content/book';
import { forpost } from '../../../src/games/zakoldovannaya/content/forpost';
import type { Scene, Site, Step } from '../../../src/games/zakoldovannaya/script';
import { vkey } from '../../../src/games/zakoldovannaya/vkey';

interface Line { key: string; text: string; kind: 'say' | 'title'; src: string; prev?: string }
const out = new Map<string, Line>();
let prev: string | undefined;
function add(text: string | undefined, kind: Line['kind'], src: string) {
  if (!text || !text.trim()) return;
  const key = vkey(text);
  if (!out.has(key)) out.set(key, { key, text: text.replace(/\s+/g, ' ').trim(), kind, src, ...(prev && kind === 'say' ? { prev } : {}) });
  if (kind === 'say') prev = text.slice(0, 300);
}

const LISTS = ['then', 'else', 'do', 'pass', 'fail', 'win', 'fled', 'routed', 'lost', 'each'];
function steps(list: Step[] | undefined, src: string) {
  if (!Array.isArray(list)) return;
  for (const st of list) {
    if (typeof st === 'string') { add(st, 'say', src); continue; }
    const o = st as Record<string, any>;
    if (typeof o.say === 'string') add(o.say, 'say', src);
    if (o.opts) for (const op of o.opts) steps(op.do, src);
    for (const k of LISTS) if (Array.isArray(o[k])) steps(o[k], src);
    if (Array.isArray(o.random)) for (const b of o.random) steps(b, src);
    if (Array.isArray(o.aggression)) for (const b of o.aggression) steps(b, src);
    if (o.gamble) { steps(o.gamble.win, src); steps(o.gamble.lose, src); }
  }
}
function scene(sc: Scene, src: string) {
  prev = undefined;
  add(sc.title, 'title', src);
  steps(sc.steps, src);
  for (const n of Object.values(sc.nodes ?? {})) steps(n, src);
  add(sc.after, 'say', src);
}
function site(s: Site, src: string) {
  prev = undefined;
  add(s.title, 'title', src);
  steps(s.enter, `${src}:enter`);
  for (const [id, r] of Object.entries(s.rooms)) scene(r, `${src}:${id}`);
}

// движок (engine.ts, world.ts)
add('Заколдованная страна', 'title', 'engine');
add('Отряд собрался в Форпосте — последней крепости на краю Заколдованной страны. Дальше — леса, полные чудовищ, заколдованные города и замки злых колдунов. Говорят, всем этим краем правит Чёрный маг. Пройти всю охрану и освободить страну из-под власти тёмных сил — вот ваша задача.', 'say', 'engine');
for (const t of ['Ночью…', 'В пути']) add(t, 'title', 'world');
add('Темнеет. Отряд разводит костёр у дороги.', 'say', 'world');
for (const t of Object.values(BOOK_TITLES)) add(t, 'title', 'book');
site(forpost, 'forpost');
for (const [id, s] of Object.entries(BOOK_SITES)) site(s, id);
for (const r of ROAD) scene(r, r.id);
for (const k of Object.values(CAMPAIGNS)) {
  prev = undefined;
  add(k.title, 'title', k.id);
  steps(k.intro, `${k.id}:intro`);
  for (const [id, sc] of Object.entries(k.scenes)) scene(sc, `${k.id}:${id}`);
  for (const [id, s] of Object.entries(k.sites ?? {})) site(s, `${k.id}:${id}`);
  prev = undefined;
  add(k.victory, 'say', `${k.id}:victory`);
}

const lines = [...out.values()];
writeFileSync(new URL('./lines.json', import.meta.url), JSON.stringify(lines, null, 1));
const chars = lines.reduce((a, l) => a + l.text.length, 0);
console.log(`строк ${lines.length}, символов ${chars}, с подстановками ${lines.filter((l) => /\{(name|leader|n)\}/.test(l.text)).length}`);
