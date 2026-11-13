"""Голоса ударных кита: синтез 808/909-типа с разными тембрами (бочки настроены в A1/E1 — в строе кита)."""

KICKS = {  # буква → параметры бочки
    'A': dict(f0=55, punch=140, sweep=30, decay=5.5, click=0.35, drive=1.8),           # классика 909
    'B': dict(f0=55, punch=200, sweep=45, decay=7.0, click=0.6, drive=2.5),            # жёсткая евро
    'C': dict(f0=55, punch=90, sweep=20, decay=3.5, click=0.15, drive=1.3, length=0.7),  # длинная 808
    'D': dict(f0=41.2, punch=120, sweep=25, decay=4.0, click=0.3, drive=2.0, length=0.6),  # низкая (E1)
    'E': dict(f0=55, punch=260, sweep=60, decay=9.0, click=0.8, drive=3.5, length=0.35),  # хард-транс
    'F': dict(f0=55, punch=110, sweep=35, decay=6.5, click=0.1, drive=1.2),            # мягкая хаус
    'G': dict(f0=55, punch=170, sweep=40, decay=5.0, click=0.45, drive=4.5),           # перегруженная
    'H': dict(f0=41.2, punch=160, sweep=30, decay=3.0, click=0.2, drive=1.6, length=0.8),  # гудящая
    'I': dict(f0=55, punch=80, sweep=50, decay=10.0, click=0.9, drive=2.0, length=0.25),  # щелчок-бочка
    'J': dict(f0=55, punch=220, sweep=28, decay=4.5, click=0.25, drive=2.8),           # «пам»
    'K': dict(f0=55, punch=130, sweep=22, decay=5.0, click=0.5, drive=1.9, length=0.5),
    'L': dict(f0=41.2, punch=240, sweep=50, decay=6.0, click=0.7, drive=3.0, length=0.45),
}
CLAPS = {
    'A': dict(), 'B': dict(lo=1000, hi=3500, taps=3, gap=0.012), 'C': dict(lo=700, hi=2200, taps=5, gap=0.008, tail=10),
    'D': dict(lo=1200, hi=5000, taps=4, gap=0.006, tail=22), 'E': dict(lo=600, hi=2000, taps=3, gap=0.015, tail=8, length=0.45),
    'F': dict(lo=1500, hi=6000, taps=2, gap=0.01, tail=25), 'G': dict(lo=900, hi=3000, taps=6, gap=0.007, tail=12),
    'H': dict(lo=800, hi=4000, taps=4, gap=0.011, tail=6, length=0.6),
}
SNARES = {
    'A': dict(), 'B': dict(tone=220, tone_mix=0.4, noise_lo=2500, decay=28), 'C': dict(tone=160, tone_mix=0.8, decay=16),
    'D': dict(tone=250, tone_mix=0.3, noise_lo=3000, noise_hi=12000, decay=35, length=0.15),
    'E': dict(tone=190, tone_mix=0.5, noise_lo=1200, noise_hi=7000, decay=12, length=0.4),
    'F': dict(tone=300, tone_mix=0.6, decay=40, length=0.12), 'G': dict(tone=175, tone_mix=0.7, noise_lo=1500, decay=20),
    'H': dict(tone=210, tone_mix=0.2, noise_lo=4000, noise_hi=14000, decay=25),
}
HATS = {
    'A': dict(), 'B': dict(decay=0.02, cut=9000), 'C': dict(decay=0.05, cut=6500, metal=0.3),
    'D': dict(decay=0.03, cut=8000, mult=1.3), 'E': dict(decay=0.015, cut=10000, metal=0.05),
    'F': dict(decay=0.045, cut=7000, mult=0.8, metal=0.25), 'G': dict(decay=0.025, cut=11000),
    'H': dict(decay=0.06, cut=5500, metal=0.4, mult=1.1), 'I': dict(decay=0.035, cut=8500, metal=0.0),
    'J': dict(decay=0.028, cut=7500, mult=1.6, metal=0.2),
}
OPEN_HATS = {
    'A': dict(decay=0.16), 'B': dict(decay=0.12, cut=8500), 'C': dict(decay=0.22, cut=6500, metal=0.3),
    'D': dict(decay=0.14, mult=1.3), 'E': dict(decay=0.1, cut=10000, metal=0.05), 'F': dict(decay=0.25, mult=0.8, metal=0.25),
}


def kick(k='A'):
    return ('kick', KICKS[k])


def clap(k='A'):
    return ('clap', CLAPS[k])


def snare(k='A'):
    return ('snare', SNARES[k])


def hat(k='A'):
    return ('hat', HATS[k])


def ohat(k='A'):
    return ('hat', OPEN_HATS[k])


SHAKERS = {'A': dict(), 'B': dict(lo=6000, hi=14000, decay=60), 'C': dict(lo=3000, hi=9000, attack=0.02, decay=30, length=0.13),
           'D': dict(lo=5000, hi=16000, attack=0.005, decay=80)}
TAMBS = {'A': dict(), 'B': dict(decay=9, length=0.35), 'C': dict(decay=22, freqs=(5400, 6900, 8300, 11200)),
         'D': dict(decay=12, freqs=(7000, 8100, 9600, 12000))}
RIDES = {'A': dict(decay=0.5, cut=4000, length=1.2, ride=0.5), 'B': dict(decay=0.35, cut=5000, length=0.9, ride=0.8),
         'C': dict(decay=0.7, cut=3000, length=1.5, ride=0.3), 'D': dict(decay=0.4, cut=6000, length=1.0, ride=1.0)}
CRASHES = {'A': dict(), 'B': dict(decay=1.2, cut=3000, length=3.5), 'C': dict(decay=0.5, cut=5000, length=2.0),
           'D': dict(decay=1.0, cut=2500, length=3.0), 'E': dict(decay=0.3, cut=4500, length=1.5),
           'F': dict(decay=1.6, cut=4000, length=4.0)}
CONGAS = {'A': dict(f0=220), 'B': dict(f0=196, decay=10), 'C': dict(f0=262, bend=40, decay=18)}
CONGAS_HI = {'A': dict(f0=330), 'B': dict(f0=294, decay=12), 'C': dict(f0=392, bend=40, decay=20)}
BONGOS = {'A': dict(f0=440, bend=80, decay=25, length=0.2), 'B': dict(f0=392, bend=60, decay=20, length=0.2),
          'C': dict(f0=523, bend=100, decay=30, length=0.15)}
BONGOS_HI = {'A': dict(f0=659, bend=80, decay=28, length=0.15), 'B': dict(f0=587, bend=60, decay=24, length=0.15),
             'C': dict(f0=784, bend=100, decay=32, length=0.12)}
COWBELLS = {'A': dict(), 'B': dict(f1=587, f2=880, decay=16), 'C': dict(f1=480, f2=720, decay=8)}
RIMS = {'A': dict(), 'B': dict(f0=1400, decay=70), 'C': dict(f0=2100, decay=120)}
CLAVES = {'A': dict(), 'B': dict(f0=2200, decay=30)}
TOMS = {'lo': dict(f0=110, bend=50, decay=9), 'mid': dict(f0=147, bend=55, decay=10), 'hi': dict(f0=196, bend=60, decay=11),
        'top': dict(f0=262, bend=60, decay=12)}
