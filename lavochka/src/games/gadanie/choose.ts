/* «Гадание на картах» — начало: две колоды на выбор (таро и обычная), как две карточки во дворе. */
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import { backUrl, smallUrl } from './faces';

const box = (deck: 'taro' | 'karty', title: string, sub: string, faces: number[]) => `
  <button class="gd-box gd-box-${deck}" data-go="${deck}">
    <span class="gd-box-fan">${[backUrl(deck), ...faces.map((c) => smallUrl(deck, c))].map((u, i, a) => `<img src="${u}" alt="" style="--i:${i - (a.length - 1) / 2}">`).join('')}</span>
    <b>${title}</b><small>${sub}</small>
  </button>`;

export function mountChoose(root: HTMLElement, panel: HTMLElement, go: (mode: string) => void) {
  const page = h(`<div class="gd-choose">
    <h2>Погадаем?</h2>
    <div class="gd-boxes">
      ${box('taro', 'На картах таро', 'колода Уэйта — Смит 1909: карта дня, да или нет, кельтский крест и ещё 9 раскладов', [17, 1, 19])}
      ${box('karty', 'На обычной колоде', 'бабушкино гадание на 36 картах: на короля, на желание, «что было, что будет»', [35, 34, 26])}
    </div>
    <p class="gd-choose-note">Гадание — для развлечения: карты подсказывают, о чём подумать, а решаете вы сами.</p>
  </div>`);
  root.appendChild(page);
  const side = h(`<div class="gd-side"><p>Выберите колоду. Карты из колоды вы тянете сами, значение каждой — сразу под рукой, а в справочнике — все карты с толкованиями.</p>
    <p>Со «Лавочкой+» расклад целиком растолкует <b>Светка</b> — с нашего двора, гадает девчонкам на лавочке.</p></div>`);
  panel.appendChild(side);
  page.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-go]');
    if (!b) return;
    Sound.ui();
    go(b.dataset.go!);
  });
  return {
    destroy() {
      page.remove();
      side.remove();
    },
  };
}
