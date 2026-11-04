# «Герои кастета и семок» — контент первого выпуска

_Сгенерировано `studio/jobs/geroi/make_jobs.py` — правки вносить туда. Выход конвейера — `G:/temp/studio/out/geroi/<партия>/`, отбор — мой, в игру — `lavochka/public/geroi/a/` (LFS) через `pack_geroi.py`._

| Партия | Что | Где в игре |
|---|---|---|
| 10-creatures → 20-creature-3d | 66 существ: эталон → TripoSG → Blender, анимации idle/move/shoot/hit/defend/death | бой (отряды), окно найма, карта (нейтралы-охрана), иконки отрядов в армии героя |
| 11-heroes | 8 пацанов + Старшой (2 варианта), 32 местных героя | портрет героя (панель, таверна, найм), кампании, экран выбора |
| 11b-mounts | 8 классов героя на коне (эталон под 3D) | герой на карте приключений (8 направлений — утром) |
| 12-towns | панорама замка целиком и пустая площадка × 4, постройки по 18 × 4, замок на карте × 4 | экран замка (слои построек поверх площадки), меню стройки, карта |
| 13-map | ресурсы × 7, объекты × 50, грунты × 11, декор × 32, горы × 4 | карта приключений (шейдер грунта, спрайты объектов, генератор §7) |
| 14-battle | поля × 6, осада × 4, препятствия × 10 | фон боя по местности, осада, препятствия на гексах |
| 15-icons | артефакты × 60, заклинания × 40, навыки × 24, параметры × 10, ресурсы × 7 | книга магии, кукла героя, навыки, ресурсная строка |
| 16-cutscene-keys → 17-videos | 27 роликов (`docs/geroi/CAMPAIGNS.md`) | вступление (весь экран), окно ролика кампании, победа/поражение |
| 18-music | 15 треков × 2 (+ проба 02 — 12 треков) | меню, замки, карта по местности, бой, осада, кампании, злодей, финал, победа/поражение |
| 19-sfx | 105 звуков × 2 | конь по местностям, подборы, стройка, удары/выстрелы по типам, гибель, голоса существ, заклинания, интерфейс |

## Существа

| Имя | Фракция | Ступень | Улучшение | Звук голоса/удара (подбор) |
|---|---|---|---|---|
| `zatulye-militia` | zatulye | 1 |  | |
| `zatulye-spearman` | zatulye | 1 | да | |
| `zatulye-slinger` | zatulye | 2 |  | |
| `zatulye-strelets` | zatulye | 2 | да | |
| `zatulye-vataga` | zatulye | 3 |  | |
| `zatulye-brodnik` | zatulye | 3 | да | |
| `zatulye-boatman` | zatulye | 4 |  | |
| `zatulye-ushkuynik` | zatulye | 4 | да | |
| `zatulye-herbalist` | zatulye | 5 |  | |
| `zatulye-wisewoman` | zatulye | 5 | да | |
| `zatulye-rider` | zatulye | 6 |  | |
| `zatulye-vityaz` | zatulye | 6 | да | |
| `zatulye-tur` | zatulye | 7 |  | |
| `zatulye-thundertur` | zatulye | 7 | да | |
| `zatonye-reedling` | zatonye | 1 |  | |
| `zatonye-sedgeling` | zatonye | 1 | да | |
| `zatonye-frog` | zatonye | 2 |  | |
| `zatonye-toad` | zatonye | 2 | да | |
| `zatonye-wisp` | zatonye | 3 |  | |
| `zatonye-wanderwisp` | zatonye | 3 | да | |
| `zatonye-willow` | zatonye | 4 |  | |
| `zatonye-oldwillow` | zatonye | 4 | да | |
| `zatonye-vodyanitsa` | zatonye | 5 |  | |
| `zatonye-omutnitsa` | zatonye | 5 | да | |
| `zatonye-troll` | zatonye | 6 |  | |
| `zatonye-bogtroll` | zatonye | 6 | да | |
| `zatonye-mistserpent` | zatonye | 7 |  | |
| `zatonye-phantomserpent` | zatonye | 7 | да | |
| `kuznya-apprentice` | kuznya | 1 |  | |
| `kuznya-smith` | kuznya | 1 | да | |
| `kuznya-wasp` | kuznya | 2 |  | |
| `kuznya-stingwasp` | kuznya | 2 | да | |
| `kuznya-riveter` | kuznya | 3 |  | |
| `kuznya-repeater` | kuznya | 3 | да | |
| `kuznya-steamhound` | kuznya | 4 |  | |
| `kuznya-forgehound` | kuznya | 4 | да | |
| `kuznya-founder` | kuznya | 5 |  | |
| `kuznya-firemistress` | kuznya | 5 | да | |
| `kuznya-walkcannon` | kuznya | 6 |  | |
| `kuznya-walkmortar` | kuznya | 6 | да | |
| `kuznya-colossus` | kuznya | 7 |  | |
| `kuznya-forgecolossus` | kuznya | 7 | да | |
| `akademiya-student` | akademiya | 1 |  | |
| `akademiya-adept` | akademiya | 1 | да | |
| `akademiya-owl` | akademiya | 2 |  | |
| `akademiya-seerowl` | akademiya | 2 | да | |
| `akademiya-crystal` | akademiya | 3 |  | |
| `akademiya-prism` | akademiya | 3 | да | |
| `akademiya-stag` | akademiya | 4 |  | |
| `akademiya-moonstag` | akademiya | 4 | да | |
| `akademiya-pineguard` | akademiya | 5 |  | |
| `akademiya-borguard` | akademiya | 5 | да | |
| `akademiya-moondragon` | akademiya | 6 |  | |
| `akademiya-stardragon` | akademiya | 6 | да | |
| `akademiya-fallenstar` | akademiya | 7 |  | |
| `akademiya-wanderstar` | akademiya | 7 | да | |
| `neutral-wolf` | neutral | 2 |  | |
| `neutral-boar` | neutral | 3 |  | |
| `neutral-bandit` | neutral | 2 |  | |
| `neutral-leshak` | neutral | 3 |  | |
| `neutral-kikimora` | neutral | 4 |  | |
| `neutral-salamander` | neutral | 4 |  | |
| `neutral-bear` | neutral | 5 |  | |
| `neutral-sirin` | neutral | 5 |  | |
| `neutral-stonegiant` | neutral | 6 |  | |
| `neutral-poloz` | neutral | 7 |  | |

## Ролики

| Ролик | Где | Ключ | Движение |
|---|---|---|---|
| `intro-1` | вступление | Summer evening in 1995 in a Siberian city: rows of grey nine-storey panel apartment blocks… | slow pan across the panel blocks toward the construction site, birds fly, warm evening light |
| `intro-2` | вступление | Four different teenagers in mixed summer clothes of the 1990s (a striped t-shirt, a faded … | the teenagers lean a little closer, the brass knuckle lies perfectly still in the clay, only its warm golden glow pulses softly, slow gentle push in |
| `intro-3` | вступление | A solar eclipse over a construction pit and panel houses, the sun becomes a black disc wit… | the sun darkens into the eclipse, dust swirls in the wind, eerie light flickers |
| `intro-4` | вступление | A blinding white flash bursting from a construction pit, light rays engulfing the city at … | a burst of white light expands from the pit and floods everything, shards of light fly outward |
| `intro-5` | вступление | a sixteen-year-old boy with a light brown buzz cut, freckles and a cheeky confident smile … | he slowly opens his eyes and looks up, grass sways in the wind, the shard glows |
| `intro-6` | вступление | View from a hill over a wide fantasy river valley: a wooden free-folk settlement with timb… | slow sweeping pan across the valley, boats drift on the river, clouds move |
| `c1-1a` | кампания 1 | An old grey-bearded ferryman on a wooden raft bowing to a sixteen-year-old boy with a ligh… | the ferryman bows and smiles, the raft rocks gently, the river flows |
| `c1-2a` | кампания 1 | A horseman with a small blue flag galloping through morning dew toward a log palisade… | the horseman gallops toward the camera, dew sparkles, the flag flutters |
| `c1-2b` | кампания 1 | a big chubby sixteen-year-old boy with a calm lazy smile and a sunburnt face wearing a wre… | mist drifts, the boy yawns lazily, frogs croak and shift, fireflies glow |
| `c1-3a` | кампания 1 | Thick mist over a river, silhouettes of frog warriors with blowpipes and floating will-o-w… | the frog warriors step out of the mist, the wisps float and glow, fog swirls |
| `c1-3b` | кампания 1 | Black riders on black horses standing on a hill ridge under heavy storm clouds… | cloaks flap in the wind, horses stamp, lightning flickers in the clouds |
| `c1-4a` | кампания 1 | A carved stone obelisk glowing from inside among hills, a dark army camp with black banner… | the obelisk pulses with light, banners wave, campfires flicker |
| `c1-fin1` | кампания 1 | Two glowing brass shards in an open palm drawing together and fusing with a bright flash… | the shards slide together and fuse with a burst of golden light |
| `c1-fin2` | кампания 1 | A dark castle on a high rock under a stormy sky, in a lit window the silhouette of a man i… | clouds race past the castle, the silhouette turns away from the window, lightning flashes |
| `c1-fin3` | кампания 1 | a sixteen-year-old boy with a light brown buzz cut, freckles and a cheeky confident smile … | the campfire crackles, they talk and laugh, the sun sets slowly over the river |
| `c2-1a` | кампания 2 | Inside an observatory dome among pines: a small fifteen-year-old girl with two short dark … | she sits up and adjusts her glasses, the star chart slowly rotates and glows |
| `c2-1b` | кампания 2 | Old mages in blue star-embroidered robes bowing before a small fifteen-year-old girl with … | the mages bow deeply, stars on the chart light up one by one, she crosses her arms |
| `c2-2a` | кампания 2 | A forge city on an ash plain at dusk: red glow, tall smoking chimneys, walking steam machi… | smoke rises, furnaces glow, a steam machine walks across the scene |
| `c2-2b` | кампания 2 | a lanky sixteen-year-old boy with messy black hair and soot on his cheek in a leather apro… | he strikes the anvil, sparks fly, the colossus slowly turns its head |
| `c2-3a` | кампания 2 | An unrolled magic scroll on a table in a tower, above it eight glowing lights appear on a … | the scroll glows, eight lights ignite one by one above the map |
| `c2-3b` | кампания 2 | A figure in a black cloak and a flat cap leaping from a tower window with a scroll against… | the thief jumps from the window and runs across the roof, the cloak flutters |
| `c2-4a` | кампания 2 | A meteor shower over a huge crater in a pine forest at night, burning meteors falling into… | meteors streak across the sky and crash with bursts of light, smoke rises |
| `c2-fin1` | кампания 2 | a small fifteen-year-old girl with two short dark braids, round glasses and a sharp clever… | she lifts the shard, it glows brighter, smoke drifts around her |
| `c2-fin2` | кампания 2 | An open leather bag on stones, inside a yellowed metal badge and an old black-and-white ph… | slow push in on the old photo, dust drifts in a beam of light |
| `c2-fin3` | кампания 2 | a small fifteen-year-old girl with two short dark braids, round glasses and a sharp clever… | the beam shoots across the sky, her hair and scarf blow in the wind |
| `win` | итог сценария | A player banner being raised over a captured wooden town, a cheering army below, bright da… | the banner rises and unfurls, the army cheers and raises weapons |
| `lose` | итог сценария | Dark storm clouds over an empty wooden town, a torn banner lying on the ground… | clouds roll in, the torn banner flaps weakly in the wind, rain begins |

## Музыка

| Трек | Ситуация |
|---|---|
| `town-kuznya` | петля |
| `town-akademiya` | петля |
| `map-swamp` | петля |
| `map-ash` | петля |
| `map-pine` | петля |
| `battle-b` | петля |
| `battle-c` | петля |
| `siege` | петля |
| `villain` | петля |
| `campaign1` | петля |
| `campaign2` | петля |
| `intro` | петля |
| `finale` | петля |
| `victory` | короткий (до 40 с) |
| `defeat` | короткий (до 40 с) |

Проба 02 (утверждена): `menu`, `menu-vox`, `zatulye`, `zatonye`, `battle`, `map` (луга).

## Звуки

`horse-grass`, `horse-road`, `horse-swamp`, `horse-ash`, `horse-snort`, `boat-row`, `pickup-res`, `pickup-semki`, `chest-open`, `artifact`, `flag`, `mine-capture`, `shrine`, `levelup`, `newday`, `newweek`, `teleport`, `dig`, `learn`, `water-splash`, `build`, `recruit`, `market`, `gate`, `forge`, `owl`, `frogs`, `river`, `hit-blade`, `hit-blunt`, `hit-metal`, `hit-claw`, `hit-spear`, `hit-crystal`, `hit-wood`, `hit-magic`, `shot-sling`, `shot-crossbow`, `shot-blowpipe`, `shot-bow`, `shot-bolt-steam`, `shot-cannon`, `shot-mortar`, `impact-stone`, `impact-arrow`, `impact-boom`, `miss`, `defend`, `death-human`, `death-creature`, `death-machine`, `death-spirit`, `move-foot`, `move-hoof`, `move-hop`, `move-fly`, `move-mech`, `move-float`, `move-heavy`, `morale`, `luck`, `badmorale`, `catapult`, `wall-break`, `tower-shot`, `battle-start`, `battle-win`, `battle-lose`, `voice-frog`, `voice-wolf`, `voice-boar`, `voice-bear`, `voice-bird`, `voice-owl`, `voice-bull`, `voice-horse`, `voice-tree`, `voice-water`, `voice-fish`, `voice-serpent`, `voice-wasp`, `voice-hound`, `voice-colossus`, `voice-crystal`, `voice-whale`, `voice-star`, `voice-salamander`, `voice-stone`, `voice-war`, `spell-fire`, `spell-water`, `spell-earth`, `spell-air`, `spell-buff`, `spell-curse`, `spell-heal`, `spell-summon`, `spell-fail`, `ui-click`, `ui-open`, `ui-close`, `ui-scroll`, `ui-error`, `ui-turn`, `text-type`
