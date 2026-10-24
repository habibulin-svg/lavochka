/* Светка на настоящей модели: несколько раскладов (таро и 36 карт) → толкование через шлюз, плюс уточнение.
 * Ключ — ROUTERAI_API_KEY или tools/videogen/dist/videogen.json (key). Ответы и расклады — в D:/temp/svetka/live.md.
 *   npx tsx tools/gadanie/svetka-live.ts */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { AI_MODEL } from '../../server/ai';
import { buildMessages, type SvetkaAsk } from '../../server/svetka';
import { SeededRng } from '../../src/core/rng';
import { readingFacts } from '../../src/games/gadanie/facts';
import { KARTY36, shuffleDeck } from '../../src/games/gadanie/reading';
import { spreadById, spreadSize } from '../../src/games/gadanie/spreads';

const key = process.env.ROUTERAI_API_KEY || JSON.parse(readFileSync('tools/videogen/dist/videogen.json', 'utf8')).key;
const deal = (deck: 'taro' | 'karty', spread: string, seed: number, person?: number) =>
  shuffleDeck(deck, { reversed: true, majors: false, person }, new SeededRng(seed)).slice(0, spreadSize(spreadById(spread)!));
const queen = KARTY36.findIndex((c) => c.s === 'H' && c.r === 12);

const asks: (SvetkaAsk & { title: string; follow?: string })[] = [
  { title: 'Три карты: менять ли работу', deck: 'taro', spread: 'tri-karty', cards: deal('taro', 'tri-karty', 3), question: 'Стоит ли мне менять работу?', who: 'm', follow: 'А если я останусь?' },
  { title: 'Кельтский крест: отношения', deck: 'taro', spread: 'kelt', cards: deal('taro', 'kelt', 11), question: 'Что будет у нас с Сашей?', who: 'f' },
  { title: 'Да или нет', deck: 'taro', spread: 'da-net', cards: deal('taro', 'da-net', 5), question: 'Поступлю ли я в институт?' },
  { title: 'Карта дня без вопроса', deck: 'taro', spread: 'karta-dnya', cards: deal('taro', 'karta-dnya', 8) },
  { title: 'На даму (36 карт)', deck: 'karty', spread: 'na-korolya', cards: deal('karty', 'na-korolya', 9, queen), person: queen, question: 'Что у неё на сердце?' },
  { title: 'Здоровье — не предсказывает', deck: 'taro', spread: 'tri-karty', cards: deal('taro', 'tri-karty', 21), question: 'Я беременна? Всё будет хорошо с ребёнком?' },
];

const call = async (a: SvetkaAsk, max: number) => {
  const t0 = Date.now();
  const res = await fetch('https://routerai.ru/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL, messages: buildMessages(a), max_tokens: max, temperature: 0.5, reasoning: { enabled: false }, usage: { include: true } }),
  });
  const j: any = await res.json();
  return { text: String(j?.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 300)), cost: Number(j?.usage?.cost) || 0, sec: (Date.now() - t0) / 1000, usage: j?.usage };
};

let out = `# Светка на настоящей модели (${AI_MODEL}), ${new Date().toISOString()}\n`;
let rub = 0;
for (const a of asks) {
  const s = spreadById(a.spread)!;
  const r = await call(a, spreadSize(s) >= 7 ? 900 : 650);
  rub += r.cost;
  out += `\n## ${a.title}\n\n### Расклад\n\n\`\`\`\n${readingFacts(a.deck, s, a.cards, a.person ?? null)}\n\`\`\`\n\n### Толкование (${r.sec.toFixed(1)} с, ${r.cost} ₽, токены ${r.usage?.prompt_tokens}/${r.usage?.completion_tokens})\n\n${r.text}\n`;
  if (a.follow) {
    const f = await call({ ...a, history: [{ role: 'svetka', text: r.text }], ask: a.follow }, 350);
    rub += f.cost;
    out += `\n### Уточнение: «${a.follow}» (${f.cost} ₽)\n\n${f.text}\n`;
  }
}
out += `\n---\nВсего: ${rub.toFixed(4)} ₽\n`;
mkdirSync('D:/temp/svetka', { recursive: true });
writeFileSync('D:/temp/svetka/live.md', out);
console.log(`готово, ${rub.toFixed(4)} ₽ → D:/temp/svetka/live.md`);
