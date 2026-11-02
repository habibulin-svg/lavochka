/* Интерфейс боя поверх холста (DOM): таймер хода, ветер, здоровье бригад, выбранное оружие,
 * сетка оружия (Tab / кнопка), экранные кнопки для телефона, итог партии. */
import { BRIGADES, weaponIcon } from '../assets';
import { musicOff } from '../audio';
import { type Save, loadSaves, slotLabel, writeSave } from '../save';
import type { Controls } from '../input';
import { TICK_HZ, type World } from '../sim/world';
import { WEAPONS } from '../sim/weapons';
import './hud.css';

/** Названия из docs/gops/texts/weapons.json (готовое; полный список — при сборке ассетов). */
export const WEAPON_NAMES: Record<string, string> = {
  mukha: '«Муха»', limonka: 'Лимонка', sling: 'Рогатка', obrez: 'Обрез', makarov: '«Макаров»', tnt: 'Тротиловая шашка',
  mine: 'Мина-растяжка', tychok: 'Тычок', armatura: 'Арматура', rope: 'Верёвка с крюком', kuryu: 'Курю (пропуск)', pas: 'Я пас (сдаться)',
  homing: 'Ракета с наводкой', mortar: 'Миномёт из трубы', carbide: 'Банка с карбидом', korsar: 'Ящик петард «Корсар»',
  posylka: 'Посылка с минами', samogon: 'Бабкин самогон', kalash: '«Калаш»', pulemet: 'Пулемёт', uppercut: 'Апперкот',
  mawashi: 'Маваши', kukuruznik: 'Кукурузник с кирпичами', pochta: 'Почта', vanna: 'Чугунная ванна', kirpichi: 'Кирпичный град',
  truba: 'Прорыв трубы', ponyatiya: 'По понятиям', marshrutka: 'Маршрутка', plita: 'Бетонная плита', otboinik: 'Отбойный молоток',
  payalnik: 'Паяльная лампа', zontik: 'Зонтик', buratino: 'Газировка «Буратино»', kedy: 'Кеды', yagga: 'Энергетик',
  ukazka: 'Лазерная указка', tyidi: 'Ты иди', ognetushitel: 'Огнетушитель-ранец', rezinka: 'Резинка от трусов', nevidimka: 'Невидимка',
  dog: 'Дворняга с петардой', babka: 'Бабка с авоськой', kozy: 'Стадо коз', pigeon: 'Голубь с петардой', kite: 'Воздушный змей',
  auger: 'Ледобур', zapacanov: '«За пацанов!»', napalm: 'Кукурузник-химик', holodilnik: 'Заморозка',
};

/** Шпаргалка по клавишам (src/gops/input.ts, game.ts, audio.ts). */
const KEYS = `<b>Клавиши</b>
  <span><kbd>←</kbd><kbd>→</kbd> идти</span>
  <span><kbd>↑</kbd><kbd>↓</kbd> прицел</span>
  <span><kbd>Enter</kbd> прыжок вперёд</span>
  <span><kbd>Backspace</kbd> сальто назад</span>
  <span><kbd>Пробел</kbd> огонь — держать: сильнее</span>
  <span><kbd>1</kbd>–<kbd>5</kbd> таймер гранаты</span>
  <span><kbd>Tab</kbd> или правая кнопка — оружие</span>
  <span>колесо — масштаб, <kbd>C</kbd> — камера к бойцу</span>
  <span><kbd>Esc</kbd> пауза и меню · <kbd>M</kbd> весь звук</span>
  <span><kbd>H</kbd> эта подсказка</span>`;

export class Hud {
  readonly el: HTMLElement;
  private timer: HTMLElement;
  private wind: HTMLElement;
  private teams: HTMLElement;
  private weapon: HTMLElement;
  private menu: HTMLElement;
  private banner: HTMLElement;
  private goal: HTMLElement;
  private who: HTMLElement;
  /** Шпаргалка по клавишам (ПК): свёрнута/развёрнута — запоминается. */
  private keys: HTMLElement;
  private lastPhase = '';
  private whoTimer = 0;
  /** Свой итог показывает миссия — общий баннер «держит район» не нужен. */
  quietOver = false;
  /** Чьи бригады правит этот экран (подсказки — только в свой ход); null — все. */
  mine: number[] | null = null;
  onPick: (id: string) => void = () => {};
  /** Окно паузы открыто/закрыто (Game останавливает мир, кроме сети). */
  onPause: (open: boolean) => void = () => {};
  /** Музыка: переключить, вернуть «выключена». */
  onMusic: () => boolean = () => false;
  /** Выйти из боя в меню игры. */
  onQuit: () => void = () => {};
  /** Сохранение партии; строка — почему нельзя. */
  onSave: () => Save | string = () => 'Нельзя';
  /** Загрузить партию из ячейки. */
  onLoad: (sv: Save) => void = () => {};
  /** Бой по сети: пауза не останавливает мир. */
  net = false;
  private bar: HTMLElement;
  private music!: HTMLButtonElement;
  private pauseBox: HTMLElement | null = null;

  constructor(host: HTMLElement, private brigades: string[]) {
    this.el = div('hud');
    this.timer = div('hud-timer');
    this.wind = div('hud-wind');
    this.wind.innerHTML = '<div class="hud-wind-l"></div><div class="hud-wind-r"></div>';
    this.teams = div('hud-teams');
    this.weapon = div('hud-weapon');
    this.menu = div('hud-menu');
    this.menu.hidden = true;
    this.banner = div('hud-banner');
    this.banner.hidden = true;
    this.goal = div('hud-goal');
    this.who = div('hud-who');
    this.who.hidden = true;
    // панель в углу: меню и пауза, музыка, «?» — шпаргалка по клавишам (закрыта, пока не попросят)
    this.bar = div('hud-bar');
    const tool = (label: string, title: string, cls: string, act: () => void) => {
      const b = document.createElement('button');
      b.className = `hud-tool ${cls}`;
      b.textContent = label;
      b.title = title;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        b.blur(); // иначе пробел и Enter нажимали бы кнопку, а не стреляли
        act();
      });
      this.bar.append(b);
      return b;
    };
    tool('☰', 'Пауза и меню (Esc)', '', () => this.togglePause());
    this.music = tool('♪', '', 'music', () => this.setMusic(this.onMusic()));
    this.setMusic(musicOff());
    tool('?', 'Клавиши (H)', 'help', () => this.toggleKeys());
    this.keys = div('hud-keys');
    this.keys.innerHTML = KEYS;
    this.keys.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.keys.addEventListener('click', () => this.toggleKeys(false));
    this.bar.append(this.keys);
    this.el.append(this.timer, this.wind, this.teams, this.weapon, this.menu, this.banner, this.goal, this.who, this.bar);
    host.appendChild(this.el);
    this.weapon.addEventListener('click', () => this.toggleMenu());
  }

  /** Экранные кнопки для телефона (видны при pointer: coarse): слева — ходьба, справа — прицел, прыжок, огонь. */
  bindPad(c: Controls): void {
    const btn = (label: string, cls: string, down: () => void, up: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture(e.pointerId);
        down();
      });
      const off = () => up();
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('lostpointercapture', off);
      return b;
    };
    const left = div('hud-pad l');
    left.append(
      btn('◀', '', () => (c.touchMove = -1), () => (c.touchMove = 0)),
      btn('▶', '', () => (c.touchMove = 1), () => (c.touchMove = 0)),
      btn('⤴', '', () => c.jump(), () => {}),
    );
    const right = div('hud-pad r');
    const aim = div('hud-pad-col');
    aim.append(
      btn('▲', '', () => (c.touchAim = -1), () => (c.touchAim = 0)),
      btn('▼', '', () => (c.touchAim = 1), () => (c.touchAim = 0)),
    );
    right.append(aim, btn('💥', 'fire', () => (c.touchFire = true), () => (c.touchFire = false)));
    this.el.append(left, right);
  }

  toggleMenu(w: World | null = this.world): void {
    this.menu.hidden = !this.menu.hidden;
    if (!this.menu.hidden && w) this.fillMenu(w);
  }

  /** Последний показанный мир: кнопке оружия (щелчок, тап) нужен список своей бригады. */
  private world: World | null = null;

  private menuFor = -1;

  private fillMenu(w: World): void {
    const team = w.teams[w.team];
    this.menuFor = w.team;
    this.menu.replaceChildren(
      ...Object.keys(WEAPONS).filter((id) => !WEAPONS[id].hidden).map((id) => {
        const n = team.ammo[id] ?? 0;
        const b = document.createElement('button');
        b.className = 'hud-wpn' + (id === w.weapon ? ' on' : '');
        b.disabled = n === 0;
        const icon = weaponIcon(id);
        b.innerHTML = `${icon ? `<img src="${icon}" alt="">` : '<i></i>'}<span>${WEAPON_NAMES[id] ?? id}</span><b>${n < 0 ? '∞' : n}</b>`;
        b.onclick = () => {
          this.onPick(id);
          this.menu.hidden = true;
        };
        return b;
      }),
    );
  }

  /** Открыть или закрыть шпаргалку по клавишам (H, «?», щелчок по ней); open — задать явно. */
  toggleKeys(open = !this.bar.classList.contains('keys')): void {
    this.bar.classList.toggle('keys', open);
  }

  private setMusic(off: boolean): void {
    this.music.classList.toggle('off', off);
    this.music.title = off ? 'Включить музыку' : 'Выключить музыку (звуки боя останутся)';
    const item = this.pauseBox?.querySelector<HTMLButtonElement>('.music');
    if (item) item.textContent = off ? 'Музыка: выключена' : 'Музыка: включена';
  }

  /** Ячейки сохранений поверх окна паузы: записать в любую или загрузить непустую. */
  private slots(card: HTMLElement, mode: 'save' | 'load'): void {
    const kids = [...card.children];
    const back = () => card.replaceChildren(...kids);
    const head = div('hud-pause-head');
    head.textContent = mode === 'save' ? 'Сохранить' : 'Загрузить';
    const note = div('hud-pause-note');
    const list = loadSaves();
    const btns = list.map((sv, i) => {
      const b = document.createElement('button');
      b.className = 'hud-pause-btn slot';
      b.textContent = slotLabel(sv, i);
      b.disabled = mode === 'load' && !sv;
      b.addEventListener('click', () => {
        if (mode === 'load') return sv && this.onLoad(sv);
        const r = this.onSave();
        if (typeof r === 'string') return void (note.textContent = r);
        if (!writeSave(i, r)) return void (note.textContent = 'Не удалось записать: браузер не даёт места');
        b.textContent = slotLabel(r, i);
        note.textContent = 'Сохранено';
      });
      return b;
    });
    const ret = document.createElement('button');
    ret.className = 'hud-pause-btn';
    ret.textContent = '← Назад';
    ret.addEventListener('click', back);
    card.replaceChildren(head, ...btns, note, ret);
  }

  get paused(): boolean {
    return !!this.pauseBox;
  }

  /** Пауза (☰, Esc): продолжить, музыка, выйти в меню игры или во двор. В сети бой идёт дальше. */
  togglePause(open = !this.pauseBox): void {
    if (!open) {
      this.pauseBox?.remove();
      this.pauseBox = null;
      this.onPause(false);
      return;
    }
    if (this.pauseBox) return;
    this.menu.hidden = true;
    const box = div('hud-pause');
    const card = div('hud-pause-card');
    const head = div('hud-pause-head');
    head.textContent = this.net ? 'Меню' : 'Пауза';
    card.append(head);
    if (this.net) {
      const note = div('hud-pause-note');
      note.textContent = 'Бой по сети не останавливается — ход идёт.';
      card.append(note);
    }
    const item = (label: string, cls: string, act: () => void) => {
      const b = document.createElement('button');
      b.className = `hud-pause-btn ${cls}`;
      b.textContent = label;
      b.addEventListener('click', act);
      card.append(b);
    };
    item('Продолжить', 'go', () => this.togglePause(false));
    item('', 'music', () => this.setMusic(this.onMusic()));
    if (!this.net) {
      item('Сохранить', '', () => this.slots(card, 'save'));
      item('Загрузить', '', () => this.slots(card, 'load'));
    }
    item('Выйти в меню игры', '', () => this.onQuit());
    item('Во двор, к другим играм', '', () => (location.href = '/'));
    box.append(card);
    box.addEventListener('pointerdown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => {
      if (e.target === box) this.togglePause(false);
    });
    this.el.append(box);
    this.pauseBox = box;
    this.setMusic(musicOff());
    this.onPause(true);
  }

  /** Короткое сообщение посередине (как «Ходит …»). */
  flash(text: string, ms = 2500): void {
    this.who.textContent = text;
    this.who.style.color = '#ffd166';
    this.who.hidden = false;
    clearTimeout(this.whoTimer);
    this.whoTimer = window.setTimeout(() => (this.who.hidden = true), ms);
  }

  /** За одним экраном: «передай устройство» перед ходом другого человека; мир стоит, пока не нажмут «Я готов» (или Enter). */
  handoff(team: number, go: () => void): void {
    const b = BRIGADES.find((x) => x.id === this.brigades[team]);
    const box = div('hud-handoff');
    const card = div('hud-handoff-card');
    const name = div('hud-handoff-name');
    name.textContent = `Ходит ${b?.name ?? `бригада ${team + 1}`}`;
    name.style.color = '#' + (b?.color ?? 0xffffff).toString(16).padStart(6, '0');
    const tip = div('hud-handoff-tip');
    tip.textContent = 'Передай телефон или пересядь за клавиатуру';
    const btn = document.createElement('button');
    btn.className = 'hud-handoff-go';
    btn.textContent = 'Я готов';
    card.append(tip, name, btn);
    box.append(card);
    this.el.append(box);
    this.who.hidden = true; // «Ходит …» уже крупно на экране передачи
    const done = () => {
      window.removeEventListener('keydown', key, true);
      box.remove();
      go();
    };
    const key = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') done();
    };
    btn.addEventListener('click', done);
    window.addEventListener('keydown', key, true);
    btn.focus();
  }

  /** Подсказка внизу (совет миссии) — гаснет через ms. */
  hint(text: string, ms = 8000): void {
    const el = div('hud-hint');
    el.textContent = text;
    this.el.append(el);
    window.setTimeout(() => el.classList.add('gone'), ms);
    window.setTimeout(() => el.remove(), ms + 1200);
  }

  /** Строка цели миссии сверху. */
  setGoal(text: string): void {
    if (this.goal.textContent !== text) this.goal.textContent = text;
  }

  update(w: World): void {
    this.world = w;
    const turn = w.phase === 'turn' || w.phase === 'retreat';
    // новый ход — на полторы секунды «Ходит Расточка» цветом бригады
    if (w.phase === 'turn' && this.lastPhase !== 'turn' && !this.el.querySelector('.hud-handoff')) {
      const b = BRIGADES.find((x) => x.id === this.brigades[w.team]);
      this.who.textContent = `Ходит ${b?.name ?? `бригада ${w.team + 1}`}`;
      this.who.style.color = '#' + (b?.color ?? 0xffffff).toString(16).padStart(6, '0');
      this.who.hidden = false;
      clearTimeout(this.whoTimer);
      this.whoTimer = window.setTimeout(() => (this.who.hidden = true), 1500);
    }
    this.lastPhase = w.phase;
    this.timer.textContent = turn ? String(Math.ceil(w.left / TICK_HZ)) : '';
    this.timer.classList.toggle('retreat', w.phase === 'retreat');
    this.timer.classList.toggle('hurry', w.phase === 'turn' && w.left < 5 * TICK_HZ);
    const k = Math.abs(w.wind) / 100;
    (this.wind.children[0] as HTMLElement).style.width = w.wind < 0 ? `${k * 50}%` : '0';
    (this.wind.children[1] as HTMLElement).style.width = w.wind > 0 ? `${k * 50}%` : '0';
    const total = w.teams.map((t) => t.worms.reduce((s, id) => s + Math.max(0, w.worms.find((x) => x.id === id)!.hp), 0));
    const max = Math.max(1, ...total);
    this.teams.innerHTML = w.teams
      .map((t, i) => {
        const b = BRIGADES.find((x) => x.id === this.brigades[i]);
        const col = '#' + (b?.color ?? 0xffffff).toString(16).padStart(6, '0');
        return `<div class="hud-team${i === w.team && turn ? ' on' : ''}"><span style="color:${col}">${b?.name ?? i + 1}</span><i style="width:${(total[i] / max) * 100}%;background:${col}"></i></div>`;
      })
      .join('');
    const need = WEAPONS[w.weapon]?.target && !w.target && w.phase === 'turn' && (!this.mine || this.mine.includes(w.team));
    const label = (WEAPON_NAMES[w.weapon] ?? w.weapon) + (need ? ' — ткни в точку' : '');
    if (this.weapon.dataset.label !== label) {
      this.weapon.dataset.label = label;
      const icon = weaponIcon(w.weapon);
      this.weapon.innerHTML = `${icon ? `<img src="${icon}" alt="">` : ''}<span></span>`;
      (this.weapon.querySelector('span') as HTMLElement).textContent = label;
    }
    if (!this.menu.hidden && this.menuFor !== w.team) this.menu.hidden = true;
    if (w.phase === 'over' && this.banner.hidden && !this.quietOver) {
      const b = BRIGADES.find((x) => x.id === this.brigades[w.winner]);
      this.banner.textContent = w.winner < 0 ? 'Ничья — все сдулись' : `${b?.name ?? 'Бригада'} держит район!`;
      this.banner.hidden = false;
    }
  }
}

function div(cls: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}
