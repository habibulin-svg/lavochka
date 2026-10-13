"""Перетаскивание фишек в «Звезде Африки» и «Беглых» — как в «Джио-Джанги».

Свою фишку можно взять и отпустить на подсвеченной клетке: у меток шага появился data-to
и data-move (шаг или перелёт), фишка получает курсор «рука» и обработчик перетаскивания.

Запуск из lavochka/:  python -I tools/views-drag.py
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def patch(path, pieces):
    s = io.open(path, encoding='utf8').read()
    done = []
    for old, new in pieces:
        if old in s:
            s = s.replace(old, new)
            done.append(True)
        else:
            done.append(False)
    io.open(path, 'w', encoding='utf8').write(s)
    return done


# ---------- «Звезда Африки» ----------
star = os.path.join(ROOT, 'src', 'games', 'star', 'view.ts')
star_pieces = [
    (
        "        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: sea ? 38 : 32, class: 'st-move' });",
        "        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: sea ? 38 : 32, class: 'st-move', 'data-to': to, 'data-move': 'step' });",
    ),
    (
        "        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 28, class: 'st-fly' });",
        "        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 28, class: 'st-fly', 'data-to': to, 'data-move': 'air' });",
    ),
    (
        """        over!.append(svg('circle', { cx: x, cy: c.y, r: PIECE_R, fill: SEATS[seat]?.color ?? '#888', class: 'st-piece' }));""",
        """        const el = svg('circle', { cx: x, cy: c.y, r: PIECE_R, fill: SEATS[seat]?.color ?? '#888', class: 'st-piece' });
        takeable(el, seat);
        over!.append(el);""",
    ),
    (
        "  /** Фишки по клеткам: на одной клетке разводим в стороны, чтобы было видно всех. */",
        """  /** Свою фишку можно взять и переставить на подсвеченную клетку — как в «Кинь-двине». */
  function takeable(el: SVGElement, seat: number) {
    const st = v!;
    const canMove = seat === actSeat && !st.over && (st.phase === 'start' || (st.phase === 'step' && st.left > 0));
    if (!canMove) return;
    el.setAttribute('class', el.getAttribute('class') + ' st-take');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const from = { x: e.clientX, y: e.clientY };
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointerup', up);
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6) return;
        const p = cam!.toImg(ev.clientX, ev.clientY);
        let best: Element | null = null;
        let bd = Infinity;
        for (const g of Array.from(over!.querySelectorAll('[data-move]'))) {
          const cc = CELLS[Number(g.getAttribute('data-to'))];
          const d = Math.hypot(cc.x - p.x, cc.y - p.y);
          if (d < bd) {
            bd = d;
            best = g;
          }
        }
        if (!best || bd > 90) return;
        const to = Number(best.getAttribute('data-to'));
        const kind = best.getAttribute('data-move');
        ctx?.act(seat, kind === 'air' ? { type: 'air', to } : { type: 'step', to });
      };
      document.addEventListener('pointerup', up, { once: true });
    });
  }

  /** Фишки по клеткам: на одной клетке разводим в стороны, чтобы было видно всех. */""",
    ),
]

# ---------- «Беглые» ----------
beglye = os.path.join(ROOT, 'src', 'games', 'beglye', 'view.ts')
beglye_pieces = [
    (
        "        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 26, class: 'bg-move' });",
        "        const g = svg('circle', { cx: CELLS[to].x, cy: CELLS[to].y, r: 26, class: 'bg-move', 'data-to': to, 'data-move': 'step' });",
    ),
    (
        """        over!.append(
          svg('image', {
            x: c.x + off - PIECE_R, y: c.y - PIECE_R, width: PIECE_R * 2, height: PIECE_R * 2,
            href: `/hodilki/buttons/${seat}.webp`, class: 'bg-piece',
          })
        );""",
        """        const el = svg('image', {
          x: c.x + off - PIECE_R, y: c.y - PIECE_R, width: PIECE_R * 2, height: PIECE_R * 2,
          href: `/hodilki/buttons/${seat}.webp`, class: 'bg-piece',
        });
        takeable(el, seat);
        over!.append(el);""",
    ),
    (
        "  function turnPoints(): CamPoint[] {",
        """  /** Свою фишку можно взять и переставить на подсвеченную клетку — как в «Кинь-двине». */
  function takeable(el: SVGElement, seat: number) {
    const st = v!;
    if (!(seat === actSeat && st.winner == null && st.phase === 'move' && st.left > 0)) return;
    el.setAttribute('class', el.getAttribute('class') + ' bg-take');
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const from = { x: e.clientX, y: e.clientY };
      const up = (ev: PointerEvent) => {
        document.removeEventListener('pointerup', up);
        if (Math.hypot(ev.clientX - from.x, ev.clientY - from.y) < 6) return;
        const p = cam!.toImg(ev.clientX, ev.clientY);
        let best = -1;
        let bd = Infinity;
        for (const g of Array.from(over!.querySelectorAll('[data-move]'))) {
          const to = Number(g.getAttribute('data-to'));
          const cc = CELLS[to];
          const d = Math.hypot(cc.x - p.x, cc.y - p.y);
          if (d < bd) {
            bd = d;
            best = to;
          }
        }
        if (best >= 0 && bd < 90) ctx?.act(seat, { type: 'step', to: best });
      };
      document.addEventListener('pointerup', up, { once: true });
    });
  }

  function turnPoints(): CamPoint[] {""",
    ),
]

CSS = {
    os.path.join(ROOT, 'src', 'games', 'star', 'star.css'): '.st-piece.st-take { cursor: grab; }\n.st-piece.st-take:active { cursor: grabbing; }\n',
    os.path.join(ROOT, 'src', 'games', 'beglye', 'beglye.css'): '.bg-piece.bg-take { cursor: grab; }\n.bg-piece.bg-take:active { cursor: grabbing; }\n',
}


def main():
    print('звезда:', patch(star, star_pieces))
    print('беглые:', patch(beglye, beglye_pieces))
    for path, css in CSS.items():
        s = io.open(path, encoding='utf8').read()
        if 'take' not in s:
            io.open(path, 'a', encoding='utf8').write(css)
            print('стили:', os.path.basename(path), 'правлены')
        else:
            print('стили:', os.path.basename(path), 'уже есть')


if __name__ == '__main__':
    main()
