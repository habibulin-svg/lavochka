"""Эффекты (~80): лазеры, сирены, нарастания, спады, свипы, удары и звуки из FX-пресетов Surge. Без звёздочек:
тональные — на A/E или без строя."""
from kit import sample

G = 'fx'


def gen(name, bars, kind, gp=None, seed=1, style=None, fx='fx', reverse=False):
    sample(G, name, bars, loop=False, gen=kind, gp=gp or {}, seed=seed, style=style, fx=fx, reverse=reverse)


def surge(name, bars, patch, note=57, hold=None, style=None, fx='fx', reverse=False):
    sample(G, name, bars, loop=False, patch=patch, notes=lambda beats: [(note, 100, 0, hold or beats * 0.75)],
           fx=fx, style=style, reverse=reverse)


# нарастания и спады разной длины
for bars, k in ((1, 'Short'), (2, 'Mid'), (4, 'Long'), (8, 'Epic')):
    gen(f'Riser {k}', bars, 'riser', dict(oct=2 if bars < 4 else 3), seed=bars)
    gen(f'Noise Up {k}', bars, 'sweep', dict(up=True, swell=False), seed=10 + bars)
for bars, k in ((1, 'Short'), (2, 'Mid'), (4, 'Long')):
    gen(f'Downer {k}', bars, 'downer', dict(oct=4 if bars < 4 else 6), seed=20 + bars)
    gen(f'Noise Down {k}', bars, 'sweep', dict(up=False, swell=False), seed=30 + bars)
gen('Tone Riser', 4, 'riser', dict(noise=0.15, tone=0.5, f0=110, oct=3), seed=41)
gen('Tone Riser Short', 2, 'riser', dict(noise=0.15, tone=0.5, f0=220, oct=2), seed=42)
gen('Sweep Wave', 2, 'sweep', dict(up=True), seed=43)
gen('Sweep Back', 2, 'sweep', dict(up=False), seed=44)
gen('Wash', 2, 'noise_wash', dict(fc=2500), seed=45)
gen('Wash Bright', 4, 'noise_wash', dict(fc=7000), seed=46)
gen('Reverse Wash', 2, 'noise_wash', dict(fc=4000), seed=47, reverse=True)

# лазеры, пиу-пиу, писки
for i, (f0, oc, sq) in enumerate([(1800, 6, True), (2400, 5, True), (3000, 7, False), (1200, 4, True), (4000, 8, False)]):
    gen(f'Laser {"ABCDE"[i]}', 1, 'laser', dict(f0=f0, oct=oc, square=sq), seed=50 + i)
gen('Laser Burst', 1, 'laser', dict(f0=2000, oct=5, reps=4), seed=60)
gen('Laser Rain', 2, 'laser', dict(f0=2600, oct=6, reps=8), seed=61)
gen('Pew Pew', 1, 'laser', dict(f0=1500, oct=3, reps=2), seed=62)
gen('Bleep A-E', 1, 'bleep', dict(notes=[81, 88]), seed=63, fx='fx_dry')
gen('Bleep Morse', 2, 'bleep', dict(notes=[93, 93, 88], step=0.25), seed=64, fx='fx_dry')
gen('Bleep Slow', 2, 'bleep', dict(notes=[81, 76], step=1), seed=65)
gen('Robobat', 1, 'bleep', dict(notes=[105, 100, 93], step=0.125), seed=66, fx='fx_dry')

# удары
gen('Impact', 2, 'impact', dict(), seed=70)
gen('Impact Short', 1, 'impact', dict(decay=6), seed=71)
gen('Impact Boom', 4, 'impact', dict(decay=1.2), seed=72)
gen('Reverse Impact', 1, 'impact', dict(decay=4), seed=73, reverse=True)

# FX-пресеты Surge (нота A, держим ¾ сэмпла)
SURGE = [
    ('Space Cadet', 2, 'FX/Space Cadet'), ('Siren', 2, 'FX/Alarm'), ('Fireworks', 2, 'FX/Fireworks'),
    ('Aliens', 2, 'FX/Aliens'), ('Geiger', 1, 'FX/Geiger'), ('Radio Noise', 2, 'FX/Radio Noise'),
    ('Space Adventure', 4, 'FX/Space Adventure 1'), ('Space Adventure 2', 4, 'FX/Space Adventure 2'),
    ('Spooky Fish', 2, 'FX/Spooky Fish'), ('Vinyl', 2, 'FX/Vinyl'), ('Crackling', 2, 'FX/Crackling'),
    ('Unsettler', 2, 'FX/Unsettler'), ('Busy Bot', 2, 'FX/Busy'), ('Bork', 1, 'FX/Bork'), ('Die-ie-ie', 1, 'FX/Die-ie-ie'),
    ('Metal Pluck', 1, 'FX/Metal Pluck'), ('Holophoner', 2, "FX/Fry's Holophoner"), ('Health Care', 2, 'FX/Health Care'),
    ('Rather Low', 2, 'FX/Rather Low'), ('Alarm Siren', 2, 'Cybersoda/FX/Siren'), ('Plasma Gun', 1, 'Cybersoda/FX/Plasma Gun'),
    ('Sub Drop', 2, 'Cybersoda/FX/Sub Drop'), ('Tape Stop', 1, 'Cybersoda/FX/Tape Stop'),
    ('Alien Talk', 2, 'Cybersoda/FX/Alien Communication'), ('R2', 1, 'Giana Brotherz/FX/R2D2'),
    ('Pitch Drop', 2, 'Giana Brotherz/FX/Pitch Up Drop 1'), ('Pitch Drop 2', 2, 'Giana Brotherz/FX/Pitch Up Drop 2'),
    ('Alien Appears', 2, 'Giana Brotherz/FX/Alien Appears'), ('Stream Sparkle', 2, 'Giana Brotherz/FX/Stream Sparkle'),
    ('Level Up', 1, 'Kuniklo/FX/Level Up'), ('Discharge', 2, 'Kuniklo/FX/Discharge'), ('Uplifter', 4, 'Inigo Kennedy/FX/Uplifting Noise'),
    ('Saturn V', 4, 'Inigo Kennedy/FX/Saturn V'), ('Air Spray', 2, 'Inigo Kennedy/FX/Air Spray'),
    ('Swoosh', 2, 'Altenberg/FX/Swoosh'), ('Star Dust', 2, 'Dan Maurer/FX/Star Dust'), ('Flubber', 1, 'Dan Maurer/FX/Flubber'),
    ('Rezdrop', 2, 'Databroth/FX/Rezdrop'), ('Slapshot', 1, 'Emu/FX/Slapshot'), ('Jungle Bird', 2, 'Dan Maurer/FX/Summer Insects'),
]
for name, bars, patch in SURGE:
    surge(name, bars, patch)
surge('Reverse Space', 2, 'FX/Space Cadet', reverse=True)
surge('Reverse Sparkle', 2, 'Giana Brotherz/FX/Stream Sparkle', reverse=True)
