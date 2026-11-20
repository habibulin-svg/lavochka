/* Симулятор дирижёра — экраны: главное меню, карьера (сезоны, залы, афиши, улучшения), репетиция, свободная сцена,
 * переложения (редактор), сохранения, пауза, итоги с отзывом критика. Концерт — game.ts, сцена — scene/scene3d.ts. */
import { applyArrangement, canPlay } from './core/arrange';
import { buy, FAMILIES, level, moodFor, nextConcert, openPieces, rehearsed, reputation, restDay, review, settleConcert, unlocked, UPGRADES, widenFor, type Arrangement, type CareerState, type PlayedPiece } from './core/career';
import { DIFFS, type DiffId } from './core/chart';
import { CONCERTS, HALLS, hallOf, PIECES, pieceOf, SEASONS, type Hall } from './core/pieces';
import { barsOf, INSTR, LANE_SETS, type InstrId, type ScoreJson } from './core/score';
import { Autoplay } from './audio/menumusic';
import { Orchestra } from './audio/orchestra';
import { Concert, type ConcertResult, type ConcertSetup } from './game';
import { loadCareer, loadPrefs, loadSlots, saveCareer, savePrefs, slotLabel, writeSlot, freshCareer, type Prefs } from './save';
import { Scene3D } from './scene/scene3d';
import { FlatStage } from './scene/stage';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const DIFF_NAME: Record<DiffId, string> = { learn: 'обучение', easy: '3 группы', normal: '4 группы', hard: '6 групп', master: '8 групп' };

export const HELP = `<div class="dz-help">
  <p><b>Ваша задача</b> — вовремя давать вступления группам оркестра. Музыка идёт сама; на ленте внизу к <b>линии палочки</b> едут отметки.</p>
  <p>● <b>Круг</b> — вступление: нажмите кнопку группы, когда круг на линии. Не успели — группа играет робко и вразнобой.</p>
  <p>■ <b>Квадрат</b> — снятие: нажмите на последнем аккорде.</p>
  <p>• <b>Точки на строке «Палочка»</b> — ведите такт: взмах палочкой (<kbd>Пробел</kbd> или клик по пустому месту сцены) на долю. Ровная палочка — ровный оркестр. Показ группе на долю засчитывается и как взмах.</p>
  <p>Строка <b>«Палочка»</b>: <b>𝄐</b> фермата — держите <kbd>Пробел</kbd>, отпустите на конце полосы; <b>▲▼</b> — громче/тише.</p>
  <p><b>Клавиатура:</b> группы — <kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd>F</kbd> и <kbd>J</kbd><kbd>K</kbd><kbd>L</kbd><kbd>;</kbd>, палочка — <kbd>Пробел</kbd>, громче/тише — <kbd>↑</kbd><kbd>↓</kbd>, пауза — <kbd>Esc</kbd>.</p>
  <p><b>Мышь:</b> щелчок по группе музыкантов на сцене — вступление (группа под курсором подсвечивается); щелчок по пустому месту — палочка, удержание — фермата; колесо — громче/тише.</p>
  <p><b>Телефон:</b> кнопки групп — у начала строк или касание группы на сцене; палочка — касание пустого места (держать — фермата); громче/тише — провести по сцене вверх/вниз.</p>
  <p><b>Геймпад:</b> кнопки и бамперы — группы, правый курок — палочка, правый стик — громче/тише, Start — пауза.</p>
  <p><b>Шкала зала</b> 👏 — на концерте: промахи её опускают, пустая — публика уходит. На <b>репетиции</b> провала нет, а пройденная репетиция прибавляет сыгранность: группы меньше теряются, если вы промахнётесь на концерте.</p>
</div>`;

type Btn = { text: string; primary?: boolean; action?: () => void };

export class App {
  private el: HTMLElement;
  private orch: Orchestra | null = null;
  private career: CareerState;
  private prefs: Prefs;
  private music: Autoplay | null = null;
  private musicScore: ScoreJson | null = null;
  private concert: Concert | null = null;

  constructor(private host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dz-screen';
    host.appendChild(this.el);
    this.career = loadCareer() ?? freshCareer();
    this.prefs = loadPrefs();
  }

  orchestra(): Orchestra {
    if (!this.orch) {
      this.orch = new Orchestra();
      if (import.meta.env.DEV) (window as unknown as { __dz: unknown }).__dz = { orch: this.orch, app: this };
    }
    return this.orch;
  }

  async score(id: string): Promise<ScoreJson> {
    const r = await fetch(`${import.meta.env.BASE_URL}dirizher/scores/${id}.json`);
    if (!r.ok) throw new Error(`нет партитуры ${id}`);
    return (await r.json()) as ScoreJson;
  }

  // ---------------------------------------------------------------- музыка меню
  private async menuMusic(on: boolean): Promise<void> {
    if (!on || !this.prefs.music) {
      this.music?.stop();
      this.music = null;
      return;
    }
    if (this.music) return;
    const orch = this.orchestra();
    if (orch.ctx.state !== 'running') return; // до первого нажатия звук не включить
    this.musicScore ??= await this.score('b7-2').catch(() => null);
    if (!this.musicScore || this.music || this.concert) return;
    const m = new Autoplay(orch, this.musicScore, { loop: true, volume: 0.35 });
    this.music = m;
    await m.preload();
    if (this.music === m && !this.concert) m.start();
  }

  private wake(): void {
    const orch = this.orchestra();
    if (orch.ctx.state !== 'running') void orch.ctx.resume().then(() => this.menuMusic(true));
  }

  // ---------------------------------------------------------------- общее
  private screen(html: string): HTMLElement {
    this.el.hidden = false;
    this.el.innerHTML = `<div class="dz-panel">${html}</div>`;
    this.el.scrollTop = 0;
    const top = document.createElement('div');
    top.className = 'dz-corner';
    top.innerHTML = `<button class="dz-ico" data-a="music" title="Музыка меню">${this.prefs.music ? '♪' : '♪̸'}</button><button class="dz-ico" data-a="help" title="Как играть">?</button>`;
    this.el.appendChild(top);
    (top.querySelector('[data-a=music]') as HTMLElement).onclick = () => {
      this.prefs.music = !this.prefs.music;
      savePrefs(this.prefs);
      (top.querySelector('[data-a=music]') as HTMLElement).textContent = this.prefs.music ? '♪' : '♪̸';
      void this.menuMusic(this.prefs.music);
    };
    (top.querySelector('[data-a=help]') as HTMLElement).onclick = () => this.modal('<h2>Как играть</h2>' + HELP, [{ text: 'Понятно', primary: true }]);
    this.el.onclick = () => this.wake();
    return this.el.querySelector('.dz-panel') as HTMLElement;
  }

  private on(sel: string, fn: () => void): void {
    const b = this.el.querySelector(sel) as HTMLElement | null;
    if (b) b.onclick = (e) => {
      e.stopPropagation();
      this.wake();
      fn();
    };
  }

  modal(html: string, btns: Btn[]): HTMLElement {
    const m = document.createElement('div');
    m.className = 'dz-modal';
    m.innerHTML = `<div>${html}<div class="dz-row dz-mbtns"></div></div>`;
    const row = m.querySelector('.dz-mbtns') as HTMLElement;
    for (const b of btns) {
      const x = document.createElement('button');
      x.className = `dz-btn${b.primary ? ' primary' : ''}`;
      x.textContent = b.text;
      x.onclick = () => {
        m.remove();
        b.action?.();
      };
      row.appendChild(x);
    }
    this.host.appendChild(m);
    return m;
  }

  // ---------------------------------------------------------------- главное меню
  title(): void {
    void this.menuMusic(true);
    const c = this.career;
    const started = c.played > 0;
    const p = this.screen(`
      <div class="dz-logo"><span>Симулятор</span> дирижёра</div>
      <div class="dz-sub">Оркестр ждёт вашего взмаха</div>
      <button class="dz-btn primary" data-a="career">${started ? 'Продолжить карьеру' : 'Начать карьеру'}<small>${started ? `репутация ${reputation(c)} ★ · гонорары ${c.money} ₽` : 'от дома культуры до Карнеги-холла'}</small></button>
      <button class="dz-btn" data-a="rehearsal">Репетиция<small>любая открытая пьеса, без провала, медленнее, с любого такта</small></button>
      <button class="dz-btn" data-a="free">Свободная сцена<small>пьеса, зал и число групп на выбор</small></button>
      <button class="dz-btn" data-a="arr">Переложения<small>отдайте мелодию скрипок трубам — ваша редакция партитуры</small></button>
      <div class="dz-row">
        <button class="dz-btn" data-a="saves">Сохранить / загрузить</button>
        <button class="dz-btn" data-a="new">Новая карьера</button>
      </div>
      <button class="dz-btn" data-a="yard">Во двор, к другим играм</button>
      <div class="dz-foot">Lavochka Games · ранний доступ · партитуры OpenScore (CC0), звук VSCO 2 CE (CC0)</div>`);
    void p;
    this.on('[data-a=career]', () => this.careerScreen());
    this.on('[data-a=rehearsal]', () => this.rehearsalSetup());
    this.on('[data-a=free]', () => this.freeSetup());
    this.on('[data-a=arr]', () => this.arrangements());
    this.on('[data-a=saves]', () => this.saves(() => this.title()));
    this.on('[data-a=new]', () =>
      this.modal('<h2>Новая карьера?</h2><p>Текущая карьера пропадёт, если её не сохранить в ячейку.</p>', [
        { text: 'Отмена' },
        {
          text: 'Начать заново',
          primary: true,
          action: () => {
            this.career = freshCareer();
            this.title();
          },
        },
      ])
    );
    this.on('[data-a=yard]', () => (location.href = '/'));
  }

  saves(back: () => void): void {
    const slots = loadSlots();
    this.screen(`
      <h1 class="dz-h1">Сохранения</h1>
      <div class="dz-sub">Карьера сохраняется сама после каждого концерта. Ячейки — чтобы держать несколько.</div>
      ${slots.map((s, i) => `<div class="dz-row"><button class="dz-btn" data-load="${i}" ${s ? '' : 'disabled'}>Загрузить: ${esc(slotLabel(s, i))}</button><button class="dz-btn" data-save="${i}">Сохранить сюда</button></div>`).join('')}
      <button class="dz-btn" data-a="back">← Назад</button>`);
    slots.forEach((s, i) => {
      this.on(`[data-save="${i}"]`, () => {
        const next = nextConcert(this.career);
        const con = CONCERTS.find((x) => x.id === next);
        writeSlot(i, `${this.career.name}: ${con ? con.hall.name : 'карьера пройдена'}`, this.career);
        this.saves(back);
      });
      if (s)
        this.on(`[data-load="${i}"]`, () => {
          this.career = JSON.parse(JSON.stringify(s.career)) as CareerState;
          saveCareer(this.career);
          back();
        });
    });
    this.on('[data-a=back]', back);
  }

  // ---------------------------------------------------------------- карьера
  careerScreen(): void {
    void this.menuMusic(true);
    const c = this.career;
    const next = nextConcert(c);
    const html = SEASONS.map((s) => {
      const halls = s.halls
        .map((h) => {
          const cons = h.concerts
            .map((x) => {
              const st = c.stars[x.id] ?? 0;
              const open = unlocked(c, x.id);
              const stars = st ? '★'.repeat(st) + '<s>' + '★'.repeat(5 - st) + '</s>' : '';
              return `<button class="dz-btn dz-con${x.id === next ? ' primary' : ''}" data-con="${x.id}" ${open ? '' : 'disabled'}>
                ${open ? '' : '🔒 '}${esc(x.title)} <span class="dz-stars-s">${stars}</span>
                <small>${x.pieces.map((p) => esc(pieceOf(p)?.composer + ': ' + pieceOf(p)?.title)).join(' · ')} · ${DIFF_NAME[x.diff]}</small></button>`;
            })
            .join('');
          return `<div class="dz-hallcard"><b>${esc(h.name)}</b> <i>${esc(h.city)} · ${h.seats} мест</i><p>${esc(h.about)}</p>${cons}</div>`;
        })
        .join('');
      return `<h2 class="dz-season">${esc(s.title)}</h2>${halls}`;
    }).join('');
    this.screen(`
      <h1 class="dz-h1">Карьера</h1>
      <div class="dz-sub">${esc(c.name)} · репутация ${reputation(c)} ★ · гонорары ${c.money} ₽</div>
      <div class="dz-row"><button class="dz-btn" data-a="shop">Улучшения оркестра</button><button class="dz-btn" data-a="mood">Настрой оркестра</button><button class="dz-btn" data-a="back">← В меню</button></div>
      ${html}`);
    for (const x of CONCERTS) this.on(`[data-con="${x.id}"]`, () => this.concertPrep(x.id));
    this.on('[data-a=shop]', () => this.shop());
    this.on('[data-a=mood]', () => this.moodScreen());
    this.on('[data-a=back]', () => this.title());
    const cur = this.el.querySelector('.dz-con.primary');
    cur?.scrollIntoView({ block: 'center' });
  }

  moodScreen(): void {
    const c = this.career;
    const face = (m: number) => (m >= 80 ? '😄' : m >= 60 ? '🙂' : m >= 40 ? '😐' : m >= 20 ? '😒' : '😠');
    this.modal(
      `<h2>Настрой оркестра</h2><p>Точные вступления радуют группы, промахи — злят. Недовольная группа играет небрежнее. Между концертами настрой понемногу возвращается; чай в перерыве поднимает его.</p>
       ${FAMILIES.map((f) => `<p>${face(c.mood[f.id])} <b>${f.name}</b>: ${c.mood[f.id]}</p>`).join('')}`,
      [{ text: 'Хорошо', primary: true }]
    );
  }

  shop(): void {
    const c = this.career;
    const rows = UPGRADES.map((u) => {
      const lv = level(c, u.id);
      const price = u.cost[lv];
      return `<div class="dz-hallcard"><b>${esc(u.name)}</b> <i>уровень ${lv}${u.cost[1] ? ' из 3' : ''}</i><p>${esc(u.about)}</p>
        <button class="dz-btn" data-buy="${u.id}" ${price && c.money >= price ? '' : 'disabled'}>${price ? `Купить за ${price} ₽` : 'Всё куплено'}</button></div>`;
    }).join('');
    this.screen(`<h1 class="dz-h1">Улучшения</h1><div class="dz-sub">Гонорары: ${c.money} ₽</div>${rows}<button class="dz-btn" data-a="back">← К карьере</button>`);
    for (const u of UPGRADES)
      this.on(`[data-buy="${u.id}"]`, () => {
        if (buy(c, u.id)) saveCareer(c);
        this.shop();
      });
    this.on('[data-a=back]', () => this.careerScreen());
  }

  concertPrep(id: string): void {
    const con = CONCERTS.find((x) => x.id === id)!;
    const c = this.career;
    const pieces = con.pieces.map((p) => pieceOf(p)!);
    this.screen(`
      <div class="dz-poster">
        <div class="dz-poster-hall">${esc(con.hall.name)}</div>
        <div class="dz-poster-city">${esc(con.hall.city)}</div>
        <div class="dz-poster-title">${esc(con.title)}</div>
        ${pieces.map((p) => `<div class="dz-poster-piece"><b>${esc(p.composer)}</b><br>${esc(p.title)}<small>${esc(p.about)}</small><small>сыгранность: ${'●'.repeat(c.rehearsed[p.id] ?? 0)}${'○'.repeat(3 - (c.rehearsed[p.id] ?? 0))}</small></div>`).join('')}
        <div class="dz-poster-foot">дирижёр — ${esc(c.name)} · ${DIFF_NAME[con.diff]}</div>
      </div>
      <button class="dz-btn primary" data-a="go">На сцену!<small>концерт: промахи штрафуются, пустая шкала зала — провал</small></button>
      ${pieces.map((p) => `<button class="dz-btn" data-reh="${p.id}">Репетировать: ${esc(p.title)}</button>`).join('')}
      <button class="dz-btn" data-a="back">← К карьере</button>`);
    this.on('[data-a=go]', () => void this.runConcert(con.id));
    for (const p of pieces) this.on(`[data-reh="${p.id}"]`, () => void this.runRehearsal(p.id, con.diff, 0.8, con.hall, () => this.concertPrep(id)));
    this.on('[data-a=back]', () => this.careerScreen());
  }

  // ---------------------------------------------------------------- игра
  /** Сыграть одну пьесу; null — вышли в меню. */
  private async play(setup: ConcertSetup, hall: Hall, opts: { tutor?: boolean; label?: string } = {}): Promise<ConcertResult | null> {
    this.menuMusic(false);
    this.el.hidden = true;
    const orch = this.orchestra();
    void orch.ctx.resume();
    return new Promise<ConcertResult | null>((resolve) => {
      const concert = new Concert(this.host, orch, { ...setup, hall: { name: hall.name, rt60: hall.rt60 }, tutor: opts.tutor });
      this.concert = concert;
      let stage;
      try {
        stage = new Scene3D(concert.stageEl, setup.score, { hall: hall.id });
      } catch {
        stage = new FlatStage(concert.stageEl);
      }
      concert.stage = stage;
      const load = document.createElement('div');
      load.className = 'dz-load';
      load.innerHTML = `<b>${esc(hall.name)}</b><span>${esc(opts.label ?? setup.score.title)}</span><div class="bar"><i></i></div><span class="dz-load-t">Оркестр настраивается…</span>`;
      this.host.appendChild(load);
      const bar = load.querySelector('.bar i') as HTMLElement;
      const done = (r: ConcertResult | null) => {
        concert.destroy();
        this.concert = null;
        load.remove();
        resolve(r);
      };
      concert.onEnd = (r) => setTimeout(() => done(r), 600);
      concert.onPause = () => {
        concert.pause(true);
        this.modal(`<h2>Пауза</h2><p>${esc(setup.score.composer)}. ${esc(setup.score.title)}</p>`, [
          { text: 'Как играть', action: () => this.modal('<h2>Как играть</h2>' + HELP, [{ text: 'Продолжить', primary: true, action: () => concert.pause(false) }]) },
          { text: 'В меню игры', action: () => done(null) },
          { text: 'Во двор', action: () => (location.href = '/') },
          { text: 'Продолжить', primary: true, action: () => concert.pause(false) },
        ]);
      };
      concert.onHelp = () => {
        concert.pause(true);
        this.modal('<h2>Как играть</h2>' + HELP, [{ text: 'Продолжить', primary: true, action: () => concert.pause(false) }]);
      };
      const ready = (stage as Scene3D).ready ?? Promise.resolve();
      let k3 = 0;
      let ka = 0;
      const prog = () => (bar.style.width = `${Math.round((ka * 0.7 + k3 * 0.3) * 100)}%`);
      void ready.then(() => {
        k3 = 1;
        prog();
      });
      void concert
        .start((k) => {
          ka = k;
          prog();
        }, ready.then(() => load.remove()))
        .catch((e) => {
          console.error(e);
          done(null);
        });
    });
  }

  async runConcert(id: string): Promise<void> {
    const con = CONCERTS.find((x) => x.id === id)!;
    const c = this.career;
    const played: PlayedPiece[] = [];
    const lines: string[] = [];
    let total = 0;
    for (let i = 0; i < con.pieces.length; i++) {
      const pid = con.pieces[i];
      const score = await this.score(pid);
      const diff = con.diff as DiffId;
      const lanes = LANE_SETS[DIFFS[diff].lanes].map((l) => l.instr);
      const r = await this.play(
        { score, diff, concert: con.diff !== 'learn', mood: moodFor(c, lanes), widen: widenFor(c, lanes), rehearsed: c.rehearsed[pid] ?? 0 },
        con.hall,
        { tutor: con.diff === 'learn' || con.id === 'of1', label: `${i + 1}/${con.pieces.length}: ${score.title}` }
      );
      if (!r) return this.concertPrep(id);
      played.push({ piece: pid, stars: r.stars, score: r.score, failed: r.failed, mood: r.mood, laneInstr: r.chart.lanes.map((l) => l.instr) });
      total += r.score;
      const lanesN = r.chart.lanes.map((l) => l.name);
      const tot = r.chart.lanes.map((_, li) => r.chart.marks.filter((m) => m.lane === li).length);
      lines.push(review({ hall: con.hall.name, piece: score.title, stars: r.stars, failed: r.failed, lanes: lanesN, miss: r.missByLane, total: tot }, c.played + i * 7 + 1));
      if (r.failed) break;
    }
    const res = settleConcert(c, id, played);
    restDay(c);
    saveCareer(c);
    const failed = played.some((p) => p.failed);
    this.screen(`
      <h1 class="dz-h1">${failed ? 'Провал' : res.stars >= 4 ? 'Браво!' : 'Аплодисменты'}</h1>
      <div class="dz-sub">${esc(con.hall.name)} · ${esc(con.title)}</div>
      <div class="dz-stars">${'★'.repeat(res.stars)}<s>${'★'.repeat(5 - res.stars)}</s></div>
      <table class="dz-result">${played.map((p) => `<tr><td>${esc(pieceOf(p.piece)!.title)}</td><td>${p.failed ? 'провал' : '★'.repeat(p.stars)}</td><td>${p.score.toLocaleString('ru-RU')}</td></tr>`).join('')}
        <tr><td><b>Итого</b></td><td></td><td><b>${total.toLocaleString('ru-RU')}</b></td></tr></table>
      <div class="dz-critic">«${esc(lines.join(' '))}»<br>— музыкальный обозреватель</div>
      ${res.fee ? `<p>Гонорар: <b>${res.fee} ₽</b>${res.first ? ' · открыт следующий концерт' : ''}</p>` : ''}
      ${failed ? '<p>Совет: отрепетируйте пьесу — на репетиции нет провала, а сыгранность прощает промахи.</p>' : ''}
      <button class="dz-btn primary" data-a="next">${failed ? 'Попробовать ещё раз' : 'Дальше'}</button>
      <button class="dz-btn" data-a="career">К карьере</button>`);
    const nxt = nextConcert(c);
    this.on('[data-a=next]', () => (failed ? this.concertPrep(id) : nxt ? this.concertPrep(nxt) : this.careerScreen()));
    this.on('[data-a=career]', () => this.careerScreen());
  }

  async runRehearsal(pid: string, diff: DiffId, speed: number, hall: Hall, back: () => void, fromBar = 0, mute: number[] = []): Promise<void> {
    const score = await this.score(pid);
    const bars = barsOf(score);
    const r = await this.play({ score, diff, concert: false, speed, from: bars[Math.min(fromBar, bars.length - 1)]?.tick ?? 0, mute }, hall, { tutor: true, label: `Репетиция · ${Math.round(speed * 100)} %` });
    if (!r) return back();
    const up = fromBar === 0 && rehearsed(this.career, pid, r.acc);
    saveCareer(this.career);
    this.modal(
      `<h2>Репетиция окончена</h2><p>Точность: <b>${Math.round(r.acc * 100)} %</b> · лучшая серия ${r.bestCombo}</p>
       ${up ? `<p>Сыгранность пьесы выросла: ${'●'.repeat(this.career.rehearsed[pid] ?? 0)}</p>` : r.acc < 0.6 ? '<p>Сыгранность растёт, если пройти репетицию с начала с точностью от 60 %.</p>' : ''}`,
      [
        { text: 'Ещё раз', action: () => void this.runRehearsal(pid, diff, speed, hall, back, fromBar, mute) },
        { text: 'Готово', primary: true, action: back },
      ]
    );
  }

  rehearsalSetup(sel?: { piece?: string; speed?: number; from?: number; diff?: DiffId }): void {
    const open = openPieces(this.career);
    const piece = sel?.piece ?? open[open.length - 1] ?? 'ode';
    const speed = sel?.speed ?? 0.8;
    const diff = sel?.diff ?? this.careerDiff();
    const from = sel?.from ?? 0;
    void this.score(piece).then((s) => {
      const bars = barsOf(s);
      const marks = s.marks ?? [];
      const fromOpts = [[0, 'с начала'] as [number, string], ...marks.map(([t, m]) => [bars.findIndex((b) => b.tick >= t), `буква ${m}`] as [number, string])];
      for (let k = 16; k < bars.length; k += 16) if (!fromOpts.some(([b]) => Math.abs(b - k) < 6)) fromOpts.push([k, `такт ${k + 1}`]);
      fromOpts.sort((a, b) => a[0] - b[0]);
      this.screen(`
        <h1 class="dz-h1">Репетиция</h1>
        <div class="dz-sub">Без провала. Медленнее, с любого места.</div>
        <label class="dz-field">Пьеса <select data-f="piece">${PIECES.filter((p) => open.includes(p.id)).map((p) => `<option value="${p.id}" ${p.id === piece ? 'selected' : ''}>${esc(p.composer)}: ${esc(p.title)}</option>`).join('')}</select></label>
        <label class="dz-field">Темп <select data-f="speed">${[0.6, 0.7, 0.8, 0.9, 1].map((v) => `<option value="${v}" ${v === speed ? 'selected' : ''}>${Math.round(v * 100)} %</option>`).join('')}</select></label>
        <label class="dz-field">Группы <select data-f="diff">${(Object.keys(DIFFS) as DiffId[]).map((d) => `<option value="${d}" ${d === diff ? 'selected' : ''}>${DIFF_NAME[d]}</option>`).join('')}</select></label>
        <label class="dz-field">Откуда <select data-f="from">${fromOpts.map(([b, l]) => `<option value="${b}" ${b === from ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <button class="dz-btn primary" data-a="go">Начать репетицию</button>
        <button class="dz-btn" data-a="back">← В меню</button>`);
      const val = (f: string) => (this.el.querySelector(`[data-f=${f}]`) as HTMLSelectElement).value;
      this.el.querySelectorAll('select').forEach((x) => (x.onchange = () => this.rehearsalSetup({ piece: val('piece'), speed: Number(val('speed')), diff: val('diff') as DiffId, from: val('piece') === piece ? Number(val('from')) : 0 })));
      this.on('[data-a=go]', () => void this.runRehearsal(piece, diff, speed, this.rehearsalHall(), () => this.rehearsalSetup({ piece, speed, diff, from }), from));
      this.on('[data-a=back]', () => this.title());
    });
  }

  /** Сложность по сезону карьеры (для репетиций и свободной сцены по умолчанию). */
  private careerDiff(): DiffId {
    const nxt = CONCERTS.find((x) => x.id === nextConcert(this.career)) ?? CONCERTS[CONCERTS.length - 1];
    return nxt.diff as DiffId;
  }

  private rehearsalHall(): Hall {
    const nxt = CONCERTS.find((x) => x.id === nextConcert(this.career)) ?? CONCERTS[CONCERTS.length - 1];
    return nxt.hall;
  }

  freeSetup(sel?: { piece?: string; hall?: string; diff?: DiffId; arr?: string }): void {
    const open = openPieces(this.career);
    const openHalls = HALLS.filter((h) => h.concerts.some((x) => unlocked(this.career, x.id)));
    const piece = sel?.piece ?? open[0] ?? 'ode';
    const hall = sel?.hall ?? openHalls[openHalls.length - 1]?.id ?? 'dk';
    const diff = sel?.diff ?? this.careerDiff();
    const arrs = this.career.arrangements.filter((a) => a.piece === piece);
    const arr = sel?.arr ?? '';
    this.screen(`
      <h1 class="dz-h1">Свободная сцена</h1>
      <div class="dz-sub">Открытые пьесы и залы — в любом сочетании.</div>
      <label class="dz-field">Пьеса <select data-f="piece">${PIECES.filter((p) => open.includes(p.id)).map((p) => `<option value="${p.id}" ${p.id === piece ? 'selected' : ''}>${esc(p.composer)}: ${esc(p.title)}</option>`).join('')}</select></label>
      <label class="dz-field">Зал <select data-f="hall">${openHalls.map((h) => `<option value="${h.id}" ${h.id === hall ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select></label>
      <label class="dz-field">Группы <select data-f="diff">${(Object.keys(DIFFS) as DiffId[]).map((d) => `<option value="${d}" ${d === diff ? 'selected' : ''}>${DIFF_NAME[d]}</option>`).join('')}</select></label>
      <label class="dz-field">Редакция <select data-f="arr"><option value="">авторская партитура</option>${arrs.map((a) => `<option value="${a.id}" ${a.id === arr ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <button class="dz-btn primary" data-a="go">Играть</button>
      <button class="dz-btn" data-a="back">← В меню</button>`);
    const val = (f: string) => (this.el.querySelector(`[data-f=${f}]`) as HTMLSelectElement).value;
    this.el.querySelectorAll('select').forEach((x) => (x.onchange = () => this.freeSetup({ piece: val('piece'), hall: val('hall'), diff: val('diff') as DiffId, arr: val('piece') === piece ? val('arr') : '' })));
    this.on('[data-a=go]', async () => {
      const a = this.career.arrangements.find((x) => x.id === arr) ?? null;
      const score = applyArrangement(await this.score(piece), a);
      const r = await this.play({ score, diff, concert: true }, hallOf(hall)!);
      if (!r) return this.freeSetup({ piece, hall, diff, arr });
      this.modal(
        `<h2>${r.failed ? 'Публика ушла' : 'Аплодисменты'}</h2><div class="dz-stars">${'★'.repeat(r.stars)}<s>${'★'.repeat(5 - r.stars)}</s></div><p>Счёт: <b>${r.score.toLocaleString('ru-RU')}</b> · точность ${Math.round(r.acc * 100)} % · лучшая серия ${r.bestCombo}</p>`,
        [{ text: 'Ещё раз', primary: true, action: () => this.freeSetup({ piece, hall, diff, arr }) }]
      );
    });
    this.on('[data-a=back]', () => this.title());
  }

  // ---------------------------------------------------------------- переложения
  arrangements(): void {
    const list = this.career.arrangements;
    this.screen(`
      <h1 class="dz-h1">Переложения</h1>
      <div class="dz-sub">Партию любого инструмента можно отдать другому: мелодию скрипок — валторнам, бас — фаготам. Октаву инструмент берёт сам.</div>
      ${list.map((a) => `<div class="dz-row"><button class="dz-btn" data-edit="${a.id}">${esc(a.name)}<small>${esc(pieceOf(a.piece)?.title ?? a.piece)}</small></button><button class="dz-btn" data-del="${a.id}" style="flex:0 0 70px">✕</button></div>`).join('') || '<p>Пока нет своих переложений.</p>'}
      <button class="dz-btn primary" data-a="new">Новое переложение</button>
      <button class="dz-btn" data-a="back">← В меню</button>`);
    for (const a of list) {
      this.on(`[data-edit="${a.id}"]`, () => void this.editArrangement(a));
      this.on(`[data-del="${a.id}"]`, () => {
        this.career.arrangements = this.career.arrangements.filter((x) => x !== a);
        saveCareer(this.career);
        this.arrangements();
      });
    }
    this.on('[data-a=new]', () => {
      const open = openPieces(this.career);
      const a: Arrangement = { id: `a${Date.now().toString(36)}`, name: `Моя редакция ${list.length + 1}`, piece: open[0] ?? 'ode', map: {} };
      void this.editArrangement(a, true);
    });
    this.on('[data-a=back]', () => this.title());
  }

  private preview: Autoplay | null = null;

  async editArrangement(a: Arrangement, fresh = false): Promise<void> {
    const open = openPieces(this.career);
    const score = await this.score(a.piece);
    const instrs = Object.keys(INSTR) as InstrId[];
    const rows = score.parts
      .map((p, i) => {
        const cur = a.map[i] ?? [p.instr];
        const opt = (sel: InstrId | '') =>
          `<option value="">— молчит —</option>${instrs.filter((x) => canPlay(p.instr, x)).map((x) => `<option value="${x}" ${x === sel ? 'selected' : ''}>${esc(INSTR[x].name)}</option>`).join('')}`;
        return `<tr><td>${esc(p.name || INSTR[p.instr].name)}</td><td><select data-p="${i}" data-k="0">${opt(cur[0] ?? '')}</select></td><td><select data-p="${i}" data-k="1">${opt(cur[1] ?? '').replace('— молчит —', '— без удвоения —')}</select></td></tr>`;
      })
      .join('');
    this.screen(`
      <h1 class="dz-h1">Переложение</h1>
      <label class="dz-field">Название <input data-f="name" maxlength="40" value="${esc(a.name)}"></label>
      <label class="dz-field">Пьеса <select data-f="piece" ${fresh ? '' : 'disabled'}>${PIECES.filter((p) => open.includes(p.id)).map((p) => `<option value="${p.id}" ${p.id === a.piece ? 'selected' : ''}>${esc(p.composer)}: ${esc(p.title)}</option>`).join('')}</select></label>
      <table class="dz-arr"><tr><th>Партия в партитуре</th><th>Кто играет</th><th>Удвоение</th></tr>${rows}</table>
      <div class="dz-row"><button class="dz-btn" data-a="listen">▶ Послушать начало</button><button class="dz-btn" data-a="reset">Как у автора</button></div>
      <button class="dz-btn primary" data-a="save">Сохранить</button>
      <button class="dz-btn" data-a="back">← К списку</button>`);
    const sync = () => {
      a.name = (this.el.querySelector('[data-f=name]') as HTMLInputElement).value.trim() || a.name;
      const map: Record<number, InstrId[]> = {};
      score.parts.forEach((p, i) => {
        const s0 = (this.el.querySelector(`[data-p="${i}"][data-k="0"]`) as HTMLSelectElement).value as InstrId | '';
        const s1 = (this.el.querySelector(`[data-p="${i}"][data-k="1"]`) as HTMLSelectElement).value as InstrId | '';
        const list = [s0, s1].filter(Boolean) as InstrId[];
        if (list.length !== 1 || list[0] !== p.instr) map[i] = list;
      });
      a.map = map;
    };
    (this.el.querySelector('[data-f=piece]') as HTMLSelectElement).onchange = (e) => {
      a.piece = (e.target as HTMLSelectElement).value;
      a.map = {};
      void this.editArrangement(a, fresh);
    };
    this.on('[data-a=listen]', async () => {
      sync();
      this.menuMusic(false);
      this.preview?.stop();
      const orch = this.orchestra();
      await orch.ctx.resume();
      const s = applyArrangement(score, a);
      const ap = new Autoplay(orch, s, { maxSec: 25, volume: 0.9 });
      this.preview = ap;
      await ap.preload(25);
      if (this.preview === ap) ap.start();
    });
    this.on('[data-a=reset]', () => {
      a.map = {};
      void this.editArrangement(a, fresh);
    });
    this.on('[data-a=save]', () => {
      sync();
      this.preview?.stop();
      if (!this.career.arrangements.includes(a)) this.career.arrangements.push(a);
      saveCareer(this.career);
      this.arrangements();
    });
    this.on('[data-a=back]', () => {
      this.preview?.stop();
      this.arrangements();
    });
  }
}

