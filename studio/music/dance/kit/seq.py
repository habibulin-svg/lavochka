"""Секвенции (~200): арпеджио, мелодичные секвенции, «азбука Морзе» — 4 аккорда, нарезки, вся последовательность,
у части — Reverse; нейтральные линии на A/E ложатся на любой аккорд."""
import patterns as P
from kit import neutral, theme

G = 'seq'
THEMES = [  # имя, пресет, рисунок, эффект, стиль, обратные
    ('Happy Hyp', 'Plucks/Happy', P.arp('up', 69), 'seq', 'euro', False),
    ('Whirl-Pool', 'Plucks/Trancy', P.arp('trance', 69), 'seq', 'trance', True),
    ('Morse', 'Plucks/Pure Square', P.arp('octave', 69, pattern='x.x.xxx.x..xx.x.'), 'seq_dry', 'trance', False),
    ('Frogger', 'Plucks/Square Pop', P.arp('broken', 72, rate=0.25, pattern='x.xxx.xxx.xxx.x.'), 'seq', 'euro', False),
    ('Ice Drops', 'Plucks/Bell 1', P.arp('down', 76, rate=0.5), 'seq_wide', 'dream', True),
    ('Pizzicato', 'Plucks/Woody', P.arp('updown', 72, rate=0.25), 'seq_dry', 'dream', False),
    ('Moon Arp', 'Plucks/Nice Pluck 1', P.arp('climb', 64), 'seq', 'trance', False),
    ('Ping Pong', 'Plucks/Nice Pluck 2', P.arp('pingpong', 69, rate=0.25), 'seq_wide', 'trance', False),
    ('Music Box', 'Plucks/Magic Music Box', P.seq_melody(11, '8', 76, 91), 'seq_wide', 'dream', False),
    ('Robot Talk', 'Plucks/Simple PW', P.seq_melody(12, '16', 64, 79), 'seq_dry', 'euro', False),
    ('Sunrise', 'Plucks/Nice Pluck 3', P.seq_melody(13, 'sync', 69, 84), 'seq', 'trance', False),
    ('Disco Ball', 'Plucks/Diamonds', P.arp('thirds', 72, rate=0.25), 'seq', 'house', False),
    ('Clockwork', 'Plucks/FM Pluck', P.arp('up', 64, rate=0.25, pattern='xx.xx.xx.xx.xx.x'), 'seq_dry', 'house', False),
    ('Saw Runner', 'Plucks/Saw Pluck', P.arp('trance', 64, rate=0.25), 'seq', 'trance', False),
    ('Marimba Party', 'Psiome Send Sound/Synths/Xylo Chill', P.seq_melody(14, 'sync', 64, 79), 'seq_dry', 'house', False),
    ('Glass Steps', 'Plucks/Belle', P.arp('broken', 76, rate=0.5), 'seq_wide', 'dream', False),
    ('Retro Wave', 'TNMG/Plucks/Retro Wave', P.arp('updown', 67, rate=0.25), 'seq', 'euro', False),
    ('Starlight', 'Plucks/Lighter', P.seq_melody(15, '16', 72, 88), 'seq_wide', 'dream', False),
    ('Techno Stabber', 'Plucks/Hybrid 2', P.arp('octave', 64, rate=0.5), 'seq', 'trance', False),
    ('Bell Rain', 'Dan Maurer/Percussion/Smooth Bells', P.arp('down', 81, rate=0.25, pattern='x.x.x.xxx.x.x.xx'),
     'seq_wide', 'dream', False),
    ('Analog One', 'dexed:13', P.arp('up', 64, rate=0.25), 'seq', 'trance', False),
    ('Arp 2600', 'dexed:16', P.arp('trance', 69, rate=0.25), 'seq', 'euro', False),
    ('Chroma Pulse', 'dexed:4', P.seq_melody(16, 'sync', 64, 81), 'seq_dry', 'house', False),
]
for name, patch, fn, fx, style, rev in THEMES:
    theme(G, name, patch, fn, fx, style, reverse=rev)

NEUTRAL = [
    ('Morse Code A', 'Plucks/Pure Square', P.neutral_seq(21), 'seq_dry', 'trance'),
    ('Bleeper', 'Plucks/Square Pop', P.neutral_seq(22, (81, 88, 93), rate=0.25, density=0.5), 'seq', 'euro'),
    ('A-E Pulse', 'Plucks/Clean', P.neutral_seq(23, (57, 64, 69), rate=0.25, density=1.0), 'seq', 'trance'),
    ('Echo A', 'Plucks/Bell 2', P.neutral_seq(24, (69, 81), rate=0.5, density=0.6), 'seq_wide', 'dream'),
    ('Ticker', 'Plucks/Cuto', P.neutral_seq(25, (76, 81, 88), rate=0.25, density=0.7), 'seq_dry', 'house'),
    ('Space Pings', 'Plucks/Retrofit', P.neutral_seq(26, (81, 93), rate=0.5, density=0.5), 'seq_wide', 'dream'),
]
for name, patch, fn, fx, style in NEUTRAL:
    neutral(G, name, patch, fn, fx, style)
