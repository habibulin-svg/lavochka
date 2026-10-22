// «Совет Михалыча» без сети: права, лимит и «запой», безлимит, промпт только из данных, учёт расхода.
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { backOn, buildMessages, contextText, Mihalych, monthOf, PERSONA } from '../server/mihalych';
import { START_FEN as START } from '../src/games/chess/notation';

let ipN = 0;
function setup(cost = 0.02, conf: { key?: string | null; userRub?: number; siteRub?: number } = {}) {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const sent: any[] = [];
  const http = async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '**Эх**, конь — фигура хитрая.' } }], usage: { prompt_tokens: 1500, completion_tokens: 200, cost } }) };
  };
  const m = new Mihalych(acc, { key: 'key' in conf ? conf.key! : 'k', userRub: conf.userRub ?? 30, siteRub: conf.siteRub ?? 3000 }, () => {}, http);
  const ctx = (sid?: string, now = Date.UTC(2026, 9, 21, 12)) => ({ sid, ip: '10.3.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru', now });
  return { acc, m, ctx, sent };
}

async function user(acc: Accounts, ctx: (sid?: string) => any, rights: string[] = ['ai'], email = 'uchenik@x.ru') {
  const r = await acc.register({ email, password: 'пароль-ученика', consent: true, name: 'Ученик' }, ctx());
  const id = (r.body.user as any).id as number;
  for (const x of rights) await acc.store.grant(id, x, null, null);
  return { sid: r.sid as string, id };
}

const ask = { kind: 'mistake' as const, fen: '8/8/8/8/8/8/8/K6k w - - 0 1', engine: { played: 'Сb5', before: '0,0', after: '−1,5', best: 'd3' } };

describe('Совет Михалыча', () => {
  it('без ключа выключен, без входа и без подписки — понятный отказ', async () => {
    const off = setup(0.02, { key: null });
    expect((await off.m.ask(ask, off.ctx())).code).toBe(503);
    const { m, acc, ctx } = setup();
    expect((await m.ask(ask, ctx())).code).toBe(401);
    const u = await user(acc, ctx, []);
    const r = await m.ask(ask, ctx(u.sid));
    expect(r.code).toBe(403);
    expect(String(r.body.message)).toContain('Лавочки+');
  });

  it('подписчик получает ответ без разметки, расход записан', async () => {
    const { m, acc, ctx, sent } = setup();
    const u = await user(acc, ctx);
    const r = await m.ask(ask, ctx(u.sid));
    expect(r.code).toBe(200);
    expect(r.body.text).toBe('Эх, конь — фигура хитрая.');
    expect(sent[0].model).toBe('~deepseek/deepseek-v4-flash-latest');
    expect(sent[0].messages[0]).toEqual({ role: 'system', content: PERSONA });
    expect(await acc.store.aiUsage(u.id, '2026-10')).toEqual({ cost: 20000, requests: 1 });
  });

  it('лимит кончился — «в запое до 1 ноября», безлимит и Мастер не упираются', async () => {
    const { m, acc, ctx } = setup(31);
    const u = await user(acc, ctx);
    expect((await m.ask(ask, ctx(u.sid))).code).toBe(200);
    const r = await m.ask(ask, ctx(u.sid));
    expect(r.code).toBe(429);
    expect(r.body.error).toBe('zapoy');
    expect(String(r.body.message)).toContain('в запое до 1 ноября');
    expect((await m.status(ctx(u.sid))).body).toMatchObject({ allowed: true, left: 0 });
    // следующий месяц — снова можно
    expect((await m.ask(ask, ctx(u.sid, Date.UTC(2026, 10, 1, 9)))).code).toBe(200);
    const vip = await user(acc, ctx, ['ai', 'ai_unlimited'], 'vip@x.ru');
    expect((await m.ask(ask, ctx(vip.sid))).code).toBe(200);
    expect((await m.ask(ask, ctx(vip.sid))).code).toBe(200);
    const master = await user(acc, ctx, ['master'], 'master@x.ru');
    expect((await m.ask(ask, ctx(master.sid))).code).toBe(200);
    expect((await m.ask(ask, ctx(master.sid))).code).toBe(200);
    expect((await m.status(ctx(master.sid))).body).toMatchObject({ unlimited: true, left: null });
  });

  it('частые вопросы притормаживает', async () => {
    const { m, acc, ctx } = setup(0.001);
    const u = await user(acc, ctx);
    const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await m.ask(ask, ctx(u.sid))).code);
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    expect(codes[7]).toBe(429);
  });

  it('промпт: данные движка одним сообщением, реплики чередуются, длинное обрезано', () => {
    const msgs = buildMessages({
      ...ask,
      kind: 'chat',
      history: [
        { role: 'user', text: 'а почему?' },
        { role: 'mihalych', text: 'потому что слон висит' },
      ],
      question: 'x'.repeat(2000),
    });
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toContain('Ход ученика: Сb5');
    expect(msgs[1].content).toContain('Лучший ход по движку: d3');
    expect(msgs[1].content).not.toContain('Дебют');
    expect(msgs.map((x) => x.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[3].content.length).toBe(500);
  });

  it('промпт: доска и ходы движка словами (модель не читает FEN сама)', () => {
    const text = contextText({
      kind: 'hint',
      fen: 'r1bq3r/ppp3pp/2n3k1/3pP1N1/1b1p4/6Q1/PPPB1PPP/RN2K2R b KQ - 0 1',
      engine: { best: 'С:d2+', line: '1... С:d2+ 2. Кр:d2 Ф:g5+' },
    });
    expect(text).toContain('Белые фигуры: король e1, ферзь g3, ладьи a1 и h1, слон d2, кони b1 и g5');
    expect(text).toContain('белый слон d2 — нападает слон, защищает конь и король');
    expect(text).toContain('С:d2+ (словами: чёрный слон с b4 берёт белого слона на d2, шах)');
    expect(text).toContain('затем белый король с e1 берёт чёрного слона на d2');
    // ход ученика — от позиции перед ним, ответ соперника — после
    const r = contextText({ kind: 'review', fen: '8/8/8/8/8/8/8/8 w - - 0 1', engine: { at: START, played: 'e4', reply: '1... c5' } });
    expect(r).toContain('e4 (словами: белая пешка с e2 идёт на e4)');
    expect(r).toContain('c5 (словами: чёрная пешка с c7 идёт на c5)');
  });

  it('месяц и дата возвращения — по Москве', () => {
    expect(monthOf(Date.UTC(2026, 9, 31, 22))).toBe('2026-11');
    expect(backOn(Date.UTC(2026, 11, 20))).toBe('1 января');
  });
});

describe('Михалыч: запас — на оплаченный месяц подписки', () => {
  it('подписка с 10 октября: запой до 10 ноября, 1-го не сбрасывается, после продления — снова можно; общий потолок — календарный', async () => {
    const { m, acc, ctx } = setup(31);
    const u = await user(acc, ctx, []);
    const paid = Date.UTC(2026, 9, 10, 9);
    const pay = async (t: number) => {
      const id = await acc.store.createPlusOrder({ userId: u.id, amount: 29_900, days: 30, recurring: false, parentId: null });
      const until = (await acc.store.payPlusOrder(id, t))!;
      await acc.store.grant(u.id, 'ai', until, null);
    };
    await pay(paid);
    expect((await m.ask(ask, ctx(u.sid))).code).toBe(200);
    const r = await m.ask(ask, ctx(u.sid));
    expect(r.code).toBe(429);
    expect(String(r.body.message)).toContain('в запое до 10 ноября');
    expect((await m.ask(ask, ctx(u.sid, Date.UTC(2026, 10, 2, 9)))).code).toBe(429);
    await pay(Date.UTC(2026, 10, 9, 9));
    expect((await m.ask(ask, ctx(u.sid, Date.UTC(2026, 10, 10, 12)))).code).toBe(200);
    // общий учёт сайта — по календарным месяцам
    expect((await acc.store.aiTotal('2026-10')).cost).toBe(31_000_000);
    expect((await acc.store.aiTotal('2026-11')).cost).toBe(31_000_000);
  });
});

