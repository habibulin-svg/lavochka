import { describe, expect, it } from 'vitest';
import { Bot } from '../../src/gops/bot/bot';
import type { FrameIn, NetServerMsg, NetSetup } from '../../src/gops/net/protocol';
import { GopsRelay, type RelayPeer } from '../../src/gops/net/relay';
import { Mask } from '../../src/gops/sim/mask';
import { Rng } from '../../src/gops/sim/rng';
import { ARSENAL_AMMO } from '../../src/gops/sim/weapons';
import { DEFAULT_SCHEME, type Input, type World, createWorld, step, worldHash } from '../../src/gops/sim/world';

const SETUP: NetSetup = {
  level: 'm03', arsenal: 'full', hp: 100, turn: 20, wind: 1, sudden: true, crates: true,
  sides: [{ brigade: 'zatulinka', who: 'host', count: 2 }, { brigade: 'rastochka', who: 'net', count: 2 }],
};

/** Участник с почтовым ящиком: всё, что прислал сервер. */
function peer(id: number, name: string): RelayPeer & { box: NetServerMsg[] } {
  const box: NetServerMsg[] = [];
  return { id, name, box, send: (m) => box.push(m) };
}

function world(seed: number): World {
  const m = new Mask(1200, 500);
  m.fillRect(0, 400, 1200, 100);
  m.fillRect(560, 300, 80, 100);
  return createWorld({
    mask: m, waterY: 480, seed, scheme: { ...DEFAULT_SCHEME, turnTime: 20 },
    teams: [[200, 350], [850, 1000]].map((xs) => ({ spawns: xs.map((x) => [x, 400] as [number, number]), hp: 100, ammo: { ...ARSENAL_AMMO } })),
  });
}

/** Клиент: мир шагает по кадрам из ящика; за бригады ходят боты (в сети — от сида, одинаково у всех). */
class Sim {
  w: World;
  frame = 0;
  hashes: number[] = [];
  private upto = 0;
  private ins = new Map<number, FrameIn[]>();
  private bots: Bot[];
  constructor(seed: number, private box: NetServerMsg[]) {
    this.w = world(seed);
    this.bots = [0, 1].map((i) => new Bot('medium', seeded(seed * 31 + i * 977)));
  }
  /** Забрать пришедшие кадры и дошагать до них; botSide — чья бригада за бота (остальные — по сети). */
  run(botSide: number, cheat?: (i: Input) => Input) {
    for (const m of this.box.splice(0)) {
      if (m.t !== 'f') continue;
      for (const fi of m.ins) this.ins.set(fi[0], [...(this.ins.get(fi[0]) ?? []), fi]);
      this.upto = m.upto;
    }
    while (this.frame < this.upto) {
      const list = this.ins.get(this.frame) ?? [];
      this.ins.delete(this.frame++);
      const net = list.find((x) => x[1] === this.w.team)?.[2] ?? {};
      let inp = this.w.team === botSide ? this.bots[botSide].input(this.w) : net;
      if (cheat) inp = cheat(inp);
      step(this.w, inp);
      for (const e of this.w.events) if (e.t === 'turn') this.hashes.push(worldHash(this.w));
    }
  }
}

function seeded(seed: number) {
  const r = new Rng(seed >>> 0);
  return () => r.f();
}

describe('gops/net: лок-степ через ретранслятор', () => {
  it('лобби: гость садится только за сетевую бригаду, начать может только хозяин', () => {
    const relay = new GopsRelay(SETUP, 42);
    const host = peer(1, 'Хозяин'), guest = peer(2, 'Гость');
    relay.add(host, true);
    relay.add(guest, false);
    relay.message(guest, { t: 'claim', side: 0 });
    relay.message(guest, { t: 'claim', side: 1 });
    relay.message(guest, { t: 'start' });
    expect(relay.isStarted).toBe(false);
    const lobby = guest.box.filter((m) => m.t === 'lobby').at(-1);
    expect(lobby?.t === 'lobby' && lobby.peers.find((p) => p.id === 2)?.side).toBe(1);
    relay.message(host, { t: 'start' });
    expect(guest.box.some((m) => m.t === 'start' && m.seed === 42)).toBe(true);
  });

  it('чужой бригадой управлять нельзя; кадры нумеруются по часам, разовое — в один кадр', () => {
    const relay = new GopsRelay(SETUP, 1);
    const host = peer(1, 'Х'), guest = peer(2, 'Г');
    relay.add(host, true);
    relay.add(guest, false);
    relay.message(guest, { t: 'claim', side: 1 });
    relay.message(host, { t: 'start' });
    relay.message(guest, { t: 'in', side: 0, held: { move: 1 } }); // не его
    relay.message(host, { t: 'in', side: 0, held: { fire: true }, once: { weapon: 'limonka' } });
    relay.tick(1000);
    relay.tick(1000 + 100); // 6 кадров, рассылка
    const f = host.box.filter((m) => m.t === 'f').at(-1);
    expect(f?.t).toBe('f');
    if (f?.t !== 'f') return;
    expect(f.upto).toBe(6);
    expect(f.ins.filter((x) => x[1] === 1)).toEqual([]);
    expect(f.ins.filter((x) => x[2].weapon === 'limonka').length).toBe(1);
    expect(f.ins.filter((x) => x[1] === 0 && x[2].fire).length).toBe(6);
  });

  it('два клиента по одним кадрам ведут мир бит в бит; подмена ввода ловится сверкой', () => {
    const relay = new GopsRelay(SETUP, 7);
    const host = peer(1, 'Х'), guest = peer(2, 'Г');
    relay.add(host, true);
    relay.add(guest, false);
    relay.message(guest, { t: 'claim', side: 1 });
    relay.message(host, { t: 'start' });
    const a = new Sim(7, host.box), b = new Sim(7, guest.box);
    // «человек» второй бригады — гость: шлёт ввод своего бота через сервер; первая бригада — бот у всех
    const guestBot = new Bot('medium', seeded(99));
    let t = 0;
    for (let i = 0; i < 1200; i++) {
      t += 1000 / 60;
      if (b.w.team === 1 && b.w.phase === 'turn') relay.message(guest, { t: 'in', side: 1, held: pickHeld(guestBot.input(b.w)) });
      relay.tick(t);
      a.run(0);
      b.run(0);
      for (const [i2, h] of a.hashes.entries()) relay.message(host, { t: 'hash', turn: i2, h });
      for (const [i2, h] of b.hashes.entries()) relay.message(guest, { t: 'hash', turn: i2, h });
    }
    expect(a.frame).toBeGreaterThan(1000);
    expect(worldHash(a.w)).toBe(worldHash(b.w));
    expect(a.hashes.length).toBeGreaterThan(1);
    expect(relay.desynced).toBe(false);
    // третий клиент «жульничает» — двигает своего бойца без сервера: его хеш хода разойдётся
    const c = new Sim(7, []);
    const w0 = world(7);
    for (let i = 0; i < 400; i++) step(w0, {});
    c.w = w0;
    c.w.worms[0].x += 256 * 5;
    relay.message(host, { t: 'hash', turn: 999, h: worldHash(a.w) });
    relay.message(guest, { t: 'hash', turn: 999, h: worldHash(c.w) });
    expect(relay.desynced).toBe(true);
  }, 60_000);
});

function pickHeld(i: Input) {
  return { move: i.move, aim: i.aim, fire: i.fire };
}

describe('gops/net: возврат в идущую партию', () => {
  it('вернувшийся по имени садится за свою бригаду и получает журнал кадров', () => {
    const relay = new GopsRelay(SETUP, 3);
    const host = peer(1, 'Х'), guest = peer(2, 'Гость');
    relay.add(host, true);
    relay.add(guest, false);
    relay.message(guest, { t: 'claim', side: 1 });
    relay.message(host, { t: 'start' });
    relay.message(host, { t: 'in', side: 0, held: { move: 1 } });
    relay.tick(10);
    relay.tick(10 + 500);
    relay.remove(guest);
    const back = peer(3, 'Гость');
    relay.add(back, false);
    const lobby = back.box.find((m) => m.t === 'lobby');
    expect(lobby?.t === 'lobby' && lobby.peers.find((p) => p.id === 3)?.side).toBe(1);
    expect(back.box.some((m) => m.t === 'start')).toBe(true);
    const f = back.box.find((m) => m.t === 'f');
    expect(f?.t === 'f' && f.ins.length).toBeGreaterThan(20);
    // теперь он снова правит своей бригадой
    relay.message(back, { t: 'in', side: 1, held: { aim: -1 } });
    relay.tick(10 + 600);
    const last = back.box.filter((m) => m.t === 'f').at(-1);
    expect(last?.t === 'f' && last.ins.some((x) => x[1] === 1)).toBe(true);
  });
});

describe('gops/net: чат и голос через комнату', () => {
  it('чат — всем с именем; сигнал голоса — только между теми, кто в голосе', () => {
    const relay = new GopsRelay(SETUP, 5);
    const a = peer(1, 'А'), b = peer(2, 'Б');
    relay.add(a, true);
    relay.add(b, false);
    relay.message(a, { t: 'chat', text: '  здорово  ' });
    expect(b.box.some((m) => m.t === 'chat' && m.name === 'А' && m.text === 'здорово')).toBe(true);
    relay.message(a, { t: 'voice', on: true });
    relay.message(a, { t: 'rtc', to: '2', data: { x: 1 } });
    expect(b.box.some((m) => m.t === 'rtc')).toBe(false); // Б ещё не в голосе
    relay.message(b, { t: 'voice', on: true });
    const v = b.box.filter((m) => m.t === 'voice').at(-1);
    expect(v?.t === 'voice' && v.members.map((x) => x.name)).toEqual(['А', 'Б']);
    relay.message(a, { t: 'rtc', to: '2', data: { x: 1 } });
    expect(b.box.some((m) => m.t === 'rtc' && m.from === '1')).toBe(true);
  });
});

describe('gops/net: восстановление после рассинхрона', () => {
  it('сервер стопит часы, хозяин шлёт снимок частями, гость накладывает — миры снова одинаковые, часы идут с того же кадра', async () => {
    const { applySnapshot, takeSnapshot } = await import('../../src/gops/sim/snapshot');
    const relay = new GopsRelay(SETUP, 11);
    const host = peer(1, 'Х'), guest = peer(2, 'Г');
    relay.add(host, true);
    relay.add(guest, false);
    relay.message(guest, { t: 'claim', side: 1 });
    relay.message(host, { t: 'start' });
    const a = new Sim(11, host.box), b = new Sim(11, guest.box);
    let t = 0;
    for (let i = 0; i < 300; i++) {
      t += 1000 / 60;
      relay.tick(t);
      a.run(-1);
      b.run(-1);
    }
    b.w.worms[1].hp = 7; // мир гостя «разошёлся»
    relay.message(host, { t: 'hash', turn: 50, h: worldHash(a.w) });
    relay.message(guest, { t: 'hash', turn: 50, h: worldHash(b.w) });
    const d = guest.box.find((m) => m.t === 'desync');
    expect(d?.t === 'desync' && d.from).toBe(1);
    a.run(-1);
    b.run(-1);
    const upto = d?.t === 'desync' ? d.upto : -1;
    expect(a.frame).toBe(upto);
    // хозяин: снимок частями по 40000 знаков
    const json = JSON.stringify(takeSnapshot(a.w));
    const n = Math.ceil(json.length / 40000);
    for (let i = 0; i < n; i++) relay.message(host, { t: 'snap', frame: upto, turn: 50, i, n, data: json.slice(i * 40000, (i + 1) * 40000) });
    expect(relay.desynced).toBe(false);
    const parts = guest.box.filter((m) => m.t === 'snap');
    expect(parts.length).toBe(n);
    applySnapshot(b.w, JSON.parse(parts.map((m) => (m.t === 'snap' ? m.data : '')).join('')));
    expect(worldHash(b.w)).toBe(worldHash(a.w));
    // часы — дальше с того же кадра, без скачка
    t += 5000;
    relay.tick(t);
    relay.tick(t + 60);
    const f = guest.box.filter((m) => m.t === 'f').at(-1);
    expect(f?.t === 'f' && f.upto - upto).toBeLessThan(8);
  });
});
