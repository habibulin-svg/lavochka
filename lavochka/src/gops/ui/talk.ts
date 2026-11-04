/* Чат и голос сетевой партии ГОПС поверх боя: строки чата слева (гаснут через 8 с), T — написать;
 * кнопка 🎤 — голосовой чат (core/voice.ts, звук напрямую между браузерами, сигналы — через комнату). */
import type { RoomClient } from '../../core/client';
import { Voice } from '../../core/voice';
import './talk.css';

/** Что нужно панели от сетевого клиента (ГОПС, «Герои»); остальное для голоса — id, on, voice, rtc. */
export interface TalkNet {
  onChat: (name: string, text: string) => void;
  chat(text: string): void;
}

export class Talk {
  readonly el: HTMLElement;
  private log: HTMLElement;
  private input: HTMLInputElement;
  private mic: HTMLButtonElement;
  private who: HTMLElement;
  private voice: Voice | null = null;
  private off = new AbortController();

  constructor(host: HTMLElement, net: TalkNet) {
    this.el = document.createElement('div');
    this.el.className = 'talk';
    this.log = document.createElement('div');
    this.log.className = 'talk-log';
    this.input = document.createElement('input');
    this.input.className = 'talk-input';
    this.input.maxLength = 200;
    this.input.placeholder = 'Сказать пацанам… (Enter — отправить, Esc — закрыть)';
    this.input.hidden = true;
    const bar = document.createElement('div');
    bar.className = 'talk-bar';
    const chatBtn = document.createElement('button');
    chatBtn.textContent = '💬';
    chatBtn.title = 'Чат (T)';
    chatBtn.onclick = () => this.open();
    this.mic = document.createElement('button');
    this.who = document.createElement('span');
    this.who.className = 'talk-who';
    bar.append(chatBtn, this.mic, this.who);
    this.el.append(this.log, this.input, bar);
    host.appendChild(this.el);

    net.onChat = (name, text) => this.line(name, text);
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.input.value.trim();
        if (t) net.chat(t);
        this.close();
      } else if (e.key === 'Escape') this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT' && this.input.hidden && !(e.target as HTMLElement)?.closest?.('input')) {
        e.preventDefault();
        this.open();
      }
    }, { signal: this.off.signal });

    if (Voice.supported()) {
      // ГОПС-клиент отвечает тем же, что голосу нужно от клиента комнаты: id, on, voice, rtc
      this.voice = new Voice(net as unknown as RoomClient);
      this.voice.onChange = () => this.renderVoice();
      this.voice.onFail = (name) => this.line('', `Не соединиться с ${name} по голосу`);
    }
    this.mic.onclick = () => {
      const v = this.voice;
      if (!v) return;
      if (!v.joined) v.join(false, false).catch(() => this.line('', 'Нет доступа к микрофону'));
      else v.setMic(!v.micOn);
    };
    this.mic.oncontextmenu = (e) => {
      e.preventDefault();
      this.voice?.leave();
    };
    this.renderVoice();
  }

  private open(): void {
    this.input.hidden = false;
    this.input.focus();
  }

  private close(): void {
    this.input.value = '';
    this.input.hidden = true;
    this.input.blur();
  }

  private line(name: string, text: string): void {
    const d = document.createElement('div');
    d.className = 'talk-line';
    if (name) {
      const b = document.createElement('b');
      b.textContent = `${name}: `;
      d.append(b);
    }
    d.append(text);
    this.log.append(d);
    while (this.log.children.length > 6) this.log.firstElementChild?.remove();
    window.setTimeout(() => d.classList.add('gone'), 8000);
    window.setTimeout(() => d.remove(), 9000);
  }

  private renderVoice(): void {
    const v = this.voice;
    this.mic.hidden = !v;
    if (!v) return;
    this.mic.textContent = !v.joined ? '🎤' : v.micOn ? '🎙️' : '🔇';
    this.mic.title = !v.joined ? 'Голос: войти' : 'Микрофон вкл/выкл (правая кнопка — выйти из голоса)';
    this.mic.classList.toggle('on', v.joined && v.micOn);
    const tiles = v.tiles();
    this.who.textContent = tiles.length ? tiles.map((t) => (t.me ? 'ты' : t.name) + (t.level > 0.08 && !t.muted ? ' 🔊' : '')).join(', ') : '';
  }

  destroy(): void {
    this.off.abort();
    this.voice?.leave();
    this.el.remove();
  }
}
