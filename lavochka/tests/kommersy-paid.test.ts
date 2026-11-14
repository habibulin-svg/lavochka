/* «Коммерсы 2.0», этап 4: второй сезон — платное дополнение (право kommersy_s2) и наследие первого сезона (§9). */
import { afterEach, describe, expect, it } from 'vitest';
import { localPair, type RoomMsg } from '../src/core/protocol';
import { fitOptions, Room } from '../src/core/room';
import { PRODUCTS } from '../src/core/buy';
import { hasRight, type RightGrant } from '../src/core/rights';
import { SeededRng } from '../src/core/rng';
import type { Options, SeatSpec } from '../src/core/types';
import { def } from '../src/games/kommersy/def';
import { choose } from '../src/games/kommersy/bot';
import { apply, newState, toAct, view, type State } from '../src/games/kommersy/engine';
import { CANON_HOME, encodeLegacy, legacyFromView, legacySlava, parseLegacy, type Legacy } from '../src/games/kommersy/legacy';
import { CLUB_START, START_2009 } from '../src/games/kommersy/s2data';
import { AutoClient, until } from './harness';

/** Как server/index.ts → paidAllow: правила, какими их увидит комната, против прав хозяина. */
const allowFor = (rights: RightGrant[]) => (o: Options) => {
  const need = def.needRight!(o);
  return need && !hasRight(rights, need as never) ? 'платное' : null;
};
const OWNED: RightGrant[] = [{ right: 'kommersy_s2', until: null }];

describe('Коммерсы 2.0: доступ', () => {
  it('товар kommersy2 — 300 ₽, даёт право kommersy_s2; Мастеру открыто и так', () => {
    expect(PRODUCTS.kommersy2).toMatchObject({ right: 'kommersy_s2', rub: 300 });
    expect(hasRight([{ right: 'master', until: null }], 'kommersy_s2')).toBe(true);
    expect(hasRight([{ right: 'early_access', until: null }], 'kommersy_s2')).toBe(false);
  });

  it('право нужно только второму сезону — и подменой опций его не обойти', () => {
    expect(def.needRight!({})).toBeNull();
    expect(def.needRight!({ season: 1, start: 0 })).toBeNull();
    expect(def.needRight!({ season: 2 })).toBe('kommersy_s2');
    // строки, дроби, перебор — тот же разбор, что у партии
    for (const season of ['2', 2.4, 99, '2.0']) expect(def.needRight!({ season } as never), String(season)).toBe('kommersy_s2');
    // по сети правила идут через fitOptions: что пропущено проверкой, то и сыграется
    for (const raw of [{ season: '2' }, { season: 2 }, { season: 7 }, { season: 2, legacy: 'x' }]) {
      const o = fitOptions(def, raw);
      const s = def.setup([{ seat: 0, kind: 'human', name: '', level: 1 }], o, new SeededRng(1));
      expect(allowFor([])(o) === null, JSON.stringify(raw)).toBe(s.opts.season !== 2);
    }
  });

  it('пресеты второго сезона видны всем, но каждый требует права', () => {
    const s2 = def.presets!.filter((p) => p.id.startsWith('s2-'));
    expect(s2.length).toBe(3);
    for (const p of s2) {
      expect(allowFor([])(p.options)).not.toBeNull();
      expect(allowFor(OWNED)(p.options)).toBeNull();
    }
    for (const p of def.presets!.filter((p) => !p.id.startsWith('s2-'))) expect(allowFor([])(p.options)).toBeNull();
  });
});

describe('Коммерсы 2.0: комната без права', () => {
  const rooms: Room[] = [];
  afterEach(() => rooms.splice(0).forEach((r) => r.close()));
  type Lobby = Extract<RoomMsg, { t: 'lobby' }>;
  const lastLobby = (c: AutoClient) => c.log.filter((m): m is Lobby => m.t === 'lobby').pop();

  function room(rights: RightGrant[]) {
    const seats: SeatSpec[] = [
      { seat: 0, kind: 'human', name: 'Хозяин', level: 1 },
      { seat: 1, kind: 'remote', name: '', level: 1 },
    ];
    const r = new Room({ def, options: { season: 1 }, seats, code: 'KOMM', ownerKey: 'key', botDelay: 0, allow: allowFor(rights) });
    rooms.push(r);
    const [a, b] = localPair();
    r.connect(a);
    return new AutoClient(def, b, 'Хозяин', 'key', 1);
  }

  it('хозяин без права не переключит стол на второй сезон в лобби, с правом — переключит', async () => {
    const poor = room([]);
    await until(() => !!lastLobby(poor), 3000, 'лобби');
    poor.client.host({ op: 'setup', options: { season: 2, start: START_2009 }, count: 2 });
    await until(() => poor.log.some((m) => m.t === 'error'), 3000, 'отказ');
    expect(lastLobby(poor)!.options.season).toBe(1);

    const rich = room(OWNED);
    await until(() => !!lastLobby(rich), 3000, 'лобби');
    rich.client.host({ op: 'setup', options: { season: 2, start: START_2009 }, count: 2 });
    await until(() => lastLobby(rich)?.options.season === 2, 3000, 'второй сезон');
    expect(rich.log.some((m) => m.t === 'error')).toBe(false);
  });
});

/** Партия первого сезона, доигранная ботом; в финале — покупка клуба (как в настоящей партии: club, ending, over). */
function s1WithClub(): State {
  const r = new SeededRng(3);
  let s = newState([0], { start: 124, diff: 1 }, [], r);
  for (let k = 0; k < 20000 && s.phase !== 'over'; k++) {
    const seat = toAct(s)[0];
    s = apply(s, seat, choose(view(s, [seat]), seat, 2, r)!, r)!.state;
  }
  const p = s.players[0];
  Object.assign(p, { club: true, ending: 'club' });
  s.phase = 'over';
  return s;
}

describe('Коммерсы 2.0: наследие первого сезона', () => {
  it('из финала с клубом — только у купившего и только из своего вида', () => {
    const s = s1WithClub();
    const lg = legacyFromView(view(s, [0]), 0, 'Колян')!;
    expect(lg).toBeTruthy();
    expect(lg.st[0]).toBe(s.players[0].stats.name);
    expect(lg.sk[4]).toBe(s.players[0].skills.english);
    expect(lg.f.length).toBe(s.players[0].falls.length);
    // чужой вид, не финал, без клуба — нет наследия
    expect(legacyFromView(view(s, 'all'), 0, 'Колян')).toBeNull();
    const noClub = s1WithClub();
    noClub.players[0].club = false;
    expect(legacyFromView(view(noClub, [0]), 0, 'Колян')).toBeNull();
    // строка короткая — помещается в правила партии
    expect(encodeLegacy(lg).length).toBeLessThan(200);
  });

  it('переносится в январь 2004-го: параметры, навыки, падения, дела, Слава за ранний клуб', () => {
    const lg: Legacy = { n: 'Колян', y: 1999, st: [81, 77, 66, 44, 30, 50], sk: [5, 4, 3, 2, 1, 0], f: ['jail', 'infarkt'], biz: 2 * CANON_HOME };
    const seats: SeatSpec[] = [{ seat: 0, kind: 'human', name: 'Колян', level: 1 }];
    const canon = def.setup(seats, { season: 2, start: 0 }, new SeededRng(1));
    const s = def.setup(seats, { season: 2, start: 0, legacy: encodeLegacy(lg) }, new SeededRng(1));
    const p = s.players[0];
    const c = canon.players[0];
    expect(p.stats).toMatchObject({ name: 81, avt: 77, svyazi: 66, blizkie: 44, sovest: 30 });
    expect(p.stats.health).toBe(Math.round((50 + 75) / 2));
    expect(p.skills).toMatchObject({ trade: 5, schet: 4, bazar: 3, sila: 2, english: 1, poryadok: 0, cifra: 0 });
    expect(p.falls.map((f) => f.kind)).toEqual(['jail', 'infarkt']);
    expect(p.assets.map((a) => a.id)).toEqual(c.assets.map((a) => a.id));
    expect(p.assets[0].value).toBe(c.assets[0].value * 2);
    expect(p.club2!.slava).toBe(CLUB_START.slava + legacySlava(lg));
    expect(legacySlava(lg)).toBe(20);
    // канонический — без наследия: Английский 3, Связи 60
    expect(c.skills.english).toBe(3);
    expect(c.stats.svyazi).toBe(60);
  });

  it('наследие — только во втором сезоне с 2004-го и в одиночку; мусор и перебор отбрасываются', () => {
    const lg = encodeLegacy({ n: 'Колян', y: 1999, st: [90, 90, 90, 90, 90, 90], sk: [5, 5, 5, 5, 5, 5], f: [], biz: 1e8 });
    const one: SeatSpec[] = [{ seat: 0, kind: 'human', name: '', level: 1 }];
    const two: SeatSpec[] = [one[0], { seat: 1, kind: 'bot', name: '', level: 1 }];
    expect(def.setup(one, { season: 1, legacy: lg }, new SeededRng(1)).opts.legacy).toBeUndefined();
    expect(def.setup(one, { season: 2, start: START_2009, legacy: lg }, new SeededRng(1)).opts.legacy).toBeUndefined();
    expect(def.setup(two, { season: 2, start: 0, legacy: lg }, new SeededRng(1)).players.every((p) => p.cash === 1e6)).toBe(true);
    expect(parseLegacy('{"st":[1],"sk":[]}')).toBeNull();
    expect(parseLegacy('не json')).toBeNull();
    const big = parseLegacy(JSON.stringify({ n: 'x'.repeat(50), y: 1500, st: [999, -5, 50, 50, 50, 50], sk: [9, 9, 9, 9, 9, 9], f: ['razor', 'взлом'], biz: 1e15 }))!;
    expect(big.st.slice(0, 2)).toEqual([100, 0]);
    expect(big.sk.every((x) => x === 5)).toBe(true);
    expect(big.y).toBe(1988);
    expect(big.f).toEqual(['razor']);
    expect(big.n.length).toBe(16);
  });

  it('второй сезон со своим Коляном доигрывается ботом до декабря 2021-го', () => {
    const lg = legacyFromView(view(s1WithClub(), [0]), 0, 'Колян')!;
    const r = new SeededRng(8);
    let s = def.setup([{ seat: 0, kind: 'bot', name: '', level: 2 }], { season: 2, start: 0, legacy: encodeLegacy(lg) }, r);
    expect(s.opts.legacy).toBeTruthy();
    for (let k = 0; k < 40000 && s.phase !== 'over'; k++) {
      const seat = toAct(s)[0];
      s = apply(s, seat, choose(view(s, [seat]), seat, 2, r)!, r)!.state;
    }
    expect(s.phase).toBe('over');
  }, 60000);
});
