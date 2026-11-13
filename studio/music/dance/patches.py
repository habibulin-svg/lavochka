"""Отбор пресетов Surge XT под роли кита: строй, октава, атака, «чистота» аккорда.

Каждый кандидат играет ноту A (бас — A2, остальные — A4) и аккорд Am; меряем:
  высоту (pyin) — класс высоты должен быть A, отклонение < 30 центов; сдвиг на октаву компенсируем transpose;
  атаку — время до половины огибающей (бас/клавиши/секвенции — быстро, пэды — как угодно);
  аккорд Am по хроме — пресеты с вшитыми интервалами (квинты, «аккорд одной клавишей») отсеиваются.
Пишет patches.json рядом: {патч: {ok, role, transpose, cents, attack, why}}.

G:/ai/venvs/music/Scripts/python.exe studio/music/dance/patches.py [--redo pad,keys]
"""
import json
import pathlib
import sys
from multiprocessing import Pool

import numpy as np

HERE = pathlib.Path(__file__).parent
OUT = HERE / 'patches.json'

CAND = {
    'bass': '''Basses/Bass 1|Basses/Bass 2|Basses/Bass 3|Basses/Bass 4|Basses/Bass 5|Basses/FM Bass 1|Basses/FM Bass 2|
Basses/FM Bass 3|Basses/FM Bass 4|Basses/FM Bass 5|Basses/FM Bass 6|Basses/FM Slap|Basses/Fingered|Basses/Mellow|
Basses/Plain|Basses/Rubber Bass|Basses/Smoothie|Basses/Square Bass|Basses/Squared|Basses/Stable|Basses/Sub 1|Basses/Sub 2|
Basses/Sub 3|Basses/Sub Square|Basses/Tacky 1|Basses/Tacky 2|Basses/Wide Bassline|Basses/Digibass|Basses/E-Bass|
Basses/Piano Bass|Basses/Deep End|Basses/Attacky|Basses/Schnell|Basses/WT Bass|Basses/Saw Lo-Fi|Basses/Theme|
Sequences/Acid Seq 1|Sequences/Acid Seq 2|Sequences/Acid Seq 3|Leads/Tight Bassline|
Cybersoda/Basses/Housy|Cybersoda/Basses/Moogish|Cybersoda/Basses/Synthwave|Cybersoda/Basses/Acid Bassline 2|
Cybersoda/Basses/Fancy|Cybersoda/Basses/Emulation|Damon Armani/Basses/House Fly|Damon Armani/Basses/Normal Bass|
Damon Armani/Basses/Analog Magic|Damon Armani/Basses/Little Finger|Damon Armani/Basses/Bam Bo Bass|
Damon Armani/Basses/Distinguished|Giana Brotherz/Basses/Dark Trancer|Giana Brotherz/Basses/X0X Bassline|
Giana Brotherz/Basses/Warm Square|Giana Brotherz/Basses/Rave Detuner|Giana Brotherz/Basses/Hoovin' Spot|
Giana Brotherz/Basses/Shaped Tri-Saw|Giana Brotherz/Basses/Sinus To Sinus|Giana Brotherz/Basses/VA Experience|
Inigo Kennedy/Basses/Bass 1|Inigo Kennedy/Basses/Bass 2|Inigo Kennedy/Basses/Bass 3|Inigo Kennedy/Basses/Bass 4|
Inigo Kennedy/Basses/Bass 5|Inigo Kennedy/Basses/Bass 6|Inigo Kennedy/Basses/Softer Bass|Inigo Kennedy/Basses/Squelch 1|
Inigo Kennedy/Basses/Squelch 2|Bluelight/Basses/Bass 1|Bluelight/Basses/Bass 2|Bluelight/Basses/Bass 3|
Bluelight/Basses/Bass 4|Bluelight/Basses/Bass 5|Bluelight/Basses/Bass 6|Bluelight/Basses/Bass 7|Bluelight/Basses/Bass 8|
Altenberg/Basses/Rounded|Altenberg/Basses/Useful|Altenberg/Basses/Boog|Emu/Basses/Beefy Boi|Emu/Basses/Soft Plucks|
Databroth/Basses/Moognt|A.Liv/Basses/Dynamo Square''',
    'pad': '''Pads/MKS-70 Warm Pad|Pads/Pad 1|Pads/Pad 3|Pads/Pad 4|Pads/Pad 5|Pads/Pad 6|Pads/Pad 7|Pads/Pad 8|Pads/Bright|
Pads/Choir Pad Thing|Pads/Ooh|Pads/Retro Choir|Pads/Robochoir 1|Pads/Synth Choir MW O-Ah|Pads/Sawteeth|Pads/Super|
Pads/Sunday|Pads/Still|Pads/Verb Pad|Pads/Winter Warmer|Pads/Legacy|Pads/Distant|Pads/Sparkly|Pads/Sprinkly|Pads/Bell Pad|
Pads/FM Pad|Pads/Ghost Pad|Pads/Safety|Pads/Subtle Comb Strings|Pads/Well|Pads/Growth|Pads/Louder|Pads/Moody Statement|
Polysynths/Juno-60 Strings|Polysynths/Poly Ahhs|Polysynths/Poly Lala|Polysynths/PPG Choir|Polysynths/PPG Dreams|
Polysynths/Oberheim Dreams|Polysynths/Violini Poly|Polysynths/Polymoog|Polysynths/Gentle|Polysynths/Slow Poly MW|
Polysynths/Ahh Polly|Polysynths/Korg Triton|
Argitoth/Pads/Classic Strings|Argitoth/Pads/Blue Pad|Argitoth/Pads/Subtle Pad|Argitoth/Pads/Saw-Square Pad|
Cybersoda/Pads/Strings|Cybersoda/Pads/Lush|Cybersoda/Pads/Utopia |Cybersoda/Pads/FM Pad|Cybersoda/Pads/Origin|
Damon Armani/Pads/Church Pad|Damon Armani/Pads/Paddington|Damon Armani/Pads/Freedom Message|Damon Armani/Pads/House Of Chords|
Dan Maurer/Pads/Lush PWM Strings|Dan Maurer/Pads/Galaxy Pad|Dan Maurer/Pads/Muted Square Pad|Dan Maurer/Pads/The Voice|
Dan Maurer/Pads/Touch String - Brass|Dan Maurer/Pads/Until Then|Databroth/Pads/Basic Pad|Databroth/Pads/Bright Strings|
Databroth/Pads/Warmbo|Databroth/Pads/Vintaged|Databroth/Pads/Polished Cheese|Emu/Pads/Ghostly Voices|
Giana Brotherz/Pads/Deep Choir|Giana Brotherz/Pads/OAH Choir|Giana Brotherz/Pads/Digitized Choir|Giana Brotherz/Pads/Moon and Water|
Giana Brotherz/Pads/Horizon Opens|Bluelight/Pads/Juno|Bluelight/Pads/Another Warm|Bluelight/Pads/Obie|Bluelight/Pads/Wool 1|
Bluelight/Pads/Wool 2|Bluelight/Pads/White Room|Altenberg/Pads/Journey|Altenberg/Pads/Stars|Altenberg/Pads/Unity|
Slowboat/Rhythms/Choir Pad|Luna/Synths/Poly Dreams|Luna/Synths/Sweet Dreams|Luna/Synths/Big Brightness Pad Release''',
    'keys': '''Keys/EP 1|Keys/EP 2|Keys/DX EP|Keys/House Organ|Keys/Organ 1|Keys/Organ 2|Keys/Organ 3|Keys/Soft Suitcase|
Keys/Digi Harpsi|Keys/Church|Keys/Artificial 1|Plucks/Piano Remains 1|Plucks/Piano Remains 2|Chords/Major 7 MkI|
Bluelight/Keys/Digi Piano|Bluelight/Keys/Pianoish|Bluelight/Keys/Treated Rhodes|Bluelight/Keys/Rotary Blue|
Cybersoda/Keys/Vintage EP|Cybersoda/Keys/Wurli|Cybersoda/Keys/Tape Keys|Cybersoda/Keys/Gentle|Cybersoda/Keys/Fake Bell|
Dan Maurer/Keys/FM Piano 1|Dan Maurer/Keys/FM Piano 2|Dan Maurer/Keys/FM Piano 3|Dan Maurer/Keys/FM Acoustic Piano 1|
Dan Maurer/Keys/FM Acoustic Piano 2|Dan Maurer/Keys/Forte Piano|Dan Maurer/Keys/Detuned Vibes|Dan Maurer/Keys/Bonita Keys|
Emu/Keys/Light EP|Emu/Keys/Trashion EP|Emu/Keys/Crispy Key|Giana Brotherz/Keys/Glassy E-Piano|Giana Brotherz/Keys/Moody Piano|
Giana Brotherz/Keys/Vintage Boost|Inigo Kennedy/Keys/Piano 1|Inigo Kennedy/Keys/Piano 2|Inigo Kennedy/Keys/Piano 3|
Inigo Kennedy/Keys/Piano 4|Inigo Kennedy/Keys/Piano 5|Inigo Kennedy/Keys/Melodic Organ|Jacky Ligon/Keys/Iso EP|
Jacky Ligon/Keys/EPleasantries|John Valentine/Keys/Grand Piano|
Giana Brotherz/Organs/Deep Houser|Giana Brotherz/Organs/Wanna B3|Giana Brotherz/Organs/Hammond's Hall|
Giana Brotherz/Organs/Lot Of Drawbars|Giana Brotherz/Organs/Late Night|Cybersoda/Organs/Clicky Organ|Luna/Organs/Leslied Organ|
Altenberg/Organs/Organish|Bluelight/Organs/C. Jack Dupree|LinnStrument MPE/Organs/Drawbar Organ 1''',
    'pluck': '''Plucks/Clean|Plucks/Trancy|Plucks/Nice Pluck 1|Plucks/Nice Pluck 2|Plucks/Nice Pluck 3|Plucks/Nice Pluck 4|
Plucks/Nice Pluck 5|Plucks/Saw Pluck|Plucks/FM Pluck|Plucks/Bell 1|Plucks/Bell 2|Plucks/Belle|Plucks/Happy|Plucks/Friendly|
Plucks/Pure Square|Plucks/Square Pop|Plucks/Simple PW|Plucks/Sync Pluck|Plucks/Magic Music Box|Plucks/Diamonds|Plucks/Light 1|
Plucks/Light 2|Plucks/Lighter|Plucks/Snap|Plucks/Woody|Plucks/Retrofit|Plucks/The 1980s|Plucks/Fantasy Bell|Plucks/Pulsii|
Plucks/Soft Sync Saw|Plucks/Mol|Plucks/Hybrid 1|Plucks/Hybrid 2|Plucks/ACME|Plucks/Cuto|Plucks/Convex|Plucks/Delay Dancer|
Sequences/Octave Arp|Sequences/Sync Arp|Sequences/Calm|Sequences/Bell Seq|Sequences/FM Seq|Sequences/Seq 1234|
Sequences/Sine Sequencer 1|Leads/Square|Leads/Sine Lead|
Damon Armani/Plucks/Trance Pluck|Damon Armani/Plucks/Happy Snappy|Damon Armani/Plucks/Fun Key|Damon Armani/Plucks/Like Piano|
Damon Armani/Plucks/Modern Bell|Damon Armani/Plucks/Glassier|Damon Armani/Plucks/Brass Pluck 1|Damon Armani/Plucks/Daft Punk|
Stefan Singer/Plucks/Trance Pluck|Stefan Singer/Plucks/Techno Stab|Stefan Singer/Plucks/Velo VA|Vincent Zauhar/Plucks/Anjunabeats 2007|
Vincent Zauhar/Plucks/Super Pluck|Vincent Zauhar/Plucks/Wooden Glass|Slowboat/Plucks/Classic Arp|Slowboat/Plucks/Little Pluck|
Rozzer/Plucks/JP80x0 Pluck|A.Liv/Plucks/Cute 1|A.Liv/Plucks/Cute 2|A.Liv/Plucks/Cute 3|Jacky Ligon/Plucks/Bright Pizzicato|
Jacky Ligon/Plucks/Wooden Pizz|Jacky Ligon/Plucks/Bright Short|Kinsey Dulcet/Plucks/No Frills Harp Pluck|
Kinsey Dulcet/Plucks/Wooden Block Pluck|Rare Earth/Plucks/Music Box|Vospi/Plucks/Flat Computer Marimba|Vospi/Plucks/Popcorn Pluck|
Zoozither/Plucks/Icy Pluck|TNMG/Plucks/Retro Wave|TNMG/Plucks/Millennium|Luna/Plucks/Sine Drops|Dan Maurer/Plucks/Galactic Harp|
Psiome Send Sound/Synths/Xylo Chill|Psiome Send Sound/Synths/Pluck Control|Slowboat/Synths/Bell Square 1|
Slowboat/Synths/Bell Square 2|Nick Moritz/Synths/Dream Drops|Nick Moritz/Synths/Moon Piano|Altenberg/Percussion/Tuned Wood|
Dan Maurer/Percussion/Synclav Bells|Dan Maurer/Percussion/Smooth Bells|Rare Earth/Percussion/Kalimba Attempt''',
    'stab': '''Polysynths/Anthemish 1|Polysynths/Anthemish 2|Polysynths/Anthemish 3|Polysynths/Tarnce|Polysynths/Super Jupiter|
Polysynths/Jupiter-8|Polysynths/Hugeness|Polysynths/Megasynth 1|Polysynths/Megasynth 2|Polysynths/Megasynth 3|
Polysynths/Megasynth 4|Polysynths/Smooth Stabs|Polysynths/Uni 1|Polysynths/Uni 2|Polysynths/Uni Saw FB|Polysynths/Fat Curtis|
Polysynths/Japanese Unison|Polysynths/Larger|Polysynths/Play Louder|Polysynths/Fast Poly|Polysynths/Prophet VS|
Polysynths/Xpander 1|Polysynths/Xpander 2|Polysynths/Zizzly Saw|Polysynths/Sine Saw|Polysynths/Old Square|Polysynths/Oldie|
Polysynths/Simplistic|Polysynths/Instant Coffee PWM|Polysynths/PWM Avenger|Polysynths/Analyse|Polysynths/Boss|Polysynths/1804|
Brass/Brassy|Brass/Synth Brass 1|Brass/Synth Brass 2|Brass/Synth Brass 3|Brass/JX-10 Double Brass|Brass/OB-8 Jump|Brass/Toto Brass|
Brass/Plastic Brass|Brass/Reso Brassy|Chords/Minor Chord Retro Stab|Chords/Maj-Min Saw|Chords/Maj-Min Stab|
Rozzer/Chords/Old Skool Detroit Minor Stab|Rozzer/Chords/6 Osc Stab|Rozzer/Chords/M25 Stab|
Giana Brotherz/Chords/Dual Ensemble|Giana Brotherz/Chords/Pluck Character|Giana Brotherz/Chords/Unison Minority|
Damon Armani/Plucks/Brass Synth|Damon Armani/Plucks/Main Brass|Cybersoda/Brass/Soft 80s Brass|Cybersoda/Brass/Brassy|
Luna/Brass/Fat Brass|Luna/Brass/Analog Brass|Luna/Brass/Wavetable Brass|Bluelight/Brass/Horns 1|Bluelight/Brass/Horns 2|
Jacky Ligon/Plucks/Orch Hit Short|Luna/Synths/Basic DCO Polysynth|Luna/Synths/Efficient Poly|Emu/Synths/80s Future Key''',
    'lead': '''Leads/Classic Lead 1|Leads/Classic Lead 2|Leads/Moogy Saw|Leads/Saw Octaves|Leads/Sync Lead|Leads/Crisp PWM|
Leads/Square|Leads/Sine Lead|Leads/Generic|Leads/Light|Leads/Simpler Times|Leads/Turbo|Leads/Turbo Solo|Leads/Butter|
Leads/Fairy|Leads/Fluff|Leads/Smoothness World Cup|Leads/Very Chorus|Leads/Violini Solo|Leads/Vocal Lead|Leads/Mundane|
Leads/Play Nice|Leads/Photon|Leads/Panda|Leads/Koala 1|Leads/Koala 2|Leads/Gliss Lead|Leads/Digi Portalead|Leads/Up Down|
Leads/Sweepy|Leads/Quick Basic|Leads/Eight|Leads/Formant Pulse|Leads/Kilkenny|Leads/Hippo|Leads/Pet|Leads/Owl|
Leads/Sine-Saw Acidish|Leads/Squelch|Leads/Acidofil|Leads/Rundfunk Funk|Leads/Scooped|Leads/Shanai|
Leads/Synth Guitar 1|Leads/Synth Guitar 2|Leads/Fundament|Leads/In The Distance|Leads/Long Stocking|
Giana Brotherz/Leads/Trance Lead|Damon Armani/Leads/Trance Lead|Cybersoda/Leads/Synthwave Lead''',
}


DEXED = 32  # голоса встроенного картриджа Dexed — роль 'dexed' (атака любая, записываем её для выбора)


def _cands():
    root3 = pathlib.Path('G:/ai/synths/vst/SurgeXTData/patches_3rdparty')
    rootf = pathlib.Path('G:/ai/synths/vst/SurgeXTData/patches_factory')
    out = []
    for role, s in CAND.items():
        for p in [x.strip() for x in s.replace('\n', '').split('|') if x.strip()]:
            base = rootf if p.count('/') == 1 else root3
            if (base / f'{p}.fxp').exists():
                out.append((role, p))
            else:
                print('нет пресета', p, file=sys.stderr)
    out += [('dexed', f'dexed:{k}') for k in range(DEXED)]
    return out


def screen(job):
    role, patch = job
    import librosa
    import synths
    sr = synths.SR
    note = 45 if role == 'bass' else 69
    try:
        a = synths.render(synths.instrument('t', patch), [(note, 105, 0, 1.6)], 2.4, 128).mean(0)
    except Exception as e:  # noqa: BLE001
        return patch, dict(ok=False, role=role, why=f'ошибка {e}')
    pk = float(np.abs(a).max())
    if pk < 1e-3:
        return patch, dict(ok=False, role=role, why='тишина')
    env = np.sqrt(np.convolve(a ** 2, np.ones(441) / 441, 'same'))
    attack = float(np.argmax(env > env.max() * 0.5) / sr)
    seg = a[int(0.08 * sr):int(1.5 * sr)]
    f0, v, _ = librosa.pyin(seg, fmin=25 if role == 'bass' else 60, fmax=500 if role == 'bass' else 2500, sr=sr,
                            frame_length=4096 if role == 'bass' else 2048)
    f0 = f0[v]
    res = dict(role=role, attack=round(attack, 3), voiced=round(len(f0) / max(len(v), 1), 2))
    if len(f0) < 5:
        res.update(ok=False, why='высота не определяется')
        return patch, res
    mid = float(np.median(librosa.hz_to_midi(f0)))
    off = int(round(mid - note))
    cents = round((mid - note - off) * 100)
    res.update(detected=round(mid, 2), offset=off, cents=cents)
    why = []
    if off % 12:
        why.append(f'строй сдвинут на {off} полутонов')
    if abs(cents) > 30:
        why.append(f'расстройка {cents} центов')
    lim = {'bass': 0.06, 'keys': 0.08, 'pluck': 0.06, 'stab': 0.16, 'lead': 0.15, 'pad': 1.2, 'dexed': 1.2}[role]
    if attack > lim:
        why.append(f'медленная атака {attack:.2f} с')
    res['transpose'] = -off if off % 12 == 0 and abs(off) <= 24 else 0
    if role != 'bass' and not why:
        # одна нота A: доля хромы вне A, E, C# (это гармоники 1–5) — вшитые интервалы и аккорды «одной клавишей»
        ch1 = librosa.feature.chroma_cqt(y=seg, sr=sr, hop_length=2048).mean(1)
        foreign = float(ch1[[p for p in range(12) if p not in (9, 4, 1)]].sum() / ch1.sum())
        res['foreign'] = round(foreign, 2)
        if foreign > 0.4:
            why.append(f'в одной ноте чужие звуки ({foreign:.0%})')
        # аккорд Am должен определяться как Am среди всех 24 трезвучий
        b = synths.render(synths.instrument('t', patch), [(m + res['transpose'], 100, 0, 1.6) for m in (57, 60, 64)], 2.0, 128)
        ch = librosa.feature.chroma_cqt(y=b.mean(0)[int(0.08 * sr):int(1.5 * sr)], sr=sr, hop_length=2048).mean(1)
        best, bs = None, -1
        for r0 in range(12):
            for q, third in (('', 4), ('m', 3)):
                t = np.zeros(12)
                t[[r0, (r0 + third) % 12, (r0 + 7) % 12]] = 1
                sc = float(ch @ t)
                if sc > bs:
                    best, bs = f'{r0}{q}', sc
        if best != '9m' and role != 'lead':  # лиды одноголосые — аккорд не проверяем
            why.append(f'аккорд Am слышится как {best}')
    res['ok'] = not why
    res['why'] = '; '.join(why)
    return patch, res


def main():
    old = json.loads(OUT.read_text(encoding='utf-8')) if OUT.exists() else {}
    redo = set(sys.argv[sys.argv.index('--redo') + 1].split(',')) if '--redo' in sys.argv else set()
    jobs = [j for j in _cands() if j[1] not in old or j[0] in redo]
    with Pool(6) as pool:
        for patch, r in pool.imap_unordered(screen, jobs):
            old[patch] = r
            print(f"{'ок ' if r['ok'] else 'НЕТ'} {r['role']:5} {patch:45} {r.get('why', '')}", flush=True)
    OUT.write_text(json.dumps(dict(sorted(old.items())), ensure_ascii=False, indent=1), encoding='utf-8')
    by = {}
    for p, r in old.items():
        by.setdefault(r['role'], [0, 0])[0 if r['ok'] else 1] += 1
    print(by)


if __name__ == '__main__':
    main()
