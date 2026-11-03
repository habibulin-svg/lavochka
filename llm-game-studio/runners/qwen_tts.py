"""Озвучка: Qwen3-TTS — голос по описанию (VoiceDesign) → образец → клон (Base) на все фразы, голос не плывёт.

Шаг задаёт голоса:
  voices:
    kolyan: {describe: "Male, 27, raspy baritone, laconic... Russian.", sample: "Фраза образца 8–12 с", ref_audio: необязательно}
Единица: name, text, voice (имя голоса; один голос — можно не писать), seed.
Образцы — <run>/_voices/<голос>.wav (раз и навсегда; удалить — сделает заново).
Выход: <key>.wav + <key>.ogg (тишина срезана, −16 LUFS, Opus). Лицензия Apache-2.0.
"""
import pathlib
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import _lgs  # noqa: E402

AF = ('silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,'
      'areverse,loudnorm=I=-16:TP=-1.5:LRA=7')


def main():
    j = _lgs.job()
    import soundfile as sf
    import torch
    from qwen_tts import Qwen3TTSModel

    dirs = {pathlib.Path(d).name: pathlib.Path(d) for d in j['model_dirs']}
    dev = _lgs.device(j)
    lang = j.get('language', 'Russian')
    voices = j.get('voices') or {}
    vdir = pathlib.Path(j['voice_dir'])
    vdir.mkdir(parents=True, exist_ok=True)
    units = j['units']
    used = sorted({u.get('voice') or (next(iter(voices)) if voices else 'default') for u in units})

    def load(name):
        return Qwen3TTSModel.from_pretrained(str(dirs[name]), device_map=dev, dtype=torch.bfloat16, attn_implementation='sdpa')

    need = [v for v in used if not (vdir / f'{v}.wav').exists() and not (voices.get(v) or {}).get('ref_audio')]
    if need:
        print('образцы голосов:', ', '.join(need), flush=True)
        design = load('Qwen3-TTS-12Hz-1.7B-VoiceDesign')
        for v in need:
            spec = voices.get(v) or {}
            if not spec.get('describe'):
                sys.exit(f'голос {v}: нужен describe (описание голоса) или ref_audio')
            torch.manual_seed(7)
            wavs, sr = design.generate_voice_design(text=spec.get('sample') or 'Привет! Это проба голоса для игры.',
                                                    language=lang, instruct=spec['describe'])
            sf.write(str(vdir / f'{v}.wav'), wavs[0], sr)
            _lgs.output(vdir / f'{v}.wav', key=f'voice-{v}', item=v, voice_sample=True)
        del design
        torch.cuda.empty_cache()

    base = load('Qwen3-TTS-12Hz-1.7B-Base')
    prompts = {}
    for v in used:
        spec = voices.get(v) or {}
        ref = spec.get('ref_audio') or str(vdir / f'{v}.wav')
        prompts[v] = base.create_voice_clone_prompt(ref_audio=ref, ref_text=spec.get('sample') or spec.get('ref_text') or '')
    out = pathlib.Path(j['out'])
    for i, u in enumerate(units):
        _lgs.progress(i, len(units), u['key'])
        v = u.get('voice') or used[0]
        torch.manual_seed(int(u.get('seed', 1)))
        t0 = time.time()
        wavs, sr = base.generate_voice_clone(text=u['text'], language=lang, voice_clone_prompt=prompts[v])
        wav = out / f"{u['key']}.wav"
        sf.write(str(wav), wavs[0], sr)
        ogg = out / f"{u['key']}.ogg"
        _lgs.to_opus(wav, ogg, j['ffmpeg'], AF)
        _lgs.output(ogg, key=u['key'], item=u['name'], seed=u.get('seed'), text=u['text'], voice=v,
                    secs=round(len(wavs[0]) / sr, 1), took=round(time.time() - t0, 1))
        _lgs.progress(i + 1, len(units), u['key'])


if __name__ == '__main__':
    main()
