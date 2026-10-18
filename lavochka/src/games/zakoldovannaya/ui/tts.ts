/* Голос ведущего: рассказ книги читается вслух голосом браузера (Web Speech API, speechSynthesis) — бесплатно и без
 * сервера. Голос свой у каждой системы; если русского нет — подсказка, что доустановить. Выбор голоса и скорость —
 * у каждого зрителя свои (localStorage). */
import { esc } from '../../../core/util';
import { store } from '../../../core/settings';
import type { Entry } from '../state';

const PREF = 'zs-tts';
interface Pref {
  on: boolean;
  voice?: string;
  rate: number;
}
const pref = (): Pref => ({ on: false, rate: 1, ...store.get<Partial<Pref>>(PREF, {}) });
const save = (p: Pref) => store.set(PREF, p);

const synth = (): SpeechSynthesis | null => (typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null);

/** Русские голоса, лучшие сверху: нейросетевые (Edge «Natural»/«Online»), Google, «улучшенные» Apple, остальные. */
export function ruVoices(): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|neural/i.test(v.name) ? 40 : 0) + (/online/i.test(v.name) ? 20 : 0) + (/google/i.test(v.name) ? 15 : 0) +
    (/enhanced|premium|улучш/i.test(v.name) ? 12 : 0) + (/milena|svetlana|dariya|dmitry/i.test(v.name) ? 5 : 0) + (v.localService ? 0 : 2);
  return s.getVoices().filter((v) => /^ru(-|_|$)/i.test(v.lang)).sort((a, b) => score(b) - score(a));
}

function pickVoice(): SpeechSynthesisVoice | undefined {
  const list = ruVoices();
  const want = pref().voice;
  return list.find((v) => v.voiceURI === want) ?? list[0];
}

/** Куски не длиннее ~200 знаков по предложениям: Chrome обрывает длинные фразы на полуслове. */
function chunks(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const s of text.replace(/\s+/g, ' ').match(/[^.!?…]+[.!?…»"]*\s*/g) ?? [text]) {
    if ((cur + s).length > 200 && cur) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Убрать то, что вслух звучит глупо: эмодзи, ×2, служебные значки. */
const clean = (t: string) => t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').replace(/×(\d+)/g, ', $1 шт.').replace(/[*_#]/g, '');

export class Narrator {
  private seen = -1;
  private keepAlive = 0;
  constructor() {
    // голоса в Chrome приходят не сразу
    synth()?.addEventListener?.('voiceschanged', () => this.onVoices?.());
  }
  onVoices?: () => void;
  on(): boolean {
    return !!synth() && pref().on;
  }
  toggle(): boolean {
    const p = pref();
    p.on = !p.on;
    save(p);
    if (!p.on) this.stop();
    else this.say('Ведущий будет читать рассказ вслух.');
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
    for (const e of fresh) if (e.k === 'say' || e.k === 'talk' || e.k === 'title') this.say(e.text, e.k === 'title');
  }
  say(text: string, title = false): void {
    const s = synth();
    if (!s) return;
    const p = pref();
    const voice = pickVoice();
    for (const part of chunks(clean(text))) {
      const u = new SpeechSynthesisUtterance(part);
      u.lang = voice?.lang ?? 'ru-RU';
      if (voice) u.voice = voice;
      u.rate = p.rate * (title ? 0.92 : 1);
      u.pitch = title ? 0.9 : 1;
      s.speak(u);
    }
    // Chrome на компьютере замолкает через ~15 с длинной очереди — подталкиваем паузой/продолжением
    clearInterval(this.keepAlive);
    this.keepAlive = window.setInterval(() => {
      if (!s.speaking) return clearInterval(this.keepAlive);
      if (!/android|iphone|ipad/i.test(navigator.userAgent)) {
        s.pause();
        s.resume();
      }
    }, 10000);
  }
  stop(): void {
    clearInterval(this.keepAlive);
    synth()?.cancel();
  }
}

// ---------- окно настройки голоса

type Os = 'windows' | 'mac' | 'ios' | 'android' | 'linux' | 'other';
function osOf(): Os {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/windows/i.test(ua)) return 'windows';
  if (/macintosh|mac os/i.test(ua)) return 'mac';
  if (/linux|cros/i.test(ua)) return 'linux';
  return 'other';
}

const TIPS: { os: Os; title: string; html: string }[] = [
  {
    os: 'windows',
    title: 'Windows',
    html: `<b>Лучше всего — браузер Microsoft Edge:</b> в нём бесплатные нейросетевые голоса «Microsoft Svetlana / Dmitry Online (Natural)» — звучат почти как человек (нужен интернет).<br>
      В Chrome есть «Google русский» (тоже через интернет).<br>
      Голос без интернета: <i>Параметры → Время и язык → Речь → Управление голосами → Добавить голоса → Русский</i> (Irina, Pavel). После установки перезапустите браузер.`,
  },
  {
    os: 'mac',
    title: 'macOS',
    html: `<i>Системные настройки → Универсальный доступ → Устный контент → Системный голос → Управлять голосами… → Русский</i> —
      скачайте <b>Milena (улучшенный)</b> или Yuri (улучшенный). Перезапустите браузер. В Chrome есть ещё «Google русский» (через интернет).`,
  },
  {
    os: 'ios',
    title: 'iPhone и iPad',
    html: `<i>Настройки → Универсальный доступ → Устный контент → Голоса → Русский</i> — скачайте <b>Milena (улучшенный)</b> или Yuri (улучшенный).
      Затем закройте и снова откройте Safari. Если звука нет — проверьте переключатель «Без звука» сбоку телефона.`,
  },
  {
    os: 'android',
    title: 'Android',
    html: `Поставьте из Google Play <b>«Распознавание и синтез речи Google»</b> (Speech Services by Google).<br>
      <i>Настройки → Специальные возможности → Синтез речи (Преобразование текста в речь)</i>: система — Google, язык — Русский;
      в настройках движка «Установка голосовых данных» → Русский — скачайте голос. Перезапустите Chrome.
      Без русского пакета Android может молча читать английским голосом.`,
  },
  {
    os: 'linux',
    title: 'Linux',
    html: `Браузер говорит через <b>speech-dispatcher</b>. Хороший русский голос — RHVoice:
      <code>sudo apt install speech-dispatcher speech-dispatcher-rhvoice rhvoice-russian</code> (или пакеты rhvoice-voice-* вашего дистрибутива), затем в
      <code>~/.config/speech-dispatcher/speechd.conf</code> — <code>DefaultModule rhvoice</code> и <code>DefaultLanguage ru</code>.
      Без RHVoice будет espeak — понятно, но роботом. Перезапустите браузер.`,
  },
];

export function openVoiceDialog(root: HTMLElement, nar: Narrator, onChange: () => void): void {
  root.querySelector('.zs-modal')?.remove();
  const dlg = document.createElement('div');
  dlg.className = 'zs-modal';
  const os = osOf();
  const draw = () => {
    const p = pref();
    const list = ruVoices();
    const cur = pickVoice();
    const tips = [...TIPS.filter((t) => t.os === os), ...TIPS.filter((t) => t.os !== os)];
    dlg.innerHTML = `<div class="zs-modal-box zs-sheet zs-tts"><button class="zs-close">✕</button>
      <h2>Голос ведущего</h2>
      ${!synth() ? '<p class="zs-tts-warn">Этот браузер не умеет читать вслух. Попробуйте Edge, Chrome или Safari.</p>' : ''}
      <label class="zs-tts-row"><input type="checkbox" class="zs-tts-on"${p.on ? ' checked' : ''}${synth() ? '' : ' disabled'}> Читать рассказ вслух</label>
      ${list.length
        ? `<label class="zs-tts-row">Голос: <select class="zs-tts-voice">${list.map((v) => `<option value="${esc(v.voiceURI)}"${v === cur ? ' selected' : ''}>${esc(v.name)}${v.localService ? '' : ' · интернет'}</option>`).join('')}</select></label>`
        : synth() ? '<p class="zs-tts-warn">Русского голоса на этом устройстве не найдено — браузер прочтёт текст чужим голосом или промолчит. Ниже — как его поставить.</p>' : ''}
      <label class="zs-tts-row">Скорость: <input type="range" class="zs-tts-rate" min="0.7" max="1.5" step="0.05" value="${p.rate}"> <span>${p.rate.toFixed(2)}</span></label>
      <div class="zs-row"><button class="btn small zs-tts-test">▶ Проба</button><button class="btn small primary zs-tts-close">Готово</button></div>
      <h4>Чтобы звучало хорошо</h4>
      ${tips.map((t, i) => `<details${i === 0 ? ' open' : ''}><summary>${t.title}${t.os === os ? ' — ваша система' : ''}</summary><p>${t.html}</p></details>`).join('')}
    </div>`;
    const q = <T extends HTMLElement>(s: string) => dlg.querySelector(s) as T | null;
    q<HTMLInputElement>('.zs-tts-on')?.addEventListener('change', () => {
      nar.toggle();
      onChange();
    });
    q<HTMLSelectElement>('.zs-tts-voice')?.addEventListener('change', (e) => {
      save({ ...pref(), voice: (e.target as HTMLSelectElement).value });
      nar.stop();
      nar.say('Так звучит этот голос.');
    });
    q<HTMLInputElement>('.zs-tts-rate')?.addEventListener('input', (e) => {
      const r = Number((e.target as HTMLInputElement).value);
      save({ ...pref(), rate: r });
      (e.target as HTMLElement).nextElementSibling!.textContent = r.toFixed(2);
    });
    q('.zs-tts-test')?.addEventListener('click', () => {
      nar.stop();
      nar.say('Отряд собрался в Форпосте — последней крепости на краю Заколдованной страны. Дальше — леса, полные чудовищ.');
    });
    q('.zs-tts-close')?.addEventListener('click', () => dlg.remove());
    q('.zs-close')?.addEventListener('click', () => dlg.remove());
  };
  dlg.addEventListener('click', (e) => e.target === dlg && dlg.remove());
  nar.onVoices = () => dlg.isConnected && draw();
  draw();
  root.append(dlg);
}
