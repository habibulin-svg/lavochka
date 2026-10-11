"""Промпты для видео-персонажей холдема (см. docs/holdem-video.md). Их можно поправить в prompts.json рядом с программой."""

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
