// «Вкладыши» на сервере без сети: коллекция под аккаунтом, жвачки, кон в комнате, обмен, домашние вкладыши, монеты за рубли.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Accounts } from '../server/accounts/accounts';
import { MemoryMailer } from '../server/accounts/mail';
import { MemoryAccountStore } from '../server/accounts/store';
import { Donate } from '../server/donate';
import type { RobokassaConf } from '../server/pay/robokassa';
import { REWARD_GAP, Vk } from '../server/vkladyshi';
import { COIN_PACKS, REWARD, count, type Collection } from '../src/games/vkladyshi/collection';

const conf: RobokassaConf = { login: 'lavochka', pass1: 'p1', pass2: 'p2', test: true, hash: 'md5', receipt: false, recurring: false, subscription: null };
const md5 = (s: string) => createHash('md5').update(s).digest('hex');

let ipN = 0;
async function setup() {
  const acc = new Accounts(new MemoryAccountStore(), new MemoryMailer());
  const vk = new Vk(acc, conf, () => {}, () => 0.5);
  const ctx = (sid?: string, now?: number) => ({ sid, ip: '10.2.0.' + ++ipN, ua: 'test', site: 'https://lavochka-games.ru', ...(now ? { now } : {}) });
  const user = async (name: string) => {
    const r = await acc.register({ email: `${name}@x.ru`, password: 'пароль-' + name + '-123', consent: true, name }, ctx());
    return { sid: r.sid as string, id: (r.body.user as any).id as number, name };
  };
  return { acc, vk, ctx, user };
}

const collOf = (r: any) => r.body.coll as Collection;
const yardIds = (c: Collection, n: number) => Object.entries(c.owned).filter(([, o]) => o.y > 0).slice(0, n).map(([id]) => id);

describe('коллекция на сервере', () => {
  it('гостю — 401, вошедшему — свежая коллекция; жвачку открывает сервер', async () => {
    const { vk, ctx, user } = await setup();
    expect((await vk.get(ctx())).code).toBe(401);
    const a = await user('Вася');
    const c0 = collOf(await vk.get(ctx(a.sid)));
    expect(c0.coins).toBe(200);
    const r = await vk.gum({ gum: 'turbo' }, ctx(a.sid));
    expect(r.code).toBe(200);
    expect((r.body.got as string[]).length).toBe(3);
    expect(collOf(r).coins).toBe(140);
    // сохранено в базе: новый Vk читает то же
    const again = collOf(await new Vk((vk as any).acc).get(ctx(a.sid)));
    expect(again.coins).toBe(140);
  });

  it('награда за бота — не чаще раза в минуту', async () => {
    const { vk, ctx, user } = await setup();
    const a = await user('Петя');
    const t = Date.now();
    expect((await vk.rewardBot({ win: true }, ctx(a.sid, t))).body.coins).toBe(REWARD.win);
    expect((await vk.rewardBot({ win: true }, ctx(a.sid, t + 1000))).body.coins).toBe(0);
    expect((await vk.rewardBot({ win: false }, ctx(a.sid, t + REWARD_GAP + 1))).body.coins).toBe(REWARD.loss);
  });

  it('перенос из браузера — только домашними и один раз', async () => {
    const { vk, ctx, user } = await setup();
    const a = await user('Коля');
    const r = await vk.import({ coll: { owned: { 'turbo-109': { y: 2, h: 0 } } } }, ctx(a.sid));
    expect(collOf(r).owned['turbo-109']).toEqual({ y: 0, h: 2 });
    expect((await vk.import({ coll: { owned: { 'turbo-110': { y: 1, h: 0 } } } }, ctx(a.sid))).code).toBe(409);
  });
});

describe('кон', () => {
  async function table() {
    const s = await setup();
    const a = await s.user('Аня');
    const b = await s.user('Боря');
    s.vk.join('ROOM1', a.id, a.name);
    s.vk.join('ROOM1', b.id, b.name);
    const ca = collOf(await s.vk.get(s.ctx(a.sid)));
    const cb = collOf(await s.vk.get(s.ctx(b.sid)));
    return { ...s, a, b, ca, cb };
  }

  it('оба согласны — победитель забирает кон соперника; свои колоды подставлены', async () => {
    const { vk, ctx, a, b, ca } = await table();
    const potA = yardIds(ca, 2);
    const cb = collOf(await vk.get(ctx(b.sid)));
    const potB = Object.keys(cb.owned).filter((id) => !potA.includes(id)).slice(0, 1);
    // у Бори этого номера не было до кона — так видно, что пришло
    expect((await vk.stakeSet({ room: 'ROOM1', ids: potA }, ctx(a.sid))).code).toBe(200);
    const r = await vk.stakeSet({ room: 'ROOM1', ids: potB }, ctx(b.sid));
    const sig = r.body.sig as string;
    expect((r.body.foe as any).ids).toEqual(potA);
    await vk.stakeOk({ room: 'ROOM1', sig }, ctx(a.sid));
    await vk.stakeOk({ room: 'ROOM1', sig }, ctx(b.sid));
    // отложенное нельзя отдать в обмен
    const held = vk.held(a.id);
    expect([...held.values()].reduce((x, y) => x + y, 0)).toBe(2);
    const opts = vk.start('ROOM1', [a.id, b.id], { deck0: 'rand', deck1: 'rand' });
    expect(String(opts.deck0)).toMatch(/^c:/);
    expect((await vk.stakeSet({ room: 'ROOM1', ids: [] }, ctx(a.sid))).code).toBe(409);
    const before = { a: structuredClone(collOf(await vk.get(ctx(a.sid))).owned), b: count(collOf(await vk.get(ctx(b.sid))), potA[0]) };
    await vk.settle('ROOM1', [1], [a.id, b.id]);
    const na = collOf(await vk.get(ctx(a.sid)));
    const nb = collOf(await vk.get(ctx(b.sid)));
    expect(count(nb, potA[0])).toBe(before.b + 1);
    expect((na.owned[potA[0]]?.y ?? 0)).toBe(before.a[potA[0]].y - 1);
    expect(nb.log?.[0].text).toMatch(/Кон выигран/);
    expect(na.log?.[0].text).toMatch(/Кон проигран/);
    expect(nb.wins).toBe(1);
    expect(vk.held(a.id).size).toBe(0);
  });

  it('не договорились до начала — на интерес, ничего не переходит', async () => {
    const { vk, ctx, a, b, ca } = await table();
    await vk.stakeSet({ room: 'ROOM1', ids: yardIds(ca, 1) }, ctx(a.sid));
    const r = await vk.stakeSet({ room: 'ROOM1', ids: yardIds(collOf(await vk.get(ctx(b.sid))), 1) }, ctx(b.sid));
    await vk.stakeOk({ room: 'ROOM1', sig: r.body.sig }, ctx(a.sid)); // Боря не согласился
    vk.start('ROOM1', [a.id, b.id], {});
    const owned = JSON.stringify(collOf(await vk.get(ctx(a.sid))).owned);
    await vk.settle('ROOM1', [1], [a.id, b.id]);
    expect(JSON.stringify(collOf(await vk.get(ctx(a.sid))).owned)).toBe(owned);
  });

  it('изменение кона снимает согласие; чужой подписью согласиться нельзя', async () => {
    const { vk, ctx, a, b, ca } = await table();
    const r1 = await vk.stakeSet({ room: 'ROOM1', ids: yardIds(ca, 1) }, ctx(a.sid));
    const r2 = await vk.stakeSet({ room: 'ROOM1', ids: yardIds(collOf(await vk.get(ctx(b.sid))), 1) }, ctx(b.sid));
    expect((await vk.stakeOk({ room: 'ROOM1', sig: r1.body.sig }, ctx(a.sid))).code).toBe(409);
    await vk.stakeOk({ room: 'ROOM1', sig: r2.body.sig }, ctx(a.sid));
    const r3 = await vk.stakeSet({ room: 'ROOM1', ids: yardIds(ca, 2) }, ctx(a.sid));
    expect((r3.body.mine as any).ok).toBe(false);
  });

  it('домашние на кон не идут; чужая комната — нет', async () => {
    const { vk, ctx, a, user } = await table();
    await vk.import({ coll: { owned: { 'turbo-109': { y: 1, h: 0 } } } }, ctx(a.sid));
    const r = await vk.stakeSet({ room: 'ROOM1', ids: ['turbo-109'] }, ctx(a.sid));
    expect(r.code).toBe(400);
    expect(r.body.message).toMatch(/домашний/);
    const c = await user('Чужой');
    expect((await vk.stakeGet(new URLSearchParams('room=ROOM1'), ctx(c.sid))).code).toBe(404);
  });

  it('комната закрылась — кон возвращается', async () => {
    const { vk, ctx, a, ca } = await table();
    await vk.stakeSet({ room: 'ROOM1', ids: yardIds(ca, 1) }, ctx(a.sid));
    expect(vk.held(a.id).size).toBe(1);
    vk.drop('ROOM1');
    expect(vk.held(a.id).size).toBe(0);
  });
});

describe('обмен', () => {
  it('оба согласны — вкладыши переходят разом, журнал у обоих', async () => {
    const { vk, ctx, user } = await setup();
    const a = await user('Даша');
    const b = await user('Женя');
    const ca = collOf(await vk.get(ctx(a.sid)));
    const give = yardIds(ca, 1);
    const t = await vk.tradeOpen(ctx(a.sid));
    const code = t.body.code as string;
    expect((await vk.tradeJoin({ code }, ctx(b.sid))).code).toBe(200);
    const p = await vk.tradePut({ code, ids: give }, ctx(a.sid));
    expect((await vk.tradeOk({ code, sig: 'старая' }, ctx(b.sid))).code).toBe(409);
    await vk.tradeOk({ code, sig: p.body.sig }, ctx(a.sid));
    const before = count(collOf(await vk.get(ctx(b.sid))), give[0]);
    const done = await vk.tradeOk({ code, sig: p.body.sig }, ctx(b.sid));
    expect(done.body.done).toBeTruthy();
    expect(count(collOf(await vk.get(ctx(b.sid))), give[0])).toBe(before + 1);
    expect(collOf(await vk.get(ctx(a.sid))).log?.[0].text).toMatch(/Обмен \(с кем — Женя\)/);
  });

  it('третьему за стол не сесть, домашнее не выложить', async () => {
    const { vk, ctx, user } = await setup();
    const a = await user('Зина');
    const b = await user('Игорь');
    const c = await user('Лёша');
    const code = (await vk.tradeOpen(ctx(a.sid))).body.code as string;
    await vk.tradeJoin({ code }, ctx(b.sid));
    expect((await vk.tradeJoin({ code }, ctx(c.sid))).code).toBe(409);
    await vk.import({ coll: { owned: { 'turbo-110': { y: 1, h: 0 } } } }, ctx(a.sid));
    expect((await vk.tradePut({ code, ids: ['turbo-110'] }, ctx(a.sid))).code).toBe(400);
  });
});

describe('монеты за рубли', () => {
  it('заказ → уведомление кассы → купленные монеты; жвачка на них — домашняя', async () => {
    const { acc, vk, ctx, user } = await setup();
    const don = new Donate(acc, conf);
    don.onPaid = (d) => vk.paid(d);
    const a = await user('Миша');
    const r = await vk.buy({ pack: 's' }, ctx(a.sid));
    expect(r.code).toBe(200);
    const f = (r.body.form as any).fields;
    const pack = COIN_PACKS.find((p) => p.id === 's')!;
    const ok = await don.result({ OutSum: f.OutSum, InvId: f.InvId, SignatureValue: md5(`${f.OutSum}:${f.InvId}:p2`) });
    expect(ok).toBe('OK' + f.InvId);
    // повторное уведомление монет не удваивает
    await don.result({ OutSum: f.OutSum, InvId: f.InvId, SignatureValue: md5(`${f.OutSum}:${f.InvId}:p2`) });
    const c = collOf(await vk.get(ctx(a.sid)));
    expect(c.hcoins).toBe(pack.coins);
    // покупка не считается пожертвованием
    expect(await acc.store.donatedSince(0)).toBe(0);
    const g = await vk.gum({ gum: 'turbo' }, ctx(a.sid));
    const got = g.body.got as string[];
    const after = collOf(g);
    expect(after.hcoins).toBe(pack.coins - 60);
    expect(after.coins).toBe(200);
    for (const id of got) expect(after.owned[id].h).toBeGreaterThan(0);
  });
});
