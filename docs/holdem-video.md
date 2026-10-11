# Видео-персонажи для холдема — промпты и требования к роликам

Как в Apple poker: соперник за столом — короткие видеоролики живого человека. Игра включает нужный ролик по ходу партии
(думает → колл → снова ждёт), фон вырезается шейдером, человек «сидит» за нашим 3D-столом.

## Как генерировать (чтобы человек был один и тот же во всех роликах)

1. **Сначала картинка-эталон** персонажа (любой генератор картинок или первый кадр видео) — промпт «Эталон» ниже.
2. **Потом каждый ролик — «из картинки в видео»** (image-to-video) с этим эталоном как **первым И последним кадром**
   (Kling: Start frame + End frame; Veo / Runway / Luma: first & last frame / keyframes). Тогда все ролики начинаются и
   заканчиваются одной позой — игра склеивает их без скачков.
3. Если модель не умеет последний кадр — в промпте уже сказано «возвращается в исходную позу», ролик чуть длиннее, я обрежу.

«Всё одним промптом» видеомодели пока не умеют: один ролик — одна реакция (5–10 с). Можно попробовать одним длинным дублем
(Sora 2 / Kling с продлением, 20–60 с) — все реакции подряд с паузой в нейтральной позе между ними; я разрежу сам. Но лицо
к концу длинного дубля «плывёт», поэтому надёжнее по отдельности.

## Технические требования (одинаковые для всех)

- Формат **1:1** (квадрат), 720p или 1080p, 24–30 кадров/с, 3–6 секунд, **без звука** (или звук отдельно — не обязателен).
- **Камера неподвижна** (locked-off tripod shot), без зума, без панорамы, без смены плана.
- Фон — **ровный хромакей-зелёный** (#00B140), без теней и складок; на человеке **нет зелёного** в одежде.
- Человек **сидит за столом**, виден **от пояса** вверх, локти и кисти лежат на краю стола внизу кадра. Стол тоже
  **зелёный хромакей** (его вырежем, руки останутся «на нашем столе»).
- Камера — спереди, **чуть выше глаз** человека, смотрит слегка сверху (как будто из-за стола напротив).
- Свет мягкий тёплый сверху (лампа над столом), без резких цветных бликов.
- **Без карт, фишек и предметов в руках** — карты и фишки рисует игра. Движения рук «как будто» (двигает невидимые фишки).
- Голова и тело всегда целиком в кадре, не выходят за край.

Имена файлов: `<персонаж>_<реакция>.mp4`, например `kolyan_raise.mp4`. Персонажи латиницей: vovka, lenka, seryoga, tanka,
dimon, kolyan, svetka, zheka, mihalych.

## Общий промпт (подставлять персонажа и реакцию)

> Photorealistic video, square 1:1, locked-off static camera on a tripod, no camera movement. {ПЕРСОНАЖ} sits at a card
> table, framed from the waist up, forearms and hands resting on the table edge at the bottom of the frame. Solid flat
> chroma-key green background (#00B140) and a chroma-key green table surface, evenly lit, no shadows on the background.
> Warm soft overhead light like a lamp above a poker table, Russia in the mid-1990s. Camera slightly above eye level,
> looking at the person from across the table. No cards, no chips, no objects in hands. {РЕАКЦИЯ} The person starts and
> ends in the same neutral pose: sitting upright, hands resting on the table, looking slightly down at the table.
> Realistic natural micro-movements, natural skin, cinematic but natural colors. No text, no subtitles, no logos.

## Персонажи ({ПЕРСОНАЖ})

| Файл | Кто | Промпт |
|---|---|---|
| vovka | Вовка, «пацан с района» | a Russian man about 25 years old, short buzz cut, slightly squinting cocky look, dark blue nylon tracksuit jacket with three white stripes on the sleeves zipped halfway, thin gold chain |
| lenka | Ленка, модница | a Russian woman about 22 years old, voluminous bleached permed curly hair, bright blue eyeshadow, pink lipstick, acid-wash denim jacket over a white top, big plastic earrings |
| seryoga | Серёга, шофёр | a Russian man about 32 years old, flat tweed cap, black leather jacket, grey turtleneck, three-day stubble, calm heavy gaze |
| tanka | Танька, продавщица | a Russian woman about 30 years old, big teased hair with a scrunchie, bright fuchsia sweater with shoulder pads, gold hoop earrings, lively smiling face |
| dimon | Димон, младший | a Russian guy about 19 years old, mullet haircut, striped navy-and-white sailor undershirt (telnyashka), skinny, restless and cheeky |
| kolyan | Колян, «новый русский» | a heavy-set Russian man about 38 years old, crew cut, thick neck, raspberry-red blazer over a black shirt, very thick gold chain, gold signet ring, smug look |
| svetka | Светка, бухгалтер | a Russian woman about 27 years old, dark sleek bob haircut, red lipstick, leopard-print blouse, thin gold necklace, sharp attentive look |
| zheka | Жека, студент | a Russian young man about 21 years old, round glasses, messy hair, knitted beige sweater with a reindeer pattern, shy nervous smile |
| mihalych | Михалыч, пенсионер с завода | a Russian man about 66 years old, grey bushy mustache, flat cap, worn grey jacket over a checkered flannel shirt, wrinkled kind but crafty face |

## Реакции ({РЕАКЦИЯ}) — по ролику на каждую

| Файл | Когда в игре | Промпт |
|---|---|---|
| idle | ждёт (крутится по кругу) | The person waits calmly, breathes, blinks, glances around the table at other players, slightly shifts in the chair. Subtle, seamless loop. |
| think | его ход, думает | The person thinks hard about a decision: frowns, rubs the chin with one hand, taps fingers on the table, looks down at the table and then up across it. |
| check | чек | The person taps the table twice with two fingers, saying "check" silently, then relaxes. |
| call | колл | The person nods, then slides one hand forward across the table as if pushing a small stack of chips toward the center, then pulls the hand back. |
| raise | рейз | The person smirks confidently, leans forward and pushes forward with one hand as if moving a big stack of chips to the center, holds a challenging gaze at the camera, then sits back. |
| allin | ва-банк | The person leans in, pushes forward decisively with both hands as if shoving all chips to the center, stares intensely and provocatively at the camera, then slowly sits back. |
| fold | пас | The person sighs, flicks one hand dismissively forward as if tossing cards away, leans back and crosses arms for a moment, then returns to the neutral pose. |
| win | выиграл раздачу | The person grins widely, raises a fist in small celebration, then rakes both hands toward themselves as if pulling a pile of chips in. |
| lose | проиграл крупно | The person freezes, closes eyes, rubs face with both hands in frustration, shakes head, exhales and slowly returns to the neutral pose. |
| look | смотрит свои карты | The person cups both hands on the table and peeks down at the space between them as if lifting the corners of two cards, keeps a poker face, then rests the hands. |
| bluff | (необязательно) блефует | The person keeps a stone poker face, very still, only eyes moving, a tiny barely visible smirk at the end. |

Итого на персонажа 10–11 роликов; на 9 персонажей ~95. Можно начать с 3–4 персонажей — остальные пока останутся 3D.

## Эталон (картинка)

> Photorealistic portrait photo, square 1:1. {ПЕРСОНАЖ} sits at a card table, framed from the waist up, forearms and hands
> resting on the table edge at the bottom of the frame, neutral relaxed pose, looking slightly down at the table. Solid
> flat chroma-key green background (#00B140) and chroma-key green table surface, evenly lit. Warm soft overhead light,
> mid-1990s Russia. Camera slightly above eye level. No cards, no chips, no objects. Natural skin, no text.

## Что я сделаю с роликами

Сожму в WebM/MP4 (~150–300 КБ на ролик), вырежу зелёный шейдером (с подавлением зелёной каймы), посажу на стул за
3D-столом с тенью, свяжу реакции с событиями партии (ход, пас, колл, рейз, ва-банк, выигрыш). Загрузка — только
персонажей, которые сидят за столом, и только в виде 3D.
