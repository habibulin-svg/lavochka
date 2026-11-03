/* «Вкладыши» на сервере (DESIGN.md §5–8): коллекция вошедшего игрока, жвачки (выпадение считает сервер), кон в сетевой партии,
 * обмен и монеты за рубли. Логика — класс Vk (тесты — tests/vkladyshi-server.test.ts), HTTP — vkApi.
 *   GET  /api/vk                       — { coll, held, pay }: коллекция, отложенные на кон/в обмен номера, включена ли оплата
 *   POST /api/vk/gum {gum}             — открыть жвачку → { got: [id], coll }
 *   POST /api/vk/dust                  — сдать повторы сверх двух → { coins, coll }
 *   POST /api/vk/decks {decks, active} — сохранить колоды
 *   POST /api/vk/reward {win}          — награда за партию с ботом (не чаще REWARD_GAP, не больше REWARD_DAY в сутки)
 *   POST /api/vk/import {coll}         — один раз перенести браузерную коллекцию: вкладыши — домашними, монеты — нет
 *   POST /api/vk/buy {pack}            — монеты за рубли: форма Robokassa (заказ — в donations с purpose 'vk')
 *   GET  /api/vk/stake?room=КОД        — кон за столом: { mine, foe, sig, locked }
 *   POST /api/vk/stake {room, ids}     — положить на кон свои дворовые (любое изменение снимает согласие обоих)
 *   POST /api/vk/stake/ok {room, sig}  — согласиться на этот кон
 *   POST /api/vk/trade/open            — открыть стол обмена → { code }
 *   POST /api/vk/trade/join {code}     — сесть за стол обмена
 *   GET  /api/vk/trade?code=…          — стол обмена: { mine, foe, sig, done }
 *   POST /api/vk/trade/put {code, ids} — выложить свои дворовые (снимает согласие обоих)
 *   POST /api/vk/trade/ok {code, sig}  — согласиться; оба согласны — обмен проходит разом
 *   POST /api/vk/trade/leave {code}    — встать из-за стола
 * Все изменения коллекций идут по одному (очередь lock): кон и обмен трогают двоих сразу, запись — одной транзакцией (putSaves). */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomInt } from 'node:crypto';
import { Limiter, type Accounts, type Ctx, type Reply } from './accounts/accounts';
import { cookieOf, sameOrigin, send, siteOf } from './accounts/http';
import type { Donation } from './accounts/store';
import { payForm, type RobokassaConf } from './pay/robokassa';
import { card } from '../src/games/vkladyshi/cards';
import {
  COIN_PACKS,
  STAKE_MAX,
  addLog,
  checkYard,
  deckSpec,
  deckValid,
  dustExtras,
  fresh,
  moveYard,
  normalize,
  openGum,
  reward,
  type Collection,
} from '../src/games/vkladyshi/collection';
import type { Options } from '../src/core/types';

const KEY = 'vk:coll';
const err = (code: number, error: string, message: string): Reply => ({ code, body: { error, message } });
/** Награда за партию с ботом — не чаще раза в REWARD_GAP и не больше REWARD_DAY в сутки (партию не проверить: её ведёт браузер). */
export const REWARD_GAP = 60_000;
export const REWARD_DAY = 30;
/** Стол обмена без движения закрывается. */
const TRADE_TTL = 30 * 60_000;

interface Side {
  uid: number;
  name: string;
  ids: string[];
  ok: boolean;
}
interface Stake {
  sides: Map<number, Side>;
  /** Партия идёт на этот кон: менять нельзя; места → аккаунты. */
  locked: { seats: (number | null)[] } | null;
}
interface Trade {
  sides: Side[];
  at: number;
  done: string | null;
}

const cleanIds = (v: unknown): string[] | null => {
  if (!Array.isArray(v) || v.length > STAKE_MAX) return null;
  const ids = v.map(String);
  try {
    ids.forEach((id) => card(id));
  } catch {
    return null;
  }
  return ids;
};
const sigOf = (sides: Iterable<Side>) =>
  [...sides]
    .sort((a, b) => a.uid - b.uid)
    .map((s) => `${s.uid}:${[...s.ids].sort().join(',')}`)
    .join('|');
const names = (ids: string[]) => ids.map((id) => `«${card(id).name}»`).join(', ');

export class Vk {
  private cache = new Map<number, Collection>();
  private queue: Promise<unknown> = Promise.resolve();
  private stakes = new Map<string, Stake>();
  /** Кто сидел в комнате (только они договариваются о коне). */
  private members = new Map<string, Map<number, string>>();
  private trades = new Map<string, Trade>();
  private rewards = new Map<number, number[]>();
  private often = new Limiter(240, 3600_000);
  private buyLimit = new Limiter(20, 3600_000);

  constructor(
    private acc: Accounts,
    private pay: RobokassaConf | null = null,
    private log: (s: string) => void = () => {},
    private rand: () => number = () => randomInt(0, 2 ** 32) / 2 ** 32
  ) {}

  get payEnabled() {
    return !!this.pay;
  }

  /** Все изменения коллекций — по одному. */
  private lock<T>(f: () => Promise<T>): Promise<T> {
    const run = this.queue.then(f, f);
    this.queue = run.catch(() => {});
    return run;
  }

  async coll(uid: number): Promise<Collection> {
    const c = this.cache.get(uid);
    if (c) return c;
    const s = await this.acc.store.getSave(uid, KEY);
    let parsed: Collection | null = null;
    try {
      parsed = s?.data ? JSON.parse(s.data) : null;
    } catch {
      parsed = null;
    }
    const got = normalize(parsed);
    if (this.cache.size > 5000) this.cache.clear();
    this.cache.set(uid, got);
    return got;
  }

  private async put(...list: [number, Collection][]) {
    const at = Date.now();
    await this.acc.store.putSaves(list.map(([userId, c]) => ({ userId, game: KEY, at, data: JSON.stringify(c) })));
  }

  /** Отложенные номера игрока: всё, что лежит на конах и столах обмена. */
  held(uid: number, except?: object): Map<string, number> {
    const m = new Map<string, number>();
    const add = (ids: string[]) => ids.forEach((id) => m.set(id, (m.get(id) ?? 0) + 1));
    for (const st of this.stakes.values()) if (st !== except) add(st.sides.get(uid)?.ids ?? []);
    for (const t of this.trades.values()) if (t !== except && !t.done) add(t.sides.find((x) => x.uid === uid)?.ids ?? []);
    return m;
  }

  private async user(ctx: Ctx) {
    return this.acc.current(ctx).catch(() => null);
  }

  private async out(uid: number, extra: Record<string, unknown> = {}): Promise<Reply> {
    return { code: 200, body: { coll: await this.coll(uid), held: Object.fromEntries(this.held(uid)), pay: this.payEnabled, ...extra } };
  }

  async get(ctx: Ctx): Promise<Reply> {
    const u = await this.user(ctx);
    if (!u) return err(401, 'auth', 'Войдите — коллекция хранится на сервере.');
    return this.out(u.id);
  }

  /** Общая обвязка изменений одной коллекции. */
  private async change(ctx: Ctx, f: (c: Collection, uid: number) => Reply | Record<string, unknown> | null): Promise<Reply> {
    const u = await this.user(ctx);
    if (!u) return err(401, 'auth', 'Войдите заново.');
    if (!this.often.take(String(u.id), ctx.now)) return err(429, 'often', 'Слишком часто. Подождите немного.');
    return this.lock(async () => {
      const c = await this.coll(u.id);
      const before = JSON.stringify(c);
      const r = f(c, u.id);
      if (r && 'code' in r && typeof r.code === 'number') {
        this.cache.set(u.id, normalize(JSON.parse(before)));
        return r as Reply;
      }
      await this.put([u.id, c]);
      return this.out(u.id, (r as Record<string, unknown>) ?? {});
    });
  }

  gum(b: any, ctx: Ctx) {
    return this.change(ctx, (c) => {
      const got = openGum(c, String(b?.gum ?? ''), this.rand);
      return got ? { got: got.map((x) => x.id) } : err(400, 'coins', 'Не хватает монет на эту жвачку.');
    });
  }

  dust(ctx: Ctx) {
    return this.change(ctx, (c, uid) => ({ coins: dustExtras(c, this.held(uid)) }));
  }

  decks(b: any, ctx: Ctx) {
    return this.change(ctx, (c) => {
      const list = Array.isArray(b?.decks) ? b.decks.slice(0, 20) : null;
      if (!list || !list.length) return err(400, 'decks', 'Нет колод.');
      const decks = list.map((d: any) => ({ name: String(d?.name ?? 'Колода').trim().slice(0, 24) || 'Колода', ids: Array.isArray(d?.ids) ? d.ids.slice(0, 30).map(String) : [] }));
      // недособранная колода хранится как есть, но вкладыши — только из своего альбома
      for (const d of decks) if (d.ids.some((id: string) => !c.owned[id])) return err(400, 'deck', 'В колоде вкладыш, которого нет в альбоме.');
      c.decks = decks;
      c.active = Math.max(0, Math.min(decks.length - 1, Math.floor(Number(b?.active) || 0)));
      return {};
    });
  }

  rewardBot(b: any, ctx: Ctx) {
    return this.change(ctx, (c, uid) => {
      const now = ctx.now ?? Date.now();
      const list = (this.rewards.get(uid) ?? []).filter((t) => now - t < 86_400_000);
      if (list.length && now - list[list.length - 1] < REWARD_GAP) return { coins: 0 };
      if (list.length >= REWARD_DAY) return { coins: 0, limit: true };
      list.push(now);
      this.rewards.set(uid, list);
      return { coins: reward(c, !!b?.win) };
    });
  }

  import(b: any, ctx: Ctx) {
    return this.change(ctx, (c) => {
      if (c.imported) return err(409, 'done', 'Коллекция из браузера уже перенесена.');
      c.imported = true;
      const local = b?.coll;
      if (!local || typeof local.owned !== 'object') return {};
      let n = 0;
      for (const [id, o] of Object.entries<any>(local.owned)) {
        try {
          card(id);
        } catch {
          continue;
        }
        // из браузера — проверить нельзя, поэтому домашними: в альбом и колоду можно, на кон и в обмен — нет
        const k = Math.max(0, Math.min(10, Math.floor(Number(o?.y) || 0) + Math.floor(Number(o?.h) || 0)) - (c.owned[id]?.y ?? 0) - (c.owned[id]?.h ?? 0));
        if (!k) continue;
        (c.owned[id] ??= { y: 0, h: 0 }).h += k;
        n += k;
      }
      if (n) addLog(c, `Перенесено из браузера: ${n} вкладышей (домашние)`);
      return { imported: n };
    });
  }

  // ---------------------------------------------------------------- монеты за рубли

  async buy(b: any, ctx: Ctx): Promise<Reply> {
    if (!this.pay) return err(503, 'off', 'Покупка монет ещё не подключена.');
    const u = await this.user(ctx);
    if (!u) return err(401, 'auth', 'Войдите, чтобы купить монеты.');
    const p = COIN_PACKS.find((x) => x.id === b?.pack);
    if (!p) return err(400, 'pack', 'Нет такого набора.');
    if (!this.buyLimit.take(String(u.id), ctx.now)) return err(429, 'often', 'Слишком много попыток подряд.');
    const id = await this.acc.store.createDonation({ userId: u.id, amount: p.rub * 100, purpose: 'vk' });
    return { code: 200, body: { form: payForm(this.pay, { invId: id, amount: p.rub * 100, description: `Вкладыши: ${p.coins} монет`, email: u.emailVerified ? u.email : null }) } };
  }

  /** Оплата пришла (server/donate.ts, один раз на заказ): купленные монеты — в копилку. */
  async paid(d: Donation): Promise<void> {
    if (d.purpose !== 'vk' || d.userId == null) return;
    const p = COIN_PACKS.find((x) => x.rub * 100 === d.amount);
    if (!p) return this.log(`вкладыши: оплата №${d.id} на ${d.amount / 100} ₽ — нет такого набора`);
    const uid = d.userId;
    await this.lock(async () => {
      const c = await this.coll(uid);
      c.hcoins = (c.hcoins ?? 0) + p.coins;
      addLog(c, `Куплено ${p.coins} монет (${p.rub} ₽)`);
      await this.put([uid, c]);
    });
    this.log(`вкладыши: заказ №${d.id} — ${p.coins} монет игроку ${uid}`);
  }

  // ---------------------------------------------------------------- кон (комната сервера)

  /** Игрок вошёл в комнату «Вкладышей». */
  join(room: string, uid: number, name: string) {
    let m = this.members.get(room);
    if (!m) this.members.set(room, (m = new Map()));
    m.set(uid, name);
    void this.coll(uid).catch(() => {});
  }

  private stakeView(room: string, uid: number): Reply {
    const st = this.stakes.get(room);
    const mine = st?.sides.get(uid) ?? null;
    const foe = st ? ([...st.sides.values()].find((s) => s.uid !== uid) ?? null) : null;
    const others = [...(this.members.get(room)?.entries() ?? [])].filter(([id]) => id !== uid).map(([, n]) => n);
    return { code: 200, body: { mine: mine && { ids: mine.ids, ok: mine.ok }, foe: foe && { name: foe.name, ids: foe.ids, ok: foe.ok }, others, sig: st ? sigOf(st.sides.values()) : '', locked: !!st?.locked } };
  }

  async stakeGet(q: URLSearchParams, ctx: Ctx): Promise<Reply> {
    const u = await this.user(ctx);
    if (!u) return err(401, 'auth', 'Играть на кон — только вошедшим.');
    const room = String(q.get('room') ?? '').toUpperCase();
    if (!this.members.get(room)?.has(u.id)) return err(404, 'room', 'Кон — только за столом на сервере.');
    return this.stakeView(room, u.id);
  }

  async stakeSet(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.user(ctx);
    if (!u) return err(401, 'auth', 'Играть на кон — только вошедшим.');
    const room = String(b?.room ?? '').toUpperCase();
    if (!this.members.get(room)?.has(u.id)) return err(404, 'room', 'Кон — только за столом на сервере.');
    const ids = cleanIds(b?.ids);
    if (!ids) return err(400, 'ids', `На кон — от одного до ${STAKE_MAX} вкладышей.`);
    return this.lock(async () => {
      let st = this.stakes.get(room);
      if (st?.locked) return err(409, 'locked', 'Партия уже идёт — кон не меняется.');
      const c = await this.coll(u.id);
      const bad = checkYard(c, ids, this.held(u.id, st));
      if (bad) return err(400, 'yard', bad);
      if (!st) this.stakes.set(room, (st = { sides: new Map(), locked: null }));
      if (!ids.length) st.sides.delete(u.id);
      else st.sides.set(u.id, { uid: u.id, name: u.name, ids, ok: false });
      for (const s of st.sides.values()) s.ok = false;
      if (!st.sides.size) this.stakes.delete(room);
      return this.stakeView(room, u.id);
    });
  }

  async stakeOk(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.user(ctx);
    if (!u) return err(401, 'auth', 'Войдите заново.');
    const room = String(b?.room ?? '').toUpperCase();
    const st = this.stakes.get(room);
    const me = st?.sides.get(u.id);
    if (!st || !me) return err(400, 'none', 'Сначала положите свой вкладыш на кон.');
    if (st.locked) return err(409, 'locked', 'Партия уже идёт.');
    if (String(b?.sig ?? '') !== sigOf(st.sides.values())) return err(409, 'changed', 'Кон изменился — посмотрите ещё раз.');
    me.ok = b?.ok !== false;
    return this.stakeView(room, u.id);
  }

  /** Партия начинается: свои колоды вошедших и кон, если оба согласились. */
  start(room: string, seatUsers: (number | null)[], options: Options): Options {
    const opts: Options = { ...options };
    seatUsers.forEach((uid, seat) => {
      const c = uid != null ? this.cache.get(uid) : null;
      const d = c?.decks[c.active];
      if (c && d && !deckValid(c, d.ids)) opts['deck' + seat] = deckSpec(d.ids);
    });
    const st = this.stakes.get(room);
    if (st && !st.locked) {
      const [a, b] = seatUsers;
      const both = a != null && b != null && a !== b && st.sides.size === 2 && st.sides.get(a)?.ok && st.sides.get(b)?.ok;
      if (both) st.locked = { seats: [...seatUsers] };
      else this.stakes.delete(room); // не договорились — играют на интерес, кон возвращается
    }
    return opts;
  }

  /** Партия кончилась: победитель забирает кон, обоим — монеты за партию. */
  async settle(room: string, winners: number[], seatUsers: (number | null)[]): Promise<void> {
    const st = this.stakes.get(room);
    this.stakes.delete(room);
    const w = winners.length === 1 ? (seatUsers[winners[0]] ?? null) : null;
    const people = [...new Set(seatUsers.filter((x): x is number => x != null))];
    await this.lock(async () => {
      const touched = new Map<number, Collection>();
      const get = async (uid: number) => touched.get(uid) ?? touched.set(uid, await this.coll(uid)).get(uid)!;
      if (st?.locked && w != null) {
        const loser = st.locked.seats.find((x) => x != null && x !== w);
        const pot = loser != null ? st.sides.get(loser)?.ids ?? [] : [];
        if (loser != null && pot.length) {
          const from = await get(loser);
          const to = await get(w);
          const bad = checkYard(from, pot, this.held(loser));
          if (!bad) {
            moveYard(from, to, pot);
            addLog(to, `Кон выигран у ${st.sides.get(loser)!.name}: ${names(pot)}`);
            addLog(from, `Кон проигран ${st.sides.get(w)?.name ?? 'сопернику'}: ${names(pot)}`);
            this.log(`вкладыши ${room}: кон ${pot.length} шт. ${loser} → ${w}`);
          } else this.log(`вкладыши ${room}: кон не передан — ${bad}`);
        }
      }
      // сетевая партия двух людей — награда как за бота
      if (people.length === 2) for (const uid of people) reward(await get(uid), uid === w);
      if (touched.size) await this.put(...touched.entries());
    });
  }

  /** Комната закрылась (или партия не доиграна) — кон возвращается. */
  drop(room: string) {
    this.stakes.delete(room);
    this.members.delete(room);
  }

  // ---------------------------------------------------------------- обмен

  private tradeView(code: string, t: Trade, uid: number): Reply {
    const mine = t.sides.find((s) => s.uid === uid)!;
    const foe = t.sides.find((s) => s.uid !== uid) ?? null;
    return { code: 200, body: { code, mine: { ids: mine.ids, ok: mine.ok }, foe: foe && { name: foe.name, ids: foe.ids, ok: foe.ok }, sig: sigOf(t.sides), done: t.done } };
  }

  private sweep(now: number) {
    for (const [k, t] of this.trades) if (now - t.at > TRADE_TTL) this.trades.delete(k);
  }

  private async trader(ctx: Ctx, code: unknown): Promise<{ uid: number; t: Trade; code: string } | Reply> {
    const u = await this.user(ctx);
    if (!u) return err(401, 'auth', 'Меняться — только вошедшим.');
    const k = String(code ?? '').toUpperCase();
    const t = this.trades.get(k);
    if (!t || !t.sides.some((s) => s.uid === u.id)) return err(404, 'trade', 'Стол обмена не найден.');
    return { uid: u.id, t, code: k };
  }

  async tradeOpen(ctx: Ctx): Promise<Reply> {
    const u = await this.user(ctx);
    if (!u) return err(401, 'auth', 'Меняться — только вошедшим.');
    const now = ctx.now ?? Date.now();
    this.sweep(now);
    let code = '';
    do code = Array.from({ length: 4 }, () => 'АБВГДЕЖЗИКЛМНПРСТУФХ'[randomInt(0, 20)]).join('');
    while (this.trades.has(code));
    this.trades.set(code, { sides: [{ uid: u.id, name: u.name, ids: [], ok: false }], at: now, done: null });
    return this.tradeView(code, this.trades.get(code)!, u.id);
  }

  async tradeJoin(b: any, ctx: Ctx): Promise<Reply> {
    const u = await this.user(ctx);
    if (!u) return err(401, 'auth', 'Меняться — только вошедшим.');
    const code = String(b?.code ?? '').trim().toUpperCase();
    const t = this.trades.get(code);
    if (!t || t.done) return err(404, 'trade', 'Нет такого стола обмена. Проверьте код.');
    if (!t.sides.some((s) => s.uid === u.id)) {
      if (t.sides.length >= 2) return err(409, 'full', 'За этим столом уже меняются двое.');
      t.sides.push({ uid: u.id, name: u.name, ids: [], ok: false });
      t.at = ctx.now ?? Date.now();
    }
    return this.tradeView(code, t, u.id);
  }

  async tradeGet(q: URLSearchParams, ctx: Ctx): Promise<Reply> {
    const r = await this.trader(ctx, q.get('code'));
    return 'body' in r ? r : this.tradeView(r.code, r.t, r.uid);
  }

  async tradePut(b: any, ctx: Ctx): Promise<Reply> {
    const r = await this.trader(ctx, b?.code);
    if ('body' in r) return r;
    const ids = cleanIds(b?.ids);
    if (!ids) return err(400, 'ids', `В обмен — до ${STAKE_MAX} вкладышей за раз.`);
    return this.lock(async () => {
      if (r.t.done) return err(409, 'done', 'Обмен уже состоялся.');
      const bad = checkYard(await this.coll(r.uid), ids, this.held(r.uid, r.t));
      if (bad) return err(400, 'yard', bad);
      r.t.sides.find((s) => s.uid === r.uid)!.ids = ids;
      r.t.sides.forEach((s) => (s.ok = false));
      r.t.at = ctx.now ?? Date.now();
      return this.tradeView(r.code, r.t, r.uid);
    });
  }

  async tradeOk(b: any, ctx: Ctx): Promise<Reply> {
    const r = await this.trader(ctx, b?.code);
    if ('body' in r) return r;
    return this.lock(async () => {
      const t = r.t;
      if (t.done) return this.tradeView(r.code, t, r.uid);
      if (String(b?.sig ?? '') !== sigOf(t.sides)) return err(409, 'changed', 'Обмен изменился — посмотрите ещё раз.');
      if (t.sides.length < 2) return err(400, 'alone', 'Второй ещё не сел за стол.');
      if (!t.sides.some((s) => s.ids.length)) return err(400, 'empty', 'Никто ничего не выложил.');
      t.sides.find((s) => s.uid === r.uid)!.ok = true;
      if (t.sides.every((s) => s.ok)) {
        const [a, bb] = t.sides;
        const ca = await this.coll(a.uid);
        const cb = await this.coll(bb.uid);
        const bad = checkYard(ca, a.ids, this.held(a.uid, t)) ?? checkYard(cb, bb.ids, this.held(bb.uid, t));
        if (bad) {
          t.sides.forEach((s) => (s.ok = false));
          return err(400, 'yard', bad);
        }
        moveYard(ca, cb, a.ids);
        moveYard(cb, ca, bb.ids);
        const line = (me: Side, foe: Side) => `Обмен с ${foe.name}: отдал ${me.ids.length ? names(me.ids) : 'ничего'}, получил ${foe.ids.length ? names(foe.ids) : 'ничего'}`;
        addLog(ca, line(a, bb));
        addLog(cb, line(bb, a));
        await this.put([a.uid, ca], [bb.uid, cb]);
        t.done = new Date(ctx.now ?? Date.now()).toISOString();
        this.log(`вкладыши: обмен ${a.uid} ⇄ ${bb.uid} (${a.ids.length} на ${bb.ids.length})`);
      }
      return this.tradeView(r.code, t, r.uid);
    });
  }

  async tradeLeave(b: any, ctx: Ctx): Promise<Reply> {
    const r = await this.trader(ctx, b?.code);
    if ('body' in r) return r;
    this.trades.delete(r.code);
    return { code: 200, body: { ok: true } };
  }
}

/** HTTP: /api/vk…; false — не наш адрес. */
export async function vkApi(vk: Vk, req: IncomingMessage, res: ServerResponse, url: URL, ip: string, readBody: (req: IncomingMessage, limit?: number) => Promise<string>): Promise<boolean> {
  const path = url.pathname;
  if (path !== '/api/vk' && !path.startsWith('/api/vk/')) return false;
  const ctx: Ctx = { sid: cookieOf(req), ip, ua: String(req.headers['user-agent'] || ''), site: siteOf(req) };
  const sub = path.slice('/api/vk'.length);
  if (req.method === 'GET') {
    send(req, res, sub === '' ? await vk.get(ctx) : sub === '/stake' ? await vk.stakeGet(url.searchParams, ctx) : sub === '/trade' ? await vk.tradeGet(url.searchParams, ctx) : err(404, 'path', 'Нет такого адреса.'));
    return true;
  }
  if (req.method !== 'POST') {
    send(req, res, { code: 405, body: { error: 'method' } });
    return true;
  }
  if (!sameOrigin(req) || !/^application\/json/.test(String(req.headers['content-type'] || ''))) {
    send(req, res, { code: 403, body: { error: 'origin' } });
    return true;
  }
  let b: any;
  try {
    b = JSON.parse((await readBody(req, sub === '/import' ? 200_000 : 16_384)) || '{}');
  } catch {
    send(req, res, { code: 400, body: { error: 'bad body' } });
    return true;
  }
  const routes: Record<string, () => Promise<Reply>> = {
    '/gum': () => vk.gum(b, ctx),
    '/dust': () => vk.dust(ctx),
    '/decks': () => vk.decks(b, ctx),
    '/reward': () => vk.rewardBot(b, ctx),
    '/import': () => vk.import(b, ctx),
    '/buy': () => vk.buy(b, ctx),
    '/stake': () => vk.stakeSet(b, ctx),
    '/stake/ok': () => vk.stakeOk(b, ctx),
    '/trade/open': () => vk.tradeOpen(ctx),
    '/trade/join': () => vk.tradeJoin(b, ctx),
    '/trade/put': () => vk.tradePut(b, ctx),
    '/trade/ok': () => vk.tradeOk(b, ctx),
    '/trade/leave': () => vk.tradeLeave(b, ctx),
  };
  send(req, res, routes[sub] ? await routes[sub]() : err(404, 'path', 'Нет такого адреса.'));
  return true;
}

export { fresh as vkFresh };
