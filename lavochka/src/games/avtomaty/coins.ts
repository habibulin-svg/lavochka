/* Монеты по 15 копеек. Строго — в кармане рубль на день (шесть монет, 10 копеек сдачи не в счёт), кончились —
 * приходи завтра; бесконечные — монета всегда находится. Монету, которую автомат не взял, возвращаем в карман. */
import { store } from '../../core/settings';

export type CoinMode = 'strict' | 'free';
export const DAILY = 6;

interface Pocket {
  day: string;
  left: number;
  played: number;
}

const today = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

export const coinMode = (): CoinMode => (store.get<string>('avtomaty.coins', 'strict') === 'free' ? 'free' : 'strict');
export const setCoinMode = (m: CoinMode) => store.set('avtomaty.coins', m);

export function pocket(now = new Date()): Pocket {
  const p = store.get<Pocket | null>('avtomaty.pocket', null);
  if (p && p.day === today(now)) return p;
  const fresh = { day: today(now), left: DAILY, played: 0 };
  store.set('avtomaty.pocket', fresh);
  return fresh;
}

/** Достать монету из кармана. false — кончились (только в строгом режиме). */
export function takeCoin(now = new Date()): boolean {
  const p = pocket(now);
  if (coinMode() === 'strict') {
    if (p.left <= 0) return false;
    p.left--;
  }
  p.played++;
  store.set('avtomaty.pocket', p);
  return true;
}

/** Автомат монету не взял — она вернулась в карман. */
export function giveBack(now = new Date()) {
  const p = pocket(now);
  if (coinMode() === 'strict') p.left = Math.min(DAILY, p.left + 1);
  p.played = Math.max(0, p.played - 1);
  store.set('avtomaty.pocket', p);
}
