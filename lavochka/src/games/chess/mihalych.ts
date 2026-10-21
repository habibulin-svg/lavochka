/* «Совет Михалыча» — блок помощника на ИИ для кружка и шахмат (сервер — server/mihalych.ts, подписка «Лавочка+»).
 * Хозяин блока даёт кнопки-вопросы с данными движка (ходы — русской записью) и позицию; разговор живёт, пока хозяин
 * не скажет reset() (новая задача, новая позиция). Без ключа на сервере блок не показывается; без подписки —
 * приглашение на «Лавочку+». */
import { Sound } from '../../core/audio';
import { esc, h } from '../../core/util';
import './mihalych.css';

export type MihalychKind = 'mistake' | 'hint' | 'explain' | 'review' | 'chat';

export interface MihalychEngine {
  /** Позиция (FEN), к которой относятся played/best/line/solution, если это не текущая позиция разговора. */
  at?: string;
  played?: string;
  before?: string;
  after?: string;
  best?: string;
  line?: string;
  reply?: string;
  eval?: string;
  solution?: string;
}

export interface MihalychContext {
  where: 'puzzle' | 'analysis' | 'game' | 'lesson';
  level?: 'novice' | 'amateur' | 'strong';
  fen?: string;
  side?: string;
  moves?: string;
  theme?: string;
  opening?: string;
}

export interface MihalychAction {
  /** Готовая фраза-кнопка под разговором. */
  label: string;
  kind: MihalychKind;
  /** Что спросить словами ученика (показывается в разговоре). */
  say: string;
  /** Данные движка — собираются в момент нажатия (может досчитать движок). */
  engine?: () => MihalychEngine | Promise<MihalychEngine>;
  /** Перед вопросом (например, «подсказка — задача не в зачёт»). */
  before?: () => void;
}

interface Status {
  enabled: boolean;
  allowed: boolean;
  unlimited?: boolean;
  left?: number | null;
  zapoy?: string | null;
  reason?: string;
  message?: string;
}

let cached: { at: number; s: Promise<Status> } | null = null;
const status = (fresh = false): Promise<Status> => {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.s;
  const s = fetch('/api/mihalych', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<Status>) : { enabled: false, allowed: false }))
    .catch(() => ({ enabled: false, allowed: false }));
  cached = { at: Date.now(), s };
  return s;
};

export const PORTRAIT = `${import.meta.env.BASE_URL}kruzhok/mihalych.webp`;

export function mountMihalych(host: HTMLElement, ctx: () => MihalychContext) {
  const el = h(`<div class="mh" hidden>
    <div class="mh-head"><img src="${PORTRAIT}" alt="Михалыч" width="48" height="48"><div><b>Михалыч</b><small class="mh-status"></small></div></div>
    <div class="mh-log"></div>
    <div class="mh-acts"></div>
    <form class="mh-ask"><input maxlength="500" placeholder="Спросить Михалыча…" enterkeyhint="send"><button class="btn small" title="Спросить">➤</button></form>
  </div>`);
  host.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const log = q('.mh-log');
  const acts = q('.mh-acts');
  const form = q<HTMLFormElement>('.mh-ask');
  const input = q<HTMLInputElement>('.mh-ask input');
  let history: { role: 'user' | 'mihalych'; text: string }[] = [];
  let actions: MihalychAction[] = [];
  /** Как понимать вопрос, набранный своими словами (зависит от того, что на доске). */
  let typed: Pick<MihalychAction, 'kind' | 'engine' | 'before'> = { kind: 'chat' };
  let busy = false;
  let st: Status = { enabled: false, allowed: false };
  let alive = true;

  const line = (who: 'user' | 'mihalych' | 'note', text: string) => {
    const b = h(`<div class="mh-msg mh-${who}">${esc(text)}</div>`);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  const setLeft = (left: number | null | undefined) => {
    q('.mh-status').textContent = st.unlimited || left == null ? '' : left <= 0 ? 'в запое до первого числа' : left < 0.15 ? 'советов на этот месяц почти не осталось' : '';
  };

  const renderActs = () => {
    acts.innerHTML = '';
    if (!st.allowed || st.zapoy) return;
    for (const a of actions) {
      const b = h<HTMLButtonElement>(`<button class="mh-chip" type="button">${esc(a.label)}</button>`);
      b.disabled = busy;
      b.onclick = () => void run(a.kind, a.say, a.engine, a.before);
      acts.appendChild(b);
    }
  };

  const run = async (kind: MihalychKind, say: string, engine?: MihalychAction['engine'], before?: () => void) => {
    if (busy || !st.allowed) return;
    busy = true;
    Sound.ui();
    before?.();
    renderActs();
    input.disabled = true;
    line('user', say);
    const wait = line('mihalych', 'Михалыч чешет затылок…');
    wait.classList.add('mh-wait');
    try {
      const data = engine ? await engine() : undefined;
      const r = await fetch('/api/mihalych', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, ...ctx(), engine: data, history: history.slice(-6), question: say }),
      });
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      wait.remove();
      if (r.ok && j.text) {
        line('mihalych', j.text);
        history.push({ role: 'user', text: say }, { role: 'mihalych', text: j.text });
        history = history.slice(-6);
        setLeft(j.left);
      } else {
        line('note', j.message || 'Михалыч не расслышал. Спроси ещё раз.');
        if (j.error === 'zapoy' || j.error === 'sick') {
          st = { ...st, zapoy: j.message };
          setLeft(0);
        }
      }
    } catch {
      wait.remove();
      line('note', 'Нет связи с кружком. Проверь интернет и спроси ещё раз.');
    } finally {
      busy = false;
      input.disabled = !!st.zapoy;
      renderActs();
    }
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    void run(typed.kind, t, typed.engine, typed.before);
  };

  void status().then((s) => {
    if (!alive) return;
    st = s;
    if (!s.enabled) return;
    el.hidden = false;
    if (!s.allowed) {
      form.hidden = true;
      line(
        'note',
        s.reason === 'login'
          ? 'Михалыч объяснит ошибку, подскажет идею и ответит на вопросы — для подписчиков «Лавочки+». Войдите на сайт, чтобы оформить подписку.'
          : 'Михалыч объяснит ошибку, подскажет идею и ответит на вопросы — для подписчиков «Лавочки+».'
      );
      log.appendChild(h('<a class="btn small primary mh-plus" href="/podpiska/" target="_blank">Что такое «Лавочка+»</a>'));
      return;
    }
    if (s.zapoy) {
      line('note', s.zapoy);
      input.disabled = true;
    }
    setLeft(s.left);
    renderActs();
  });

  return {
    /** Кнопки-вопросы под разговором (зависят от того, что сейчас на доске). */
    actions(list: MihalychAction[]) {
      actions = list;
      renderActs();
    },
    /** Как понимать свои вопросы сейчас; hint — подпись в строке ввода. */
    typed(t: Pick<MihalychAction, 'kind' | 'engine' | 'before'> & { hint?: string }) {
      typed = t;
      input.placeholder = t.hint ?? 'Спросить Михалыча…';
    },
    /** Новая позиция или задача — разговор с начала. */
    reset() {
      history = [];
      if (st.allowed && !st.zapoy) log.innerHTML = '';
      actions = [];
      renderActs();
    },
    destroy() {
      alive = false;
      el.remove();
    },
  };
}

/** Уровень ученика по рейтингу кружка. */
export const levelOf = (rating: number): 'novice' | 'amateur' | 'strong' => (rating < 1150 ? 'novice' : rating < 1750 ? 'amateur' : 'strong');
