"""Бас (~120): темы по 9 сэмплов (4 аккорда, 4 нарезки, вся последовательность) + нейтральные педали."""
import patterns as P
from kit import neutral, theme

G = 'bass'
THEMES = [  # имя, пресет, рисунок, эффект, стиль
    ('Euro Offbeat', 'Basses/Bass 1', P.bass('offbeat'), 'bass', 'euro'),
    ('Hyper', 'Basses/Squared', P.bass('hyper'), 'bass', 'euro'),
    ('Pressure', 'Basses/Bass 3', P.bass('octave'), 'bass', 'euro'),
    ('Rolling', 'Basses/Sub 2', P.bass('rolling'), 'bass', 'trance'),
    ('Gallop', 'Giana Brotherz/Basses/Dark Trancer', P.bass('gallop'), 'bass', 'trance'),
    ('Warm Line', 'Altenberg/Basses/Rounded', P.bass('walk'), 'bass', 'dream'),
    ('Wet Line', 'Cybersoda/Basses/Moogish', P.bass('arp'), 'bass', 'dream'),
    ('House Pluck', 'Basses/FM Bass 1', P.bass('house'), 'bass', 'house'),
    ('Disco Octave', 'Basses/Fingered', P.bass('disco'), 'bass_dry', 'house'),
    ('Garage Sub', 'Basses/Sub 1', P.bass('garage'), 'bass', 'house'),
    ('Deep Pump', 'Cybersoda/Basses/Housy', P.bass('pump'), 'bass', 'house'),
    ('Tresillo', 'Damon Armani/Basses/Analog Magic', P.bass('tresillo'), 'bass', 'dream'),
    ('Acid Line', 'Cybersoda/Basses/Acid Bassline 2', P.acid(303), 'bass_acid', 'trance'),
    ('Synco Slap', 'Basses/FM Slap', P.bass('synco'), 'bass_dry', 'house'),
]
for name, patch, fn, fx, style in THEMES:
    theme(G, name, patch, fn, fx, style)

neutral(G, 'Acid Pedal', 'Giana Brotherz/Basses/X0X Bassline', P.acid_pedal, 'bass_acid', 'trance')
neutral(G, 'Pedal A Offbeat', 'Basses/Bass 2', P.pedal(33, '..x...x...x...x...x...x...x...x.'), 'bass', 'euro')
neutral(G, 'Pedal A Gallop', 'Giana Brotherz/Basses/X0X Bassline', P.pedal(33, '..xx..xx..xx..xx..xx..xx..xx..xx'),
        'bass', 'trance')
