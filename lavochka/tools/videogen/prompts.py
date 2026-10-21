"""Промпты для видео-персонажей холдема (см. docs/holdem-video.md) и картинок аркад. Их можно поправить в prompts*.json рядом с программой."""

TECH = (
    "Solid flat chroma-key green background (#00B140) and a chroma-key green table surface, evenly lit, "
    "no shadows on the background. Warm soft overhead light like a lamp above a poker table, Russia in the mid-1990s. "
    "Camera slightly above eye level, looking at the person from across the table. No cards, no chips, no objects in hands. "
    "No text, no subtitles, no logos."
)

IMAGE = (
    "Photorealistic portrait photo, square 1:1, shot on a 50mm lens. {person} sits at a card table, framed from the waist up, "
    "forearms and hands resting on the table edge at the bottom of the frame, neutral relaxed pose, looking slightly down "
    "at the table. Natural skin texture, realistic. " + TECH
)

VIDEO = (
    "Photorealistic video, square 1:1, locked-off static camera on a tripod, no camera movement, no zoom, no cuts. "
    "The person from the image sits at a card table, framed from the waist up. {action} "
    "The person starts and ends in the same neutral pose: sitting upright, hands resting on the table, looking slightly "
    "down at the table. Realistic natural micro-movements, natural skin. " + TECH
)

CHARACTERS = {
    "vovka": ("Вовка", "a Russian man about 25 years old, short buzz cut, slightly squinting cocky look, dark blue nylon tracksuit jacket with three white stripes on the sleeves zipped halfway, thin gold chain"),
    "lenka": ("Ленка", "a Russian woman about 22 years old, voluminous bleached permed curly hair, bright blue eyeshadow, pink lipstick, acid-wash denim jacket over a white top, big plastic earrings"),
    "seryoga": ("Серёга", "a Russian man about 32 years old, flat tweed cap, black leather jacket, grey turtleneck, three-day stubble, calm heavy gaze"),
    "tanka": ("Танька", "a Russian woman about 30 years old, big teased hair with a scrunchie, bright fuchsia sweater with shoulder pads, gold hoop earrings, lively smiling face"),
    "dimon": ("Димон", "a Russian guy about 19 years old, mullet haircut, striped navy-and-white sailor undershirt (telnyashka), skinny, restless and cheeky"),
    "kolyan": ("Колян", "a heavy-set Russian man about 38 years old, crew cut, thick neck, raspberry-red blazer over a black shirt, very thick gold chain, gold signet ring, smug look"),
    "svetka": ("Светка", "a Russian woman about 27 years old, dark sleek bob haircut, red lipstick, leopard-print blouse, thin gold necklace, sharp attentive look"),
    "zheka": ("Жека", "a Russian young man about 21 years old, round glasses, messy hair, knitted beige sweater with a reindeer pattern, shy nervous smile"),
    "mihalych": ("Михалыч", "a Russian man about 66 years old, grey bushy mustache, flat cap, worn grey jacket over a checkered flannel shirt, wrinkled kind but crafty face"),
}

REACTIONS = {
    "idle": ("ждёт", "The person waits calmly, breathes, blinks, glances around the table at other players, slightly shifts in the chair. Subtle, seamless loop."),
    "think": ("думает", "The person thinks hard about a decision: frowns, rubs the chin with one hand, taps fingers on the table, looks down at the table and then up across it."),
    "check": ("чек", "The person taps the table twice with two fingers, saying \"check\" silently, then relaxes."),
    "call": ("колл", "The person nods, then slides one hand forward across the table as if pushing a small stack of chips toward the center, then pulls the hand back."),
    "raise": ("рейз", "The person smirks confidently, leans forward and pushes forward with one hand as if moving a big stack of chips to the center, holds a challenging gaze at the camera, then sits back."),
    "allin": ("ва-банк", "The person leans in, pushes forward decisively with both hands as if shoving all chips to the center, stares intensely and provocatively at the camera, then slowly sits back."),
    "fold": ("пас", "The person sighs, flicks one hand dismissively forward as if tossing cards away, leans back and crosses arms for a moment, then returns to the neutral pose."),
    "win": ("выиграл", "The person grins widely, raises a fist in small celebration, then rakes both hands toward themselves as if pulling a pile of chips in."),
    "lose": ("проиграл", "The person freezes, closes eyes, rubs face with both hands in frustration, shakes head, exhales and slowly returns to the neutral pose."),
    "look": ("смотрит карты", "The person cups both hands on the table and peeks down at the space between them as if lifting the corners of two cards, keeps a poker face, then rests the hands."),
    "bluff": ("блефует", "The person keeps a stone poker face, very still, only eyes moving, a tiny barely visible smirk at the end."),
}

# ---------------------------------------------------------------- крупье
# Стоит за серединой дальнего края стола, лицом к нам. Карт и фишек в руках нет — их рисует игра (карты летят от крупье),
# крупье только показывает движения. Кадр тот же, что у игроков (от пояса, руки на краю стола), чтобы игра сажала его так же.

DEALER_TECH = (
    "Solid flat chroma-key green background (#00B140) and a chroma-key green table surface, evenly lit, "
    "no shadows on the background. Warm soft overhead light like a lamp above a poker table, a small private casino "
    "in Russia in the mid-1990s. Camera slightly above eye level, straight in front, looking at the dealer from across the table. "
    "No cards, no chips, no objects in hands. No text, no subtitles, no logos, no name badge."
)

DEALER_IMAGE = (
    "Photorealistic portrait photo, square 1:1, shot on a 50mm lens. {person} stands behind a card table as a casino "
    "croupier, framed from the waist up, centered, both hands resting palms down on the table edge at the bottom of the "
    "frame, neutral polite professional pose, looking straight ahead. Natural skin texture, realistic. " + DEALER_TECH
)

DEALER_VIDEO = (
    "Photorealistic video, square 1:1, locked-off static camera on a tripod, no camera movement, no zoom, no cuts. "
    "The croupier from the image stands behind a card table, framed from the waist up. {action} "
    "The croupier starts and ends in the same neutral pose: standing upright, both hands resting palms down on the table "
    "edge, looking straight ahead. Precise, smooth professional hand movements, realistic natural micro-movements, "
    "natural skin. " + DEALER_TECH
)

DEALERS = {
    "dealer": ("Крупье Марина", "a Russian woman about 28 years old, croupier of a 1990s casino: crisp white shirt, black waistcoat, black bow tie, dark hair pulled back in a neat bun, light makeup, calm polite slightly cool look"),
    "dealer_m": ("Крупье Аркадий", "a Russian man about 35 years old, croupier of a 1990s casino: crisp white shirt, black waistcoat, black bow tie, neatly combed hair with a side parting, thin mustache, calm polite look"),
}

DEALER_ACTIONS = {
    "idle": ("ждёт", "The croupier waits calmly, breathes, blinks, glances left and right at the players around the table, slightly adjusts the hands on the table. Subtle, seamless loop."),
    "hello": ("здоровается", "The croupier smiles politely, nods a greeting and makes a small welcoming gesture with one open palm toward the table."),
    "deal": ("раздаёт", "The croupier deals cards: the left hand is held as if holding a deck, the right hand repeatedly flicks quickly forward-left, forward, forward-right as if pitching cards across the table to the players, about eight quick pitches."),
    "flop": ("флоп", "The croupier sweeps the right hand from left to right low over the middle of the table as if spreading and turning over three cards in a row, then glances at them."),
    "card": ("тёрн/ривер", "The croupier taps the table once with two fingers, then with the right hand makes a short neat flipping motion in the middle of the table as if turning over one card, and glances at it."),
    "collect": ("собирает ставки", "The croupier reaches forward with both hands and smoothly rakes the empty table surface toward the middle as if gathering chips into one pile, then pats the empty spot."),
    "push_front": ("отдаёт банк нам", "The croupier slides both empty hands across the table as if pushing a pile of chips straight forward toward the camera, then gestures with an open palm toward the camera as if saying 'yours', with a slight polite smile."),
    "push_left": ("отдаёт банк влево", "The croupier slides both empty hands across the table as if pushing a pile of chips toward the left side of the frame, then gestures with an open palm to the left as if saying 'yours'."),
    "push_right": ("отдаёт банк вправо", "The croupier slides both empty hands across the table as if pushing a pile of chips toward the right side of the frame, then gestures with an open palm to the right as if saying 'yours'."),
    "point_front": ("ход — нам", "The croupier looks straight at the camera and gestures with an open palm toward the camera, politely inviting the viewer to make a move, then waits a moment."),
    "point_left": ("ход — слева", "The croupier turns the head to the left side of the frame and gestures with an open palm to the left, politely inviting a player there to act."),
    "point_right": ("ход — справа", "The croupier turns the head to the right side of the frame and gestures with an open palm to the right, politely inviting a player there to act."),
    "gather": ("собирает карты", "The croupier sweeps both hands across the table as if gathering cards from all around into one pile in front, then squares the imaginary pile with a couple of taps. Hands stay empty."),
    "allin": ("ва-банк", "The croupier raises the eyebrows slightly, impressed, gives a short respectful nod toward the camera, keeps a professional face."),
}

# ---------------------------------------------------------------- аркады (только картинки)
# Шарики, Клад, Яйца динозавров. Стиль «смешанный» (решение пользователя): фишки — глянцевые и яркие, как в казуальных играх
# нулевых; фоны и персонажи — двор 90-х (персонажи — советские игрушки). Фишки рисуются листом (все цвета на одной картинке —
# один стиль), на ровном хромакее; вырезает фон и режет лист на фишки уже сборщик ассетов в проекте.
# Запись: (название, промпт, соотношение сторон). Файлы — <папка>/<набор>/<id>.png.

GLOSSY = (
    "Polished casual puzzle game art in the style of classic 2000s PopCap games (Zuma, Bejeweled): glossy, saturated colors, "
    "crisp clean edges, strong specular highlights, soft inner glow, rendered 3D-like illustration, very readable at small size. "
)
YARD = (
    "Russia, the courtyard of Soviet five-storey apartment blocks in the mid-1990s. Realistic painterly illustration with rich "
    "natural textures, warm late-afternoon light, slightly nostalgic mood. "
)
TOY = "Realistic product-style render of an old Soviet-made children's toy from the 1980s, slightly worn, soft studio light. "
NO_TEXT = "No text, no letters, no numbers, no logos, no watermark."


def key(color: str) -> str:
    """Ровный фон под вырезание. Зелёное рисуем на пурпурном, остальное — на зелёном."""
    c = {"green": "chroma-key green (#00B140)", "magenta": "pure magenta (#FF00FF)"}[color]
    return (
        f"Isolated on a perfectly flat uniform solid {c} background, no gradient, no vignette, no shadow on the background, "
        "no floor, no reflections of the background color on the objects. "
    )


def sheet(n: int, what: str, bg: str) -> str:
    return (
        GLOSSY + f"A sprite sheet: exactly {n} separate {what}, arranged in one horizontal row, same size, same lighting from the "
        "top-left, evenly spaced with wide gaps, none touching each other or the image edges, each seen straight from the front. "
        + key(bg) + NO_TEXT
    )


def top(what: str) -> str:
    """Фон, на котором игра сама рисует поле: вид строго сверху, середина спокойная, чтобы фишки читались."""
    return (
        YARD + f"Strict top-down orthographic view (camera pointing straight down, no perspective, no horizon, no sky): {what} "
        "Even low-contrast texture in the middle of the frame so that game pieces drawn over it stay readable; more details "
        "toward the edges. No people, no animals. " + NO_TEXT
    )


def notebook(what: str) -> str:
    return (
        "Top-down photo, the paper fills the whole frame edge to edge (no table, no notebook cover visible): a single Soviet school notebook page with a light blue square grid (math notebook), slightly yellowed "
        f"paper, soft daylight. Drawn on it by a child with a blue ballpoint pen and colored pencils: {what} Leave the central "
        "area mostly empty grid for level markers. " + NO_TEXT
    )


SHARIKI = {
    "bg1": ("Фон: асфальт", top("old cracked grey asphalt of the yard with faded children's chalk doodles of a sun, flowers and a cat (pictures only, absolutely no writing, no digits, no hopscotch), a few yellow leaves, a bottle cap, edges bordered by grass and a curb."), "4:3"),
    "bg2": ("Фон: утоптанная земля", top("trampled bare earth of the yard with small pebbles, sparse patches of grass, plantain leaves and dandelions toward the edges, a puddle in one corner."), "4:3"),
    "bg3": ("Фон: осень", top("autumn yard ground covered with fallen maple leaves (yellow, orange, red) on dark wet asphalt, more leaves near the edges."), "4:3"),
    "marbles1": ("Шарики: красный, жёлтый, синий", sheet(3, "glass marbles with a twisted swirl inside (cat's-eye marbles), each marble entirely one color: a pure red marble, a pure yellow marble, a pure blue marble", "green"), "16:9"),
    "marbles2": ("Шарики: зелёный, фиолетовый, белый", sheet(3, "glass marbles with a twisted swirl inside (cat's-eye marbles), each marble entirely one color: a pure green marble, a pure purple marble, a pure milky-white marble", "magenta"), "16:9"),
    "frog": ("Лягушка-пушка", TOY + "Bird's-eye view photographed from directly overhead: a green rubber squeaky toy frog lying flat on its belly, we see only its back and the top of its head, legs spread to the sides, the head points to the top edge of the image with the wide-open mouth at the very top, two round bulging eyes on top of the head, perfectly symmetric left-right, no perspective. " + key("magenta") + NO_TEXT, "1:1"),
    "hole": ("Яма: открытый люк", YARD + "Strict top-down view of an open round sewer manhole in asphalt: a deep dark round hole with a rusty rim, the heavy cast-iron lid lying shifted to one side, centered in the frame, ground around fades out. " + key("green") + NO_TEXT, "1:1"),
    "map": ("Карта уровней", notebook("a winding dotted path of a rolling marble through a yard, little apartment blocks, a sandbox, a frog, a manhole, swings."), "3:4"),
}

KLAD = {
    "bg": ("Фон: песочница", top("a wooden children's sandbox: a thick frame of old painted planks (faded green and red paint, peeling) around a large square of smooth clean yellow sand that fills most of the frame; outside the frame — asphalt and grass."), "1:1"),
    "sand": ("Клетка: песок", "Seamless tileable texture, strict top-down view of smooth fine yellow sand of a children's sandbox, small even grain, soft light, low contrast. " + NO_TEXT, "1:1"),
    "dirt": ("Клетка: земля", "Seamless tileable texture, strict top-down view of dark brown damp packed earth with tiny pebbles and roots, low contrast. " + NO_TEXT, "1:1"),
    "stone": ("Камень: кирпич", "Realistic illustration, soft studio light. Strict top-down view of a chunk of an old red Soviet brick with chipped corners and bits of cement, square-ish shape, filling most of the frame. " + key("green") + NO_TEXT, "1:1"),
    "gems1": ("Сокровища 1–4", sheet(4, "treasures: a shiny gold coin with an embossed star, a faceted red ruby, a faceted green emerald, a faceted blue sapphire", "magenta"), "16:9"),
    "gems2": ("Сокровища 5–7", sheet(3, "treasures: a faceted purple amethyst, a big lustrous white pearl, a gold ring with a red stone", "green"), "16:9"),
    "specials": ("Спецфишки", sheet(3, "power-up items: a small metal children's shovel with a red wooden handle lying diagonally, a bundle of three red dynamite sticks with a lit sparkling fuse, a big glowing gold nugget", "green"), "16:9"),
    "map": ("Карта уровней", notebook("a pirate-style treasure map of a yard: dotted path, X marks, a sandbox, a shovel, apartment blocks, a dog."), "3:4"),
}

EGGS = {
    "bg1": ("Фон: площадка", YARD + "Front view of a Soviet children's playground at dusk: an old concrete dinosaur sculpture painted green, metal climbing frames, tall ferns and overgrown grass in the foreground at the bottom, apartment block windows glowing in the distance. The upper and middle part is a calm, slightly blurred, low-contrast area (game pieces are drawn over it). No people. " + NO_TEXT, "2:3"),
    "bg2": ("Фон: заросли", YARD + "Front view of a wild overgrown corner of the yard behind garages: huge burdock leaves and ferns at the bottom, an old wooden fence, misty soft light; the upper and middle part is calm and low-contrast. No people. " + NO_TEXT, "2:3"),
    "bg3": ("Фон: вечер", YARD + "Front view of the yard late in the evening: dark blue sky, a single street lamp, silhouettes of trees and a concrete dinosaur on the playground at the bottom, warm windows; the upper and middle part is calm and low-contrast. No people. " + NO_TEXT, "2:3"),
    "eggs1": ("Яйца: зелёное, синее, красное", sheet(3, "dinosaur eggs standing upright, slightly oval, with darker irregular spots: a green egg, a blue egg, a red egg", "magenta"), "16:9"),
    "eggs2": ("Яйца: жёлтое, фиолетовое, оранжевое", sheet(3, "dinosaur eggs standing upright, slightly oval, with darker irregular spots: a yellow egg, a purple egg, an orange egg", "green"), "16:9"),
    "dino": ("Динозаврик-пушка", TOY + "A small rubber toy dinosaur (green body, yellow belly), sitting upright, front view, head tilted up, mouth wide open as if ready to spit an egg upward, cute and slightly funny. " + key("magenta") + NO_TEXT, "1:1"),
    "ceiling": ("Каменный потолок", "Seamless horizontally tileable strip, front view of the bottom edge of a rough grey stone slab with moss and small hanging roots, the lower edge uneven. " + key("magenta") + NO_TEXT, "16:9"),
    "map": ("Карта уровней", notebook("a dotted path through a land of dinosaurs drawn in the yard: ferns, a volcano made from a sand pile, eggs in a nest, a toy dinosaur."), "3:4"),
}

# Наборы в программе: свои промпты, персонажи и действия; правятся в json рядом с программой.
# images_only — набор только из картинок: «персонажи» — это картинки, у каждой своё соотношение сторон.
SETS = {
    "players": {"title": "Игроки", "file": "prompts.json", "image": IMAGE, "video": VIDEO, "characters": CHARACTERS, "reactions": REACTIONS, "off": ["bluff"]},
    "dealer": {"title": "Крупье", "file": "prompts_dealer.json", "image": DEALER_IMAGE, "video": DEALER_VIDEO, "characters": DEALERS, "reactions": DEALER_ACTIONS, "off": []},
    "shariki": {"title": "Аркада: Шарики", "file": "prompts_shariki.json", "image": "{person}", "video": "", "characters": SHARIKI, "reactions": {}, "off": [], "images_only": True},
    "klad": {"title": "Аркада: Клад", "file": "prompts_klad.json", "image": "{person}", "video": "", "characters": KLAD, "reactions": {}, "off": [], "images_only": True},
    "eggs": {"title": "Аркада: Яйца", "file": "prompts_eggs.json", "image": "{person}", "video": "", "characters": EGGS, "reactions": {}, "off": [], "images_only": True},
}
