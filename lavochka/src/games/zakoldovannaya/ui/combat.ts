/* Бой: карточки опасностей (портрет, имя, раны; числа — если открыты), отряд, действия героя: удар, выстрел,
 * заклинание, бутылочка, отгон, святая вода и аконит, кол, бегство. Цель выбирается щелчком по карточке. */
import { esc } from '../../../core/util';
import { CLASSES, SPELL } from '../book';
import { fmtHp } from '../dice';
import type { View } from '../engine';
import { heroKd, meleeAttack, missileAttacks, type Hero } from '../hero';
import { MONSTER } from '../monsters';
import type { Act } from './book';
import { portrait } from './common';

const HURT = ['цел', 'ранен', 'тяжело ранен', 'еле жив'];
const PHASE: Record<string, string> = { volley: 'Залп до схватки', init: 'Кто бьёт первым', party: 'Бьют герои', foes: 'Бьют опасности', saves: 'Броски удачи' };

export class CombatView {
  el: HTMLElement;
  private target: number | null = null;
  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'zs-combat';
    parent.append(this.el);
  }

  render(v: View, seats: number[], act: Act, nameOf: (s: number) => string): void {
    const cm = v.combat;
    if (!cm) {
      this.el.hidden = true;
      this.target = null;
      return;
    }
    this.el.hidden = false;
    const foes = cm.foes;
    const alive = foes.filter((f) => !f.dead && !f.fled);
    if (this.target == null || !alive.some((f) => f.uid === this.target)) this.target = alive[0]?.uid ?? null;
    const foeCards = foes
      .map((f) => {
        const m = MONSTER[f.m];
        const nums = f.hp != null ? `<div class="zs-fnum">КД ${f.kd} · ОР ${fmtHp(Math.max(0, f.hp))}/${fmtHp(f.hpMax ?? 0)}${f.value ? ` · ${f.value} ИО` : ''}</div>` : '';
        const state = f.dead ? 'повержен' : f.fled ? 'исчез' : HURT[f.hurt];
        return `<button class="zs-foe${f.dead ? ' dead' : ''}${f.fled ? ' gone' : ''}${f.uid === this.target ? ' sel' : ''}" data-uid="${f.uid}" title="${esc(m?.text ?? '')}">${portrait(f.m, 'zs-foe-img')}<div class="zs-foe-n">${esc(f.name)}</div><div class="zs-foe-s">${state}${f.blind ? ' · ослеплён' : ''}${f.weak ? ' · ослаб' : ''}</div>${nums}</button>`;
      })
      .join('');
    const party = v.heroes
      .filter((h) => h.cls)
      .map((h) => {
        const fled = cm.fled.includes(h.seat);
        const turn = cm.queue.includes(h.seat);
        return `<div class="zs-ph${h.dead ? ' dead' : ''}${fled ? ' gone' : ''}${turn ? ' turn' : ''}"><b>${nameOf(h.seat)}</b><span>❤ ${fmtHp(Math.max(0, h.hp))}/${fmtHp(h.hpMax)} · КД ${heroKd(h, cm.buffs[h.seat])}</span>${fled ? '<i>убежал</i>' : ''}</div>`;
      })
      .join('') + v.party.allies.map((a) => `<div class="zs-ph ally"><b>${esc(a.name)}</b><span>❤ ${fmtHp(a.hp)}</span></div>`).join('') + cm.allies.filter((a) => !a.dead).map((a) => `<div class="zs-ph ally"><b>${esc(a.name)}</b><span>❤ ${fmtHp(a.hp)}</span></div>`).join('');
    this.el.innerHTML = `<div class="zs-cb-h">Бой · раунд ${cm.round} · ${PHASE[cm.phase] ?? ''}</div><div class="zs-foes">${foeCards}</div><div class="zs-party">${party}</div><div class="zs-cb-act"></div>`;
    this.el.querySelectorAll<HTMLButtonElement>('.zs-foe').forEach((b) => {
      b.onclick = () => {
        const uid = Number(b.dataset.uid);
        if (alive.some((f) => f.uid === uid)) {
          this.target = uid;
          this.render(v, seats, act, nameOf);
        }
      };
    });
    const box = this.el.querySelector('.zs-cb-act') as HTMLElement;
    for (const seat of seats) {
      const h = v.heroes.find((x) => x.seat === seat);
      if (!h || !cm.queue.includes(seat)) continue;
      this.actions(box, v, h, act, seats.length > 1 ? nameOf(seat) : '');
    }
  }

  private actions(box: HTMLElement, v: View, h: Hero, act: Act, who: string): void {
    const cm = v.combat!;
    const t = this.target;
    const row = document.createElement('div');
    row.className = 'zs-acts';
    if (who) row.innerHTML = `<div class="zs-who">${who}</div>`;
    const b = (label: string, a: Parameters<Act>[1], cls = '', title = '') => {
      const x = document.createElement('button');
      x.className = `btn ${cls}`;
      x.innerHTML = label;
      if (title) x.title = title;
      x.onclick = () => act(h.seat, a);
      row.append(x);
    };
    if (cm.phase === 'init') {
      b('🎲 Кто бьёт первым — бросить d6', { t: 'init' }, 'primary');
      if (h.spells.some((s) => s.id === 'iniciativa' && (s.left ?? 1) > 0)) b('✨ «Инициатива»', { t: 'init', spell: true });
    } else if (cm.phase === 'saves') {
      b('🎲 Бросок удачи', { t: 'save' }, 'primary');
    } else if (t != null) {
      const miss = missileAttacks(h);
      if (cm.phase === 'party') {
        const m = meleeAttack(h);
        b(`⚔ ${esc(m.name)}`, { t: 'attack', target: t }, 'primary', `урон ${m.dmg[0]}–${m.dmg[m.dmg.length - 1]}`);
      }
      miss.forEach((a, i) => b(`🏹 ${esc(a.name)}`, { t: 'shoot', i, target: t }));
      if (cm.phase === 'party') {
        for (const s of h.spells) {
          const d = SPELL[s.id];
          if (!d || (s.left != null && s.left <= 0)) continue;
          if (!/escape|repel|weaken|web|kill|fear|fireball|blind|buff|invis|phantom|heal/.test(d.kind)) continue;
          b(`✨ ${esc(d.name)}${s.left != null ? ` <small>×${s.left}</small>` : ''}`, { t: 'cast', id: s.id, ...(d.kind.startsWith('heal') ? { target: h.seat } : { target: t }) }, '', d.text);
        }
        for (const it of h.items) if (it.id === 'bottle' && it.bottle) b(`🧪 ${esc(itemName2(it))}`, { t: 'drink', bottle: it.bottle });
        if (h.cls && CLASSES[h.cls].turn) b(h.cls === 'mag' ? '✋ Отгон (каменные, оборотни)' : '✋ Отгон животных', { t: 'turn' });
        if (h.items.some((x) => x.id === 'holy_water')) b('💧 Святая вода', { t: 'repel', id: 'holy_water' });
        if (h.items.some((x) => x.id === 'aconite')) b('🌿 Аконит', { t: 'repel', id: 'aconite' });
        if (h.items.some((x) => x.id === 'stake')) b('🪵 Кол', { t: 'stake', target: t });
        if (!cm.noFlee) b('🏃 Бежать', { t: 'flee' });
      }
      b('Пропустить', { t: 'pass' }, 'small');
    }
    box.append(row);
  }
}

function itemName2(it: { bottle?: number; known?: boolean }): string {
  return it.known ? `Бутылочка ${it.bottle}` : 'Бутылочка';
}
