/* «Димон» — блок помощника на ИИ по покеру (сервер — server/dimon.ts, подписка «Лавочка+»; запас на месяц — общий
 * с Михалычем). Как Михалыч в шахматах (chess/mihalych.ts): разговор, кнопки-вопросы по месту и свой вопрос. Хозяин
 * блока даёт кнопки с обстановкой словами (dimon-facts.ts — только свой вид); блок шлёт на сервер только этот текст.
 * Без ключа на сервере блок не показывается; без подписки — приглашение на «Лавочку+» (пробного доступа нет). */
import { Sound } from '../../core/audio';
import { esc, h } from '../../core/util';
import '../chess/mihalych.css';
import './dimon.css';

export type DimonKind = 'move' | 'hand' | 'opp' | 'stats' | 'tour' | 'chat';
export type DimonWhere = 'table' | 'replay' | 'stats' | 'school';

export interface DimonAction {
  /** Готовая фраза-кнопка под разговором. */
  label: string;
  kind: DimonKind;
  /** Что спросить словами игрока (показывается в разговоре). */
  say: string;
  /** Обстановка словами — собирается в момент нажатия. */
  facts: () => string;
}

export interface DimonStatus {
  enabled: boolean;
  allowed: boolean;
  unlimited?: boolean;
  left?: number | null;
  zapoy?: string | null;
  reason?: string;
  message?: string;
}

let cached: { at: number; s: Promise<DimonStatus> } | null = null;
/** Можно ли спросить Димона (на минуту запоминается). */
export const dimonStatus = (fresh = false): Promise<DimonStatus> => {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.s;
  const s = fetch('/api/dimon', { credentials: 'same-origin' })
    .then((r) => (r.ok ? (r.json() as Promise<DimonStatus>) : { enabled: false, allowed: false }))
    .catch(() => ({ enabled: false, allowed: false }));
  cached = { at: Date.now(), s };
  return s;
};

export const PORTRAIT = `${import.meta.env.BASE_URL}poker/dimon.webp`;

export interface DimonBlock {
  /** Кнопки-вопросы под разговором (зависят от того, что сейчас на столе). */
  actions(list: DimonAction[]): void;
  /** Как понимать свои вопросы: обстановка к ним; hint — подпись в строке ввода. */
  typed(t: { facts: () => string; hint?: string }): void;
  /** Задать вопрос кнопкой извне (например, из окна HUD соперника). */
  ask(a: DimonAction): void;
  /** Новый разговор. */
  reset(): void;
  readonly el: HTMLElement;
  destroy(): void;
}

export function mountDimon(host: HTMLElement, where: DimonWhere): DimonBlock {
  const el = h(`<div class="mh dm" hidden>
    <div class="mh-head"><img src="${PORTRAIT}" alt="Димон" width="48" height="48"><div><b>Димон</b><small class="mh-status">дворовый картёжник, советует по цифрам</small></div></div>
    <div class="mh-log" aria-live="polite"></div>
    <div class="mh-acts"></div>
    <form class="mh-ask"><input maxlength="500" placeholder="Спросить Димона…" enterkeyhint="send"><button class="btn small" title="Спросить">➤</button></form>
  </div>`);
  host.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const log = q('.mh-log');
  const acts = q('.mh-acts');
  const form = q<HTMLFormElement>('.mh-ask');
  const input = q<HTMLInputElement>('.mh-ask input');
  let history: { role: 'user' | 'dimon'; text: string }[] = [];
  let actions: DimonAction[] = [];
  let typed: { facts: () => string } = { facts: () => '' };
  let busy = false;
  let st: DimonStatus = { enabled: false, allowed: false };
  let alive = true;
  let pending: DimonAction | null = null;

  const line = (who: 'user' | 'dimon' | 'note', text: string) => {
    const b = h(`<div class="mh-msg mh-${who}">${esc(text)}</div>`);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  const setLeft = (left: number | null | undefined) => {
    q('.mh-status').textContent = st.unlimited || left == null ? 'дворовый картёжник, советует по цифрам' : left <= 0 ? 'проигрался в ноль' : left < 0.15 ? 'советов на этот месяц почти не осталось' : 'дворовый картёжник, советует по цифрам';
  };

  const renderActs = () => {
    acts.innerHTML = '';
    if (!st.allowed || st.zapoy) return;
    for (const a of actions) {
      const b = h<HTMLButtonElement>(`<button class="mh-chip" type="button">${esc(a.label)}</button>`);
      b.disabled = busy;
      b.onclick = () => void run(a.kind, a.say, a.facts);
      acts.appendChild(b);
    }
  };

  const run = async (kind: DimonKind, say: string, facts: () => string) => {
    if (busy || !st.allowed || st.zapoy) return;
    busy = true;
    Sound.ui();
    renderActs();
    input.disabled = true;
    line('user', say);
    const wait = line('dimon', 'Димон щурится на карты…');
    wait.classList.add('mh-wait');
    try {
      let text = '';
      try {
        text = facts();
      } catch {
        /* обстановку не собрать — спросим без неё */
      }
      const r = await fetch('/api/dimon', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, where, facts: text, history: history.slice(-6), question: say }),
      });
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      wait.remove();
      if (r.ok && j.text) {
        line('dimon', j.text);
        history.push({ role: 'user', text: say }, { role: 'dimon', text: j.text });
        history = history.slice(-6);
        setLeft(j.left);
      } else {
        line('note', j.message || 'Димон не расслышал. Спроси ещё раз.');
        if (j.error === 'zapoy' || j.error === 'sick') {
          st = { ...st, zapoy: j.message };
          setLeft(0);
          cached = null;
        }
      }
    } catch {
      wait.remove();
      line('note', 'Нет связи со двором. Проверь интернет и спроси ещё раз.');
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
    void run('chat', t, typed.facts);
  };

  void dimonStatus().then((s) => {
    if (!alive) return;
    st = s;
    if (!s.enabled) return;
    el.hidden = false;
    if (!s.allowed) {
      form.hidden = true;
      line(
        'note',
        `Димон подскажет, что делать в раздаче, разберёт, как ты сыграл, и объяснит цифры соперников — для подписчиков «Лавочки+».${s.reason === 'login' ? ' Войдите на сайт, чтобы оформить подписку.' : ''}`
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
    if (pending) {
      const a = pending;
      pending = null;
      void run(a.kind, a.say, a.facts);
    }
  });

  return {
    el,
    actions(list) {
      actions = list;
      renderActs();
    },
    typed(t) {
      typed = t;
      input.placeholder = t.hint ?? 'Спросить Димона…';
    },
    ask(a) {
      if (st.allowed) void run(a.kind, a.say, a.facts);
      else if (!st.enabled) pending = a;
    },
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
