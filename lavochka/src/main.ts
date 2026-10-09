/* Точка входа: двор → экран игры → стол. */
import './styles/base.css';
import { Sound } from './core/audio';
import { openHome } from './core/home';
import { nav, offerResume } from './core/session';
import { modal } from './core/ui';
import { esc } from './core/util';
import { byId, type CatalogEntry } from './games/catalog';
import { yard } from './launcher/yard';
import { cardHTML, DECK_STYLES } from './cards/render';
import { makeDeck } from './cards/deck';

async function openGame(g: CatalogEntry) {
  if (!g.load) return;
  try {
    const mod = (await g.load()).default;
    openHome(mod, () => yard.show());
  } catch (e: any) {
    modal(`<h2>Не загрузилось</h2><p>${esc(e?.message || e)}</p>`, [{ text: 'Ок', primary: true }]);
  }
}

yard.openGame = (g) => void openGame(g);
nav.yard = () => yard.show();
nav.home = (id) => {
  const g = byId(id);
  if (g) void openGame(g);
  else yard.show();
};

/** ?thumb=<игра> — служебный режим: поле в «красивой» позиции для снимка превью карточки. */
async function thumbMode(id: string) {
  const g = byId(id);
  if (!g?.load) return;
  const mod = (await g.load()).default;
  const stage = document.createElement('div');
  stage.className = 'thumb-stage';
  const board = document.createElement('div');
  board.className = 'thumb-board';
  const controls = document.createElement('div');
  stage.append(board);
  document.body.append(stage);
  const view = mod.createView();
  view.mount(board, { act() {}, mySeats: [], demo: true, controls, name: (s) => mod.def.seats[s]?.name ?? String(s), speed: () => 1, autoSingle: () => false });
  const st = mod.def.showcase ? mod.def.showcase() : null;
  if (st) view.setView(mod.def.view(st, 'all'));
}

/** ?cards — служебный режим: вся колода во всех трёх стилях (проверка рисунков). */
function cardsMode() {
  // ?cards=courts — только фигуры, крупно
  const courts = params.get('cards') === 'courts';
  const deck = makeDeck(54).filter((c) => !courts || (c.r >= 11 && c.r <= 13));
  document.body.innerHTML = DECK_STYLES.map(
    (d) => `<h2 style="color:#fff;font:20px 'PT Serif',serif;margin:16px">${d.title}</h2><div class="cards-sheet">${deck.map((c) => cardHTML(c, d.id)).join('')}${cardHTML(null, d.id)}</div>`
  ).join('');
  const st = document.createElement('style');
  st.textContent = `body{background:#2a4a32;overflow:auto}.cards-sheet{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px}.cards-sheet .card{width:${courts ? 230 : 150}px;height:auto;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}`;
  document.head.append(st);
}

const params = new URLSearchParams(location.search);
const thumb = params.get('thumb');
if (thumb) void thumbMode(thumb);
else if (params.has('cards')) cardsMode();
else {
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  yard.show();
  offerResume();
}
