"""Образцы голосов «Заколдованной страны» для клонирования CosyVoice3: ElevenLabs v4 (RouterAI), ~10 с на голос.
python -X utf8 studio/voices/zs/make_refs.py  →  studio/voices/zs/<голос>.wav + cast.json (голос → образец и его текст).
Голоса — русские из библиотеки ElevenLabs (каталог json2video.com/ai-voices/elevenlabs/languages/russian), выбор мой."""
import json, pathlib, subprocess, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'runners'))
from tts_eleven import key, synth, FFMPEG  # noqa: E402

HERE = pathlib.Path(__file__).parent
CAST = {
    # голос: (voice_id ElevenLabs, кто это, текст образца)
    'nar': ('lxY8Pn0yWs1Ve9rBceah', 'Ivan Nazarov — рассказчик', 'Дорога уходит в тёмный лес. Над верхушками елей кружат вороны, а где-то вдали, за болотами, догорает закат.'),
    'villain': ('mOTbMAOniC3yoEvgo4bi', 'Evelon — злой маг', 'Вы пришли в мой замок без приглашения. Глупцы! Отсюда ещё никто не уходил живым.'),
    'sage': ('kuR1PV7xDOsP38QMSEvD', 'Arcad — добрый маг, мудрец', 'Не спешите, путники. Сила не в мече, а в терпении. Выслушайте меня, и я укажу вам дорогу.'),
    'oldman': ('2Zst4rvX5S2nMbiauLDN', 'Arty Grumson — старик', 'Эх, сынки… Давно тут никто не проходил. Садитесь к огню, расскажу вам, что за лесом творится.'),
    'king': ('RGy9Pi4dN4jZx6BL6lef', 'Tsar — король, вельможа', 'Я правитель этого города. Освободите мою землю от чудовищ, и награда будет достойной.'),
    'soldier': ('6A9D8WSMm4rFsg2DWFeE', 'Egor Gadzhiyev — стражник, воин', 'Стоять! Кто такие? Оружие на землю, иначе пеняйте на себя. Проход в город закрыт.'),
    'rogue': ('RLRdvNFwJJct2XZOgfzy', 'Mishka Yaponcik — разбойник, пройдоха', 'Ну что, дорогие мои, кошельки на стол. Да не бойтесь, мы люди честные — берём только деньги.'),
    'commoner': ('Vl27Cllkuw8BhyPqus2n', 'VASKO — простой мужик, трактирщик, гном', 'Заходите, гости дорогие! Ночлег у нас недорогой, похлёбка горячая, а пиво своё, домашнее.'),
    'young': ('m0OQuJtWCw1V23P0pQmG', 'Eugene — юноша, эльф', 'Спасибо вам! Я уж думал, никогда не выберусь из этой темницы. Возьмите меня с собой, я пригожусь.'),
    'monster': ('pM78bgjPVk0JXtaEnFoj', 'Nester Surovy (ниже на тон) — людоед, тролль', 'Кто топчет мой мост? Мясо пришло само… Сейчас я вас съем, косточки обглодаю!'),
    'imp': ('ZEchI3lWet1JsdNubYRY', 'Darth — гоблин, бес, клурк', 'Хи-хи! Попались, попались! А ну, угадайте загадку, а не то останетесь тут навсегда!'),
    'ghost': ('X0jd19oPQ0cVJcbpmAuX', 'Amid Hasan — призрак, нежить', 'Уходите… Это место проклято. Сто лет я брожу по этим залам и не могу найти покоя.'),
    'girl': ('GN4wbsbejSnGSa1AzjH5', 'Ekaterina — девушка, принцесса', 'Помогите, прошу вас! Колдун запер меня в этой башне. Только вы можете меня спасти.'),
    'lady': ('TPIitICAZ8CqlGZ81AKm', 'Elen Kuragina — королева, волшебница', 'Я знаю, зачем вы пришли. Но за мою помощь придётся заплатить, путники. Подумайте хорошенько.'),
    'crone': ('ZAs871VKqeAhWHigmemn', 'Lea Wander — старуха, гадалка', 'Ох, касатики, позолотите ручку — всю правду скажу. Ждёт вас дальняя дорога да лихая беда.'),
    'child': ('rSfuQoQ3FY8SVKeraMAp', 'Lunya — ребёнок', 'Дяденьки, а вы правда рыцари? А у вас настоящий меч? Пойдёмте, я покажу, где живёт дракон!'),
}
# свои поправки высоты (полутона) — чудовище ниже
PITCH = {'monster': -3}


def main():
    k = key()
    cast = {}
    for v, (vid, who, text) in CAST.items():
        mp3, wav = HERE / f'{v}.mp3', HERE / f'{v}.wav'
        if not mp3.exists():
            synth(k, text, vid, mp3)
        af = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse'
        if v in PITCH:
            r = 2 ** (PITCH[v] / 12)
            af = f'asetrate=44100*{r:.4f},aresample=44100,atempo={1 / r:.4f},' + af
        subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(mp3), '-af', af, '-ac', '1', '-ar', '24000', str(wav)], check=True)
        cast[v] = {'wav': wav.resolve().as_posix(), 'text': text, 'who': who, 'eleven': vid}
        print(v, 'ok')
    (HERE / 'cast.json').write_text(json.dumps(cast, ensure_ascii=False, indent=1), encoding='utf-8')


main()
