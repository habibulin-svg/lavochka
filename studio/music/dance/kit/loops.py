"""Лупы ударных (~120): по 8 стилей × 6 рисунков (от простого к полному) × 2 набора звуков + по 3 сбивки на стиль.
Имена — как в Dance eJay: «House Grp.1 Vers.3». Длина — 2 такта (32 шага), сбивки — 1 такт."""
from kit import sample
from kit import drumvoices as dv

G = 'loop'
PANS = {'h': 0.25, 'o': -0.15, 'r': 0.35, 't': -0.3, 'g': -0.4, 'G': 0.4, 'y': 0.2, 'w': 0.3, 'm': -0.25, 'b': 0.3}
GAINS = {'k': 1.0, 'c': 0.75, 's': 0.7, 'h': 0.45, 'o': 0.4, 'r': 0.35, 't': 0.35, 'y': 0.3, 'g': 0.45, 'G': 0.4,
         'w': 0.3, 'm': 0.35, 'b': 0.4, 'x': 0.5}


def x2(p):
    return p if len(p) == 32 else p * 2


FOUR = 'X...x...X...x...'
STYLES = {
    # стиль: (метка, 2 набора голосов, 6 рисунков, сбивки)
    'House': ('house', [
        {'k': dv.kick('F'), 'c': dv.clap('A'), 'h': dv.hat('A'), 'o': dv.ohat('A'), 'r': ('shaker', dv.SHAKERS['A'])},
        {'k': dv.kick('C'), 'c': dv.clap('C'), 'h': dv.hat('C'), 'o': dv.ohat('C'), 'r': ('shaker', dv.SHAKERS['C'])},
    ], [
        {'k': FOUR, 'o': '..x...x...x...x.'},
        {'k': FOUR, 'c': '....x.......x...', 'o': '..x...x...x...x.'},
        {'k': FOUR, 'c': '....x.......x...', 'o': '..x...x...x...x.', 'h': '-.-.-.-.-.-.-.-.'},
        {'k': FOUR, 'c': '....x.......x...', 'o': '..x...x...x...x.', 'r': '-x-x-x-x-x-x-x-x'},
        {'k': FOUR, 'c': '....x.......x..-' + '....x.......x...', 'o': '..x...x...x...x.', 'h': 'x-x-x-x-x-x-x-x-'},
        {'k': 'X...x...X...x..x' + 'X...x...X...x...', 'c': '....x.......x...', 'o': '..x...x...x...xx',
         'h': '-x-x-x-x-x-x-x-x', 'r': 'x.x.x.x.x.x.x.x.'},
    ], 0.08),
    'Euro': ('euro', [
        {'k': dv.kick('B'), 'c': dv.clap('B'), 's': dv.snare('A'), 'h': dv.hat('B'), 'o': dv.ohat('B')},
        {'k': dv.kick('J'), 'c': dv.clap('D'), 's': dv.snare('H'), 'h': dv.hat('G'), 'o': dv.ohat('E')},
    ], [
        {'k': FOUR, 'h': 'x.x.x.x.x.x.x.x.'},
        {'k': FOUR, 'c': '....X.......X...', 'h': 'x.x.x.x.x.x.x.x.'},
        {'k': FOUR, 'c': '....X.......X...', 's': '....x.......x...', 'h': 'x.x.x.x.x.x.x.x.', 'o': '..-...-...-...-.'},
        {'k': FOUR, 'c': '....X.......X...', 'h': 'xxx.xxx.xxx.xxx.', 'o': '..x...x...x...x.'},
        {'k': FOUR, 'c': '....X.......X...', 's': '....x.......x.x.' + '....x.......xxxx', 'h': 'x.x.x.x.x.x.x.x.',
         'o': '..x...x...x...x.'},
        {'k': 'X...x...X...x.x.', 'c': '....X.......X...', 's': '....x..x....x...', 'h': 'x-x-x-x-x-x-x-x-',
         'o': '..x...x...x...x.'},
    ], 0.0),
    'Trance': ('trance', [
        {'k': dv.kick('E'), 'c': dv.clap('F'), 'h': dv.hat('E'), 'o': dv.ohat('D'), 'y': ('cymbal', dv.RIDES['B'])},
        {'k': dv.kick('L'), 'c': dv.clap('G'), 'h': dv.hat('J'), 'o': dv.ohat('A'), 'y': ('cymbal', dv.RIDES['D'])},
    ], [
        {'k': FOUR, 'o': '..x...x...x...x.'},
        {'k': FOUR, 'o': '..x...x...x...x.', 'h': '-x--x--x-x--x--x'},
        {'k': FOUR, 'o': '..x...x...x...x.', 'h': '-x--x--x-x--x--x', 'c': '....-.......-...'},
        {'k': FOUR, 'o': '..x...x...x...x.', 'h': 'x-x-x-x-x-x-x-x-', 'c': '....x.......x...'},
        {'k': FOUR, 'o': '..x...x...x...x.', 'h': 'xxxxxxxxxxxxxxxx', 'c': '....x.......x...', 'y': 'x.x.x.x.x.x.x.x.'},
        {'k': FOUR, 'o': '..x...x...x...x.', 'h': '-x--x--x-x--x--x', 'c': '....x.......x...' + '....x.......x.xx',
         'y': '..x...x...x...x.'},
    ], 0.0),
    'Dream': ('dream', [
        {'k': dv.kick('A'), 'o': dv.ohat('F'), 'r': ('shaker', dv.SHAKERS['B']), 't': ('tamb', dv.TAMBS['A']),
         'c': dv.clap('E'), 'h': dv.hat('F')},
        {'k': dv.kick('K'), 'o': dv.ohat('B'), 'r': ('shaker', dv.SHAKERS['D']), 't': ('tamb', dv.TAMBS['C']),
         'c': dv.clap('H'), 'h': dv.hat('I')},
    ], [
        {'k': FOUR, 'r': '-x-x-x-x-x-x-x-x'},
        {'k': FOUR, 'o': '..x...x...x...x.', 'r': '-x-x-x-x-x-x-x-x'},
        {'k': FOUR, 'o': '..x...x...x...x.', 'r': '-x-x-x-x-x-x-x-x', 't': '....x.......x...'},
        {'k': FOUR, 'o': '..x...x...x...x.', 'h': 'x-x-x-x-x-x-x-x-', 'c': '....x.......x...'},
        {'k': FOUR, 'o': '..x...x...x...x.', 'r': '-x-x-x-x-x-x-x-x', 't': '....x.......x...', 'c': '....x.......x...'},
        {'k': FOUR, 'o': '..x...x...x...xx', 'h': 'x-x-x-x-x-x-x-x-', 't': '..x...x...x...x.', 'c': '....x.......x...'},
    ], 0.05),
    'Garage': ('house', [
        {'k': dv.kick('C'), 'c': dv.clap('A'), 'm': ('rim', dv.RIMS['A']), 'h': dv.hat('D'), 'o': dv.ohat('A')},
        {'k': dv.kick('H'), 'c': dv.clap('E'), 'm': ('rim', dv.RIMS['C']), 'h': dv.hat('H'), 'o': dv.ohat('F')},
    ], [
        {'k': 'X......x..X.....', 'c': '....X.......X...'},
        {'k': 'X......x..X.....', 'c': '....X.......X...', 'h': 'x.xxx.x.x.xxx.x.'},
        {'k': 'X......x..X.....', 'c': '....X.......X...', 'h': 'x.xxx.x.x.xxx.x.', 'o': '......x.......x.'},
        {'k': 'X.....x...X..x..', 'c': '....X.......X...', 'm': '..x..x....x..x.x', 'h': 'x.x.x.x.x.x.x.x.'},
        {'k': 'X......x..X.....' + 'X.....x...X..x..', 'c': '....X.......X...', 'm': '..x..x....x..x.x',
         'h': 'x.xxx.x.x.xxx.x.'},
        {'k': 'X......x..X.....', 'c': '....X.......X..x', 'm': '..x..x....x..x.x', 'h': 'x.xxx.x.x.xxx.x.',
         'o': '......x.......x.'},
    ], 0.12),
    'Breaks': ('euro', [
        {'k': dv.kick('A'), 's': dv.snare('C'), 'h': dv.hat('A'), 'o': dv.ohat('A'), 'c': dv.clap('B')},
        {'k': dv.kick('G'), 's': dv.snare('E'), 'h': dv.hat('C'), 'o': dv.ohat('C'), 'c': dv.clap('D')},
    ], [
        {'k': 'X.........x.....', 's': '....X.......X...'},
        {'k': 'X.........x.....', 's': '....X.......X...', 'h': 'x.x.x.x.x.x.x.x.'},
        {'k': 'X.x.......x.....', 's': '....X.......X...', 'h': 'x.x.x.x.x.x.x.x.'},
        {'k': 'X.x.......x.....' + 'X.........x..x..', 's': '....X..x.x..X...', 'h': 'x.x.x.x.x.x.x.x.'},
        {'k': 'X.x.......x.....', 's': '....X..-.-..X..-', 'h': 'x-x-x-x-x-x-x-x-', 'o': '..............x.'},
        {'k': 'X.x.......xx....', 's': '....X..x.x..X.x.', 'h': 'x-x-x-x-x-x-x-x-', 'c': '....x.......x...'},
    ], 0.1),
    'Hard': ('trance', [
        {'k': dv.kick('G'), 'c': dv.clap('D'), 'h': dv.hat('B'), 'o': dv.ohat('E'), 's': dv.snare('D')},
        {'k': dv.kick('E'), 'c': dv.clap('F'), 'h': dv.hat('G'), 'o': dv.ohat('D'), 's': dv.snare('B')},
    ], [
        {'k': FOUR, 'o': '..X...X...X...X.'},
        {'k': FOUR, 'o': '..X...X...X...X.', 'c': '....x.......x...'},
        {'k': FOUR, 'o': '..X...X...X...X.', 'c': '....x.......x...', 'h': 'xxxxxxxxxxxxxxxx'},
        {'k': 'X...x...X...x.xx', 'o': '..X...X...X...X.', 'c': '....x.......x...', 'h': 'x-x-x-x-x-x-x-x-'},
        {'k': FOUR, 'o': '..X...X...X...X.', 'c': '....x.......x...', 's': '..............xx' + '............xxxx',
         'h': 'xxxxxxxxxxxxxxxx'},
        {'k': 'X...x...X...x...' + 'X...x...X.x.x.x.', 'o': '..X...X...X...X.', 'c': '....x..x....x...',
         'h': 'x-x-x-x-x-x-x-x-'},
    ], 0.0),
    'Tribal': ('house', [
        {'k': dv.kick('D'), 'g': ('tom', dv.CONGAS['A']), 'G': ('tom', dv.CONGAS_HI['A']), 'b': ('tom', dv.BONGOS['A']),
         'w': ('cowbell', dv.COWBELLS['A']), 'r': ('shaker', dv.SHAKERS['A']), 'o': dv.ohat('A')},
        {'k': dv.kick('C'), 'g': ('tom', dv.CONGAS['C']), 'G': ('tom', dv.CONGAS_HI['C']), 'b': ('tom', dv.BONGOS['C']),
         'w': ('cowbell', dv.COWBELLS['B']), 'r': ('shaker', dv.SHAKERS['C']), 'o': dv.ohat('F')},
    ], [
        {'k': FOUR, 'g': 'x..x..x...x..x..'},
        {'k': FOUR, 'g': 'x..x..x...x..x..', 'G': '..x...x.x...x...'},
        {'k': FOUR, 'g': 'x..x..x...x..x..', 'G': '..x...x.x...x...', 'r': 'x-x-x-x-x-x-x-x-'},
        {'k': FOUR, 'b': 'x...x.x.x...x.x.', 'G': '..x...x.x...x...', 'w': '..x...x...x...x.'},
        {'k': FOUR, 'g': 'x..x..x...x..x..', 'b': '..x.....-.x...x-', 'o': '..x...x...x...x.', 'r': 'x-x-x-x-x-x-x-x-'},
        {'k': FOUR, 'g': 'x..x...x..x.x...x..x...x..x..x..', 'G': '..x.x.x...x...x...x.x.x...x.x...',
         'w': 'x..x..x...x.x...', 'o': '..x...x...x...x.'},
    ], 0.06),
}

FILLS = [
    ('Fill Snare', {'s': '--x-x-xxxxXXXXXX', 'k': 'X...............'}),
    ('Fill Toms', {'g': 'x.x.x.x.........', 'G': '........x.x.xxxx', 'k': '............x...'}),
    ('Fill Break', {'k': 'X.....x...x.....', 's': '....x..x.xx.xxxx', 'h': 'x.x.x.x.........'}),
]

for sname, (style, kits, grids, swing) in STYLES.items():
    for gi, grid in enumerate(grids):
        for vi, voices in enumerate(kits):
            g = {k: x2(v) for k, v in grid.items()}
            missing = [k for k in g if k not in voices]
            assert not missing, (sname, gi, missing)
            sample(G, f'{sname} Grp.{gi + 1} Vers.{vi + 1}', 2, grid=g, voices=voices, pans=PANS, gains=GAINS,
                   swing=swing, style=style)
    for fi, (fname, grid) in enumerate(FILLS):
        voices = dict(kits[fi % 2])
        voices.setdefault('s', dv.snare('A'))
        voices.setdefault('g', ('tom', dv.TOMS['mid']))
        voices.setdefault('G', ('tom', dv.TOMS['hi']))
        voices.setdefault('h', dv.hat('A'))
        sample(G, f'{sname} {fname}', 1, loop=False, grid=grid, voices=voices, pans=PANS, gains=GAINS, style=style)
