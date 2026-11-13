"""Синтезаторы для сэмплов Lavochka Music Studio: Surge XT и Dexed через DawDreamer, без окна.

Плагины — G:/ai/synths/vst (Surge XT 1.3.4 portable, Dexed 1.1.0; GPL, звук на выходе — наш).
Пресет Surge (.fxp) грузится подменой состояния VST3: JUCE хранит его как XML с IComponent
в своём base64, а IComponent у Surge — это блок `sub3…` из .fxp.

Запуск: G:/ai/venvs/music/Scripts/python.exe
"""
import re
import struct

import dawdreamer as daw

VST = 'G:/ai/synths/vst'
SURGE = f'{VST}/SurgeXT.vst3'
DEXED = f'{VST}/Dexed.vst3'
PATCHES = f'{VST}/SurgeXTData/patches_factory'
PATCHES3 = f'{VST}/SurgeXTData/patches_3rdparty'
SR = 44100
_CH = '.ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+'


def _enc(b: bytes) -> str:
    """MemoryBlock::toBase64Encoding из JUCE: «<длина>.» + 6 бит на знак, младшими битами вперёд."""
    bits = len(b) * 8
    out = []
    for i in range(0, bits, 6):
        v = 0
        for k in range(6):
            j = i + k
            if j < bits and b[j >> 3] >> (j & 7) & 1:
                v |= 1 << k
        out.append(_CH[v])
    return f'{len(b)}.' + ''.join(out)


_engine = None
_template = None


def engine():
    global _engine
    if _engine is None:
        _engine = daw.RenderEngine(SR, 256)
    return _engine


def _surge_template():
    """XML состояния VST3 по умолчанию — в нём подменяем IComponent."""
    global _template
    if _template is None:
        import os
        import tempfile
        p = engine().make_plugin_processor('_tpl', SURGE)
        f = os.path.join(tempfile.gettempdir(), f'surge_tpl_{os.getpid()}.bin')
        p.save_state(f)
        d = open(f, 'rb').read()
        _template = d[8:].split(b'\0')[0].decode()
    return _template


def surge(name: str, patch: str):
    """Процессор Surge XT с пресетом patch: 'Basses/Bass 1' — заводской, 'Автор/Basses/Имя' — сторонний."""
    base = PATCHES if patch.count('/') == 1 else PATCHES3
    fxp = open(f'{base}/{patch}.fxp', 'rb').read()
    chunk = fxp[fxp.index(b'sub3'):]
    xml = re.sub(r'<IComponent>[^<]*</IComponent>', f'<IComponent>{_enc(chunk)}</IComponent>', _surge_template())
    body = xml.encode() + b'\0'
    import os
    import tempfile
    f = os.path.join(tempfile.gettempdir(), f'surge_{name}_{os.getpid()}.bin')
    open(f, 'wb').write(b'VC2!' + struct.pack('<I', len(body)) + body)
    p = engine().make_plugin_processor(name, SURGE)
    p.load_state(f)
    return p


def dexed(name: str, program: int | None = None):
    """Dexed (DX7). program — номер голоса 0..31 во встроенном картридже Dexed (параметр «Program»,
    нормированный k/31); заводских ROM1A у портативной сборки нет, голоса — из картриджа, вшитого в плагин."""
    p = engine().make_plugin_processor(name, DEXED)
    if program is not None:
        i = [x['name'] for x in p.get_parameters_description()].index('Program')
        p.set_parameter(i, program / 31)
    return p


def instrument(name: str, patch: str):
    """Пресет кита: 'dexed:13' — голос Dexed, иначе — пресет Surge."""
    if patch.startswith('dexed:'):
        return dexed(name, int(patch[6:]))
    return surge(name, patch)


LEAD = 0.5  # Surge применяет пресет в первых блоках — ноты сдвигаем на разгон и потом его отрезаем


def render(proc, notes, seconds, bpm=120):
    """notes: [(midi, vel, start_s, dur_s)] → стерео numpy (2, n) длиной seconds.
    bpm — темп хоста: по нему идут LFO и шаговые секвенсоры патча, синхронизированные с темпом.
    Разгон — целый такт, чтобы синхронные с темпом LFO стояли в фазе с тактом."""
    lead = 4 * 60 / bpm
    while lead < LEAD:
        lead *= 2
    proc.clear_midi()
    for n, v, t, d in notes:
        proc.add_midi_note(int(n), int(v), float(t) + lead, float(d))
    e = engine()
    e.set_bpm(float(bpm))
    e.load_graph([(proc, [])])
    e.render(seconds + lead)
    a = e.get_audio()
    k = int(round(lead * SR))
    return a[:, k:k + int(round(seconds * SR))]
