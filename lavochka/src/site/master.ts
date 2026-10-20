/* «Слово Мастера»: записка под заголовком двора и письмо целиком в окне — со ссылками на игры и разделы.
 * Прочитал — записка становится скромнее (помним в браузере). */
import { modal } from '../core/ui';
import { esc } from '../core/util';
import { markdown } from '../core/markdown';
import { gameCard } from './postcard';
import { Sound } from '../core/audio';
import { store } from '../core/settings';
import { gamePath, sectionPath } from './routes';
import { openDonate } from './donate';
import './master.css';

const g = (id: string, text: string) => `[${text}](${gamePath(id)})`;
const s = (id: string, text: string) => `[${text}](${sectionPath(id)})`;

/** Встроенное письмо (Markdown; строки с < — HTML с оформлением письма). Его же редактор админки показывает для правки. */
export const MASTER_MD = () => `<p class="mw-hello">Мир дому твоему, путник!</p>

Волею судеб ты оказался в волшебном мире, полном удивительных чудес и тёплых воспоминаний.

Помнишь, как воскресным утром в солнечный зимний день, когда в школу не надо, а друзья ещё не выбежали во двор, ты просыпался от запаха маминых блинов, наскоро плескал водой в лицо, быстро бежал на кухню, завтракал, а потом, пока папа ещё дома, благоговейно брал вкусно пахнущую деревом старую ${g('chess', 'шахматную доску')} и, глядя в его добрые глаза, просил сыграть с тобой партию-другую?

Он ухмылялся в усы, делал вид, что очень увлечён свежим номером «${s('sport', 'Советского спорта')}», но, конечно же, соглашался, и вы играли часами — в ${g('chess', 'шахматы')}, ${g('checkers', 'шашки')}, потом опять шахматы, а когда надоест — ты доставал из-под кровати свои волшебные сокровища: потрёпанные ${s('tabletop', 'картонные коробки')}, внутри которых бушевали страсти, капитаны водили ${g('sea', 'парусные корабли')} по далёким океанам, авантюристы снаряжали ${g('star', 'экспедиции за сокровищами')} в экзотических странах, громыхали ${g('seabattle', 'войны')}, за несколько минут делались и проигрывались ${g('manager', 'состояния')}, а храбрые герои бросались в бой навстречу ${g('zakoldovannaya', 'неведомым чудовищам')}.

А когда смеркалось, и [двор](/) наполнялся детворой — ты бежал туда с ${s('cards', 'колодой карт')} в кармане, чтобы в краткие минутки отдыха между снежками и ${g('hockey', 'хоккеем')}, смести снег с лавочки и быстренько перекинуться с друзьями ${g('durak', 'в дурака')}, ${g('bluff', 'верю-не верю')} или что-нибудь подобное, давно забытое, во что уже давно никто не играет…

<p class="mw-but">…А ты можешь!</p>

Так что вперёд, мой друг, ${g('adventures', 'к приключениям')}!

<p class="mw-sign">Твой Мастер.</p>

<p class="mw-ps">P.S. Только прошу — не забывай, что ничто на земле не бывает просто так, а чудес, увы, не бывает. Без твоей поддержки проекту не выжить: доступны и <a href="#donate">разовая благодарность</a>, и <a href="/podpiska/">подписка</a> — выбирай!</p>`;

const READ_KEY = 'master.read';

/** Письмо: правленое в админке (server/content.ts) или встроенное. */
let word: Promise<{ title: string; md: string }> | null = null;
function loadWord() {
  word ??= fetch('/api/master-word', { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((b) => (b?.body ? { title: String(b.title || 'Слово Мастера'), md: String(b.body) } : { title: 'Слово Мастера', md: MASTER_MD() }));
  return word;
}

/** Начало письма для записки: без разметки, пара первых фраз. */
function opening(md: string): string {
  const t = md
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>`|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = t.slice(0, 140);
  return cut.length < t.length ? cut.replace(/\s+\S*$/, '') + '…' : cut;
}

/** Письмо целиком. */
export async function openMasterWord(): Promise<void> {
  Sound.ui();
  const w = await loadWord();
  const box = document.createElement('div');
  box.className = 'mw-letter';
  box.innerHTML = `<h2 class="mw-title">${esc(w.title)}</h2>${markdown(w.md, gameCard)}`;
  const m = modal(box, [{ text: 'Во двор!', primary: true }], { cls: 'mw-modal' });
  box.addEventListener('click', (e) => {
    const a = (e.target as Element).closest('a');
    if (!a) return;
    // «разовая благодарность» — окно доната; ссылки на игры и разделы — закрыть письмо (роутер откроет страницу)
    if (a.getAttribute('href') === '#donate' || a.hasAttribute('data-donate')) {
      e.preventDefault();
      m.close();
      void openDonate();
    } else m.close();
  });
  try {
    store.set(READ_KEY, 1);
  } catch {
    /* без памяти — просто не запомним */
  }
  document.querySelectorAll('.mw-note').forEach((n) => n.classList.add('read'));
}

/** Записка для двора: заголовок, первые слова и «читать письмо». */
export function masterNote(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'mw-note';
  if (store.get(READ_KEY, 0)) b.classList.add('read');
  b.innerHTML = `<span class="mw-pin" aria-hidden="true"></span>
    <span class="mw-n-head">Слово Мастера</span>
    <span class="mw-n-text">«${esc(opening(MASTER_MD()))}»</span>
    <span class="mw-n-more">читать письмо ✉</span><span class="mw-n-again">перечитать ✉</span>`;
  b.title = 'Письмо от Мастера сборника';
  b.onclick = () => void openMasterWord();
  // правленое письмо — своё начало на записке
  void loadWord().then((w) => {
    (b.querySelector('.mw-n-text') as HTMLElement).textContent = `«${opening(w.md)}»`;
    (b.querySelector('.mw-n-head') as HTMLElement).textContent = w.title;
  });
  return b;
}
