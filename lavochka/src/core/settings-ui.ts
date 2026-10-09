/* Окно общих настроек сборника. */
import { cardSVG, DECK_STYLES } from '../cards/render';
import type { Card } from '../cards/deck';
import { serverBase } from './net/ws';
import { saveSettings, settings, type DeckStyle, type NetMode } from './settings';
import { modal } from './ui';
import { esc, h } from './util';

const SAMPLE: Card[] = [
  { s: 'H', r: 13 },
  { s: 'S', r: 14 },
  { s: 'D', r: 7 },
];

export function openSettings() {
  const el = h(`<div class="settings">
    <h2>Настройки</h2>
    <label class="field">Как вас зовут во дворе <input data-k="name" maxlength="16" placeholder="Имя"></label>
    <div class="set-row"><label><input type="checkbox" data-k="sound"> Звук</label>
      <input type="range" data-k="volume" min="0" max="1" step="0.05" title="Громкость"></div>
    <div class="set-row"><span>Скорость анимации</span><input type="range" data-k="speed" min="0.5" max="3" step="0.25"></div>
    <label class="set-row"><input type="checkbox" data-k="autoSingle"> Ходить автоматически, если вариант один</label>
    <h3>Колода</h3>
    <div class="deck-pick"></div>
    <h3>Сетевая игра</h3>
    <div class="seg net-seg"><button data-net="p2p">Напрямую (P2P)</button><button data-net="server">Через сервер</button></div>
    <p class="hint net-hint"></p>
    <label class="field server-field">Адрес сервера <input data-k="serverUrl" placeholder="${esc(location.origin)}"></label>
    <div class="row"><button class="btn small" data-a="check">Проверить связь</button><span class="check-res"></span></div>
  </div>`);

  const inp = (k: string) => el.querySelector(`[data-k=${k}]`) as HTMLInputElement;
  inp('name').value = settings.name;
  inp('name').oninput = () => {
    settings.name = inp('name').value.trim();
    saveSettings();
  };
  for (const k of ['sound', 'autoSingle'] as const) {
    inp(k).checked = settings[k];
    inp(k).onchange = () => {
      settings[k] = inp(k).checked;
      saveSettings();
    };
  }
  for (const k of ['volume', 'speed'] as const) {
    inp(k).value = String(settings[k]);
    inp(k).oninput = () => {
      settings[k] = +inp(k).value;
      saveSettings();
    };
  }

  const pick = el.querySelector('.deck-pick') as HTMLElement;
  const renderDecks = () => {
    pick.innerHTML = '';
    for (const d of DECK_STYLES) {
      const b = h(`<button class="deck-opt${settings.deck === d.id ? ' on' : ''}">
          <span class="deck-cards">${SAMPLE.map((c) => cardSVG(c, d.id)).join('')}${cardSVG(null, d.id)}</span>
          <b>${d.title}</b><small>${d.hint}</small></button>`);
      b.onclick = () => {
        settings.deck = d.id as DeckStyle;
        saveSettings();
        renderDecks();
      };
      pick.appendChild(b);
    }
  };
  renderDecks();

  const hint = el.querySelector('.net-hint') as HTMLElement;
  const srvField = el.querySelector('.server-field') as HTMLElement;
  const renderNet = () => {
    el.querySelectorAll<HTMLButtonElement>('[data-net]').forEach((b) => b.classList.toggle('on', b.dataset.net === settings.net));
    hint.textContent =
      settings.net === 'p2p'
        ? 'Бесплатно и без сервера: всё ведёт браузер того, кто создал комнату. Код комнаты — 5 знаков.'
        : 'Партию ведёт сервер — чужие карты и роли не видит никто. Код комнаты — 6 знаков.';
    srvField.hidden = settings.net !== 'server';
  };
  el.querySelectorAll<HTMLButtonElement>('[data-net]').forEach(
    (b) =>
      (b.onclick = () => {
        settings.net = b.dataset.net as NetMode;
        saveSettings();
        renderNet();
      })
  );
  renderNet();
  inp('serverUrl').value = settings.serverUrl;
  inp('serverUrl').oninput = () => {
    settings.serverUrl = inp('serverUrl').value.trim();
    saveSettings();
  };
  const res = el.querySelector('.check-res') as HTMLElement;
  (el.querySelector('[data-a=check]') as HTMLButtonElement).onclick = async () => {
    res.textContent = 'Проверяем…';
    try {
      const r = await fetch(serverBase() + '/api/health', { cache: 'no-store' });
      const j = await r.json();
      res.textContent = j.ok ? `✔ Сервер на связи (комнат: ${j.rooms})` : '✖ Странный ответ';
    } catch {
      res.textContent = '✖ Сервер не отвечает';
    }
  };

  return modal(el, [{ text: 'Готово', primary: true }], { wide: true });
}
