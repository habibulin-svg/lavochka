/* Требования CLAUDE.md к каждой игре, которые проверяются без модели:
 * три уровня ботов, цель и показ правил, страница на сайте (seo.ts, FAQ 4–5), карточка с датой и превью.
 * Найденные расхождения — ниже в KNOWN с причиной; новая игра в список не попадает — тест упадёт. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/games/catalog';
import { DEFS } from '../src/games/defs';

const ROOT = join(__dirname, '..');

type Def = {
  id: string;
  bot: { levels: string[] };
  rules: { goal?: string; sections: { title: string; demo?: unknown }[] };
};

const AUDIT = process.env.REQ_AUDIT === '1';

/** Известные расхождения: «игра: правило» → причина. Убирать отсюда по мере исправления. */
const RT = 'аркада (реальное время или головоломка на уровни): пошаговый показ на поле не делается, правила — текстом и обучением';
const KNOWN: Record<string, string> = {
  'hockey: ни у одного раздела правил нет показа': RT,
  'football: ни у одного раздела правил нет показа': RT,
  'aerohockey: ни у одного раздела правил нет показа': RT,
  'basketball: ни у одного раздела правил нет показа': RT,
  'zarulem: ни у одного раздела правил нет показа': RT,
  'treasures: ни у одного раздела правил нет показа': RT,
  'shariki: ни у одного раздела правил нет показа': RT,
  'brick2026: ни у одного раздела правил нет показа': RT,
  'eggs: ни у одного раздела правил нет показа': RT,
};

async function problems(): Promise<string[]> {
  const out: string[] = [];
  for (const card of CATALOG) {
    // карточка-раздел (members) и отложенная игра (shelved) — не игры со своей страницей
    if ((card as { members?: unknown }).members || (card as { shelved?: boolean }).shelved) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(card.added ?? '')) out.push(`${card.id}: карточка без даты added`);
    if (!card.thumb) out.push(`${card.id}: карточка без превью`);
    else if (!existsSync(join(ROOT, 'public', 'thumbs', card.thumb))) out.push(`${card.id}: нет файла превью ${card.thumb}`);

    const dir = card.id === '101' ? 'sto' : card.id;
    const seoFile = join(ROOT, 'src', 'games', dir, 'seo.ts');
    if (!existsSync(seoFile)) out.push(`${card.id}: нет seo.ts`);
    else {
      const seo = ((await import(pathToFileURL(seoFile).href)) as { seo?: { faq?: unknown[]; title?: string; h1?: string; description?: string; intro?: string } }).seo ?? {};
      for (const k of ['title', 'h1', 'description', 'intro'] as const) if (!seo[k]) out.push(`${card.id}: seo без ${k}`);
      const n = seo.faq?.length ?? 0;
      if (n < 4 || n > 5) out.push(`${card.id}: seo.faq — ${n} вопросов (нужно 4–5)`);
    }

    const load = (DEFS as Record<string, (() => Promise<Def>) | undefined>)[card.id];
    if (!load) continue;
    const def = await load();
    if (def.bot.levels.length < 3) out.push(`${card.id}: уровней ботов ${def.bot.levels.length} (нужно 3)`);
    if (!def.rules.goal?.trim()) out.push(`${card.id}: в правилах нет цели`);
    const noDemo = def.rules.sections.filter((s) => !s.demo).length;
    if (noDemo === def.rules.sections.length) out.push(`${card.id}: ни у одного раздела правил нет показа`);
  }
  return out;
}

describe('требования к каждой игре (CLAUDE.md)', () => {
  it('нет новых расхождений', async () => {
    const all = await problems();
    if (AUDIT) console.log(all.join('\n'));
    const fresh = all.filter((p) => !(p in KNOWN));
    expect(fresh, 'новые расхождения').toEqual([]);
  }, 180_000);

  it('список KNOWN не устарел', async () => {
    const all = new Set(await problems());
    expect(Object.keys(KNOWN).filter((k) => !all.has(k)), 'уже исправлено — убрать из KNOWN').toEqual([]);
  }, 180_000);
});
