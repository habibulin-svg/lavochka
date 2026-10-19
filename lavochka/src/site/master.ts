/* «Слово Мастера»: записка под заголовком двора и письмо целиком в окне — со ссылками на игры и разделы.
 * Прочитал — записка становится скромнее (помним в браузере). */
import { modal } from '../core/ui';
import { Sound } from '../core/audio';
import { store } from '../core/settings';
import { gamePath, sectionPath } from './routes';
import { openDonate } from './donate';
import './master.css';

const g = (id: string, text: string) => `<a href="${gamePath(id)}">${text}</a>`;
const s = (id: string, text: string) => `<a href="${sectionPath(id)}">${text}</a>`;

const LETTER = `
<p class="mw-hello">Мир дому твоему, путник!</p>
<p>Волею судеб ты оказался в волшебном мире, полном удивительных чудес и тёплых воспоминаний.</p>
<p>Помнишь, как воскресным утром в солнечный зимний день, когда в школу не надо, а друзья ещё не выбежали во двор, ты просыпался от запаха маминых блинов, наскоро плескал водой в лицо, быстро бежал на кухню, завтракал, а потом, пока папа ещё дома, благоговейно брал вкусно пахнущую деревом старую ${g('chess', 'шахматную доску')} и, глядя в его добрые глаза, просил сыграть с тобой партию-другую?</p>
<p>Он ухмылялся в усы, делал вид, что очень увлечён свежим номером «${s('sport', 'Советского спорта')}», но, конечно же, соглашался, и вы играли часами — в ${g('chess', 'шахматы')}, ${g('checkers', 'шашки')}, потом опять шахматы, а когда надоест — ты доставал из-под кровати свои волшебные сокровища: потрёпанные ${s('tabletop', 'картонные коробки')}, внутри которых бушевали страсти, капитаны водили ${g('sea', 'парусные корабли')} по далёким океанам, авантюристы снаряжали ${g('star', 'экспедиции за сокровищами')} в экзотических странах, громыхали ${g('seabattle', 'войны')}, за несколько минут делались и проигрывались ${g('manager', 'состояния')}, а храбрые герои бросались в бой навстречу ${g('zakoldovannaya', 'неведомым чудовищам')}.</p>
<p>А когда смеркалось, и ${'<a href="/">двор</a>'} наполнялся детворой — ты бежал туда с ${s('cards', 'колодой карт')} в кармане, чтобы в краткие минутки отдыха между снежками и ${g('hockey', 'хоккеем')}, смести снег с лавочки и быстренько перекинуться с друзьями ${g('durak', 'в дурака')}, ${g('bluff', 'верю-не верю')} или что-нибудь подобное, давно забытое, во что уже давно никто не играет…</p>
<p class="mw-but">…А ты можешь!</p>
<p>Так что вперёд, мой друг, ${g('adventures', 'к приключениям')}!</p>
<p class="mw-sign">Твой Мастер.</p>
<p class="mw-ps">P.S. Только прошу — не забывай, что ничто на земле не бывает просто так, а чудес, увы, не бывает. Без твоей поддержки проекту не выжить: доступны и <a href="#" data-donate>разовая благодарность</a>, и <a href="/podpiska/">подписка</a> — выбирай!</p>`;

const READ_KEY = 'master.read';

/** Письмо целиком. */
export function openMasterWord(): void {
  Sound.ui();
  const box = document.createElement('div');
  box.className = 'mw-letter';
  box.innerHTML = `<h2 class="mw-title">Слово Мастера</h2>${LETTER}`;
  const m = modal(box, [{ text: 'Во двор!', primary: true }], { cls: 'mw-modal' });
  (box.querySelector('[data-donate]') as HTMLElement).onclick = (e) => {
    e.preventDefault();
    m.close();
    void openDonate();
  };
  // ушли по ссылке на игру или раздел — письмо закрыть (роутер откроет страницу)
  box.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a:not([data-donate])')) m.close();
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
    <span class="mw-n-text">«Мир дому твоему, путник! Волею судеб ты оказался в волшебном мире, полном удивительных чудес и тёплых воспоминаний…»</span>
    <span class="mw-n-more">читать письмо ✉</span><span class="mw-n-again">перечитать ✉</span>`;
  b.title = 'Письмо от Мастера сборника';
  b.onclick = openMasterWord;
  return b;
}
