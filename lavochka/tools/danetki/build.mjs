// Данетки: история и разгадка (docs/analysis/danetki.json) + сценарий ведущего от агентов (docs/analysis/danetki-host-*.json)
// → src/games/danetki/data.json. Данетки без сценария пропускаются. Запуск из lavochka/: node tools/danetki/build.mjs
import fs from 'node:fs';

const SRC = '../docs/analysis';
const base = JSON.parse(fs.readFileSync(`${SRC}/danetki.json`, 'utf8'));
const host = new Map();
for (const f of fs.readdirSync(SRC).filter((f) => /^danetki-host-\d+\.json$/.test(f)))
  for (const h of JSON.parse(fs.readFileSync(`${SRC}/${f}`, 'utf8'))) host.set(h.id, h);

const bad = [];
const out = base.flatMap((d) => {
  const h = host.get(d.id);
  if (!h) return [];
  const ok =
    [1, 2, 3].includes(h.level) &&
    Array.isArray(h.questions) && h.questions.length >= 8 &&
    h.questions.every((q) => q.q && ['y', 'n', 'i'].includes(q.a)) &&
    Array.isArray(h.hints) && h.hints.length >= 1 &&
    Array.isArray(h.options) && h.options.length === 4 && h.options.every((o) => typeof o === 'string' && o.trim());
  if (!ok) {
    bad.push(d.id);
    return [];
  }
  return [{
    id: d.id,
    title: d.title,
    level: h.level,
    kids: !!h.kids,
    story: d.question,
    answer: d.answer,
    short: h.short || '',
    hints: h.hints.slice(0, 3),
    questions: h.questions.map((q) => (q.fact && q.a === 'y' ? { q: q.q, a: q.a, f: q.fact } : { q: q.q, a: q.a })),
    options: h.options,
  }];
});
fs.writeFileSync('src/games/danetki/data.json', JSON.stringify(out));
const lv = [1, 2, 3].map((l) => out.filter((d) => d.level === l).length);
console.log(`данеток ${out.length} из ${base.length} (лёгких ${lv[0]}, средних ${lv[1]}, трудных ${lv[2]}, детских ${out.filter((d) => d.kids).length})${bad.length ? ` · брак: ${bad.join(', ')}` : ''}`);
