"""Отдельные ударные (как «Kick A…I», «Hihat ×51» в Dance eJay): по 1–2 такта, каждый тембр в нескольких рисунках."""
from kit import sample
from kit import drumvoices as dv

G = 'drum'


def d(name, bars, grid, voices, loop=True, pans=None, gains=None, **kw):
    sample(G, name, bars, loop=loop, grid=grid, voices=voices, pans=pans or {}, gains=gains or {}, **kw)


# бочки: 12 тембров × 3 рисунка
for k in dv.KICKS:
    v = {'k': dv.kick(k)}
    d(f'Kick {k} 4-4', 1, {'k': 'X...x...X...x...'}, v)
    d(f'Kick {k} Double', 1, {'k': 'X...x...X...x.x.'}, v)
    d(f'Kick {k} Half', 1, {'k': 'X.......x.......'}, v)

# хлопки: 8 × 3
for k in dv.CLAPS:
    v = {'c': dv.clap(k)}
    d(f'Clap {k}', 1, {'c': '....X.......X...'}, v)
    d(f'Clap {k} Flam', 1, {'c': '....X......-X...'}, v)
    d(f'Clap {k} Offbeat', 1, {'c': '..x...x...x...x.'}, v)

# малые: 8 × 2 петли + 2 сбивки
for k in dv.SNARES:
    v = {'s': dv.snare(k)}
    d(f'Snare {k} Beat', 1, {'s': '....X.......X...'}, v)
    d(f'Snare {k} Ghost', 1, {'s': '....X..-.-..X..-'}, v)
    d(f'Snare {k} Fill', 1, {'s': '--x-x-xxxxXXXXXX'}, v, loop=False)
    d(f'Snare {k} Roll', 2, {'s': 'o.o.o.o.-.-.-.-.x-x-x-x-xxxxXXXX'}, v, loop=False)

# закрытые хэты: 10 × 5
HAT_PATS = {'8th': 'x.x.x.x.x.x.x.x.', '16th': 'x-x-x-x-x-x-x-x-', 'Offbeat': '..x...x...x...x.',
            'Accent': 'X-x-X-x-X-x-X-x-', 'Shuffle': 'x.xxx.xxx.xxx.xx'}
for k in dv.HATS:
    for pn, pat in HAT_PATS.items():
        d(f'Hihat {k} {pn}', 1, {'h': pat}, {'h': dv.hat(k)}, pans={'h': 0.2})

# открытые хэты: 6 × 3
for k in dv.OPEN_HATS:
    v = {'o': dv.ohat(k)}
    d(f'Open Hat {k}', 1, {'o': '..x...x...x...x.'}, v, pans={'o': -0.15})
    d(f'Open Hat {k} Lift', 1, {'o': '..x...x...x...xx'}, v, pans={'o': -0.15})
    d(f'Open Hat {k} Long', 2, {'o': '..x.......x.......x.......x...x.'}, v, pans={'o': -0.15})

for k, p in dv.SHAKERS.items():
    v = {'r': ('shaker', p)}
    d(f'Shaker {k}', 1, {'r': '-x-x-x-x-x-x-x-x'}, v, pans={'r': 0.35})
    d(f'Shaker {k} Swing', 1, {'r': 'x-xx-xx-xx-xx-xx'}, v, pans={'r': 0.35}, swing=0.15)
for k, p in dv.TAMBS.items():
    v = {'t': ('tamb', p)}
    d(f'Tambourine {k}', 1, {'t': '....x.......x...'}, v, pans={'t': -0.3})
    d(f'Tambourine {k} 8th', 1, {'t': '-.x.-.x.-.x.-.x.'}, v, pans={'t': -0.3})
for k, p in dv.RIDES.items():
    v = {'y': ('cymbal', p)}
    d(f'Ride {k}', 1, {'y': 'x.x.x.x.x.x.x.x.'}, v, pans={'y': 0.25})
    d(f'Ride {k} Offbeat', 1, {'y': '..x...x...x...x.'}, v, pans={'y': 0.25})
for k, p in dv.CRASHES.items():
    v = {'x': ('cymbal', p)}
    d(f'Crash {k}', 2, {'x': 'X' + '.' * 31}, v, loop=False)
    d(f'Crash {k} Reverse', 1, {'x': 'X' + '.' * 15}, v, loop=False, reverse=True)

# перкуссия
for k in dv.CONGAS:
    v = {'g': ('tom', dv.CONGAS[k]), 'G': ('tom', dv.CONGAS_HI[k])}
    pans = {'g': -0.4, 'G': 0.4}
    d(f'Conga {k}', 1, {'g': 'x..x..x...x..x..', 'G': '..x...x.x...x...'}, v, pans=pans)
    d(f'Conga {k} Latin', 2, {'g': 'x..x...x..x.x...x..x...x..x..x..', 'G': '..x.x.x...x...x...x.x.x...x.x...'}, v, pans=pans)
for k in dv.BONGOS:
    v = {'b': ('tom', dv.BONGOS[k]), 'B': ('tom', dv.BONGOS_HI[k])}
    pans = {'b': 0.3, 'B': -0.3}
    d(f'Bongo {k}', 1, {'b': 'x...x.x.x...x.x.', 'B': '..x.....-.x...x-'}, v, pans=pans)
    d(f'Bongo {k} Roll', 1, {'b': 'x.x.x.x.xxxxxxxx', 'B': '.x.x.x.x........'}, v, pans=pans, loop=False)
for k, p in dv.COWBELLS.items():
    v = {'w': ('cowbell', p)}
    d(f'Cowbell {k}', 1, {'w': '..x...x...x...x.'}, v, pans={'w': 0.2})
    d(f'Cowbell {k} Latin', 1, {'w': 'x..x..x...x.x...'}, v, pans={'w': 0.2})
for k, p in dv.RIMS.items():
    v = {'m': ('rim', p)}
    d(f'Rimshot {k}', 1, {'m': '...x..x....x..x.'}, v, pans={'m': -0.2})
    d(f'Rimshot {k} Garage', 1, {'m': '..x..x....x..x.x'}, v, pans={'m': -0.2})
for k, p in dv.CLAVES.items():
    v = {'l': ('clave', p)}
    d(f'Clave {k}', 2, {'l': 'x..x..x...x.x...' + '..x.x...x..x..x.'}, v, pans={'l': 0.3})
    d(f'Clave {k} Son', 2, {'l': 'x..x..x.....x.x.'}, v, pans={'l': 0.3})
for k, p in {'A': dict(), 'B': dict(length=0.2)}.items():
    v = {'n': ('snap', p)}
    d(f'Snap {k}', 1, {'n': '....x.......x...'}, v)
    d(f'Snap {k} Double', 1, {'n': '....x.......x..x'}, v)
for k, p in {'A': dict(), 'B': dict(f0=5000, f1=200, decay=35)}.items():
    v = {'z': ('zap', p)}
    d(f'Zap {k}', 1, {'z': '....x.......x...'}, v)
    d(f'Zap {k} Offbeat', 1, {'z': '..x...x...x...x.'}, v)
TOMV = {t: ('tom', p) for t, p in dv.TOMS.items()}
d('Tom Fill Down', 1, {'4': 'x.x.....', '3': '....x.x.........', '2': '........x.x.....', '1': '............xxxx'},
  {'4': TOMV['top'], '3': TOMV['hi'], '2': TOMV['mid'], '1': TOMV['lo']}, loop=False,
  pans={'4': 0.4, '3': 0.15, '2': -0.15, '1': -0.4})
d('Tom Fill Up', 1, {'1': 'x.x.............', '2': '....x.x.........', '3': '........x.x.....', '4': '............xxxx'},
  {'4': TOMV['top'], '3': TOMV['hi'], '2': TOMV['mid'], '1': TOMV['lo']}, loop=False,
  pans={'4': 0.4, '3': 0.15, '2': -0.15, '1': -0.4})
d('Tom Groove', 1, {'1': 'x.....x.........', '2': '...x......x.....', '3': '.........x...x..'},
  {'3': TOMV['hi'], '2': TOMV['mid'], '1': TOMV['lo']}, pans={'3': 0.3, '1': -0.3})
d('Tom Roll', 2, {'1': '................xxxxxxxxXXXXXXXX', '3': 'x.x.x.x.x.x.x.x.................'},
  {'3': TOMV['hi'], '1': TOMV['lo']}, loop=False)
