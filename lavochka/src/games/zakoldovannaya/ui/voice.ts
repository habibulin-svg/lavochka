/* Голос ведущего: рассказ читают заранее записанные голоса — рассказчик и 15 ролей (CosyVoice3 по образцам ElevenLabs,
 * tools/zakoldovannaya/voice). Запись строки — public/zakoldovannaya/voice/<ключ>.ogg, ключ — vkey исходного текста
 * (у строк с {name} — запись шаблона, Entry.v). Строки, собранные движком на лету (бой, имена), не озвучены — тишина.
 * Включение, громкость и скорость — у каждого зрителя свои (localStorage). */
import { store } from '../../../core/settings';
import type { Entry } from '../state';
import { vkey } from '../vkey';
import { IMG } from './common';

const PREF = 'zs-voice';
interface Pref {
  on: boolean;
  vol: number;
  rate: number;
}
const pref = (): Pref => ({ on: true, vol: 0.9, rate: 1, ...store.get<Partial<Pref>>(PREF, {}) });
const save = (p: Pref) => store.set(PREF, p);

const DIR = `${IMG}voice/`;
/** Сколько записей ждать в очереди: игроки читают быстрее, чем ведущий говорит, — старое выбрасываем. */
const QUEUE_MAX = 6;

let have: Promise<Set<string>> | null = null;
/** Список озвученных ключей (index.json) — чтобы не дёргать сервер за строками без записи. */
function known(): Promise<Set<string>> {
  have ??= fetch(`${DIR}index.json`)
    .then((r) => (r.ok ? r.json() : []))
    .then((a: string[]) => new Set(a))
    .catch(() => new Set<string>());
  return have;
}

export class Narrator {
  private seen = -1;
  private queue: string[] = [];
  private cur: HTMLAudioElement | null = null;
  /** Приглушить музыку, пока говорит ведущий. */
  onSpeak?: (speaking: boolean) => void;
  on(): boolean {
    return pref().on;
  }
  toggle(): boolean {
    const p = pref();
    p.on = !p.on;
    save(p);
    if (!p.on) this.stop();
    return p.on;
  }
  /** Новые записи рассказа (по номеру записи) — вслух; при первом показе — только запомнить, где мы. */
  feed(story: Entry[]): void {
    const last = story.length ? story[story.length - 1].n ?? 0 : 0;
    if (this.seen < 0 || last < this.seen) {
      this.seen = last;
      return;
    }
    const fresh = story.filter((e) => (e.n ?? 0) > this.seen);
    this.seen = last;
    if (!this.on()) return;
    const keys = fresh.filter((e) => e.k === 'say' || e.k === 'title').map((e) => e.v ?? vkey(e.text));
    if (keys.length) void this.push(keys);
  }
  private async push(keys: string[]): Promise<void> {
    const set = await known();
    this.queue.push(...keys.filter((k) => set.has(k)));
    if (this.queue.length > QUEUE_MAX) this.queue.splice(0, this.queue.length - QUEUE_MAX);
    if (!this.cur) this.next();
  }
  private next(): void {
    const k = this.queue.shift();
    if (!k) {
      this.cur = null;
      this.onSpeak?.(false);
      return;
    }
    const p = pref();
    const a = new Audio(`${DIR}${k}.ogg`);
    a.volume = p.vol;
    a.playbackRate = p.rate;
    a.preservesPitch = true;
    a.onended = a.onerror = () => {
      if (this.cur === a) this.next();
    };
    this.cur = a;
    this.onSpeak?.(true);
    void a.play().catch(() => {
      if (this.cur === a) this.next();
    });
  }
  /** Проба голоса — первая строка партии. */
  sample(): void {
    this.stop();
    void this.push([vkey('Отряд собрался в Форпосте — последней крепости на краю Заколдованной страны. Дальше — леса, полные чудовищ, заколдованные города и замки злых колдунов. Говорят, всем этим краем правит Чёрный маг. Пройти всю охрану и освободить страну из-под власти тёмных сил — вот ваша задача.')]);
  }
  stop(): void {
    this.queue = [];
    if (this.cur) {
      this.cur.onended = this.cur.onerror = null;
      this.cur.pause();
    }
    this.cur = null;
    this.onSpeak?.(false);
  }
  /** Громкость и скорость — сразу и на звучащей записи. */
  apply(): void {
    const p = pref();
    if (this.cur) {
      this.cur.volume = p.vol;
      this.cur.playbackRate = p.rate;
    }
  }
}

// ---------- окно настройки голоса

export function openVoiceDialog(root: HTMLElement, nar: Narrator, onChange: () => void): void {
  root.querySelector('.zs-modal')?.remove();
  const dlg = document.createElement('div');
  dlg.className = 'zs-modal';
  const p = pref();
  dlg.innerHTML = `<div class="zs-modal-box zs-sheet zs-voice"><button class="zs-close">✕</button>
    <h2>Голос ведущего</h2>
    <p>Рассказ читают рассказчик и голоса героев книги: маги, стражники, разбойники, людоеды, призраки.</p>
    <label class="zs-voice-row"><input type="checkbox" class="zs-voice-on"${p.on ? ' checked' : ''}> Читать рассказ вслух</label>
    <label class="zs-voice-row">Громкость: <input type="range" class="zs-voice-vol" min="0.1" max="1" step="0.05" value="${p.vol}"></label>
    <label class="zs-voice-row">Скорость: <input type="range" class="zs-voice-rate" min="0.8" max="1.4" step="0.05" value="${p.rate}"> <span>${p.rate.toFixed(2)}</span></label>
    <div class="zs-row"><button class="btn small zs-voice-test">▶ Проба</button><button class="btn small primary zs-voice-close">Готово</button></div>
  </div>`;
  const q = <T extends HTMLElement>(s: string) => dlg.querySelector(s) as T;
  q<HTMLInputElement>('.zs-voice-on').addEventListener('change', () => {
    nar.toggle();
    onChange();
  });
  q<HTMLInputElement>('.zs-voice-vol').addEventListener('input', (e) => {
    save({ ...pref(), vol: Number((e.target as HTMLInputElement).value) });
    nar.apply();
  });
  q<HTMLInputElement>('.zs-voice-rate').addEventListener('input', (e) => {
    const r = Number((e.target as HTMLInputElement).value);
    save({ ...pref(), rate: r });
    (e.target as HTMLElement).nextElementSibling!.textContent = r.toFixed(2);
    nar.apply();
  });
  q('.zs-voice-test').addEventListener('click', () => nar.sample());
  const close = () => dlg.remove();
  q('.zs-voice-close').addEventListener('click', close);
  q('.zs-close').addEventListener('click', close);
  dlg.addEventListener('click', (e) => e.target === dlg && close());
  root.append(dlg);
}
