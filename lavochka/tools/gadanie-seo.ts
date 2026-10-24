/* Страницы гадания для пререндера (tools/prerender.ts): разделы (на таро, на игральных картах, справочник) и страница
 * на каждую карту — «Девятка Мечей — значение карты таро», «Шестёрка пик — значение в гадании». Тексты — из справочника
 * гадания (src/games/gadanie/data), без отдельного написания. */
import { isMajor, roman, suitOf, SUIT_TITLE, tarotFile, TAROT_SIZE } from '../src/cards/tarot';
import { cardPath, GADANIE_PATH, MODES } from '../src/games/gadanie/pages';
import { KARTY, KARTY36, kartaMeaning, TARO } from '../src/games/gadanie/reading';
import { spreadsOf, spreadSize } from '../src/games/gadanie/spreads';
import { cardTitle } from '../src/games/gadanie/card-names';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s: string, n = 160) => (s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…');
const YN = (v: number) => (v > 0 ? 'да' : v < 0 ? 'нет' : 'смотря как поступите');

export interface GadaniePage {
  path: string;
  name: string;
  crumbs: [string, string][];
  title: string;
  description: string;
  h1: string;
  intro: string;
  body: string;
  image?: string;
  priority: number;
}

const sec = (id: string) => `/${GADANIE_PATH}/${MODES.find((m) => m.id === id)!.path}/`;

export function gadaniePages(): GadaniePage[] {
  const out: GadaniePage[] = [];
  const ref = sec('znacheniya');
  const spreadList = (deck: 'taro' | 'karty') =>
    `<ul class="seo-links">${spreadsOf(deck).map((s) => `<li><b>${esc(s.title)}</b> — ${spreadSize(s)} ${spreadSize(s) === 1 ? 'карта' : spreadSize(s) < 5 ? 'карты' : 'карт'}: ${esc(s.sub.replace(/^\d+ карт\S* — /, ''))}</li>`).join('')}</ul>`;
  const taroLinks = (filter: (c: number) => boolean) =>
    `<ul class="seo-links seo-cols">${Array.from({ length: TAROT_SIZE }, (_, i) => i).filter(filter).map((c) => `<li><a href="${cardPath('taro', c)}">${esc(cardTitle('taro', c))}</a></li>`).join('')}</ul>`;

  out.push({
    path: sec('taro'),
    name: 'На таро',
    crumbs: [['На таро', sec('taro')]],
    title: 'Гадание на таро онлайн бесплатно — расклады на колоде Уэйта',
    description: 'Гадание на картах таро онлайн: карта дня, да или нет, прошлое-настоящее-будущее, подкова, кельтский крест, на отношения. Карты тянете сами, значения — сразу под рукой.',
    h1: 'Гадание на картах таро онлайн',
    intro: `<p>Колода Уэйта — Смит 1909 года: 22 старших аркана и 56 младших. Выберите расклад, задумайте вопрос и перетасуйте колоду —
      она ляжет веером, а карты вы тянете сами, по одной. Каждая встаёт на своё место и открывается; перевёрнутые читаются по-своему
      (их можно выключить). Значение каждой карты — сразу под рукой.</p>`,
    body: `<h2>Расклады</h2>${spreadList('taro')}<p><a href="${ref}">Значения всех карт таро</a></p>`,
    priority: 0.7,
  });
  out.push({
    path: sec('karty'),
    name: 'На игральных картах',
    crumbs: [['На игральных картах', sec('karty')]],
    title: 'Гадание на игральных картах онлайн — 36 карт, на короля, на желание',
    description: 'Гадание на обычных игральных картах онлайн бесплатно: на 36 картах по-русски — на короля и даму, на желание, «что было, что будет, чем сердце успокоится».',
    h1: 'Гадание на игральных картах (36 карт)',
    intro: `<p>Бабушкино гадание на атласной колоде: шестёрки — дороги, семёрки — разговоры, восьмёрки — встречи, девятки — чувства и надежды,
      десятки — исполнение, тузы — главное событие, а короли, дамы и валеты — люди. Короля или даму берут за загаданного человека.
      Карты из колоды тянете сами; совпадения — три девятки, четыре туза — считаются отдельно.</p>`,
    body: `<h2>Расклады</h2>${spreadList('karty')}<p><a href="${ref}">Значения всех 36 карт</a></p>`,
    priority: 0.7,
  });
  out.push({
    path: ref,
    name: 'Справочник',
    crumbs: [['Значения карт', ref]],
    title: 'Значения карт таро и игральных карт — прямо и перевёрнуто',
    description: 'Справочник значений: все 78 карт таро Уэйта — Смит (прямое и перевёрнутое значение, в отношениях, в делах, совет) и 36 игральных карт для гадания.',
    h1: 'Значения карт: таро и игральные',
    intro: `<p>Толкования всех карт — по книгам А. Э. Уэйта «Иллюстрированный ключ к таро» (1910) и С. Л. Мэзерса «Таро» (1888) и по
      народной традиции гадания на 36 картах. Пересказ — наш, своими словами.</p>`,
    body: `<h2>Старшие арканы</h2>${taroLinks(isMajor)}
${(['W', 'C', 'S', 'P'] as const).map((s) => `<h2>${SUIT_TITLE[s]}</h2>${taroLinks((c) => suitOf(c) === s)}`).join('\n')}
<h2>Игральные карты (36)</h2><ul class="seo-links seo-cols">${KARTY36.map((_, i) => `<li><a href="${cardPath('karty', i)}">${esc(cardTitle('karty', i))}</a></li>`).join('')}</ul>`,
    priority: 0.7,
  });

  // карты таро
  for (let c = 0; c < TAROT_SIZE; c++) {
    const m = TARO[c];
    const name = cardTitle('taro', c);
    const plainName = isMajor(c) ? m.name : name;
    const kind = isMajor(c) ? `${roman(c)} старший аркан` : `младший аркан, масть ${SUIT_TITLE[suitOf(c)!]}`;
    const path = cardPath('taro', c);
    out.push({
      path,
      name: plainName,
      crumbs: [['Значения карт', ref], [plainName, path]],
      title: `${plainName} таро — значение карты прямо и перевёрнуто`,
      description: clip(`${plainName} (${kind}) в таро: ${m.up.slice(0, 3).join(', ')}; перевёрнутая — ${m.down.slice(0, 3).join(', ')}. Значение в отношениях, в делах, совет и ответ «да/нет».`),
      h1: `${plainName} — значение карты таро`,
      intro: `<p><i>${esc(m.pic)}</i></p>`,
      image: `/tarot/rws/big/${tarotFile(c)}.webp`,
      body: `<h2>Прямое положение</h2><p><b>${esc(m.up.join(', '))}.</b></p><p>${esc(m.upText)}</p>
<h2>Перевёрнутая</h2><p><b>${esc(m.down.join(', '))}.</b></p><p>${esc(m.downText)}</p>
<h2>В отношениях</h2><p>${esc(m.love)}</p>
<h2>В делах и деньгах</h2><p>${esc(m.work)}</p>
<h2>Совет карты</h2><p>${esc(m.advice)}</p>
<h2>Да или нет</h2><p>Прямо — ${YN(m.yn[0])}, перевёрнутая — ${YN(m.yn[1])}.</p>
<p>${kind[0].toUpperCase() + kind.slice(1)} колоды Уэйта — Смит (рисунок Памелы Колман Смит, 1909). Толкование — по А. Э. Уэйту (1910) и С. Л. Мэзерсу (1888), пересказ «Лавочки».</p>
<p><a href="${sec('taro')}">Погадать на таро</a> · <a href="${ref}">Все карты</a>${c > 0 ? ` · <a href="${cardPath('taro', c - 1)}">← ${esc(cardTitle('taro', c - 1))}</a>` : ''}${c < TAROT_SIZE - 1 ? ` · <a href="${cardPath('taro', c + 1)}">${esc(cardTitle('taro', c + 1))} →</a>` : ''}</p>`,
      priority: 0.5,
    });
  }

  // игральные карты
  KARTY36.forEach((card, i) => {
    const m = kartaMeaning(i);
    const name = cardTitle('karty', i);
    const path = cardPath('karty', i);
    const person = card.r >= 11 && card.r <= 13 ? KARTY.persons[card.s + card.r] : '';
    out.push({
      path,
      name,
      crumbs: [['Значения карт', ref], [name, path]],
      title: `${name} — значение в гадании на картах`,
      description: clip(`${name} в гадании на 36 картах: ${m.short}. ${m.text}`),
      h1: `${name}: значение в гадании`,
      intro: `<p><b>${esc(m.short[0].toUpperCase() + m.short.slice(1))}.</b> ${esc(m.text)}</p>`,
      body: `${person ? `<h2>Кого означает</h2><p>${esc(person)}</p>` : ''}
<h2>Ключевые слова</h2><p>${esc(m.up.join(', '))}.</p>
<h2>Масть</h2><p>${esc(KARTY.suits[card.s])}</p>
<h2>Да или нет</h2><p>${YN(m.yn)[0].toUpperCase() + YN(m.yn).slice(1)}.</p>
<p><a href="${sec('karty')}">Погадать на игральных картах</a> · <a href="${ref}">Все карты</a></p>`,
      priority: 0.4,
    });
  });
  return out;
}
