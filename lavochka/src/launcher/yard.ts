/* Лаунчер: вечерний двор 90-х. Фон рисуется процедурно (SVG), поверх — карточки игр. */
import { Sound } from '../core/audio';
import { codeKind, joinGame, loadSave } from '../core/session';
import { openSettings } from '../core/settings-ui';
import { onSettings, settings, store } from '../core/settings';
import { modal, mountScreen, showScreen, toast } from '../core/ui';
import { esc, h } from '../core/util';
import { SeededRng } from '../core/rng';
import { CATALOG, CATEGORIES, type CatalogEntry, type Category } from '../games/catalog';
import './yard.css';

const WAVE_NAMES: Record<number, string> = {
  1: 'скоро',
  2: 'в планах',
  3: 'в планах',
  4: 'в планах',
  5: 'в планах',
  6: 'в планах',
  7: 'в планах',
};

// ------------------------------------------------------------------ фон

function scene(): string {
  const rng = new SeededRng(1993);
  const r = () => rng.next();
  let s = `<svg class="yard-bg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="y-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#151938"/><stop offset=".35" stop-color="#2f2c5c"/>
      <stop offset=".62" stop-color="#7a4a6a"/><stop offset=".78" stop-color="#d9805e"/><stop offset=".9" stop-color="#f2b26e"/>
    </linearGradient>
    <radialGradient id="y-cone" cx=".5" cy="0" r="1">
      <stop offset="0" stop-color="#ffd98a" stop-opacity=".55"/><stop offset=".6" stop-color="#ffc56a" stop-opacity=".12"/><stop offset="1" stop-color="#ffc56a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="y-pool" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#ffcf7a" stop-opacity=".45"/><stop offset="1" stop-color="#ffcf7a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="y-glow" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#fff2c4"/><stop offset=".3" stop-color="#ffd27a" stop-opacity=".7"/><stop offset="1" stop-color="#ffb24a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="y-ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a2730"/><stop offset="1" stop-color="#141218"/></linearGradient>
    <filter id="y-chalk"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.5"/></filter>
  </defs>
  <rect width="1600" height="900" fill="url(#y-sky)"/>`;

  // звёзды
  for (let i = 0; i < 90; i++) {
    const x = r() * 1600;
    const y = r() * 330;
    const rr = r() * 1.3 + 0.3;
    s += `<circle class="${r() < 0.25 ? 'tw' : ''}" style="animation-delay:${(r() * 4).toFixed(2)}s" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${rr.toFixed(1)}" fill="#fff" opacity="${(0.4 + r() * 0.5).toFixed(2)}"/>`;
  }
  // месяц
  s += `<g transform="translate(1310,130)"><circle r="34" fill="#fff4d0" opacity=".95"/><circle cx="14" cy="-8" r="30" fill="#232650"/><circle r="60" fill="#fff4d0" opacity=".05"/></g>`;

  // дальние девятиэтажки
  let x = -40;
  while (x < 1650) {
    const w = 170 + r() * 160;
    const top = 290 + r() * 80;
    s += `<rect x="${x.toFixed(0)}" y="${top.toFixed(0)}" width="${w.toFixed(0)}" height="${(700 - top).toFixed(0)}" fill="#2a2d4c"/>`;
    // антенны
    for (let a = 0; a < 3; a++) {
      const ax = x + 20 + r() * (w - 40);
      s += `<path d="M${ax.toFixed(0)} ${top.toFixed(0)} v-22 m-10 6 h20 m-16 6 h12" stroke="#1d2038" stroke-width="2" fill="none"/>`;
    }
    for (let wy = top + 14; wy < 690; wy += 26) {
      for (let wx = x + 12; wx < x + w - 14; wx += 22) {
        const lit = r();
        if (lit < 0.3) {
          const tv = r() < 0.18;
          s += `<rect class="${tv ? 'tv' : r() < 0.06 ? 'blink' : ''}" style="animation-delay:${(r() * 6).toFixed(1)}s" x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="11" height="14" fill="${tv ? '#8fb3ff' : r() < 0.5 ? '#ffd27a' : '#f7b45c'}" opacity="${(0.55 + r() * 0.35).toFixed(2)}"/>`;
        } else s += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="11" height="14" fill="#1e2140"/>`;
      }
    }
    x += w + 10 + r() * 50;
  }

  // ближняя хрущёвка слева
  s += `<rect x="-20" y="430" width="760" height="330" fill="#3b3550"/>`;
  s += `<rect x="-20" y="424" width="760" height="10" fill="#2c2840"/>`;
  for (let fl = 0; fl < 5; fl++) {
    const wy = 450 + fl * 60;
    for (let i = 0; i < 12; i++) {
      const wx = 10 + i * 61;
      const lit = r() < 0.42;
      const tv = lit && r() < 0.2;
      const col = tv ? '#9ec0ff' : r() < 0.5 ? '#ffcf73' : '#f6a957';
      s += `<rect x="${wx}" y="${wy}" width="34" height="38" fill="${lit ? col : '#221f33'}" ${tv ? 'class="tv"' : ''} style="animation-delay:${(r() * 5).toFixed(1)}s"/>`;
      if (lit) {
        // занавески и форточка
        s += `<path d="M${wx} ${wy} q8 18 0 38 M${wx + 34} ${wy} q-8 18 0 38" stroke="#000" stroke-opacity=".25" stroke-width="6" fill="none"/>`;
        if (r() < 0.3) s += `<rect x="${wx + 8}" y="${wy + 16}" width="10" height="22" fill="#000" opacity=".35"/>`;
      }
      s += `<path d="M${wx + 17} ${wy} v38 M${wx} ${wy + 14} h34" stroke="#2c2840" stroke-width="2"/>`;
      if (i % 3 === 1 && fl > 0) {
        // балкон, иногда с бельём
        s += `<rect x="${wx - 8}" y="${wy + 38}" width="50" height="16" fill="#4a4462" stroke="#2c2840" stroke-width="2"/>`;
        if (r() < 0.4) for (let k = 0; k < 4; k++) s += `<rect x="${wx - 4 + k * 11}" y="${wy + 26}" width="8" height="${8 + r() * 8}" fill="${['#c9d6e8', '#e8b4b4', '#d8d0a0', '#a8c8a8'][k]}" opacity=".7"/>`;
      }
    }
  }
  // подъезд с козырьком и лампочкой
  s += `<rect x="300" y="690" width="70" height="70" fill="#1c1928"/><rect x="288" y="680" width="94" height="12" fill="#58506e"/>
        <circle cx="335" cy="698" r="4" fill="#fff0b0"/><circle cx="335" cy="698" r="40" fill="url(#y-glow)" opacity=".5"/>
        <rect x="308" y="700" width="54" height="60" fill="#3a2f22"/><text x="335" y="676" font-size="14" fill="#c8c0e0" text-anchor="middle" font-family="PT Sans, sans-serif">2</text>`;

  // тополь: ствол и крона из множества полупрозрачных «листовых» пятен
  const tree = (tx: number, ty: number, k: number) => {
    let t = `<g transform="translate(${tx},${ty}) scale(${k})"><path d="M0 0 C-4 -60 -2 -120 -6 -170 M-3 -100 C-20 -130 -34 -150 -40 -180 M-2 -120 C14 -150 26 -170 30 -200" stroke="#17141c" stroke-width="9" fill="none" stroke-linecap="round"/>`;
    for (let i = 0; i < 70; i++) {
      const yy = -150 - r() * 230;
      const spread = 30 + (1 - Math.abs(yy + 265) / 115) * 45;
      const xx = (r() - 0.5) * 2 * spread;
      const shade = ['#1c2a26', '#22322c', '#182420', '#2a3a30'][Math.floor(r() * 4)];
      t += `<ellipse cx="${xx.toFixed(0)}" cy="${yy.toFixed(0)}" rx="${(10 + r() * 14).toFixed(0)}" ry="${(14 + r() * 18).toFixed(0)}" fill="${shade}" opacity="${(0.55 + r() * 0.35).toFixed(2)}"/>`;
    }
    return t + '</g>';
  };
  s += tree(870, 770, 0.95);

  // гаражи
  const gx0 = 930;
  for (let i = 0; i < 7; i++) {
    const gx = gx0 + i * 100;
    const col = ['#3a3f4a', '#2f3640', '#40382f', '#2f3a33', '#383447', '#3d3d3d', '#33404a'][i];
    s += `<rect x="${gx}" y="610" width="96" height="150" fill="${col}"/><rect x="${gx - 2}" y="602" width="100" height="10" fill="#22242c"/>
      <rect x="${gx + 10}" y="630" width="76" height="130" fill="none" stroke="#1a1c22" stroke-width="3"/>
      <line x1="${gx + 48}" y1="630" x2="${gx + 48}" y2="760" stroke="#1a1c22" stroke-width="3"/>
      <text x="${gx + 48}" y="625" font-size="11" fill="#9aa" text-anchor="middle" font-family="PT Sans, sans-serif">${17 + i}</text>`;
    if (r() < 0.5) s += `<rect x="${gx + 20}" y="690" width="12" height="18" rx="2" fill="#0f1014"/>`;
  }
  // надписи мелом на гаражах
  const chalk = [
    ['ЦОЙ ЖИВ', 960, 690, -4, 30],
    ['Вася + Лена', 1160, 700, 3, 22],
    ['кто прочитал — тот…', 1330, 735, -2, 16],
    ['♥', 1500, 680, 0, 34],
  ] as const;
  s += `<g filter="url(#y-chalk)" font-family="Caveat, cursive" fill="#f2efe6" opacity=".78">`;
  for (const [t, cx, cy, rot, fs] of chalk) s += `<text x="${cx}" y="${cy}" font-size="${fs}" transform="rotate(${rot} ${cx} ${cy})">${t}</text>`;
  s += `</g>`;
  // кот на крыше гаража
  s += `<g transform="translate(1250,602)" fill="#0c0c10"><ellipse cx="0" cy="-12" rx="16" ry="12"/><circle cx="14" cy="-24" r="8"/><path d="M8 -30 l3 -9 l4 7Z M16 -30 l5 -8 l2 9Z"/><path d="M-16 -10 q-14 -4 -10 -22" stroke="#0c0c10" stroke-width="4" fill="none"/>
    <circle cx="12" cy="-25" r="1.6" fill="#d8e070"/><circle cx="18" cy="-25" r="1.6" fill="#d8e070"/></g>`;

  // земля
  s += `<rect x="0" y="758" width="1600" height="142" fill="url(#y-ground)"/>`;
  s += `<path d="M120 800 l40 14 l30 -6 l50 20 M900 830 l60 -10 l20 18 l70 4 M1300 790 l30 20 l60 -6" stroke="#0d0c11" stroke-width="2" fill="none"/>`;
  // классики мелом на асфальте
  s += `<g filter="url(#y-chalk)" stroke="#e8e4da" stroke-opacity=".5" fill="none" stroke-width="2.5" transform="translate(1040,800) skewX(-35) scale(1,.5)">
    <rect x="0" y="0" width="50" height="50"/><rect x="50" y="0" width="50" height="50"/><rect x="25" y="50" width="50" height="50"/><rect x="0" y="100" width="50" height="50"/><rect x="50" y="100" width="50" height="50"/></g>`;

  // фонарь и пятно света
  s += `<polygon points="560,470 380,880 760,880" fill="url(#y-cone)"/>
    <ellipse cx="560" cy="850" rx="240" ry="50" fill="url(#y-pool)"/>
    <rect x="606" y="460" width="8" height="420" fill="#16151c"/>
    <path d="M610 466 q-10 -26 -50 -20" stroke="#16151c" stroke-width="7" fill="none"/>
    <path d="M538 446 h44 l-8 16 h-28Z" fill="#232129"/>
    <circle cx="560" cy="466" r="60" fill="url(#y-glow)" class="lamp"/>`;

  // лавочка
  s += `<g transform="translate(410,800)">
    <rect x="0" y="0" width="300" height="14" rx="3" fill="#3f6b45"/><rect x="0" y="18" width="300" height="14" rx="3" fill="#457550"/>
    <rect x="6" y="-44" width="288" height="12" rx="3" fill="#3f6b45"/><rect x="6" y="-28" width="288" height="12" rx="3" fill="#457550"/>
    <path d="M24 -50 v100 M276 -50 v100" stroke="#1d1d22" stroke-width="10"/>
    <path d="M14 32 h30 M256 32 h30" stroke="#1d1d22" stroke-width="8"/></g>`;
  // семечки под лавочкой
  for (let i = 0; i < 40; i++) {
    const sx = 430 + r() * 260;
    const sy = 858 + r() * 26;
    s += `<ellipse cx="${sx.toFixed(0)}" cy="${sy.toFixed(0)}" rx="3" ry="1.6" fill="#0c0b0e" transform="rotate(${(r() * 180).toFixed(0)} ${sx.toFixed(0)} ${sy.toFixed(0)})"/>`;
  }
  // велосипед у лавочки
  s += `<g transform="translate(740,840)" stroke="#121117" stroke-width="5" fill="none"><circle cx="0" cy="0" r="34"/><circle cx="110" cy="0" r="34"/>
    <path d="M0 0 L40 -48 L90 -48 L110 0 M40 -48 L55 0 L90 -48 M55 0 L0 0 M90 -48 l-6 -18 h18 M40 -48 l-6 -10 h-14"/></g>`;
  s += `</svg>`;
  return s;
}

// ------------------------------------------------------------------ карточки

function card(g: CatalogEntry): HTMLElement {
  const ready = !!g.load;
  const save = ready && loadSave(g.id);
  const el = h(`<button class="game-card${ready ? ' ready' : ''}" style="--tint:${g.tint}">
      <span class="gc-pic">${
        g.thumb
          ? `<img src="${import.meta.env.BASE_URL}thumbs/${esc(g.thumb)}" alt="" loading="lazy">`
          : `<span class="gc-glyph">${esc(g.icon)}</span>`
      }</span>
      <span class="gc-icon">${esc(g.icon)}</span>
      <span class="gc-title">${esc(g.title)}</span>
      <span class="gc-sub">${esc(g.sub)}</span>
      ${g.variants?.length ? `<span class="gc-vars">${g.variants.map(esc).join(' · ')}</span>` : ''}
      <span class="gc-meta"><span class="gc-players">👥 ${esc(g.players)}</span>${save ? '<span class="gc-save">▶ партия</span>' : ''}</span>
      ${ready ? '' : `<span class="stamp">${esc(WAVE_NAMES[g.wave] ?? 'в планах')}</span>`}
    </button>`);
  el.onclick = () => {
    Sound.ui();
    if (ready) yard.openGame(g);
    else
      modal(
        `<h2>${esc(g.title)}</h2><p>${esc(g.sub)}.</p><p>Эту игру ещё строим — она появится в одной из следующих волн. Пока можно сыграть в то, что уже готово.</p>`,
        [{ text: 'Ладно', primary: true }]
      );
  };
  return el;
}

export const yard = {
  /** Назначается в main.ts: открыть экран игры. */
  openGame: (_g: CatalogEntry) => {},
  el: null as HTMLElement | null,

  mount() {
    const el = h(`<section class="yard">
      ${scene()}
      <div class="yard-shade"></div>
      <div class="yard-content">
        <header class="yard-top">
          <div class="yard-title">
            <h1>Вечером на лавочке</h1>
            <p>сборник дворовых игр</p>
          </div>
          <div class="yard-actions">
            <form class="join-form" title="Код комнаты от друга">
              <input class="code-input" maxlength="6" placeholder="КОД" autocomplete="off" spellcheck="false">
              <button class="btn primary">Войти</button>
            </form>
            <button class="btn" data-a="settings" title="Настройки">⚙ <span class="who"></span></button>
          </div>
        </header>
        <div class="yard-spacer"></div>
        <nav class="cats"></nav>
        <div class="cards"></div>
        <footer class="yard-foot">Играть можно за одним экраном, с ботами или с друзьями по коду комнаты.</footer>
      </div>
    </section>`);
    this.el = el;
    mountScreen('yard', el);

    const who = el.querySelector('.who') as HTMLElement;
    const upd = () => (who.textContent = settings.name || 'Настройки');
    upd();
    onSettings(upd);
    (el.querySelector('[data-a=settings]') as HTMLButtonElement).onclick = () => openSettings();

    const form = el.querySelector('.join-form') as HTMLFormElement;
    const code = form.querySelector('input') as HTMLInputElement;
    code.value = store.get('lastCode', '');
    code.oninput = () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
    form.onsubmit = (e) => {
      e.preventDefault();
      Sound.unlock();
      if (!codeKind(code.value)) return toast('Код комнаты — 5 или 6 знаков.');
      if (!settings.name) {
        const m = openSettings();
        toast('Сначала скажите, как вас зовут.');
        void m;
        return;
      }
      void joinGame(code.value);
    };

    const cats = el.querySelector('.cats') as HTMLElement;
    const sel = store.get<Category | 'all'>('cat', 'all');
    const mk = (id: string, title: string) => {
      const b = h<HTMLButtonElement>(`<button data-cat="${id}">${esc(title)}</button>`);
      b.onclick = () => {
        store.set('cat', id);
        this.renderCards(id as any);
      };
      cats.appendChild(b);
    };
    mk('all', 'Все игры');
    for (const c of CATEGORIES) mk(c.id, c.title);
    this.renderCards(sel);
  },

  renderCards(cat: Category | 'all') {
    const el = this.el!;
    el.querySelectorAll<HTMLButtonElement>('.cats button').forEach((b) => b.classList.toggle('on', b.dataset.cat === cat));
    const box = el.querySelector('.cards') as HTMLElement;
    box.innerHTML = '';
    const list = CATALOG.filter((g) => cat === 'all' || g.cat === cat).sort((a, b) => Number(!!b.load) - Number(!!a.load));
    for (const g of list) box.appendChild(card(g));
  },

  show() {
    if (!this.el) this.mount();
    else this.renderCards(store.get<Category | 'all'>('cat', 'all'));
    showScreen('yard');
  },
};
