import json, sys, types, pickle
from collections import Counter
sys.modules['yaml'] = types.ModuleType('yaml')
sys.path.insert(0, 'G:/Claude/Shish/studio/jobs/gops')
import make_jobs as mj

Z, R, ZA, P, C, LN = 'zatulinka', 'rastochka', 'zaton', 'pervomayka', 'chemskoy', 'leninsky'

def A(preset, w, d=''):
    ws = {}
    for p in w.split():
        k, v = p.split(':'); ws[k] = int(v)
    ds = {}
    for p in d.split():
        k, v = p.split(':'); ds[k] = int(v)
    return {'preset': preset, 'weapons': ws, 'delays': ds}

def S(turn=45, rnd=600, wind=0.3, crates=0.3, mines=0, barrels=0.2, fall=0.5, sd='water', **kw):
    s = {'turn_time': turn, 'round_time': rnd, 'wind': wind, 'crates': crates, 'mines': mines,
         'barrels': barrels, 'fall_damage': fall, 'sudden_death': sd}
    s.update(kw); return s

def E(b, n, hp, bot, **kw):
    d = {'brigade': b, 'count': n, 'hp': hp, 'bot': bot}; d.update(kw); return d

def ST(third_type, val=None):
    t = {'type': third_type}
    if val is not None: t['value'] = val
    return {'1': {'type': 'win'}, '2': {'type': 'no_losses'}, '3': t}

LV = []
def L(id, mode, ch, title, theme, time, arch, water, props, brief, obj, pl, en, ars, sch, stars, music, cut, tip, new, diff, **kw):
    n = int(id[1:])
    d = dict(id=id, mode=mode, chapter=ch, title=title, theme=theme, time=time,
             terrain={'archetype': arch, 'seed': (n * 7919 + {'t': 100, 'm': 2000, 'r': 40000}[id[0]]) % 99991,
                      'water': water, 'props': props},
             briefing=brief, objective=obj, player={'count': pl[0], 'hp': pl[1]}, enemies=en,
             arsenal=ars, scheme=sch, stars=stars, music=music, cutscene_after=cut or None, tip=tip, new=new, difficulty=diff)
    d.update(kw); LV.append(d)

# ============================================================ ОБУЧЕНИЕ
L('t01','training',0,'Ножки, ножки','yard','grey','hills',0.2,0.3,
  'Для начала научимся ходить — это проще, чем кажется, но кепку придётся придерживать. Добеги до трёх флажков, перепрыгни лужу и не упади в неё: лужа здесь не для купания.',
  {'type':'reach_point','points':[[0.25,0.5],[0.55,0.45],[0.9,0.4]],'ordered':True},(1,100),[],
  A('custom','tychok:-1'),S(turn=120,wind='none',crates=0,barrels=0,fall=0,sd='none'),
  ST('turns_max',6),'calm',None,'Стрелки — бегать, пробел — прыжок, двойное нажатие — прыжок назад с кувырком.','Ходьба, прыжок, кувырок',0)
L('t02','training',0,'Муха и ветер','garages','day','valley',0.1,0.3,
  'Вот «Муха»: труба на плечо — и в дело. Ветер сносит её, как фантик, так что целься с поправкой. Сбей три банки с забора и узнаешь, что такое «на глаз».',
  {'type':'targets','count':3,'kind':'cans_fence','turns':6},(1,100),[],
  A('custom','mukha:-1'),S(turn=90,wind=0.6,crates=0,barrels=0,fall=0,sd='none'),
  ST('turns_max',4),'calm',None,'Стрелка у ветра показывает, куда сдует ракету: целься против ветра.','«Муха»: сила удержанием, ветер',0)
L('t03','training',0,'Лимонка с характером','construction','day','pit',0.2,0.4,
  'Лимонку не просто кидают — её ещё нужно уговорить. Выбери таймер от одного до пяти секунд, дай ей отскочить от плиты и закатиться за угол. Три бочки за стенкой ждут сюрприза.',
  {'type':'targets','count':3,'kind':'barrels_behind_wall','turns':6},(1,100),[],
  A('custom','limonka:-1'),S(turn=90,wind='none',crates=0,barrels=0,fall=0,sd='none'),
  ST('turns_max',4),'calm',None,'Цифры 1–5 — таймер лимонки; чем сильнее бросок, тем дальше она катится.','Лимонка: таймер и отскок',0)
L('t04','training',0,'Верёвка и крюк','dacha','day','cliff',0.5,0.3,
  'Верёвка с крюком — это когда ты Тарзан, а вокруг дачи. Зацепись за ветку яблони, раскачайся и прыгни на тот берег. Главное — отпустить вовремя.',
  {'type':'reach_point','points':[[0.5,0.35],[0.92,0.45]],'ordered':True},(1,100),[],
  A('custom','rope:-1'),S(turn=120,wind='none',crates=0,barrels=0,fall=0,sd='none'),
  ST('turns_max',4),'calm',None,'Пробел во время качания — отпустить; вверх/вниз — подтянуться или отпустить длиннее.','Верёвка с крюком',0)
L('t05','training',0,'Мишени на время','school','day','arena',0.1,0.4,
  'Школьный тир: мишени встают и падают быстрее, чем физрук говорит «отставить». Восемь штук за минуту — и ты принят в кружок. «Макаров» бьёт точно, но мишени не ждут.',
  {'type':'targets','count':8,'kind':'pop_up','time_limit':60},(1,100),[],
  A('custom','makarov:-1 sling:-1'),S(turn=60,rnd=60,wind='none',crates=0,barrels=0,fall=0,sd='none'),
  ST('time_max',40),'timed',None,'Пули ветром не сносит: целься прямо, а промах пересчитывай на глаз.','«Макаров», рогатка, счёт по времени',0)

# ============================================================ ГЛАВА 1: РАСТОЧКА
L('m01','mission',1,'Первый двор','yard','grey','hills',0.15,0.5,
  'Расточка заняла наш двор и уже лузгает семки на нашей лавочке. Их двое, нас трое — арифметика на нашей стороне. Выгони гостей поскорее, пока бабушки с балконов не начали давать советы.',
  {'type':'eliminate'},(3,100),[E(R,2,70,'easy')],
  A('limited','mukha:-1 limonka:-1 obrez:3 rope:2'),S(wind=0.2,crates=0.2,barrels=0.1,fall=0.3),
  ST('turns_max',8),'calm',None,'Первый ход не торопи: оглядись, откуда ветер, и только потом целься.','«Обрез» — два выстрела за ход',1)
L('m02','mission',1,'Бочки не виноваты','garages','day','objects',0.1,0.7,
  'У гаражей стоят бочки с чем-то подозрительно пахучим, и Расточка хочет их увезти. Если бочки взорвутся сами, они уж точно никому не достанутся. Помоги им взорваться, пока их не погрузили в «Москвич».',
  {'type':'destroy_objects','object':'barrel','count':5},(3,100),[E(R,1,60,'easy')],
  A('limited','mukha:-1 limonka:-1 obrez:3 mine:3 rope:2'),S(wind=0.2,crates=0.2,mines=0,barrels=0.8,fall=0.3),
  ST('turns_max',7),'calm',None,'Бочки взрываются цепочкой: поставь одну точно в центр и смотри, как остальные сами договорятся.','Растяжка (мина)',1)
L('m03','mission',1,'Прогул с последствиями','school','evening','staircase',0.1,0.5,
  'Физрук ушёл за кефиром, а со склада посыпались ящики с инвентарём. Расточка уже лезет на трибуны с мешками. Собери четыре ящика первым — как за последней булкой в буфете.',
  {'type':'collect_crates','count':4},(3,100),[E(R,2,70,'easy')],
  A('limited','mukha:-1 limonka:-1 sling:-1 makarov:-1 obrez:2 mine:2 rope:2'),S(wind=0.2,crates=0.9,barrels=0.1,fall=0.3),
  ST('turns_max',7),'calm','s02-crate','Ящик падает на парашюте — подбегай к месту падения до того, как он коснётся земли.','Ящики: подобрал — получил оружие; рогатка, «Макаров»',2)
L('m04','mission',1,'Бабка на грядках','dacha','day','valley',0.1,0.5,
  'Бабка Шура копает картошку, а Расточка уже подбирается к её грядкам. Бабку лучше не трогать: она сама кого хочешь тронет, но помочь ей не грех. Продержись пять ходов, а потом — огурцы и сметана.',
  {'type':'protect','ward':'babka','ward_hp':120,'turns':5},(3,100),[E(R,3,60,'easy')],
  A('limited','mukha:-1 limonka:-1 carbide:2 makarov:-1 rope:2 zontik:1'),S(wind=0.3,crates=0.3,barrels=0.1,fall=0.4),
  ST('hp_percent_min',60),'calm',None,'Подопечный стоит на месте и ждёт защиты: закрой его собой или выгони врагов подальше.','Банка с карбидом; подопечный',2)
L('m05','mission',1,'Кран на небо','construction','grey','towers',0.2,0.8,
  'Кто-то повесил на башенный кран флаг Расточки, и он развевается над всей стройкой, как наглое бельё. Забрось на кран нашего бойца и смени флаг, пока прораб не вернулся с обеда. Плиты и отбойный молоток на стройке всегда под рукой.',
  {'type':'reach_point','position':[0.5,0.05],'label':'флаг на кране'},(3,100),[E(R,2,70,'easy')],
  A('limited','plita:4 otboinik:3 rope:-1 limonka:3 mukha:2'),S(wind=0.4,crates=0.3,barrels=0.2,fall=0.4),
  ST('turns_max',8),'calm',None,'Плита — это мост и ступенька одновременно; отбойник пробивает путь вниз.','Бетонная плита и отбойный молоток',2)
L('m06','mission',1,'Базарная площадь','market','day','arena',0.2,0.8,
  'Рынок поделили на сотки, а нам нужен свой ларёк с газировкой. Займи пятачок у ларька и держи его, пока Расточка бегает за семечками. Три хода — и ларёк наш, а вместе с ним и вся газировка.',
  {'type':'king_of_hill','zone':[0.5,0.55,0.08],'hold_turns':3},(3,100),[E(R,3,70,'easy')],
  A('limited','mukha:-1 limonka:-1 korsar:2 makarov:-1 obrez:2'),S(wind=0.3,crates=0.3,barrels=0.3,fall=0.4),
  ST('turns_max',9),'battle','s09-kvass','Зону держит тот, кто в ней один: выгони чужих взрывом и стой.','Ящик петард «Корсар»; режим «царь горы»',3)
L('m07','mission',1,'Форт-Ночь','yard','night','fortress',0.2,0.6,
  'Ночью строили форты из шин и поддонов: свой у них, свой у нас. Победит тот, у кого стенка крепче, а голова горячее. Фонарик не забудь — он не поможет, но так красивее.',
  {'type':'eliminate'},(3,100),[E(R,3,70,'medium')],
  A('limited','mukha:-1 limonka:-1 pigeon:2 obrez:2 plita:2 makarov:-1','pigeon:2'),S(wind=0.3,crates=0.3,barrels=0.2,fall=0.4,forts=True),
  ST('turns_max',10),'battle',None,'Форт можно разобрать по кирпичику, но тот, кто разберёт, сам окажется на виду.','Голубь с петардой; режим «форты»',3)
L('m08','mission',1,'Курьерский','depot','evening','bridge',0.3,0.6,
  'На депо ждут товарняк с семками, а Расточка решила встретить его без нас. Продержись шесть ходов, пока не загудит паровоз. Рельсы — не только дорога, но и отличное укрытие, если не стоять на них.',
  {'type':'survive_turns','turns':6},(3,100),[E(R,4,60,'medium')],
  A('limited','mukha:-1 limonka:-1 tnt:3 mine:3 makarov:-1 zontik:2'),S(wind=0.3,crates=0.4,mines=2,barrels=0.2,fall=0.4),
  ST('hp_percent_min',50),'battle',None,'Тротил можно оставить на дорожке и убежать — шашка взорвётся сама.','Тротиловая шашка, зонтик',3)
L('m09','mission',1,'Бугор Расточки','garages','evening','cliff',0.2,0.7,
  'Сам Бугор вышел на крышу гаража: кепка размером с таз, самомнение размером с гараж. У него 300 ХП, и он твёрдо уверен, что это мало. Спусти его с небес на землю — желательно без обид.',
  {'type':'eliminate'},(4,100),[E(R,1,300,'medium',boss=True,name='Бугор'),E(R,2,60,'easy')],
  A('limited','mukha:-1 limonka:-1 tnt:2 korsar:2 pigeon:2 obrez:-1 rope:3 plita:2','tnt:2 pigeon:2'),S(wind=0.4,crates=0.4,barrels=0.3,fall=0.5),
  ST('turns_max',14),'sudden','s17-garage-door','У босса много ХП — не трать лучшее оружие на его охрану, береги к его выходу.','Первый босс: 300 ХП',4,boss=True)

# ============================================================ ГЛАВА 2: ЗАТОН
L('m10','mission',2,'Остров невезения','beach','day','islands',0.5,0.3,
  'Наш Рыжий уплыл на надувном матрасе и застрял на островке посреди Затона. Верни его на берег, пока он не запел. Верёвка и огнетушитель — твои лучшие друзья, а Затон — не самый добрый сосед.',
  {'type':'rescue','count':1,'where':'island'},(3,100),[E(ZA,2,70,'easy')],
  A('limited','rope:-1 ognetushitel:3 mukha:-1 limonka:-1 makarov:-1'),S(wind=0.4,crates=0.4,barrels=0.1,fall=0.4),
  ST('no_losses'),'calm',None,'Спасаемый присоединится к бригаде, если до него дотронуться; береги его — он слабенький, зато с характером.','Огнетушитель-ранец; спасение с острова',3)
L('m11','mission',2,'Смена трансформаторов','factory','grey','pit',0.4,0.7,
  'Затон держит завод на свету, а нам нужна тёмная ночь. Раздолбай четыре трансформатора, пока смена не вернулась с обеда. Ракета с наводкой найдёт, куда стукнуть, а ты — что сказать мастеру.',
  {'type':'destroy_objects','object':'transformer','count':4},(4,100),[E(ZA,2,80,'medium')],
  A('limited','homing:3 mukha:-1 limonka:-1 tnt:3 mine:2 rope:2','homing:1'),S(wind=0.3,crates=0.3,barrels=0.3,fall=0.5),
  ST('turns_max',9),'battle',None,'Ракета с наводкой летит туда, куда ткнёшь, — но ветер сносит и её, чуть-чуть.','Ракета с наводкой',4)
L('m12','mission',2,'Скидки на хлам','market','evening','maze',0.3,0.9,
  'На рынке распродажа: ящики падают с неба, как шоколадки с ёлки. Затон тянет руки, мы тянем их быстрее. Собери шесть ящиков и считай себя почти олигархом.',
  {'type':'collect_crates','count':6},(4,100),[E(ZA,3,70,'medium')],
  A('limited','dog:2 mukha:-1 korsar:2 limonka:-1 rope:2 makarov:-1 sling:-1'),S(wind=0.3,crates=1.0,mines=3,barrels=0.3,fall=0.5),
  ST('turns_max',9),'battle','s08-dog','В ящиках бывают мины — не таскай всё подряд, смотри под ноги.','Дворняга с петардой',3)
L('m13','mission',2,'Мусорный регламент','dump','grey','hills',0.4,0.8,
  'Свалка — вечный спор: чей это холм. Затон решил, что их, нам это решение не нравится. Продержись восемь ходов и докажи, что ты тут сидел раньше.',
  {'type':'survive_turns','turns':8},(4,100),[E(ZA,4,70,'medium')],
  A('limited','mortar:3 mukha:-1 carbide:2 limonka:-1 obrez:-1 tnt:2'),S(wind=0.5,crates=0.4,barrels=0.3,fall=0.5),
  ST('hp_percent_min',50),'battle',None,'Миномёт бьёт навесом через стены, но осколки летят и в тебя.','Миномёт из трубы',4)
L('m14','mission',2,'Контрольная по физике','school','day','staircase',0.1,0.6,
  'Физичка велела попасть в мишени, не вставая с места. Восемь штук за шесть ходов — и получишь пятёрку и «Калаш» в придачу. Промажешь — тройка и замечание в дневник.',
  {'type':'targets','count':8,'kind':'moving','turns':6},(3,100),[],
  A('limited','kalash:-1 makarov:-1 sling:-1'),S(turn=40,wind='none',crates=0,barrels=0,fall=0.3,sd='none'),
  ST('turns_max',4),'timed',None,'Автомат стреляет очередью: держи клавишу и веди прицел вслед за мишенью.','«Калаш» (очередь)',3)
L('m15','mission',2,'Дача держит оборону','dacha','evening','floating',0.3,0.8,
  'На дачах оружия нет — зато есть козы и бабка. Затон считает, что огурцы теперь их, козы вытянули шеи и громко не согласны. Защити пасеку пять ходов — пчёлы потом расплатятся мёдом.',
  {'type':'protect','ward':'beehive','ward_hp':150,'turns':5},(4,100),[E(ZA,3,80,'medium')],
  A('limited','kozy:2 babka:2 mukha:-1 limonka:-1 rope:-1 dog:1','kozy:3'),S(wind=0.4,crates=0.4,barrels=0.2,fall=0.5),
  ST('hp_percent_min',70),'battle','s03-babushka','Козы бегут вперёд и бодают всё, что на пути, — в том числе и своих.','Бабка с авоськой, стадо коз',4)
L('m16','mission',2,'Горячая точка','heating','night','cavern',0.35,0.5,
  'В теплотрассе прорвало трубу: горячая вода лезет вверх, а нам нужно к вентилю в самом конце. Добеги и закрути, пока не сварились все. Паяльная лампа прожжёт там, где ходить нельзя.',
  {'type':'reach_point','position':[0.93,0.3],'label':'вентиль'},(3,100),[E(ZA,2,80,'medium')],
  A('limited','payalnik:-1 otboinik:3 rope:-1 ognetushitel:2 mukha:-1 limonka:-1'),S(wind='none',crates=0.3,barrels=0.3,fall=0.5,sd='water',rising_water=0.5),
  ST('turns_max',8),'sudden',None,'Вода поднимается каждый ход: чем выше ты, тем дольше живёшь.','Паяльная лампа',4)
L('m17','mission',2,'Один ход — всех','construction','day','maze',0.2,0.8,
  'Четверо затонских умников выстроились у забора на стройке: фото на память. У тебя один ход, много взрывчатки и ни одной второй попытки. Продумай траекторию и ничего не перепутай.',
  {'type':'one_turn_kill','turns':1},(4,100),[E(ZA,4,40,'easy',clustered=True)],
  A('limited','tnt:4 korsar:3 limonka:3 mukha:3 mine:2'),S(turn=90,wind=0.2,crates=0,barrels=0.5,fall=0.0,sd='none'),
  ST('shots_max',3),'calm',None,'Бочки и мины тоже считаются: подожги одну, и остальное придёт само.','Режим «один ход — всех»',5)
L('m18','mission',2,'Смотрящий пирса','beach','evening','bridge',0.6,0.4,
  'Босс Затона держит мол: триста ХП, кепка как зонтик и взгляд заведующей. Вода вокруг тоже на его стороне, поэтому лучше в неё не падать. Столкни его с насиженного места — аккуратно.',
  {'type':'eliminate'},(4,100),[E(ZA,1,300,'medium',boss=True,name='Смотрящий'),E(ZA,2,70,'medium')],
  A('limited','mukha:-1 limonka:-1 homing:2 mortar:2 kalash:-1 rope:-1 ognetushitel:1 dog:2'),S(wind=0.5,crates=0.4,barrels=0.2,fall=0.5),
  ST('turns_max',14),'sudden','s13-map','Босс стоит рядом с водой — подталкивай его к ней, а не бей в лоб.','Босс главы 2: 300 ХП',6,boss=True)

# ============================================================ ГЛАВА 3: ПЕРВОМАЙКА
L('m19','mission',3,'Ёлка на льду','winter','winter','valley',0.4,0.7,
  'Первомайка залила каток и притворяется, что он их. Займи центр и держи четыре хода: ледобур и заморозка на нашей стороне. Мандарины — по традиции, но уже после победы.',
  {'type':'king_of_hill','zone':[0.5,0.6,0.09],'hold_turns':4},(4,100),[E(P,3,80,'medium')],
  A('limited','auger:3 holodilnik:2 sling:-1 limonka:-1 mukha:-1 rope:-1','holodilnik:2'),S(wind=0.3,crates=0.3,barrels=0.2,fall=0.5),
  ST('turns_max',10),'battle',None,'Заморозка останавливает бойца на ход; заморозь того, кто стоит в зоне.','Ледобур и «Заморозка»',4)
L('m20','mission',3,'Тупик','depot','night','objects',0.3,0.7,
  'Старый тепловоз — гордость депо, и Первомайка метит на его гудок. Постереги шесть ходов, пока придёт мастер. Кукурузник сегодня на нашей стороне — единственный день в году.',
  {'type':'protect','ward':'locomotive','ward_hp':200,'turns':6},(4,100),[E(P,4,80,'medium')],
  A('limited','kukuruznik:2 mukha:-1 limonka:-1 tnt:2 rope:-1 makarov:-1','kukuruznik:2'),S(wind=0.4,crates=0.4,barrels=0.3,fall=0.5),
  ST('hp_percent_min',70),'battle',None,'Тепловоз крепкий, но кукурузник бьёт сверху — не упусти, когда он зайдёт на круг.','Кукурузник с кирпичами',5)
L('m21','mission',3,'Через овраг','yard','night','cliff',0.4,0.4,
  'Овраг между дворами: ходить некуда, да и незачем — у нас артиллерия. Сидим на краях и стреляем, как положено культурным людям. Ветер сегодня главный, а ты — просто очень точный.',
  {'type':'eliminate'},(4,100),[E(P,4,90,'medium')],
  A('limited','mukha:-1 mortar:-1 homing:3 kukuruznik:1 limonka:-1','kukuruznik:3'),S(wind=0.6,crates=0.3,barrels=0.2,fall=0,no_walk=True),
  ST('turns_max',10),'battle','s06-staring','Ходить нельзя: бойцы стоят на местах, и вся игра — в расчёте угла.','Режим «артиллерия»: ходить нельзя',5)
L('m22','mission',3,'Котельная','factory','evening','towers',0.35,0.8,
  'Первомайка гоняет котлы, а нам мёрзнуть. Разбей пять котлов — только не все сразу, а то весь район останется без чая. Чугунная ванна для этих дел самое то, хоть и тяжеловата.',
  {'type':'destroy_objects','object':'boiler','count':5},(4,100),[E(P,3,90,'medium')],
  A('limited','vanna:2 tnt:3 mukha:-1 limonka:-1 rope:2 homing:2','vanna:3'),S(wind=0.3,crates=0.3,barrels=0.5,fall=0.5),
  ST('turns_max',10),'battle',None,'Ванна падает с неба там, куда ты ткнул, — следи, чтобы под ней не оказался свой.','Чугунная ванна',5)
L('m23','mission',3,'Гаражи не выпускают','garages','night','maze',0.2,0.9,
  'Двоих наших пацанов закрыли в гаражах: Первомайка спутала их с хламом. Найди обоих по крышам и верни на воздух. Кеды и резинка — для храбрых, а храбрые у нас кончились.',
  {'type':'rescue','count':2,'where':'garage'},(4,100),[E(P,3,90,'medium')],
  A('limited','rope:-1 rezinka:-1 ognetushitel:2 kedy:2 makarov:-1 limonka:-1'),S(wind=0.2,crates=0.4,mines=2,barrels=0.3,fall=0.4),
  ST('no_losses'),'battle',None,'Резинка от трусов: растянул, отпустил — и ты на крыше. Только не промахнись.','Резинка от трусов, кеды',5)
L('m24','mission',3,'Паводок на трассе','heating','grey','pit',0.5,0.4,
  'Трубу прорвало, кипяток лезет вверх, а выхода всё меньше. Держись повыше: восемь ходов — и сантехник придёт. Плиты и верёвка — наш спасательный круг и всё его удобство.',
  {'type':'survive_turns','turns':8},(4,100),[E(P,3,80,'medium')],
  A('limited','rope:-1 plita:4 ognetushitel:3 zontik:2 mukha:-1 limonka:-1 mawashi:-1'),S(turn=35,rnd=300,wind='none',crates=0.5,barrels=0.2,fall=0.5,sd='water',rising_water=1.0),
  ST('hp_percent_min',50),'sudden','s07-rope','Вода поднимается каждый ход, так что высокая позиция — лучший щит.','Вода поднимается с первого хода',6)
L('m25','mission',3,'Сладкая невесомость','dump','evening','floating',0.4,0.7,
  'Кто-то разлил «Буратино» на свалку, и всё поплыло. Гравитации почти нет, а холодильников — шесть, и все они мешают. Разбей их, пока никто не улетел в космос вместе с кепкой.',
  {'type':'destroy_objects','object':'fridge','count':6},(4,100),[E(P,3,90,'medium')],
  A('limited','buratino:3 mukha:-1 limonka:-1 mortar:2 kedy:2 rope:-1'),S(wind=0.2,crates=0.4,barrels=0.3,fall=0.2,gravity=0.4),
  ST('turns_max',10),'battle',None,'В низкой гравитации всё летит выше и дальше — снижай силу броска вдвое.','Газировка «Буратино», низкая гравитация',5)
L('m26','mission',3,'Драка без оружия','market','day','arena',0.2,0.8,
  'На рынке запретили всё громкое: остались кулаки, ноги и арматура. Займи центр и не пускай никого: четыре хода — и ты хозяин всех прилавков. Только без «за пацанов!» — хотя нет, с ним.',
  {'type':'king_of_hill','zone':[0.5,0.55,0.1],'hold_turns':4},(4,100),[E(P,4,80,'medium')],
  A('custom','uppercut:-1 mawashi:-1 armatura:-1 zapacanov:2'),S(wind='none',crates=0.2,barrels=0.2,fall=0.3,sd='water'),
  ST('turns_max',10),'battle',None,'Бить можно только вплотную: подбеги, ударь — и отходи, пока не ответили.','Ближний бой: апперкот, маваши, арматура, «За пацанов!»',5)
L('m27','mission',3,'Король льда','winter','night','fortress',0.4,0.6,
  'Король Первомайки сидит в ледяном форте. Триста ХП и привычка жаловаться на холод. Взломай форт и сдуй короля — он и так уже надутый.',
  {'type':'eliminate'},(4,100),[E(P,1,300,'hard',boss=True,name='Король Первомайки'),E(P,2,80,'medium')],
  A('limited','mukha:-1 limonka:-1 homing:2 mortar:2 auger:3 holodilnik:2 truba:1 kirpichi:1 rope:-1','truba:5 kirpichi:5'),S(wind=0.5,crates=0.4,barrels=0.2,fall=0.5,forts=True),
  ST('turns_max',15),'sudden','s10-winter','Прорыв трубы и кирпичный град дают по разу за бой — береги к решающему ходу.','Босс главы 3: 300 ХП; труба и кирпичи',7,boss=True)

# ============================================================ ГЛАВА 4: ЧЕМСКОЙ И ЛЕНИНСКИЙ
L('m28','mission',4,'Две бригады, один мост','construction','evening','bridge',0.4,0.6,
  'Чемской и Ленинский встретились на мосту и сразу поссорились — классика. Собери восемь ящиков, пока они меряются кепками. Если повезёт, они сами друг друга сдуют.',
  {'type':'collect_crates','count':8},(4,100),[E(C,3,90,'medium'),E(LN,3,90,'medium')],
  A('limited','pulemet:3 kalash:-1 mukha:-1 homing:2 limonka:-1 rope:-1','pulemet:2'),S(wind=0.4,crates=1.0,mines=2,barrels=0.3,fall=0.6),
  ST('turns_max',12),'battle',None,'Бригады враждуют и друг с другом — не мешай им, пока собираешь ящики.','Пулемёт; два вражеских района сразу',6)
L('m29','mission',4,'Дачи объединились','dacha','day','hills',0.3,0.8,
  'Чемской и Ленинский договорились и пошли на дачи вместе — пока одни дерутся, у других бабка с самогоном. Нам тут только лавочку поставить. Пойдём разберёмся, чьи огурцы.',
  {'type':'eliminate'},(5,100),[E(C,3,90,'hard'),E(LN,3,90,'medium')],
  A('limited','samogon:1 babka:1 kozy:1 dog:2 pigeon:2 sling:-1 obrez:-1 mukha:-1 limonka:-1','samogon:4 kozy:3'),S(wind=0.4,crates=0.4,barrels=0.2,fall=0.5),
  ST('turns_max',13),'battle',None,'Самогон делит ХП всех присутствующих поровну: выгодно, когда ты самый слабый.','Бабкин самогон (раз за бой)',6)
L('m30','mission',4,'Тир, но на островах','beach','day','islands',0.5,0.3,
  'Ленинский разложился на островках: красиво, как на открытке. Один ход, один шанс — открыток больше не будет. Посылку с минами никто не отменял.',
  {'type':'one_turn_kill','turns':1},(5,100),[E(LN,4,50,'hard')],
  A('limited','posylka:2 homing:4 mortar:4 kukuruznik:2 tnt:3'),S(turn=120,wind=0.3,crates=0,barrels=0,fall=0,sd='none'),
  ST('shots_max',4),'calm','s04-pigeon','Посылка с минами ложится в одну точку и разлетается — считай радиус.','Посылка с минами',7)
L('m31','mission',4,'Последняя маршрутка','depot','grey','staircase',0.3,0.7,
  'Чемской на станции махнул рукой уходящей маршрутке — и больше её никто не видел. Нам нужно добраться до вагона номер три, пока и он не ушёл. Телепорт на колёсах, но не бесплатный.',
  {'type':'reach_point','position':[0.95,0.15],'label':'вагон №3'},(4,100),[E(C,3,90,'hard')],
  A('limited','rope:-1 ognetushitel:3 marshrutka:2 kedy:-1 plita:3 mukha:-1 limonka:-1'),S(wind=0.4,crates=0.4,barrels=0.3,fall=0.6),
  ST('turns_max',9),'battle',None,'Маршрутка — телепорт: выбери точку на видимом участке карты, и боец уже там.','Маршрутка (телепорт)',6)
L('m32','mission',4,'Невидимый мороз','winter','winter','cavern',0.4,0.5,
  'Мороз, снег, и Ленинский решил, что нас не видно. Мы тоже решили, но невидимку себе купили. Продержись семь ходов, не вылезая из пещеры, — в тепле, но без чая.',
  {'type':'survive_turns','turns':7},(4,100),[E(LN,5,80,'hard')],
  A('limited','nevidimka:2 yagga:3 holodilnik:2 auger:3 sling:-1 limonka:-1 mukha:-1 rope:-1','nevidimka:2'),S(wind='none',crates=0.4,barrels=0.2,fall=0.5),
  ST('hp_percent_min',60),'battle',None,'Невидимку не видят только на твоём ходу: с её помощью можно подойти вплотную.','Невидимка, энергетик',7)
L('m33','mission',4,'Школьный тир','school','evening','arena',0.1,0.6,
  'В школе Чемского открыт стрелковый кружок. Лазерная указка у физрука — наша, надо только выиграть. Попади в десять мишеней за восемь ходов и получи грамоту.',
  {'type':'targets','count':10,'kind':'moving','turns':8},(4,100),[],
  A('limited','ukazka:-1 kalash:-1 makarov:-1 sling:-1 pulemet:2'),S(turn=40,wind=0.5,crates=0,barrels=0,fall=0.3,sd='none'),
  ST('turns_max',6),'timed','s05-sling','Лазерная указка показывает траекторию — но только для пули, а не для гранаты.','Лазерная указка',6)
L('m34','mission',4,'Верёвочный человек','yard','night','cliff',0.5,0.5,
  'Только верёвка, больше ничего. Добеги до флага на крышах двора: ходить можно, прыгать тоже, но по-настоящему здесь качаются. Времени мало, зато голова чистая.',
  {'type':'race_time','checkpoints':4,'time_limit':120},(1,100),[],
  A('custom','rope:-1'),S(turn=120,rnd=120,wind='none',crates=0,barrels=0,fall=0,sd='none',rope_only=True),
  ST('time_max',70),'timed',None,'Раскачивайся с длинной верёвкой: чем выше точка крюка, тем дальше полёт.','Режим «только верёвка»',6)
L('m35','mission',4,'Вывоз по-ленински','dump','grey','objects',0.4,0.9,
  'Ленинский вывозит свалку на своих рельсах и думает, что это бизнес. Сломай пять холодильников, пока их не погрузили. «Почта России» поможет — посылками прямо с неба.',
  {'type':'destroy_objects','object':'fridge','count':5},(5,100),[E(LN,4,90,'hard')],
  A('limited','pochta:2 kirpichi:2 vanna:2 tnt:4 mukha:-1 limonka:-1 rope:-1','pochta:3'),S(wind=0.5,crates=0.4,barrels=0.5,fall=0.6),
  ST('turns_max',11),'battle',None,'Почта сбрасывает посылки ряд за рядом — выстрели в начало, чтобы не оставить дыр.','«Почта России»',7)
L('m36','mission',4,'Смотрящий Чемского','heating','night','pit',0.5,0.5,
  'Босс Чемского сидит в котельной: триста ХП, кепка до потолка и привычка грозить кипятком. Ленинский стоит рядом и ухмыляется. Загони обоих в пар — вежливо.',
  {'type':'eliminate'},(5,100),[E(C,1,300,'hard',boss=True,name='Смотрящий Чемского'),E(LN,2,90,'hard'),E(C,1,90,'hard')],
  A('limited','mukha:-1 limonka:-1 napalm:1 pulemet:2 homing:3 payalnik:-1 rope:-1 truba:1','napalm:4 truba:6'),S(wind='none',crates=0.4,barrels=0.5,fall=0.6),
  ST('turns_max',16),'sudden','s14-plane','В котельной нет ветра — зато есть горячие трубы: используй их, а не только оружие.','Босс главы 4: 300 ХП; кукурузник-химик',8,boss=True)

# ============================================================ ГЛАВА 5: ВСЕ РАЙОНЫ
L('m37','mission',5,'Всё выручат гаражи','garages','evening','towers',0.3,0.9,
  'Двоих наших прижали в гаражах, и теперь все районы смотрят, кто кого. Спаси обоих по крышам, а потом разбирайся со зрителями. Оружие здесь — только то, что можно носить в кармане.',
  {'type':'rescue','count':2,'where':'rooftop'},(5,100),[E(R,2,90,'hard'),E(ZA,2,90,'hard')],
  A('limited','rope:-1 ognetushitel:3 marshrutka:2 kedy:2 rezinka:-1 zontik:2 makarov:-1 limonka:-1'),S(wind=0.3,crates=0.4,barrels=0.3,fall=0.6),
  ST('no_losses'),'battle',None,'Спасённый идёт за тобой следом — не давай ему отставать.','Вся мобильность вместе',7)
L('m38','mission',5,'Завод, ночная смена','factory','night','fortress',0.4,0.7,
  'Завод держат трое, и центр цеха — их гордость. Займи его на пять ходов и расставь всё по понятиям. Получится — заберёшь не только цех, но и пару кепок в подарок.',
  {'type':'king_of_hill','zone':[0.5,0.5,0.1],'hold_turns':5},(5,100),[E(P,2,100,'hard'),E(C,2,100,'hard'),E(LN,2,100,'hard')],
  A('full','ponyatiya:1','ponyatiya:3'),S(wind=0.5,crates=0.5,mines=2,barrels=0.5,fall=0.6,forts=True),
  ST('turns_max',14),'battle',None,'«По понятиям» уравнивает ХП всех: выгодно, когда ты не лидер.','«По понятиям» (делим ХП поровну)',8)
L('m39','mission',5,'Дача против всех','dacha','evening','valley',0.3,0.8,
  'Три района разом пошли на наши дачи — видно, кто-то им рассказал про клубнику. Выдержи натиск и сдуй всех троих. Козы и бабка тоже в игре, и мнение у них радикальное.',
  {'type':'eliminate'},(5,100),[E(R,2,100,'hard'),E(ZA,2,100,'hard'),E(P,2,100,'hard')],
  A('full','napalm:0','kozy:4 samogon:5'),S(wind=0.4,crates=0.5,barrels=0.3,fall=0.6),
  ST('turns_max',16),'battle','s01-backfire','Врагов трое: пока они дерутся друг с другом, береги ХП.','Три района вместе',8)
L('m40','mission',5,'Ящики с неба','dump','grey','floating',0.4,0.7,
  'Над свалкой раскачивается кран, и из него сыплются ящики по два за ход. Собери десять, но не забывай про воду внизу. Из оружия — только то, что умеет летать или лазить.',
  {'type':'collect_crates','count':10},(4,100),[E(LN,3,100,'hard'),E(C,3,100,'hard')],
  A('limited','rope:-1 ognetushitel:4 buratino:3 zontik:-1 kedy:-1 rezinka:-1 mukha:-1 limonka:-1'),S(wind=0.4,crates=1.0,mines=3,barrels=0.3,fall=0.6,gravity=0.7),
  ST('turns_max',14),'battle',None,'Ящики падают на платформы, не только на землю — следи за всеми.','Ящики с неба на платформы',7)
L('m41','mission',5,'Льдины','winter','night','islands',0.5,0.3,
  'Пять бригад расселись по льдинам, как чайки. Один ход — и никого. Кукурузник, кирпичи и «Почта» помогут, но придётся порядком попотеть.',
  {'type':'one_turn_kill','turns':1},(5,100),[E(R,1,60,'hard'),E(ZA,1,60,'hard'),E(P,1,60,'hard'),E(C,1,60,'hard'),E(LN,1,60,'hard')],
  A('limited','kukuruznik:2 kirpichi:2 korsar:4 tnt:4 pochta:2 posylka:2 homing:4'),S(turn=120,wind=0.3,crates=0,barrels=0,fall=0,sd='none'),
  ST('shots_max',5),'calm',None,'Цели далеко — используй лёгкую авиацию и дальние выстрелы.','Один ход против пятерых',9)
L('m42','mission',5,'Ларёк на всех','market','day','bridge',0.3,0.9,
  'Последний ларёк на рынке, и за него дерутся все районы. Тебе нужно просто продержаться восемь ходов, не дав им его разнести. Покупатели уже собрались и ждут.',
  {'type':'protect','ward':'kiosk','ward_hp':250,'turns':8},(5,100),[E(R,2,100,'hard'),E(ZA,2,100,'hard'),E(P,2,100,'hard'),E(C,2,100,'hard')],
  A('full','','kozy:4 samogon:5'),S(wind=0.4,crates=0.5,mines=2,barrels=0.4,fall=0.6),
  ST('hp_percent_min',60),'battle','s15-marshrutka','Ларёк крепче, чем кажется, но четыре района его таки разберут: стреляй первым.','Четыре района одновременно',8)
L('m43','mission',5,'Вокзал на ночь','depot','evening','cavern',0.3,0.7,
  'Вокзальная ночь долгая: десять ходов, пока придёт поезд с утренней булкой. Пещера под перроном вроде ничья, но все районы считают иначе. Держись и сохрани кепку.',
  {'type':'survive_turns','turns':10},(5,100),[E(R,2,100,'hard'),E(P,2,100,'hard'),E(C,2,100,'hard'),E(LN,2,100,'hard')],
  A('full','','kozy:3 samogon:5 napalm:4'),S(wind=0.3,crates=0.5,mines=3,barrels=0.5,fall=0.7,sd='water',rising_water=0.5),
  ST('hp_percent_min',50),'sudden',None,'Вода всё-таки поднимется, так что пещера — не навсегда.','Десять ходов против четырёх районов',9)
L('m44','mission',5,'Стройка последнего дня','construction','grey','staircase',0.35,0.9,
  'Последний этаж, последний флаг, последний выговор от прораба. Забирайся наверх и ставь наш флаг, пока никто не спохватился. Плиты и отбойник — для самых нетерпеливых.',
  {'type':'reach_point','position':[0.5,0.04],'label':'флаг на крыше'},(5,100),[E(ZA,2,100,'hard'),E(P,2,100,'hard'),E(LN,2,100,'hard')],
  A('limited','plita:6 otboinik:6 rope:-1 ognetushitel:3 mukha:-1 limonka:-1 homing:2 marshrutka:1'),S(wind=0.5,crates=0.4,barrels=0.4,fall=0.7),
  ST('turns_max',12),'battle',None,'Плиту можно положить боком и пройти по ней, как по мосту.','Все утилиты на одном уровне',8)
L('m45','mission',5,'Авторитет','factory','night','arena',0.5,0.6,
  'Все пять районов вышли на завод, и посреди арены стоит сам Авторитет: триста ХП и кепка размером с трактор. Если ты его сдуешь, все сядут на лавочку и поделят семки. Если нет — всё равно сядут, но без тебя.',
  {'type':'eliminate'},(5,100),[E(LN,1,300,'hard',boss=True,name='Авторитет'),E(R,1,100,'hard'),E(ZA,1,100,'hard'),E(P,1,100,'hard'),E(C,1,100,'hard')],
  A('full','','napalm:4 samogon:5 kozy:3 truba:6 kirpichi:6'),S(turn=40,wind=0.5,crates=0.6,mines=3,barrels=0.5,fall=0.7),
  ST('turns_max',20),'sudden','s16-finale','Финал: оружие не жалей, но сначала сдуй мелочь — Авторитета она прикрывает.','Финальный босс: 300 ХП',10,boss=True)

# ============================================================ НА ВРЕМЯ (16)
def T(id,title,theme,time,arch,water,props,brief,obj,ars,sch,gold,silver,bronze,tip,diff,music='timed'):
    L(id,'trial',0,title,theme,time,arch,water,props,brief,obj,(1,100),[],ars,sch,
      {'1':{'type':'time_max','value':bronze},'2':{'type':'time_max','value':silver},'3':{'type':'time_max','value':gold}},
      music,None,tip,None,diff,medals_seconds={'gold':gold,'silver':silver,'bronze':bronze})
def TS(**k):
    base=dict(turn=120,wind='none',crates=0,barrels=0,fall=0,sd='none'); base.update(k); return S(**base)
T('r01','Верёвочный забег','garages','evening','cliff',0.4,0.3,'Крыши гаражей, верёвка, и ни одной ступеньки. Добеги до финиша, пока не стемнело — это вам не лавочка.',
  {'type':'race_time','checkpoints':5},A('custom','rope:-1'),TS(rope_only=True),55,75,100,'Не тормози на крюке: отпускай в верхней точке качания.',1)
T('r02','Реактивные кеды','depot','evening','valley',0.3,0.3,'Огнетушитель-ранец бьёт пеной не хуже реактивной тяги. Лети над депо от флага к флагу, пока топливо не кончилось.',
  {'type':'race_time','checkpoints':6},A('custom','ognetushitel:-1'),TS(),50,70,95,'Короткие импульсы экономят топливо: не держи кнопку всё время.',2)
T('r03','Мишени во дворе','yard','grey','hills',0.1,0.4,'Во дворе выросли десять мишеней, как грибы после дождя. «Макаров» и терпение — вот и весь рецепт.',
  {'type':'targets','count':10,'kind':'pop_up'},A('custom','makarov:-1'),TS(),30,45,65,'Не стой на месте: подползай к мишеням ближе — точность растёт.',1)
T('r04','Школьная полоса','school','day','staircase',0.1,0.5,'Полоса препятствий на стадионе: бег, прыжки, лазанье. Физрук с секундомером смотрит из окна.',
  {'type':'race_time','checkpoints':7},A('custom','rope:-1 kedy:-1'),TS(),60,80,105,'Кеды ускоряют бег, но не прыжок: не форсируй перед ямой.',2)
T('r05','Стройка вверх','construction','day','towers',0.2,0.8,'Башни, леса, краны — всё вверх. Добеги до верхней точки, пока прораб не позвал на обед.',
  {'type':'race_time','checkpoints':5},A('custom','rope:-1 plita:3 otboinik:2'),TS(),65,85,110,'Плиту клади на нужной высоте, а не там, где стоишь.',3)
T('r06','Тир на свалке','dump','grey','objects',0.3,0.9,'Двенадцать банок и бутылок на разных высотах. «Калаш» заряжен, настроение боевое.',
  {'type':'targets','count':12,'kind':'cans'},A('custom','kalash:-1'),TS(),40,55,80,'Очередь рассеивается: стреляй короткими, прицел держи на цели.',3)
T('r07','Над рекой','beach','day','islands',0.6,0.3,'Пляж с островами и огнетушителем: перелетай от острова к острову, не искупавшись.',
  {'type':'race_time','checkpoints':6},A('custom','ognetushitel:-1 rope:-1'),TS(),55,75,100,'Приземляйся на плоское: на склоне скатишься в воду.',3)
T('r08','Квас на выстрел','market','evening','arena',0.2,0.8,'Рынок кипит, и в мишени превратились все: шарики, самовары и пустые бутылки. Пулемёт тоже не лишний.',
  {'type':'targets','count':15,'kind':'moving'},A('custom','pulemet:-1 makarov:-1'),TS(),45,60,85,'Упреждай движущуюся цель: стреляй туда, где она будет.',4)
T('r09','Тепло-трасса','heating','night','cavern',0.4,0.5,'Узкий лаз в трубе, верёвка и огнетушитель — но кипяток поднимается. Успей добежать до выхода.',
  {'type':'race_time','checkpoints':6},A('custom','rope:-1 ognetushitel:-1 payalnik:-1'),TS(sd='water',rising_water=1.0),70,90,120,'Паяльной лампой прожги перегородку, а не обходи её.',5,music='sudden')
T('r10','Снайпер на льду','winter','winter','hills',0.3,0.5,'На проруби выставлены поплавки — их надо сбить рогаткой. Тишина, мороз и чёткий глаз.',
  {'type':'targets','count':12,'kind':'floats'},A('custom','sling:-1'),TS(wind=0.2),50,65,90,'Рогатка летит по дуге: дальние поплавки бери с запасом.',4)
T('r11','Дачный слалом','dacha','evening','valley',0.2,0.8,'Грядки, заборы и козы в качестве препятствий. Проскочи слалом на кедах — и не забудь вернуться за пустым ведром.',
  {'type':'race_time','checkpoints':8},A('custom','kedy:-1 rope:-1 zontik:-1'),TS(),55,75,100,'Зонтик замедляет падение — используй его над ямами.',4)
T('r12','Мишени с неба','factory','night','pit',0.3,0.7,'Мишени ездят по подвесным рельсам над заводом. Миномёт навесом достанет любую, было бы время.',
  {'type':'targets','count':10,'kind':'rails'},A('custom','mortar:-1 mukha:-1'),TS(wind=0.3),55,75,100,'Миномёт требует расчёта: бей в то место, куда мишень приедет.',5)
T('r13','Крыши гаражей','garages','night','maze',0.3,0.8,'Ночной забег по лабиринту из гаражных крыш. Ни ступенек, ни перил — только верёвка и отвага.',
  {'type':'race_time','checkpoints':8},A('custom','rope:-1 rezinka:-1 kedy:-1'),TS(),70,90,120,'Резинка выкидывает вверх, верёвка — вперёд; чередуй.',5)
T('r14','Гонка с плитами','construction','grey','bridge',0.4,0.7,'Между башнями — пропасть, а у тебя только плиты. Кладёшь, бежишь, снова кладёшь.',
  {'type':'race_time','checkpoints':5},A('custom','plita:6 rope:-1'),TS(),60,80,110,'Плит всего шесть: клади их внахлёст, по две на пропасть.',5)
T('r15','Дартс лимонками','school','evening','arena',0.1,0.6,'Лимонки отскакивают от стен и катятся в корзины-мишени. Восемь штук, пока не прозвенел звонок.',
  {'type':'targets','count':8,'kind':'baskets'},A('custom','limonka:-1'),TS(),40,55,80,'Бросай так, чтобы лимонка отскочила от стены: таймер подбирай по расстоянию.',4)
T('r16','Марафон двора','depot','night','floating',0.5,0.6,'Длинная трасса на всю карту: верёвка, ранец, зонтик, плиты — всё сразу. Для настоящих пацанов, которые ещё и без остановок.',
  {'type':'race_time','checkpoints':12},A('custom','rope:-1 ognetushitel:-1 zontik:-1 plita:4 kedy:-1 rezinka:-1'),TS(sd='water',rising_water=0.5),120,150,190,'Пройди без остановок: не заходи в тупики, плиту ставь заранее.',7)

# ============================================================ ПРОВЕРКИ
ARCH = 'hills islands cavern bridge towers pit fortress staircase floating valley cliff maze arena objects'.split()
ids = [l['id'] for l in LV]
assert len(ids) == len(set(ids)) == 66
M = [l for l in LV if l['mode'] == 'mission']
assert len(M) == 45
ws = {w[0] for w in mj.WEAPONS}; sk = {s[0] for s in mj.SKETCHES}
for l in LV:
    th = mj.THEMES[l['theme']]; assert l['time'] in th['times'], (l['id'], l['time'])
    assert l['terrain']['archetype'] in ARCH, l['id']
    for k in list(l['arsenal']['weapons']) + list(l['arsenal']['delays']): assert k in ws, (l['id'], k)
    assert l['cutscene_after'] is None or l['cutscene_after'] in sk, l['id']
for a, b in zip(M, M[1:]):
    assert a['theme'] != b['theme'], (a['id'], 'theme')
    assert a['objective']['type'] != b['objective']['type'], (a['id'], 'obj')
th = Counter(l['theme'] for l in M); ob = Counter(l['objective']['type'] for l in M)
assert len(th) == 12 and min(th.values()) >= 3 and max(ob.values()) <= 10, (th, ob)
cuts = {l['id']: l['cutscene_after'] for l in M if l['cutscene_after']}
assert len(set(cuts.values())) == len(cuts)
json.dump(LV, open('G:/Claude/Shish/docs/gops/levels/missions.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(th); print(ob); print(Counter(l['time'] for l in M)); print(Counter(l['terrain']['archetype'] for l in M))
print(cuts); print(Counter(l['music'] for l in M))
print(Counter(l['enemies'][0]['bot'] for l in M if l['enemies']))
pickle.dump((LV, mj.THEMES, [(w[0], w[1]) for w in mj.WEAPONS]), open('G:/temp/studio/levels-lv.pkl', 'wb'))
