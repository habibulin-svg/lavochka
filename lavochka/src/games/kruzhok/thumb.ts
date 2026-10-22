/* Превью карточки кружка (?thumb=kruzhok): доска с угрозой детского мата и Михалыч с подсказкой —
 * видно сразу, что здесь учат и кто подсказывает. Снимок 16:10 → public/thumbs/kruzhok.webp. */
import { Board } from '../chess/board';
import { PORTRAIT } from '../chess/mihalych';
import { fromUci, position } from '../chess/notation';

const FEN = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';

export function mountThumb(el: HTMLElement) {
  el.className = 'kz-thumb';
  el.innerHTML = `<div class="kz-thumb-board"></div>
    <div class="kz-thumb-side">
      <div class="kz-thumb-say">Куда смотреть? На f7 — его один король сторожит!</div>
      <img src="${PORTRAIT}" alt="Михалыч">
      <b>Михалыч</b>
    </div>`;
  const s = position(FEN);
  const b = new Board(el.querySelector('.kz-thumb-board') as HTMLElement, { coords: false });
  b.set(s);
  const m = fromUci(s, 'h5f7')!;
  b.draw([{ from: m.from, to: m.to, kind: 'good' }, { from: fromUci(s, 'c4f7')!.from, to: m.to, kind: 'info' }], [{ sq: m.to, kind: 'bad' }]);
}
