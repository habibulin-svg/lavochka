/* Часы комнаты и поправка на задержку сети («кнопка» в викторине — кто нажал первым).
 *
 * Как у buzzin.live и NTP: комната шлёт ping с отметкой своих часов ts, клиент отвечает pong с ts и своими часами ct.
 * По приходу ответа комната знает круг rtt = rx − ts и смещение часов клиента off ≈ ct − (ts + rtt/2).
 * Смещение берём из замера с самым коротким кругом среди последних — у него меньше всего ошибка (очереди, Wi-Fi).
 *
 * Нажатие клиент присылает со своим временем at (момент события клавиши/пальца). Комната переводит его в свои часы:
 * at − off, и ограничивает: не позже прихода сообщения rx и не раньше rx − (rtt + разброс + запас) — так подделка
 * «я нажал раньше» выигрывает не больше погрешности связи. Решение «кто первый» комната принимает не сразу,
 * а через окно ожидания window() после самого раннего нажатия: за это время успевают дойти нажатия медленных соседей.
 *
 * Модуль без DOM и без таймеров: его гоняют комната (браузер хоста или сервер) и тесты. */

export interface ClockSample {
  rtt: number;
  off: number;
}

/** Сколько последних замеров помнить. */
const KEEP = 12;
/** Окно ожидания нажатий, мс: не меньше (кадр, дребезг) и не больше (иначе «кнопка» тормозит). */
export const WIN_MIN = 60;
export const WIN_MAX = 900;
/** Запас к оценке погрешности, мс. */
const SLACK = 25;

export class ClockSync {
  private samples: ClockSample[] = [];

  /** Ответ на ping: ts — часы комнаты при отправке, ct — часы клиента при ответе, rx — часы комнаты при приходе. */
  add(ts: number, ct: number, rx: number): void {
    if (!Number.isFinite(ts) || !Number.isFinite(ct) || !Number.isFinite(rx)) return;
    const rtt = rx - ts;
    if (rtt < 0 || rtt > 10_000) return;
    this.samples.push({ rtt, off: ct - (ts + rtt / 2) });
    if (this.samples.length > KEEP) this.samples.shift();
  }

  get ready(): boolean {
    return this.samples.length > 0;
  }

  private best(): ClockSample | null {
    let b: ClockSample | null = null;
    for (const s of this.samples) if (!b || s.rtt < b.rtt) b = s;
    return b;
  }

  /** Смещение часов клиента относительно комнаты (клиент − комната), мс. */
  get off(): number {
    return this.best()?.off ?? 0;
  }

  /** Обычный круг: медиана последних замеров (самый короткий — слишком оптимистичен для окна ожидания). */
  get rtt(): number {
    if (!this.samples.length) return 0;
    const r = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    return r[Math.floor(r.length / 2)];
  }

  /** Разброс круга: насколько медленный замер хуже самого быстрого (Wi-Fi, мобильная сеть). */
  get jitter(): number {
    if (this.samples.length < 2) return this.rtt / 2;
    const r = this.samples.map((s) => s.rtt).sort((a, b) => a - b);
    return r[Math.min(r.length - 1, Math.floor(r.length * 0.9))] - r[0];
  }

  /** Насколько поздно может дойти нажатие, сделанное в момент t (односторонний путь с разбросом), мс. */
  get lag(): number {
    return this.rtt / 2 + this.jitter + SLACK;
  }

  /** Перевести нажатие клиента at (его часы) в часы комнаты; rx — когда сообщение пришло. */
  toRoom(at: unknown, rx: number): number {
    if (typeof at !== 'number' || !Number.isFinite(at) || !this.ready) return rx - this.rtt / 2;
    return clampPress(at - this.off, rx, this.rtt + this.jitter + SLACK);
  }
}

/** Нажатие не позже прихода и не раньше, чем позволяет погрешность связи. */
export function clampPress(t: number, rx: number, maxEarly: number): number {
  return Math.round(Math.min(rx, Math.max(rx - maxEarly, t)));
}

/** Окно ожидания нажатий по задержкам всех, кто может нажать (lag каждого), мс. */
export function pressWindow(lags: number[]): number {
  const m = lags.length ? Math.max(...lags) : 0;
  return Math.round(Math.min(WIN_MAX, Math.max(WIN_MIN, m)));
}

// ---------------------------------------------------------------- сторона клиента

/** Смещение часов этого клиента относительно комнаты (присылает комната в ping). */
let clientOff = 0;
export const setRoomOffset = (off: number) => {
  if (Number.isFinite(off)) clientOff = off;
};
/** Часы комнаты на этом клиенте. */
export const roomNow = () => Date.now() - clientOff;
/** Момент по часам комнаты → по местным часам (для обратного отсчёта на экране). */
export const roomToLocal = (t: number) => t + clientOff;
/** Время события ввода по настенным часам: event.timeStamp точнее, чем Date.now() в обработчике. */
export function eventTime(e?: { timeStamp?: number }): number {
  const ts = e?.timeStamp;
  if (typeof ts === 'number' && ts > 0 && typeof performance !== 'undefined' && performance.timeOrigin) {
    const t = performance.timeOrigin + ts;
    // старые браузеры дают timeStamp от эпохи — тогда он уже настенный
    if (Math.abs(t - Date.now()) < 60_000) return t;
    if (Math.abs(ts - Date.now()) < 60_000) return ts;
  }
  return Date.now();
}
