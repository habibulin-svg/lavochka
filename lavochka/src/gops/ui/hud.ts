/* Интерфейс боя поверх холста (DOM): таймер хода, ветер, здоровье бригад, выбранное оружие,
 * сетка оружия (Tab / кнопка), экранные кнопки для телефона, итог партии. */
import { BRIGADES } from '../assets';
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

export class Hud {
  readonly el: HTMLElement;
  private timer: HTMLElement;
  private wind: HTMLElement;
  private teams: HTMLElement;
  private weapon: HTMLElement;
  private menu: HTMLElement;
  private banner: HTMLElement;
  private goal: HTMLElement;
  /** Свой итог показывает миссия — общий баннер «держит район» не нужен. */
  quietOver = false;
  onPick: (id: string) => void = () => {};

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
    this.el.append(this.timer, this.wind, this.teams, this.weapon, this.menu, this.banner, this.goal);
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

  toggleMenu(w?: World): void {
    this.menu.hidden = !this.menu.hidden;
    if (!this.menu.hidden && w) this.fillMenu(w);
  }

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
        b.innerHTML = `<span>${WEAPON_NAMES[id] ?? id}</span><b>${n < 0 ? '∞' : n}</b>`;
        b.onclick = () => {
          this.onPick(id);
          this.menu.hidden = true;
        };
        return b;
      }),
    );
  }

  /** Строка цели миссии сверху. */
  setGoal(text: string): void {
    if (this.goal.textContent !== text) this.goal.textContent = text;
  }

  update(w: World): void {
    const turn = w.phase === 'turn' || w.phase === 'retreat';
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
    const need = WEAPONS[w.weapon]?.target && !w.target && w.phase === 'turn';
    this.weapon.textContent = (WEAPON_NAMES[w.weapon] ?? w.weapon) + (need ? ' — ткни в точку' : '');
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
