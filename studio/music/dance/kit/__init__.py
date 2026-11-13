"""Описание кита «Dance With Me!» по группам (как у Dance eJay 1, см. docs/music-studio/DESIGN.md §1, §3).

Сэмпл — словарь: group, name, bars, loop, star (индекс аккорда 0..3 или None), family, theme, style
и источник звука: grid/voices (ударные), patch+notes (Surge), gen (синтетический эффект), reverse.
Модули групп при импорте вызывают sample()/theme(); all_samples() собирает весь кит в постоянном порядке.

Семья темы (theme): 4 аккорда `Имя *…****` по 2 такта, нарезки `Имя Cut *…****` по 1 такту,
вся последовательность `Имя Am-F-C-G` на 8 тактов, по желанию `Имя Reverse *…****`.
"""
from theory import CHORDS, STARS

GROUPS = ['loop', 'drum', 'bass', 'layer', 'keys', 'seq', 'synth', 'fx', 'rap', 'voice']
STYLES = ['euro', 'house', 'trance', 'dream']
SAMPLES = []
_names = set()


def sample(group, name, bars, loop=True, star=None, family=None, theme=None, style=None, **kw):
    assert bars in (1, 2, 4, 8), (name, bars)
    assert name not in _names, f'повтор имени {name}'
    assert style is None or style in STYLES, style
    _names.add(name)
    SAMPLES.append(dict(group=group, name=name, bars=bars, loop=loop, star=star, family=family, theme=theme,
                        style=style, **kw))


def theme(group, name, patch, fn, fx, style, cuts=True, full=True, reverse=False, bars=2, **kw):
    """fn(ci, beats) → ноты [(midi, vel, start_beat, dur_beats)] на аккорде ci.
    Описание должно давать одинаковое начало при любом beats (нарезка — это первый такт темы)."""
    for ci, st in enumerate(STARS):
        sample(group, f'{name} {st}', bars, star=ci, family=name, theme=name, style=style, patch=patch,
               notes=lambda beats, ci=ci: fn(ci, beats), fx=fx, **kw)
    if cuts:
        for ci, st in enumerate(STARS):
            sample(group, f'{name} Cut {st}', 1, star=ci, family=f'{name} Cut', theme=name, style=style, patch=patch,
                   notes=lambda beats, ci=ci: fn(ci, beats), fx=fx, **kw)
    if full:
        def notes(beats):
            per = beats // 4
            out = []
            for ci in range(4):
                out += [(m, v, t + ci * per, d) for m, v, t, d in fn(ci, per)]
            return out
        sample(group, f'{name} Am-F-C-G', 8, theme=name, style=style, patch=patch, notes=notes, fx=fx, **kw)
    if reverse:
        for ci, st in enumerate(STARS):
            sample(group, f'{name} Reverse {st}', bars, star=ci, family=f'{name} Reverse', theme=name, style=style,
                   patch=patch, notes=lambda beats, ci=ci: fn(ci, beats), fx=fx, reverse=True, **kw)


def neutral(group, name, patch, fn, fx, style, bars=2, cut=True, **kw):
    """Нейтральная линия без звёздочки (только звуки A и E) — ложится на любой аккорд."""
    sample(group, name, bars, theme=name, style=style, patch=patch, notes=fn, fx=fx, **kw)
    if cut and bars > 1:
        sample(group, f'{name} Cut', 1, theme=name, style=style, patch=patch, notes=fn, fx=fx, **kw)


_loaded = False


def all_samples():
    global _loaded
    if not _loaded:
        from kit import loops, drums, bass, layers, keys, seq, synth, fx  # noqa: F401
        _loaded = True
    return SAMPLES


def chord_name(star):
    return None if star is None else CHORDS[star][0]
