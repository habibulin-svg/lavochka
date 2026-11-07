/* Экран игры у одиночной аркады без сети (танчики, пинбол): как обычный экран игры — заголовок, «Правила», рекорды,
 * режимы крупными кнопками («Одному»), управление; под ним сайт допишет текст страницы (attachSeo).
 * Аркаде нужен флаг ArcadeModule.soloHome, правила — ArcadeModule.rules (HTML разделов), без них — about + controls. */
import { Sound } from './audio';
import type { ArcadeModule } from './arcade';
import { SCORE_COLUMNS } from './records';
import { openRecords } from './records-ui';
import { mountScreen, modal, showScreen } from './ui';
import { esc, h } from './util';

export interface ArcadeHomeOpts {
  onBack(): void;
  onPlay(mode: string): void;
  /** Правила открыли или закрыли — адрес «…/pravila/». */
  onRules?(open: boolean): void;
  /** Сразу открыть правила (пришли по адресу правил). */
  rules?: boolean;
  topExtra?: HTMLElement;
}

export function openArcadeHome(mod: ArcadeModule, o: ArcadeHomeOpts) {
  const el = h(`<section class="home-screen arcade-home arcade-home--${esc(mod.id)}">
    <header class="home-top">
      <button class="btn back" data-a="back">← Во двор</button>
      <div class="home-title"><h1>${esc(mod.title)}</h1><p>${mod.about}</p></div>
      <div class="home-top-btns">${mod.noRecords ? '' : '<button class="btn" data-a="records">🏆 Рекорды</button>'}<button class="btn" data-a="rules">Правила</button></div>
    </header>
    <div class="home-cols">
      <div class="sheet home-card">
        <div class="solo-box">
          <h2>Играть</h2>
          <div class="solo-modes">${mod.modes
            .map((m) => `<button class="btn primary" data-mode="${esc(m.id)}">▶ ${esc(m.label)}${m.hint ? `<small>${esc(m.hint)}</small>` : ''}</button>`)
            .join('')}</div>
        </div>
      </div>
      <div class="sheet home-card">
        <h2>Управление</h2>
        <div class="arcade-home-controls">${mod.controls}</div>
      </div>
    </div>
  </section>`);
  if (o.topExtra) el.querySelector('.home-top-btns')!.prepend(o.topExtra);
  mountScreen('home', el);
  const q = (s: string) => el.querySelector(s) as HTMLElement;
  q('[data-a=back]').onclick = () => {
    Sound.ui();
    o.onBack();
  };
  el.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(
    (b) =>
      (b.onclick = () => {
        Sound.unlock();
        Sound.ui();
        o.onPlay(b.dataset.mode!);
      })
  );
  const showRules = () => {
    Sound.ui();
    const m = modal(`<div class="arcade-rules"><h2>Правила: ${esc(mod.title)}</h2>${mod.rules ?? `<p>${mod.about}</p>${mod.controls}`}</div>`, [{ text: 'Понятно', primary: true }]);
    o.onRules?.(true);
    new MutationObserver((_r, obs) => {
      if (m.el.isConnected) return;
      obs.disconnect();
      o.onRules?.(false);
    }).observe(document.body, { childList: true });
  };
  q('[data-a=rules]').onclick = showRules;
  const rec = el.querySelector('[data-a=records]') as HTMLElement | null;
  if (rec)
    rec.onclick = () => {
      Sound.ui();
      openRecords(mod.id, mod.title, { table: mod.modes[0]?.id, label: mod.modes[0]?.label, columns: SCORE_COLUMNS });
    };
  showScreen('home');
  if (o.rules) showRules();
}
