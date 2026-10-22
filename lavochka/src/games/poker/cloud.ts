/* Покер — статистика тренажёра, банкролл и прогресс школы вошедшего в профиле на сервере (/api/poker, как журнал кружка). Браузер хранит
 * своё; при входе за стол или в «Мою статистику» берём то, что новее (время — poker.hud.at / poker.cloud.at), изменения
 * отправляем с задержкой. Без входа — только устройство. Истории в профиль — последние 100 раздач (предел записи). */
import { store } from '../../core/settings';
import { currentUser } from '../../site/account';
import { bankHooks } from './bankroll';
import { loadHud, onHud, replaceHud, type HudData } from './hud';
import { loadSchool, onSchool, replaceSchool, type SchoolProgress } from './school/progress';

const BANK_KEY = 'poker.bank';
const AT = 'poker.cloud.at';
let timer = 0;

const pack = () => {
  const d = loadHud();
  return { hud: { ...d, hist: d.hist.slice(-100) } as HudData, bank: store.get<unknown>(BANK_KEY, null), school: loadSchool() };
};

function upload() {
  const at = store.get<number>(AT, 0);
  if (!currentUser() || !at) return;
  void fetch('/api/poker', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ at, data: pack() }), keepalive: true }).catch(() => {});
}

/** Статистика или банкролл изменились — отметить время и отправить (не чаще раза в 5 секунд). */
export function touchPoker() {
  store.set(AT, Date.now());
  if (!currentUser()) return;
  clearTimeout(timer);
  timer = setTimeout(upload, 5000) as unknown as number;
}

let synced = false;
/** Сверить с профилем: там новее — взять себе (true — данные сменились), здесь новее — отправить. */
export async function syncPoker(force = false): Promise<boolean> {
  if (!currentUser() || (synced && !force)) return false;
  synced = true;
  try {
    const r = await fetch('/api/poker', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) return false;
    const { at, data } = (await r.json()) as { at: number; data: { hud?: Partial<HudData>; bank?: unknown; school?: Partial<SchoolProgress> } | null };
    const mine = store.get<number>(AT, 0);
    if (data && at > mine) {
      if (data.hud) {
        // история на устройстве длиннее — не теряем её старую часть
        const local = loadHud();
        const hist = data.hud.hist ?? [];
        const first = hist[0]?.at ?? Infinity;
        replaceHud({ ...data.hud, hist: [...local.hist.filter((x) => x.at < first), ...hist].slice(-200) });
      }
      if (data.bank) store.set(BANK_KEY, data.bank);
      if (data.school) replaceSchool(data.school);
      store.set(AT, at);
      return true;
    }
    if (mine > at) upload();
  } catch {
    /* без сети — работаем с тем, что на устройстве */
  }
  return false;
}

// любое изменение статистики — в профиль
onHud(touchPoker);
onSchool(touchPoker);
bankHooks.changed = touchPoker;

if (typeof addEventListener !== 'undefined')
  addEventListener('pagehide', () => {
    if (timer) {
      clearTimeout(timer);
      timer = 0;
      upload();
    }
  });
