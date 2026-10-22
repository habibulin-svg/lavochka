/* Покер — лобби на экране игры, как в покер-руме: вкладки форматов. «Быстрая игра» — стол на очки (вид — в «Правилах
 * партии»); «Sit&Go» и «Турниры» — турниры с ботами (poker/tour.ts): вид покера, формат, скорость, вид турнира, соперники
 * и — по желанию — игра на виртуальный банкролл (poker/bankroll.ts); «Школа» — poker/school/ui.ts; «Моя статистика» —
 * poker/mystats.ts. Сетевое лобби — следующим этапом (docs/analysis/poker-plan.md). Отдельная кнопка — китайский покер «Ананас»: выбирает его пресет. */
import { store } from '../../core/settings';
import type { Options } from '../../core/types';
import { esc, h } from '../../core/util';
import type { LaunchTable } from '../../core/view';
import { BANK_START, bankInfo, refill } from './bankroll';
import { def } from './def';
import { cfgFrom, maxPlayers } from './engine';
import { isOfc } from './ofc/engine';
import { renderStats } from './mystats';
import { renderSchool } from './school/ui';
import { bigAt, FMTS, KINDS, LATE_LEVELS, paidOf, payout, REBUY_LEVELS, SPEEDS, startStack, type TourFmt, type TourKind, type TourSpeed } from './tour';

type Tab = 'cash' | 'sng' | 'mtt' | 'net' | 'school' | 'stats';
const TABS: { id: Tab; label: string; ready?: boolean; hint: string }[] = [
  { id: 'cash', label: 'Быстрая игра', ready: true, hint: 'Стол на очки: выберите вид покера в «Правилах партии», число игроков и садитесь. С друзьями — место «Сеть».' },
  { id: 'sng', label: 'Sit&Go', ready: true, hint: 'Турнир на один стол: блайнды растут по уровням, призы — первым местам.' },
  { id: 'mtt', label: 'Турниры', ready: true, hint: 'Многостоловый турнир: остальные столы играют сами, вас пересаживают, финальный стол — как в руме.' },
  { id: 'net', label: 'По сети', hint: 'Сетевое лобби: столы и Sit&Go с живыми игроками.' },
  { id: 'school', label: 'Школа', ready: true, hint: 'Уроки по шагам — от правил до финального стола: показ на столе, задачи «твой ход?» с разбором и игра против ботов нужного стиля.' },
  { id: 'stats', label: 'Моя статистика', ready: true, hint: 'Ваши VPIP, PFR и другие цифры, выигрыш на 100 раздач, турниры, история раздач с реплеером и разбором, выгрузка для трекеров.' },
];

interface Pick {
  tab: Tab;
  game: string;
  sng: TourFmt;
  mtt: TourFmt;
  speedS: TourSpeed;
  speedM: TourSpeed;
  kindS: TourKind;
  kindM: TourKind;
  late: boolean;
  bots: string;
  bank: boolean;
  buyin: number;
}

const phone = () => typeof matchMedia === 'function' && matchMedia('(max-width: 700px)').matches;
const KEY = 'poker.lobby';
const BUYINS = [10, 50, 100, 200];
const BOTS: [string, string][] = [
  ['0', 'Лёгкие'],
  ['1', 'Средние'],
  ['2', 'Сложные'],
  ['mix', 'Вперемешку'],
];

/** Виды покера для турниров — все пресеты, кроме китайского (у него нет ставок). */
const GAMES = (def.presets ?? []).filter((p) => !isOfc(p.options.mode) && p.id !== 'turbo' && p.id !== 'deep');

export function lobby(box: HTMLElement, launch: (options: Options, table?: LaunchTable) => void) {
  const st: Pick = {
    tab: 'cash',
    game: 'holdem',
    sng: 'sng6',
    mtt: phone() ? 'mtt45' : 'mtt90',
    speedS: 'turbo',
    speedM: 'turbo',
    kindS: 'freeze',
    kindM: 'freeze',
    late: false,
    bots: '1',
    bank: false,
    buyin: 100,
    ...store.get<Partial<Pick>>(KEY, {}),
  };
  const el = h(`<div class="pk-lobby">
    <div class="pk-tabs" role="tablist">${TABS.map((t) => `<button role="tab" data-t="${t.id}" ${t.ready ? '' : 'aria-disabled="true"'}>${t.label}${t.ready ? '' : '<small>скоро</small>'}</button>`).join('')}</div>
    <p class="pk-lobby-hint"></p>
    <div class="pk-tform" hidden></div>
    <button class="pk-ofc" type="button" title="Без ставок: разложи 13 карт в три ряда">🍍 Китайский покер «Ананас» <small>OFC: три ряда, роялти, фантазия</small></button>
  </div>`);
  // китайский покер — тот же стол «Покера», вид выбирается пресетом
  const ofc = el.querySelector('.pk-ofc') as HTMLButtonElement;
  ofc.onclick = () => {
    const b = document.querySelector<HTMLButtonElement>('.presets .preset[data-id="ofcp"]');
    b?.click();
    b?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const hint = el.querySelector('.pk-lobby-hint') as HTMLElement;
  const form = el.querySelector('.pk-tform') as HTMLElement;
  const save = () => store.set(KEY, st);

  const tabBtns = [...el.querySelectorAll<HTMLButtonElement>('.pk-tabs button')];
  const show = (id: Tab) => {
    const t = TABS.find((x) => x.id === id)!;
    hint.textContent = t.ready ? t.hint : `Скоро: ${t.hint}`;
  };
  const select = (id: Tab) => {
    st.tab = id;
    save();
    for (const b of tabBtns) {
      b.classList.toggle('on', b.dataset.t === id);
      if (TABS.find((x) => x.id === b.dataset.t)?.ready) b.setAttribute('aria-selected', String(b.dataset.t === id));
    }
    show(id);
    ofc.hidden = id !== 'cash';
    form.hidden = id === 'cash';
    // турнир — свой блок, «Правила партии» и места ему не нужны
    el.closest('.home-screen')?.classList.toggle('pk-tour-mode', id !== 'cash');
    if (id === 'stats') renderStats(form);
    else if (id === 'school') renderSchool(form, launch);
    else if (id !== 'cash') renderForm();
  };
  for (const b of tabBtns) {
    const t = TABS.find((x) => x.id === b.dataset.t)!;
    b.onclick = () => (t.ready ? select(t.id) : show(t.id));
    if (!t.ready) {
      b.onmouseenter = b.onfocus = () => show(t.id);
      b.onmouseleave = b.onblur = () => show(st.tab);
    }
  }

  const seg = (key: string, list: [string, string][], cur: string) =>
    `<div class="pk-seg" data-k="${key}">${list.map(([v, l]) => `<button type="button" data-v="${esc(v)}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('')}</div>`;

  function renderForm() {
    const sng = st.tab === 'sng';
    const fmt = sng ? st.sng : st.mtt;
    const speed = sng ? st.speedS : st.speedM;
    const kinds: TourKind[] = sng ? (fmt === 'don' ? ['freeze'] : ['freeze', 'pko']) : ['freeze', 'rebuy', 'reentry', 'pko'];
    let kind = sng ? st.kindS : st.kindM;
    if (!kinds.includes(kind)) kind = 'freeze';
    const game = GAMES.find((g) => g.id === st.game) ?? GAMES[0];
    const mode = cfgFrom(game.options).mode;
    const max = Math.min(9, maxPlayers(mode));
    const n = FMTS[fmt].mtt ? FMTS[fmt].n : Math.min(FMTS[fmt].n, max);
    const stack = startStack(FMTS[fmt].mtt, speed);
    const big = bigAt(FMTS[fmt].mtt, 0);
    const paid = paidOf(fmt, n, n);
    const pct = payout(fmt, paid);
    const pays = FMTS[fmt].don ? `${paid} из ${n} удваивают бай-ин` : pct.slice(0, 5).map((p) => `${Math.round(p * 100)}%`).join(' / ') + (paid > 5 ? ` … ${paid} мест` : '');
    const b = bankInfo();
    const fmts = (sng ? ['hu', 'sng6', 'sng9', 'don'] : ['mtt18', 'mtt45', 'mtt90', 'mtt180']) as TourFmt[];
    const notes: string[] = [];
    if (kind === 'rebuy') notes.push(`Ребай — если фишек не больше стартовых, первые ${REBUY_LEVELS} уровней; потом перерыв и аддон (+${Math.round(stack * 1.5)}).`);
    if (kind === 'reentry') notes.push(`Ре-энтри — вылетел в первые ${LATE_LEVELS} уровней, можно войти снова.`);
    if (kind === 'pko') notes.push('Половина бай-ина — в баунти: за выбитого — половину его головы сразу, половину — к своей.');
    if (sng && fmt === 'sng9' && n < 9) notes.push(`В этом виде за столом не больше ${max}.`);
    form.innerHTML = `
      <label class="pk-trow"><span>Вид покера</span><select class="pk-game">${GAMES.map((g) => `<option value="${g.id}" ${g.id === game.id ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>
      <div class="pk-trow"><span>${sng ? 'Формат' : 'Игроков'}</span>${seg('fmt', fmts.map((f) => [f, FMTS[f].label]), fmt)}</div>
      <div class="pk-trow"><span>Скорость</span>${seg('speed', (Object.keys(SPEEDS) as TourSpeed[]).map((s) => [s, `${SPEEDS[s].label} <small>${SPEEDS[s].min} мин</small>`]), speed)}</div>
      ${kinds.length > 1 ? `<div class="pk-trow"><span>Вид</span>${seg('kind', kinds.map((k) => [k, k === 'pko' ? 'PKO' : KINDS[k]]), kind)}</div>` : ''}
      ${!sng && kind !== 'reentry' ? `<label class="pk-trow pk-tcheck"><input type="checkbox" class="pk-late" ${st.late ? 'checked' : ''}> Поздняя регистрация <small>(часть поля садится в первые ${LATE_LEVELS} уровней)</small></label>` : ''}
      <div class="pk-trow"><span>Соперники</span>${seg('bots', BOTS, st.bots)}</div>
      <p class="pk-tinfo">Стек ${stack.toLocaleString('ru-RU')} (${Math.round(stack / big)} ББ), уровень ${SPEEDS[speed].min} мин турнирного времени — часы идут раздачами и стоят, пока вы думаете.
        Анте — с ${sng ? 5 : 4}-го уровня. Платят: ${pays}.${notes.length ? `<br>${notes.join('<br>')}` : ''}</p>
      <div class="pk-bank">
        <label class="pk-tcheck"><input type="checkbox" class="pk-bankon" ${st.bank ? 'checked' : ''}> На банкролл <small>(виртуальные очки: бай-ины, ROI, ITM)</small></label>
        ${
          st.bank
            ? `<div class="pk-bankinfo">💰 <b>${b.balance.toLocaleString('ru-RU')}</b> очков · турниров ${b.played} · ITM ${Math.round(b.itm * 100)}% · ROI ${b.roi >= 0 ? '+' : ''}${Math.round(b.roi * 100)}%
                ${b.canRefill ? `<button type="button" class="btn small pk-refill">Пополнить до ${BANK_START}</button>` : ''}</div>
               <div class="pk-trow"><span>Бай-ин</span>${seg('buyin', BUYINS.map((x) => [String(x), String(x)]), String(st.buyin))}</div>`
            : '<small class="pk-tq">Быстрая игра — без банкролла: просто турнир.</small>'
        }
      </div>
      <button type="button" class="btn primary pk-tstart">${sng ? 'Начать Sit&Go' : `Начать турнир на ${n}`}${st.bank ? ` · ${st.buyin} очков` : ''}</button>
      <p class="pk-terr"></p>`;
    (form.querySelector('.pk-game') as HTMLSelectElement).onchange = (e) => {
      st.game = (e.target as HTMLSelectElement).value;
      save();
      renderForm();
    };
    for (const s of form.querySelectorAll<HTMLElement>('.pk-seg'))
      for (const btn of s.querySelectorAll<HTMLButtonElement>('button'))
        btn.onclick = () => {
          const v = btn.dataset.v!;
          const k = s.dataset.k;
          if (k === 'fmt') st[sng ? 'sng' : 'mtt'] = v as TourFmt;
          if (k === 'speed') st[sng ? 'speedS' : 'speedM'] = v as TourSpeed;
          if (k === 'kind') st[sng ? 'kindS' : 'kindM'] = v as TourKind;
          if (k === 'bots') st.bots = v;
          if (k === 'buyin') st.buyin = Number(v);
          save();
          renderForm();
        };
    const late = form.querySelector<HTMLInputElement>('.pk-late');
    if (late)
      late.onchange = () => {
        st.late = late.checked;
        save();
      };
    (form.querySelector('.pk-bankon') as HTMLInputElement).onchange = (e) => {
      st.bank = (e.target as HTMLInputElement).checked;
      save();
      renderForm();
    };
    const rf = form.querySelector<HTMLButtonElement>('.pk-refill');
    if (rf)
      rf.onclick = () => {
        refill();
        renderForm();
      };
    (form.querySelector('.pk-tstart') as HTMLButtonElement).onclick = () => {
      if (st.bank && bankInfo().balance < st.buyin) {
        (form.querySelector('.pk-terr') as HTMLElement).textContent = 'Не хватает очков на бай-ин — выберите поменьше или пополните банкролл (раз в сутки).';
        return;
      }
      const count = FMTS[fmt].mtt ? max : n;
      const levels = Array.from({ length: count }, (_, i) => (st.bots === 'mix' ? (i * 7 + Math.floor(Math.random() * 3)) % 3 : Number(st.bots)));
      launch({ ...game.options, tour: fmt, speed, tkind: kind, late: !sng && st.late, bank: st.bank, buyin: st.bank ? st.buyin : 100 }, { count, levels });
    };
  }

  box.appendChild(el);
  select(TABS.find((t) => t.id === st.tab && t.ready) ? st.tab : 'cash');
}
