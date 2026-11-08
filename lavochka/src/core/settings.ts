/* Настройки и сохранения в localStorage. Любое обращение может бросить исключение (приватный режим) — глушим. */
import { uid } from './util';

const PREFIX = 'lavochka.';

/** Последнее записанное за эту вкладку: если localStorage полон или запрещён, запись молча не проходит —
 * без этого выключатель (музыка в городках) тут же «включался» обратно, потому что get читал старое. */
const mem = new Map<string, string>();

export const store = {
  get<T>(key: string, def: T): T {
    try {
      const raw = mem.get(key) ?? localStorage.getItem(PREFIX + key);
      return raw == null ? def : (JSON.parse(raw) as T);
    } catch {
      return def;
    }
  },
  set(key: string, value: unknown) {
    let raw: string;
    try {
      raw = JSON.stringify(value);
    } catch {
      return;
    }
    if (raw === undefined) mem.delete(key);
    else mem.set(key, raw);
    try {
      localStorage.setItem(PREFIX + key, raw);
    } catch {
      /* нет места или запрещено — значение живёт в памяти вкладки */
    }
  },
  remove(key: string) {
    mem.delete(key);
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};

export type DeckStyle = 'atlas' | 'slavic' | 'russian' | 'classic';
export type NetMode = 'p2p' | 'server';

export interface Settings {
  name: string;
  /** Аватар за столом (значок или адрес фото); у вошедшего — из профиля. */
  avatar: string;
  sound: boolean;
  volume: number;
  speed: number;
  /** Ходить самому за игрока, если ход один. По умолчанию выключено: игры не играют сами в себя (решение пользователя); ключ новый, чтобы старое «вкл» из хранилища не действовало. */
  autoMove: boolean;
  deck: DeckStyle;
  net: NetMode;
  /** Адрес сервера; пусто — тот же адрес, откуда открыт сайт. */
  serverUrl: string;
  clientId: string;
}

const defaults: Settings = {
  name: '',
  avatar: '',
  sound: true,
  volume: 0.8,
  speed: 1,
  autoMove: false,
  deck: 'atlas',
  net: 'p2p',
  serverUrl: '',
  clientId: '',
};

export const settings: Settings = Object.assign({}, defaults, store.get<Partial<Settings>>('settings', {}));

/* clientId — своя у каждой вкладки (sessionStorage переживает перезагрузку, поэтому после обрыва
   игрок вернётся на своё место). Так можно играть друг против друга и в двух вкладках одного браузера. */
settings.clientId = (() => {
  try {
    let id = sessionStorage.getItem('lavochka.cid');
    if (!id) sessionStorage.setItem('lavochka.cid', (id = uid()));
    return id;
  } catch {
    return uid();
  }
})();

const listeners = new Set<() => void>();

export function saveSettings() {
  store.set('settings', settings);
  listeners.forEach((f) => f());
}

export function onSettings(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}
