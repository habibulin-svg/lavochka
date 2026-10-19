/* История партий вошедшего игрока: доигранная партия уходит на сервер (/api/history), профиль показывает последние. */
import { esc } from '../core/util';
import { modal } from '../core/ui';
import { tableHooks } from '../core/table';
import { playOf, type Play } from '../core/history';
import { byId } from '../games/catalog';
import { currentUser } from './account';

tableHooks.finished = (f) => {
  // гость, мгновенная партия или одни боты (только смотрел) — не пишем
  if (!currentUser() || f.seconds < 5 || !f.mySeats.length) return;
  void fetch('/api/history', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(playOf(f)), keepalive: true }).catch(() => {});
};

const RESULT: Record<Play['result'], string> = { win: '🏆 победа', lose: 'поражение', draw: 'ничья', done: 'доиграна' };

function dur(s: number | null) {
  if (s == null) return '';
  return s < 60 ? `${s} с` : s < 3600 ? `${Math.round(s / 60)} мин` : `${Math.floor(s / 3600)} ч ${Math.round((s % 3600) / 60)} мин`;
}

/** Окно «Мои партии». */
export async function openHistory(): Promise<void> {
  const r = await fetch('/api/history', { cache: 'no-store' }).catch(() => null);
  const b = r?.ok ? await r.json() : null;
  const plays: Play[] = b?.plays ?? [];
  const day = (t: number) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const wins = plays.filter((p) => p.result === 'win').length;
  modal(
    `<h2>Мои партии</h2>
    ${
      !b
        ? '<p>Не удалось загрузить — проверьте связь.</p>'
        : plays.length
          ? `<p class="hint">Последние ${plays.length}${wins ? `, из них побед — ${wins}` : ''}.</p>
             <ul class="hist">${plays
               .map(
                 (p) => `<li class="hist-${p.result}"><b>${esc(byId(p.game)?.title ?? p.game)}</b> <span class="hist-r">${RESULT[p.result]}</span>
                   <small>${day(p.endedAt)} · ${p.network ? 'по сети' : p.bots ? `с ботами (${p.bots})` : 'за одним экраном'}${p.place ? ` · ${p.place}-е место` : ''}${p.score ? ` · счёт ${esc(p.score)}` : ''}${p.seconds ? ` · ${dur(p.seconds)}` : ''}</small></li>`
               )
               .join('')}</ul>`
          : '<p>Пока пусто: доигранные партии появятся здесь сами.</p>'
    }`,
    [{ text: 'Закрыть', primary: true }],
    { cls: 'auth-modal' }
  );
}
