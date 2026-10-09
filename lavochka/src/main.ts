/* Точка входа: двор → экран игры → стол. */
import './styles/base.css';
import { Sound } from './core/audio';
import { openHome } from './core/home';
import { nav, offerResume } from './core/session';
import { modal } from './core/ui';
import { esc } from './core/util';
import { byId, type CatalogEntry } from './games/catalog';
import { yard } from './launcher/yard';

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
  view.mount(board, { act() {}, mySeats: [], demo: true, controls, name: (s) => String(s), speed: () => 1, autoSingle: () => false });
  const st = mod.def.showcase ? mod.def.showcase() : null;
  if (st) view.setView(mod.def.view(st, 'all'));
}

const thumb = new URLSearchParams(location.search).get('thumb');
if (thumb) void thumbMode(thumb);
else {
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  yard.show();
  offerResume();
}
