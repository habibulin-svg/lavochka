/* Ровный таймер для комнаты реального времени. В браузере комната живёт во вкладке хоста, а скрытой вкладке браузер режет
 * setInterval до раза в секунду (через пять минут — до раза в минуту): у всех за столом партия почти вставала. Таймеры внутри
 * Worker так не режутся — тикаем оттуда. На сервере и где Worker нет — обычный setInterval. */

export interface Ticker {
  stop(): void;
}

const SRC = 'let h;onmessage=(e)=>{clearInterval(h);if(e.data>0)h=setInterval(()=>postMessage(0),e.data)}';
let url: string | null = null;

export function startTicker(fn: () => void, ms: number): Ticker {
  if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      url ??= URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = () => fn();
      w.postMessage(ms);
      return { stop: () => w.terminate() };
    } catch {
      // Worker запрещён (политика страницы) — обычный таймер
    }
  }
  const h = setInterval(fn, ms);
  return { stop: () => clearInterval(h) };
}
