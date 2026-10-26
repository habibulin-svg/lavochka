"""Шен («Собаки и шакалы»): доска-щит, колышки с головами собак и шакалов, палочки — картинки через routerai.ru
(ключ — из tools/videogen/dist/videogen.json). Лунки и переходы рисует код (src/games/shen/view.ts) — генерация даёт
только сами предметы. Спрайты — на сплошном зелёном фоне (его убирает cut.py: слоновая кость в пурпурном свете розовеет).

  python tools/shen/gen.py [--n 2] [имя ...]   → D:/temp/shen/raw/<имя>-<k>.png
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "videogen"))
import videogen as V  # noqa: E402

OUT = "D:/temp/shen/raw"
MODEL = "black-forest-labs/flux.2-pro"

BG = "Flat solid chroma-key green background (#00FF00), evenly lit, nothing else. No text, no letters, no hieroglyphs, no people."
PEG = (
    "Museum product photo of a single ancient Egyptian game piece for the board game 'hounds and jackals', standing upright, "
    "seen from the side with the camera slightly above, centered, alone, soft warm light from the upper left, no cast shadow. "
    "The piece is a slender straight round pin about ten times longer than thick, slightly tapering to the bottom, "
    "topped with a small finely carved animal head facing left. "
)
HOUND = "The head is of an Egyptian hound (tesem dog) with a long muzzle and short rounded ears folded down. Carved from aged polished ivory, warm cream white. "
JACKAL = "The head is of a jackal like the god Anubis, a long pointed muzzle and tall pointed upright ears. Carved from polished black ebony wood with thin gold leaf bands at the neck. "

BOARD = (
    "Strict top-down orthographic photo of the flat top of an ancient Egyptian game board seen from straight above, "
    "shaped like a tall rounded shield or tombstone: straight vertical sides and a flat bottom edge, the top end rounded into a full semicircle, "
    "portrait orientation, height about 1.6 times the width, filling the frame with a small margin. "
)
LOOKS = {
    "board": BOARD + "The playing surface is a single panel of aged polished ivory, warm cream colour with very fine grain and a few hairline cracks, "
    "set in a narrow border of black ebony wood. The ivory surface is completely plain and smooth: no holes, no pegs, no carvings, no drawings. "
    "Even soft light, no cast shadow. Flat solid dark grey background.",
    "boardw": BOARD + "The board is carved from one plank of warm brown acacia wood, oiled, with beautiful grain, a slightly bevelled edge "
    "and a thin incised border line. The top surface is completely plain and smooth: no holes, no pegs, no carvings, no drawings. "
    "Even soft light, no cast shadow. Flat solid dark grey background.",
}

PROMPTS = {
    **LOOKS,
    "dog": PEG + HOUND + BG,
    "jackal": PEG + JACKAL + BG,
    "stickl": (
        "Product photo from straight above of a single ancient Egyptian throwing stick for a board game: a long thin flat stick of pale wood, "
        "about 12 cm long and 1.5 cm wide, lying horizontally, its flat side up, plain smooth pale cream wood with fine grain, rounded ends. "
        "Soft light from the upper left, no cast shadow. " + BG
    ),
    "stickd": (
        "Product photo from straight above of a single ancient Egyptian throwing stick for a board game: a long thin half-round stick, "
        "about 12 cm long and 1.5 cm wide, lying horizontally, its rounded side up, painted dark brown-black with a few thin red ochre bands, "
        "rounded ends. Soft light from the upper left, no cast shadow. " + BG
    ),
    "table": (
        "Strict top-down flat photo of an old woven papyrus reed mat filling the entire frame, warm straw-brown colour, "
        "soft even light. No objects, no text."
    ),
}
ASPECT = {"board": "2:3", "boardw": "2:3", "dog": "9:16", "jackal": "9:16", "stickl": "16:9", "stickd": "16:9"}


def main():
    args = sys.argv[1:]
    n = 2
    if "--n" in args:
        i = args.index("--n")
        n = int(args[i + 1])
        del args[i:i + 2]
    ids = args or list(PROMPTS)
    with open(os.path.join(os.path.dirname(__file__), "..", "videogen", "dist", "videogen.json"), encoding="utf-8") as f:
        key = json.load(f)["key"]
    os.makedirs(OUT, exist_ok=True)
    total = 0.0
    for name in ids:
        for k in range(n):
            path = f"{OUT}/{name}-{k}.png"
            if os.path.exists(path):
                continue
            for attempt in range(8):  # у BFL ограничение на число задач — ждём и пробуем снова
                try:
                    img, cost = V.gen_image(key, MODEL, PROMPTS[name], 5800 + k, ASPECT.get(name, "1:1"))
                    break
                except V.ApiError as e:
                    if "429" not in str(e) or attempt == 7:
                        raise
                    time.sleep(15)
            with open(path, "wb") as f:
                f.write(img)
            total += cost
            print(path, f"{cost:.2f} ₽", flush=True)
    print(f"итого {total:.2f} ₽")


if __name__ == "__main__":
    main()
