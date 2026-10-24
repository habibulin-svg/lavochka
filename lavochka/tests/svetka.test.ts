// Светка — толковательница раскладов: права и общий запас с Михалычем и Димоном, проверка расклада, значения — из
// справочника (модель получает места, карты и значения словами), тяжёлые вопросы — без модели, с телефоном доверия.
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { AiDesk } from '../server/ai';
import { Dimon } from '../server/dimon';
import { buildMessages, CRISIS_TEXT, PERSONA, Svetka, validAsk, type SvetkaAsk } from '../server/svetka';
import { KARTY36 } from '../src/games/gadanie/reading';

let ipN = 0;
function setup(cost = 0.02) {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const sent: any[] = [];
  const http = async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '**Ну что**, подруга, расклад непростой.' } }], usage: { prompt_tokens: 2000, completion_tokens: 400, cost } }) };
  };
  const desk = new AiDesk(acc, { key: 'k', userRub: 30, siteRub: 3000 }, () => {}, http);
  const ctx = (sid?: string, now = Date.UTC(2026, 9, 24, 12)) => ({ sid, ip: '10.7.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru', now });
  return { acc, desk, svetka: new Svetka(desk), dimon: new Dimon(desk), ctx, sent };
}

async function user(acc: Accounts, ctx: (sid?: string) => any, rights: string[] = ['ai'], email = 'gadaet@x.ru') {
  const r = await acc.register({ email, password: 'пароль-игрока', consent: true, name: 'Гадающая' }, ctx());
  const id = (r.body.user as any).id as number;
  for (const x of rights) await acc.store.grant(id, x, null, null);
  return { sid: r.sid as string, id };
}

const three: SvetkaAsk = { deck: 'taro', spread: 'tri-karty', cards: [{ card: 16, rev: false }, { card: 17, rev: true }, { card: 22, rev: false }], question: 'Менять ли работу?' };

describe('Светка: сервер', () => {
  it('без входа и без подписки — свой отказ; с подпиской — толкование без разметки, учёт как «svetka»', async () => {
    const { svetka, acc, ctx, sent } = setup();
    expect((await svetka.ask(three, ctx())).code).toBe(401);
    const no = await user(acc, ctx, []);
    const r0 = await svetka.ask(three, ctx(no.sid));
    expect(r0.code).toBe(403);
    expect(String(r0.body.message)).toContain('Светки');
    const u = await user(acc, ctx, ['ai'], 'b@x.ru');
    const r = await svetka.ask(three, ctx(u.sid));
    expect(r.code).toBe(200);
    expect(r.body.text).toBe('Ну что, подруга, расклад непростой.');
    expect(sent[0].messages[0]).toEqual({ role: 'system', content: PERSONA });
    const facts = sent[0].messages[1].content as string;
    expect(facts).toContain('Менять ли работу?');
    expect(facts).toContain('XVI. Башня');
    expect(facts).toContain('XVII. Звезда, старший аркан, ПЕРЕВЁРНУТА');
    expect(facts).toContain('Место «Будущее»');
    expect(facts).toContain('Туз Жезлов');
    expect((await acc.store.aiTotal('2026-10')).helpers).toEqual({ svetka: { cost: 20000, requests: 1 } });
  });

  it('запас общий с Димоном', async () => {
    const { svetka, dimon, acc, ctx } = setup(20);
    const u = await user(acc, ctx);
    expect((await svetka.ask(three, ctx(u.sid))).code).toBe(200);
    expect((await dimon.status(ctx(u.sid))).body.left).toBeCloseTo(1 / 3, 5);
  });

  it('расклад проверяется: число карт, повторы, чужие номера, колода, загаданный человек', () => {
    expect(validAsk(three)).toBeNull();
    expect(validAsk({ ...three, cards: three.cards.slice(0, 2) })).toBeTruthy();
    expect(validAsk({ ...three, cards: [three.cards[0], three.cards[0], three.cards[1]] })).toBeTruthy();
    expect(validAsk({ ...three, cards: [{ card: 99, rev: false }, three.cards[1], three.cards[2]] })).toBeTruthy();
    expect(validAsk({ ...three, deck: 'karty' })).toBeTruthy();
    const cards = Array.from({ length: 8 }, (_, i) => ({ card: i, rev: false }));
    expect(validAsk({ deck: 'karty', spread: 'na-korolya', cards })).toBeTruthy();
    const queen = KARTY36.findIndex((c) => c.s === 'H' && c.r === 12);
    expect(validAsk({ deck: 'karty', spread: 'na-korolya', cards, person: queen })).toBeNull();
    const m = buildMessages({ deck: 'karty', spread: 'na-korolya', cards, person: queen });
    expect(m[1].content).toContain('Гадают на человека: дама червей');
    // у обычной колоды перевёрнутых нет, даже если клиент прислал
    expect(buildMessages({ ...three, deck: 'karty', spread: 'tri-36', cards: [{ card: 0, rev: true }, { card: 1, rev: false }, { card: 2, rev: false }] })[1].content).not.toContain('ПЕРЕВЁРНУТА');
  });

  it('беда в вопросе — без модели и без расхода, с телефоном доверия', async () => {
    const { svetka, acc, ctx, sent } = setup();
    const u = await user(acc, ctx);
    const r = await svetka.ask({ ...three, question: 'Иногда не хочу жить, что скажут карты?' }, ctx(u.sid));
    expect(r.code).toBe(200);
    expect(r.body.text).toBe(CRISIS_TEXT);
    expect(CRISIS_TEXT).toContain('8-800-2000-122');
    expect(sent).toHaveLength(0);
  });

  it('уточнение — после толкования, история уходит репликами', () => {
    const m = buildMessages({ ...three, history: [{ role: 'svetka', text: 'Башня говорит о перемене.' }], ask: 'А когда?' });
    expect(m.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(m[3].content).toBe('А когда?');
  });
});
