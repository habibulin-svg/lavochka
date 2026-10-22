/* Покер — виртуальный банкролл (отдельный режим турниров, решение пользователя): стартовые очки, бай-ины, ROI, ITM,
 * бесплатное пополнение раз в сутки. Без денег — только очки. Хранится в localStorage; баланс не хранится отдельно, а
 * считается по записям турниров (стоимость входов и выигрыш у каждого), поэтому повторный показ того же турнира ничего не
 * списывает дважды. Перенос в профиль на сервере — на этапе 4 (вместе со статистикой). */
import { store } from '../../core/settings';
import type { TourState } from './tour';

export const BANK_START = 1000;
const KEY = 'poker.bank';

interface Entry {
  fmt: string;
  buyin: number;
  /** Сколько стоили входы (с ребаями, ре-энтри и аддоном). */
  cost: number;
  /** Приз и баунти. */
  won: number;
  place: number;
  field: number;
  done: boolean;
  at: number;
}

interface Bank {
  /** Пополнения и итог давно забытых записей. */
  base: number;
  day: string;
  list: Record<string, Entry>;
}

const today = () => new Date().toISOString().slice(0, 10);
const load = (): Bank => {
  const b = store.get<Bank | null>(KEY, null);
  return b && typeof b.base === 'number' && b.list ? b : { base: BANK_START, day: '', list: {} };
};

export function bankInfo() {
  const b = load();
  const all = Object.values(b.list);
  const done = all.filter((e) => e.done);
  const cost = done.reduce((a, e) => a + e.cost, 0);
  const won = done.reduce((a, e) => a + e.won, 0);
  const balance = b.base + all.reduce((a, e) => a + e.won - e.cost, 0);
  return {
    balance,
    played: done.length,
    itm: done.length ? done.filter((e) => e.won > 0).length / done.length : 0,
    roi: cost ? (won - cost) / cost : 0,
    /** Пополнить можно раз в сутки, если меньше стартовых. */
    canRefill: balance < BANK_START && b.day !== today(),
  };
}

export function refill(): boolean {
  const info = bankInfo();
  if (!info.canRefill) return false;
  const b = load();
  b.base += BANK_START - info.balance;
  b.day = today();
  store.set(KEY, b);
  return true;
}

/** Учесть турнир человека (вызывается на каждом снимке — повторы безвредны). */
export function trackTour(T: TourState, me: number) {
  if (!T.bank) return;
  const p = T.players[me];
  if (!p) return;
  const b = load();
  const id = String(T.id);
  const e: Entry = {
    fmt: T.fmt,
    buyin: T.buyin,
    cost: (p.entries + p.rebuys + (p.addon ? 1 : 0)) * T.buyin,
    won: p.won + (T.done ? p.prize : 0),
    place: p.out,
    field: T.players.reduce((a, x) => a + (x.joined ? x.entries : 0), 0),
    done: T.done,
    at: b.list[id]?.at ?? Date.now(),
  };
  const old = b.list[id];
  if (old && old.cost === e.cost && old.won === e.won && old.done === e.done && old.place === e.place) return;
  b.list[id] = e;
  // старые записи сворачиваем в base, чтобы хранилище не росло
  const ids = Object.keys(b.list).sort((x, y) => b.list[x].at - b.list[y].at);
  for (const k of ids.slice(0, Math.max(0, ids.length - 300))) {
    const o = b.list[k];
    if (!o.done) continue;
    b.base += o.won - o.cost;
    delete b.list[k];
  }
  store.set(KEY, b);
}
