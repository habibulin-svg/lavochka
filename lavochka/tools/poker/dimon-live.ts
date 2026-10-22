/* Димон на настоящей модели: ситуации из партии ботов (холдем) → обстановка словами → вопрос через шлюз.
 * Ключ — ROUTERAI_API_KEY или tools/videogen/dist/videogen.json (key). Ответы и обстановка — в D:/temp/dimon/live.md.
 *   npx tsx tools/poker/dimon-live.ts */
import { readFileSync, writeFileSync } from 'node:fs';
import { AI_MODEL } from '../../server/ai';
import { buildMessages, type DimonAsk } from '../../server/dimon';
import { SeededRng } from '../../src/core/rng';
import { choose } from '../../src/games/poker/ai';
import { def } from '../../src/games/poker/def';
import { handFacts, oppFacts, statsFacts, tableFacts } from '../../src/games/poker/dimon-facts';
import { apply, makeView, type HandRecord, type State } from '../../src/games/poker/engine';
import { emptyHud, recordHand } from '../../src/games/poker/hud';
import { bestMove } from '../../src/games/poker/calc';

const key = process.env.ROUTERAI_API_KEY || JSON.parse(readFileSync('tools/videogen/dist/videogen.json', 'utf8')).key;
const names: Record<number, string> = { 0: 'Я', 1: 'Ленка', 2: 'Серёга', 3: 'Танька', 4: 'Димон', 5: 'Колян' };

const opts = { ...Object.fromEntries(def.options!.map((o) => [o.key, o.default])), mode: 'holdem', stack: 1000, every: 10, hands: 0 };
const rng = new SeededRng(5);
let s = <State>def.setup([0, 1, 2, 3, 4, 5].map((seat) => ({ seat, kind: 'bot', level: 2, name: '' })), opts, rng);
const hud = emptyHud();
let move: string | null = null;
let hand: { rec: HandRecord; facts: string } | null = null;
for (let guard = 0, game = 0; guard < 60000; guard++) {
  if (s.over) s = <State>def.setup([0, 1, 2, 3, 4, 5].map((seat) => ({ seat, kind: 'bot', level: 2, name: '' })), opts, new SeededRng(100 + ++game));
  const seat = s.turn;
  const v0 = makeView(s, [0]);
  // «что делать» — на флопе или тёрне, когда мне надо ответить на ставку
  if (!move && seat === 0 && s.street >= 1 && s.current > s.bet[0] && hud.me.hands > 60) move = tableFacts(v0, 0, { name: (p) => names[p], bots: hud.bots });
  const a = choose(makeView(s, [seat]), seat, 2, rng)!;
  const r = apply(s, seat, a, rng)!;
  for (const e of r.events)
    if (e.type === 'hand') {
      recordHand(hud, e.rec, 0, names, { best: bestMove(e.rec, 0).short || undefined });
      // разбор — раздача, где я дошёл хотя бы до флопа и проиграл
      if (!hand && hud.me.hands > 60 && (e.rec.net[0] ?? 0) < -e.rec.big * 4 && e.rec.board.length >= 3) hand = { rec: e.rec, facts: handFacts(e.rec, 0, names) };
    }
  s = r.state;
  if (move && hand && hud.me.hands > 150) break;
}

const asks: (DimonAsk & { title: string })[] = [
  { title: 'Что тут делать?', kind: 'move', where: 'table', facts: move ?? '', question: 'Димон, что тут делать?' },
  { title: 'Как я сыграл раздачу?', kind: 'hand', where: 'table', facts: hand?.facts ?? '', question: 'Как я сыграл эту раздачу?' },
  { title: 'Что значит статистика соперника (Димон-бот, маньяк)?', kind: 'opp', where: 'table', facts: oppFacts('Димон', hud.bots['Димон']), question: 'Что значит статистика Димона? Как против него играть?' },
  { title: 'Разбери мою статистику', kind: 'stats', where: 'stats', facts: statsFacts(hud), question: 'Разбери мою статистику: что подтянуть?' },
];

let out = `# Димон на настоящей модели (${AI_MODEL}), ${new Date().toISOString()}\n`;
let rub = 0;
for (const a of asks) {
  const t0 = Date.now();
  const res = await fetch('https://routerai.ru/api/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: AI_MODEL, messages: buildMessages(a), max_tokens: a.kind === 'move' || a.kind === 'opp' ? 400 : 550, temperature: 0.5, reasoning: { enabled: false }, usage: { include: true } }),
  });
  const j: any = await res.json();
  rub += Number(j?.usage?.cost) || 0;
  out += `\n## ${a.title}\n\n### Обстановка\n\n\`\`\`\n${a.facts}\n\`\`\`\n\n### Ответ (${((Date.now() - t0) / 1000).toFixed(1)} с, ${j?.usage?.cost ?? '?'} ₽)\n\n${j?.choices?.[0]?.message?.content ?? JSON.stringify(j).slice(0, 300)}\n`;
}
out += `\nВсего: ${rub.toFixed(4)} ₽\n`;
writeFileSync('D:/temp/dimon/live.md', out);
console.log(out);
