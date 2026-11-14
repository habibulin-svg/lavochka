import type { GameModule } from '../../core/view';
import type { Options } from '../../core/types';
import { def, isSeason2 } from './def';
import { createView } from './view';
import { legacyStore, s2Access } from './season';
import { parseLegacy } from './legacy';
import { offerS2, LEGACY_KEY } from './paid';
import { takeBuyReturn } from '../../core/buyui';
import { modal } from '../../core/ui';
import { store } from '../../core/settings';
import { hasRight } from '../../core/rights';
import { currentUser } from '../../site/account';

// второй сезон — платное дополнение (право kommersy_s2, у Мастера — всё); сервер проверяет право сам
s2Access.check = () => hasRight(currentUser()?.rights ?? [], 'kommersy_s2');
legacyStore.get = () => {
  const raw = store.get<string | null>(LEGACY_KEY, null);
  return parseLegacy(raw) ? raw : null;
};

/** Перед запуском: второй сезон без покупки — окно покупки; свой Колян — наследие в правила партии. */
function prepare(o: Options): Options | null {
  if (!isSeason2(o)) {
    delete o.legacy;
    return o;
  }
  if (!s2Access.check()) {
    offerS2('Второй сезон — платное дополнение.');
    return null;
  }
  // загрузка сохранения: наследие уже в правилах партии
  if (typeof o.legacy === 'string') return o;
  const lg = legacyStore.get();
  if (lg && Number(o.start) === 0 && o.heir !== 0) o.legacy = lg;
  return o;
}

/** Экран игры: возврат с кассы — спасибо и (если есть свой Колян) сразу во второй сезон. */
function home(box: HTMLElement, launch: (options: Options, table?: { count: number }) => void) {
  box.hidden = true;
  const v = takeBuyReturn();
  if (!v) return;
  const owned = s2Access.check();
  const lg = parseLegacy(legacyStore.get());
  const start = () => launch({ season: 2, start: 0, diff: 1, chance: 0, buh: false, heir: 1 }, { count: 1 });
  modal(
    `<h2>${v === 'spasibo' ? 'Спасибо!' : 'Оплата не прошла'}</h2><p>${
      v !== 'spasibo'
        ? 'Деньги не списаны. Можно попробовать ещё раз — выбором «Сезон 2» на экране игры.'
        : owned
          ? `Второй сезон открыт.${lg ? ` ${lg.n} из первого сезона ждёт в Лондоне — январь 2004-го.` : ''}`
          : 'Оплата принята. Если второй сезон ещё закрыт — обновите страницу через минуту.'
    }</p>`,
    v === 'spasibo' && owned ? [{ text: 'Позже' }, { text: lg ? 'Продолжить во втором сезоне' : 'Начать второй сезон', primary: true, action: start }] : [{ text: 'Хорошо', primary: true }],
  );
}

const help = `<p><b>Ход.</b> «Бросить кубик» (или <kbd>Пробел</kbd>, или тап по свободному месту поля), затем поставьте фишку на подсвеченную клетку — щелчком по клетке или кнопкой «Поставить фишку».</p>
<p><b>Клетка.</b> Выпала карточка — выберите вариант. На «Сделке» три предложения: нажмите на то, что берёте, или откажитесь. 🩸 — тёмное дело: быстрее, но органы запомнят.</p>
<p><b>Свои дела</b> — справа, пока ваш ход и кубик ещё не брошен: 👔 — нанять или уволить управляющего (часов почти не берёт, доход чуть меньше), 💵 — продать дело, «Погасить» долг, сменить крышу, уволиться с работы.</p>
<p><b>Часы.</b> У каждого дела и работы свои часы в месяц; перебор — стресс, здоровье и настроение, а дела без управляющего приносят меньше. Следите за полосой «Часы».</p>
<p><b>Второй сезон</b> (2004–2021) — дополнение за 300 ₽: выбор «Сезон» в правилах партии. Купили клуб в первом сезоне — в финале кнопка «Продолжить во втором сезоне» с вашим Коляном.</p>
<p><b>Пауза</b> — <kbd>Esc</kbd> или ☰: сохранить в ячейку, загрузить, правила, выйти в меню игры или во двор. ♪ на поле — музыка, 🔊 на панели — звуки.</p>`;

const mod: GameModule = { def, createView, help, prepare, home };
export default mod;
