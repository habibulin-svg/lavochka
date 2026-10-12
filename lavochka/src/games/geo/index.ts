import { h } from '../../core/util';
import type { GameModule } from '../../core/view';
import { def } from './def';
import { openRef } from './ref';
import { createView } from './view';
import './geo.css';

/** На экране игры — вход в справочник: посмотреть флаги, гербы и карты без викторины. */
function home(box: HTMLElement) {
  const b = h<HTMLButtonElement>(`<button class="btn geo-refbtn">📖 Справочник: флаги, гербы, столицы, карты</button>`);
  b.onclick = () => openRef();
  box.appendChild(b);
}

const mod: GameModule = { def, createView, home };
export default mod;
