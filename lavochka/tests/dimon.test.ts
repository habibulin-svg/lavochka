// Димон — помощник по покеру: общий с Михалычем запас и потолок сайта, права, учёт по помощникам, миграция;
// обстановка словами (poker/dimon-facts.ts) — только своё: чужих закрытых карт нет ни в каком месте партии.
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MIGRATIONS } from '../server/accounts/pg';
import { MemoryAccountStore } from '../server/accounts/store';
import { AiDesk } from '../server/ai';
import { buildMessages, Dimon, PERSONA } from '../server/dimon';
import { Mihalych } from '../server/mihalych';
import type { Card } from '../src/cards/deck';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/poker/ai';
import { def } from '../src/games/poker/def';
import { cardWord, handFacts, oppFacts, statsFacts, tableFacts } from '../src/games/poker/dimon-facts';
import { apply, makeView, type HandRecord, type State } from '../src/games/poker/engine';
import { emptyHud, recordHand } from '../src/games/poker/hud';
import { isOfc } from '../src/games/poker/ofc/engine';
import { zero } from '../src/games/poker/stats';

let ipN = 0;
function setup(cost = 20, conf: { userRub?: number; siteRub?: number } = {}) {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const sent: any[] = [];
  const http = async (_url: string, init: { body: string }) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: '**Пасуй**, братан.' } }], usage: { prompt_tokens: 1500, completion_tokens: 200, cost } }) };
  };
  const desk = new AiDesk(acc, { key: 'k', userRub: conf.userRub ?? 30, siteRub: conf.siteRub ?? 3000 }, () => {}, http);
  const ctx = (sid?: string, now = Date.UTC(2026, 9, 21, 12)) => ({ sid, ip: '10.4.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru', now });
  return { acc, desk, mihalych: new Mihalych(desk), dimon: new Dimon(desk), ctx, sent };
}

async function user(acc: Accounts, ctx: (sid?: string) => any, rights: string[] = ['ai'], email = 'igrok@x.ru') {
  const r = await acc.register({ email, password: 'пароль-игрока', consent: true, name: 'Игрок' }, ctx());
  const id = (r.body.user as any).id as number;
  for (const x of rights) await acc.store.grant(id, x, null, null);
  return { sid: r.sid as string, id };
}

const chess = { kind: 'hint' as const, fen: '8/8/8/8/8/8/8/K6k w - - 0 1' };
const poker = { kind: 'move' as const, facts: 'Твои карты: туз пик, король пик.' };

describe('Димон: сервер', () => {
  it('без ключа выключен; без входа и без подписки — свой отказ', async () => {
    const off = new Dimon(new AiDesk(new Accounts(new MemoryAccountStore(), new MemoryMailer()), { key: null }));
    const { dimon, acc, ctx } = setup();
    expect((await off.ask(poker, ctx())).code).toBe(503);
    expect((await dimon.ask(poker, ctx())).code).toBe(401);
    const u = await user(acc, ctx, []);
    const r = await dimon.ask(poker, ctx(u.sid));
    expect(r.code).toBe(403);
    expect(String(r.body.message)).toContain('Димона');
    expect(String(r.body.message)).toContain('Лавочки+');
    expect((await dimon.status(ctx(u.sid))).body).toMatchObject({ enabled: true, allowed: false, reason: 'plus' });
    expect((await dimon.ask({ kind: 'x' } as any, ctx((await user(acc, ctx, ['ai'], 'b@x.ru')).sid))).code).toBe(400);
  });

  it('ответ без разметки, промпт — характер Димона и обстановка, учёт с пометкой помощника', async () => {
    const { dimon, acc, ctx, sent } = setup(0.02);
    const u = await user(acc, ctx);
    const r = await dimon.ask(poker, ctx(u.sid));
    expect(r.code).toBe(200);
    expect(r.body.text).toBe('Пасуй, братан.');
    expect(sent[0].messages[0]).toEqual({ role: 'system', content: PERSONA });
    expect(sent[0].messages[1].content).toContain('туз пик, король пик');
    expect(sent[0].messages[1].content).toContain('Посоветуй ход');
    const t = await acc.store.aiTotal('2026-10');
    expect(t.helpers).toEqual({ dimon: { cost: 20000, requests: 1 } });
  });

  it('запас один на двоих: Михалыч потратил — у Димона меньше; кончился — у каждого своя шутка', async () => {
    const { mihalych, dimon, acc, ctx } = setup(20);
    const u = await user(acc, ctx);
    expect((await mihalych.ask(chess, ctx(u.sid))).code).toBe(200);
    const st = await dimon.status(ctx(u.sid));
    expect(st.body.left).toBeCloseTo(1 / 3, 5);
    expect((await dimon.ask(poker, ctx(u.sid))).code).toBe(200);
    const d = await dimon.ask(poker, ctx(u.sid));
    expect(d.code).toBe(429);
    expect(d.body.error).toBe('zapoy');
    expect(String(d.body.message)).toContain('проигрался в ноль до 1 ноября');
    const m = await mihalych.ask(chess, ctx(u.sid));
    expect(String(m.body.message)).toContain('в запое до 1 ноября');
    expect(String((await dimon.status(ctx(u.sid))).body.zapoy)).toContain('проигрался в ноль');
    expect(await acc.store.aiUsage(u.id, '2026-10')).toEqual({ cost: 40_000_000, requests: 2 });
    const t = await acc.store.aiTotal('2026-10');
    expect(t).toMatchObject({ cost: 40_000_000, requests: 2, users: 1, helpers: { mihalych: { cost: 20_000_000, requests: 1 }, dimon: { cost: 20_000_000, requests: 1 } } });
    // безлимит не упирается
    const vip = await user(acc, ctx, ['ai', 'ai_unlimited'], 'vip@x.ru');
    for (let i = 0; i < 3; i++) expect((await dimon.ask(poker, ctx(vip.sid))).code).toBe(200);
  });

  it('потолок сайта общий: расход Михалыча у одного и Димона у другого — Димон «охрип»', async () => {
    const { mihalych, dimon, acc, ctx } = setup(20, { siteRub: 35 });
    const a = await user(acc, ctx, ['ai'], 'a@x.ru');
    const b = await user(acc, ctx, ['ai'], 'b@x.ru');
    expect((await mihalych.ask(chess, ctx(a.sid))).code).toBe(200);
    expect((await dimon.ask(poker, ctx(b.sid))).code).toBe(200);
    const r = await dimon.ask(poker, ctx(a.sid));
    expect(r.code).toBe(429);
    expect(r.body.error).toBe('sick');
    expect(String(r.body.message)).toContain('Димон охрип до 1 ноября');
    expect(String((await mihalych.ask(chess, ctx(b.sid))).body.message)).toContain('Михалыч слёг');
  });

  it('частота — общая: шесть вопросов в минуту на двоих', async () => {
    const { mihalych, dimon, acc, ctx } = setup(0.001);
    const u = await user(acc, ctx);
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await (i % 2 ? dimon.ask(poker, ctx(u.sid)) : mihalych.ask(chess, ctx(u.sid)))).code);
    expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
    expect(codes[6]).toBe(429);
  });

  it('админка: расход по помощникам', async () => {
    const { mihalych, dimon, acc, ctx } = setup(1);
    const u = await user(acc, ctx);
    await mihalych.ask(chess, ctx(u.sid));
    await dimon.ask(poker, ctx(u.sid));
    await dimon.ask(poker, ctx(u.sid));
    const master = await user(acc, ctx, ['master'], 'master@x.ru');
    const r = await mihalych.admin(ctx(master.sid));
    expect(r.body).toMatchObject({ rub: 3, requests: 3, users: 1, helpers: { mihalych: { requests: 1 }, dimon: { requests: 2 } } });
  });

  it('промпт: реплики чередуются, длинное обрезано', () => {
    const msgs = buildMessages({ kind: 'chat', facts: 'x'.repeat(9000), history: [{ role: 'user', text: 'а что?' }, { role: 'dimon', text: 'пасуй' }], question: 'y'.repeat(900) });
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[1].content.length).toBeLessThan(6500);
    expect(msgs[3].content.length).toBe(500);
  });

  it('миграция: у расхода — помощник, ключ (пользователь, период, помощник)', () => {
    const m = MIGRATIONS[11];
    expect(MIGRATIONS.length).toBeGreaterThanOrEqual(12);
    expect(m).toContain("add column helper text not null default 'mihalych'");
    expect(m).toContain('drop constraint ai_usage_pkey');
    expect(m).toContain('add primary key (user_id, month, helper)');
  });
});

// ---------------------------------------------------------------- обстановка словами

const key = (c: Card) => c.s + c.r;

/** Карты, которых место me не видит сейчас: чужие закрытые (не открытые в стаде и не вскрытые) и чужие сбросы. */
function hiddenFrom(s: State, me: number): Card[] {
  const seen = new Set<string>([...(s.hole[me] ?? []), ...s.board].map(key));
  const out: Card[] = [];
  for (const p of s.seats) {
    if (p === me) continue;
    if (s.shown[p]) s.shown[p].forEach((c) => seen.add(key(c)));
    s.hole[p].forEach((c, i) => (s.up[p]?.[i] || s.shown[p] ? seen.add(key(c)) : out.push(c)));
  }
  for (const a of s.rec?.acts ?? []) {
    if (!('seat' in a) || a.seat === me) continue;
    if (a.k === 'draw') out.push(...(a.out.filter(Boolean) as Card[]));
    if (a.k === 'discard' && a.card) out.push(a.card);
    if (a.k === 'card' && a.card && !a.up) out.push(a.card);
  }
  return out.filter((c) => !seen.has(key(c)));
}

describe('Димон: обстановка словами', () => {
  it('карты словами', () => {
    expect(cardWord({ s: 'S', r: 14 })).toBe('туз пик');
    expect(cardWord({ s: 'H', r: 10 })).toBe('десятка червей');
  });

  it('на всех видах покера: за столом и в разборе раздачи — только своё, чужих закрытых карт нет', () => {
    const names: Record<number, string> = { 0: 'Я', 1: 'Вовка', 2: 'Светка', 3: 'Ленка' };
    for (const p of def.presets!.filter((x) => !isOfc(x.options.mode))) {
      const opts = { ...Object.fromEntries(def.options!.map((o) => [o.key, o.default])), ...p.options, hands: 5 };
      const r0 = new SeededRng(23);
      let s = <State>def.setup([0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot', level: 1, name: '' })), opts, r0);
      let guard = 0;
      let checked = 0;
      let hud = emptyHud();
      while (!s.over && guard++ < 3000) {
        if (s.inHand.includes(0) && guard % 2 === 0) {
          const text = tableFacts(makeView(s, [0]), 0, { name: (x) => names[x], eq: null, bots: hud.bots });
          for (const c of hiddenFrom(s, 0)) expect(text, `${p.id}: «${cardWord(c)}» утекла за столом`).not.toContain(cardWord(c));
          checked++;
        }
        const seat = s.turn;
        const a = choose(makeView(s, [seat]), seat, 1, r0)!;
        const hidden = hiddenFrom(s, 0);
        const r = apply(s, seat, a, r0)!;
        for (const e of r.events) {
          if (e.type !== 'hand') continue;
          const rec = e.rec as HandRecord;
          if (!rec.seats.some((x) => x.seat === 0)) continue;
          const text = handFacts(rec, 0, names);
          const shown = new Set(Object.values(rec.shown).flat().map(key));
          for (const c of hidden.filter((c) => !shown.has(key(c)) && !rec.board.some((b) => key(b) === key(c))))
            expect(text, `${p.id}: «${cardWord(c)}» утекла в разборе`).not.toContain(cardWord(c));
          recordHand(hud, rec, 0, names);
        }
        s = r.state;
      }
      expect(checked, p.id).toBeGreaterThan(3);
      hud = { ...hud };
      expect(statsFacts(hud)).toContain('Твои раздачи');
    }
  }, 120_000);

  it('статистика соперника: цифры, нормы и предупреждение о малом числе раздач', () => {
    const c = { ...zero(), hands: 12, vpip: 7, pfr: 5 };
    const t = oppFacts('Димон', c);
    expect(t).toContain('Раздач при тебе: 12 — мало');
    expect(t).toContain('VPIP — вход в банк: 58%');
  });
});
