/* Светка растолковывает расклад целиком (сервер — server/svetka.ts, подписка «Лавочка+»; запас на месяц — общий
 * с Михалычем и Димоном). Блок под раскладом: после последней карты — «Светка, растолкуй», потом можно уточнить.
 * На сервер уходят только номера карт и расклад; значения сервер берёт из справочника сам.
 * Без ключа на сервере блок не показывается; без подписки — приглашение на «Лавочку+» (пробного доступа нет). */
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import type { ReadingState } from './table';
import '../chess/mihalych.css';

interface Status {
  enabled: boolean;
  allowed: boolean;
  unlimited?: boolean;
  left?: number | null;
  zapoy?: string | null;
  reason?: string;
}

let cached: { at: number; s: Promise<Status> } | null = null;
const status = (): Promise<Status> => {
  if (cached && Date.now() - cached.at < 60_000) return cached.s;
  const s = fetch('/api/svetka', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<Status>) : { enabled: false, allowed: false }))
    .catch(() => ({ enabled: false, allowed: false }));
  cached = { at: Date.now(), s };
  return s;
};

export const PORTRAIT = `${import.meta.env.BASE_URL}gadanie/svetka.webp`;
/** Уточнений после толкования — не больше (каждое — новый вопрос модели). */
const MAX_ASKS = 4;

export function mountSvetka(host: HTMLElement, state: () => ReadingState) {
  const el = h(`<div class="mh gd-sv" hidden>
    <div class="mh-head"><img src="${PORTRAIT}" alt="Светка" width="48" height="48"><div><b>Светка</b><small class="mh-status">с нашего двора, гадает на лавочке</small></div></div>
    <div class="gd-sv-who" hidden>Светке, чтобы не путалась: <button type="button" data-who="f">я девушка</button><button type="button" data-who="m">я парень</button></div>
    <div class="mh-log" aria-live="polite"></div>
    <div class="mh-acts"></div>
    <form class="mh-ask" hidden><input maxlength="400" placeholder="Уточнить у Светки…" enterkeyhint="send"><button class="btn small" title="Спросить">➤</button></form>
  </div>`);
  host.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const log = q('.mh-log');
  const acts = q('.mh-acts');
  const form = q<HTMLFormElement>('.mh-ask');
  const input = q<HTMLInputElement>('.mh-ask input');
  let st: Status = { enabled: false, allowed: false };
  let history: { role: 'user' | 'svetka'; text: string }[] = [];
  let busy = false;
  let done = false;
  let asks = 0;
  let alive = true;
  let who = store.get<'f' | 'm' | null>('gadanie.who', null);
  const whoEl = q('.gd-sv-who');
  const drawWho = () => whoEl.querySelectorAll<HTMLButtonElement>('[data-who]').forEach((b) => b.classList.toggle('on', b.dataset.who === who));
  whoEl.onclick = (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-who]');
    if (!b) return;
    who = who === b.dataset.who ? null : (b.dataset.who as 'f' | 'm');
    store.set('gadanie.who', who);
    drawWho();
  };
  drawWho();

  const line = (who: 'user' | 'mihalych' | 'note', text: string) => {
    const b = h(`<div class="mh-msg mh-${who}">${esc(text)}</div>`);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  const invite = () => {
    log.innerHTML = '';
    line('note', `Светка разложит всё по полочкам: свяжет карты между собой и с твоим вопросом, а потом ответит на уточнения — для подписчиков «Лавочки+».${st.reason === 'login' ? ' Войдите на сайт, чтобы оформить подписку.' : ''}`);
    log.appendChild(h('<a class="btn small primary mh-plus" href="/podpiska/" target="_blank">Что такое «Лавочка+»</a>'));
  };

  const drawActs = () => {
    acts.innerHTML = '';
    form.hidden = !done || !history.length || asks >= MAX_ASKS || !!st.zapoy;
    if (!st.allowed || st.zapoy || !done || history.length) return;
    const b = h<HTMLButtonElement>(`<button class="btn primary gd-sv-go" type="button">🔮 Светка, растолкуй</button>`);
    b.disabled = busy;
    b.onclick = () => void run(null);
    acts.appendChild(b);
  };

  const run = async (ask: string | null) => {
    if (busy || !st.allowed || st.zapoy) return;
    const s = state();
    busy = true;
    Sound.ui();
    drawActs();
    input.disabled = true;
    if (ask) line('user', ask);
    const wait = line('mihalych', ask ? 'Светка смотрит на карты…' : 'Светка раскладывает по полочкам…');
    wait.classList.add('mh-wait');
    try {
      const r = await fetch('/api/svetka', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          deck: s.deck,
          spread: s.spread.id,
          cards: s.cards,
          person: s.person,
          question: s.question,
          history: history.slice(-6),
          ask: ask ?? undefined,
          who,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      wait.remove();
      if (r.ok && j.text) {
        line('mihalych', j.text);
        if (ask) {
          history.push({ role: 'user', text: ask });
          asks++;
        }
        history.push({ role: 'svetka', text: j.text });
        history = history.slice(-7);
        if (asks >= MAX_ASKS) line('note', 'На этот расклад хватит — Светка своё сказала. Разложи новый, если хочешь спросить о другом.');
      } else {
        line('note', j.message || 'Светка не расслышала. Спроси ещё раз.');
        if (j.error === 'zapoy' || j.error === 'sick') {
          st = { ...st, zapoy: j.message };
          cached = null;
        }
      }
    } catch {
      wait.remove();
      line('note', 'Нет связи со двором. Проверь интернет и спроси ещё раз.');
    } finally {
      busy = false;
      input.disabled = false;
      drawActs();
    }
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    void run(t);
  };

  void status().then((s) => {
    if (!alive) return;
    st = s;
    if (!s.enabled) return;
    el.hidden = false;
    if (!s.allowed) return invite();
    whoEl.hidden = false;
    if (s.zapoy) line('note', s.zapoy);
    else line('note', 'Разложи карты до конца — и Светка растолкует расклад целиком.');
    drawActs();
  });

  return {
    /** Новый расклад: разговор заново. */
    clear() {
      history = [];
      asks = 0;
      done = false;
      if (st.allowed) {
        log.innerHTML = '';
        line('note', st.zapoy ?? 'Разложи карты до конца — и Светка растолкует расклад целиком.');
      }
      drawActs();
    },
    /** Расклад разложен — можно толковать. */
    ready() {
      done = true;
      if (st.allowed && !st.zapoy) log.innerHTML = '';
      drawActs();
    },
    destroy() {
      alive = false;
      el.remove();
    },
  };
}
