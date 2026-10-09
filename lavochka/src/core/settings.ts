/* Настройки и сохранения в localStorage. Любое обращение может бросить исключение (приватный режим) — глушим. */
import { uid } from './util';

const PREFIX = 'lavochka.';

export const store = {
  get<T>(key: string, def: T): T {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? def : (JSON.parse(raw) as T);
    } catch {
      return def;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* нет места или запрещено — не страшно */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* ignore */
    }
  },
};

export type DeckStyle = 'atlas' | 'slavic' | 'russian';
export type NetMode = 'p2p' | 'server';

export interface Settings {
  name: string;
  sound: boolean;
  volume: number;
  speed: number;
  autoSingle: boolean;
  deck: DeckStyle;
  net: NetMode;
  /** Адрес сервера; пусто — тот же адрес, откуда открыт сайт. */
  serverUrl: string;
  clientId: string;
}

const defaults: Settings = {
  name: '',
  sound: true,
  volume: 0.8,
  speed: 1,
  autoSingle: true,
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
