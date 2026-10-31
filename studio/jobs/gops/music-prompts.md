# ГОПС — промпты для генерации музыки (евроданс)

Модель: **ACE-Step 1.5** — DiT `acestep-v15-xl-sft` (4B) + языковая модель `acestep-5Hz-lm-4B` (режим thinking).
Общие настройки: 50 шагов, CFG 7.0, shift 1.0, только инструментал (`[Instrumental]`), выгрузка в RAM + INT8 (на 12 ГБ).
Образец звучания (`reference_audio`) задаёт тембр, сведение и характер, мелодию и ритм не переносит.
Темп и тональность — отдельными параметрами, не в тексте промпта (так советует документация ACE-Step).

Задания-источники: `studio/jobs/gops/10-eurodance-xl.yaml`, `11-eurodance-xl-rest.yaml`. Сиды: 101, 202, 303.
✅ — варианты, выбранные пользователем 2026-11-01.

---

## Меню — ✅ 101, 202, 303
- BPM 136 · A minor · 90 с · образец: Maxx — Get A Way (Airplay Mix)

```
1990s eurodance instrumental main theme, euphoric catchy saw lead melody, house piano chords, driving octave bass,
punchy kick, claps, rave stabs, breakdown with strings and a big build-up, polished radio mix, no vocals
```

## Выбор бригады — ✅ 202, 303
- BPM 132 · C minor · 60 с · образец: 3-O-Matic — Success

```
1990s eurodance instrumental loop for a team select screen, steady kick and offbeat bass groove,
warm organ-house chords, plucky synth arpeggio, claps, confident and cheeky, medium energy, no big drops, no vocals
```

## Бой, спокойный ход — ✅ 303
- BPM 136 · D minor · 90 с · образец: Culture Beat — Mr. Vain

```
dark 1990s eurodance instrumental, reduced arrangement for aiming and thinking, muted kick, filtered pulsing bass,
sneaky minor synth riff, sparse stabs, airy pads, tension without climax, medium-low energy, no vocals
```

## Бой, основной — не выбрано (взяты треки Pixabay)
- BPM 136 · E minor · 120 с · образец: 2 Unlimited — No Limit

```
1990s eurodance instrumental, hard punchy four-on-the-floor kick, offbeat bass, big hoover synth stabs,
bright detuned saw lead with a memorable hook, rolling hi-hats, snare roll build-ups into energetic drops,
polished loud club mix, arcade fighting energy, no vocals
```

## Внезапная смерть — не выбрано (взят Pixabay)
- BPM 145 · F minor · 60 с · образец: The Immortals — Mortal Kombat

```
aggressive 1990s techno-eurodance instrumental, relentless kick, dark hoover riff, alarm-like synth stabs,
fast arpeggios, constant snare rolls, urgent climactic tension, no vocals
```

## На время — не выбрано (взят Pixabay)
- BPM 150 · G minor · 60 с · образец: 2 Unlimited — Tribal Dance

```
fast 1990s eurodance rave instrumental for a race against the clock, bouncy kick, tribal percussion,
rapid piano stabs, racing synth arpeggio, frantic and fun, high energy, no vocals
```

## Победа — не выбрано (нужно переделать)
- BPM 136 · A major · 12 с · образец: 2 Unlimited — Get Ready For This

```
short triumphant 1990s eurodance victory jingle, big major-key synth fanfare over kick and bass,
ends on a sustained chord, no vocals
```

## Поражение — не выбрано (нужно переделать)
- BPM 110 · A minor · 10 с · образец: Culture Beat — Mr. Vain

```
short comic defeat jingle in 1990s eurodance style, synth melody slowing down and falling in pitch,
sad detuned synth, ends abruptly, no vocals
```

---

## Ранние партии (не понравились) — для истории

Партия 9 — ACE-Step turbo 2B + LM 1.7B, 8 шагов, без образцов (`09-eurodance.yaml`): те же ситуации, подписи с BPM внутри текста.
Партия 7 — первая проба не в евродансе (евроданс-меню, эстрада с аккордеоном, боевик-синт), `07-music.yaml`.
