"""Страница прослушивания кита «Dance With Me!»: сэмплы по группам и темам, фильтр по стилю и поиск,
щелчок — включить/выключить слой (играет в такт с остальными, «Авто-аккорды» ведут Am–F–C–G), миксы-образцы.
Пишет index.html в G:/temp/studio/out/music-studio/kit (сервер — конфигурация «music-kit», :8791).

G:/ai/venvs/music/Scripts/python.exe studio/music/dance/listen.py
"""
import json
import pathlib

OUT = pathlib.Path('G:/temp/studio/out/music-studio/kit')
GROUPS = [('loop', 'Лупы ударных', '#e8504f'), ('drum', 'Ударные', '#f08a3c'), ('bass', 'Бас', '#3c78f0'),
          ('layer', 'Подложки', '#8e5cf0'), ('keys', 'Клавишные', '#3cc0a0'), ('seq', 'Секвенции', '#f0c83c'),
          ('synth', 'Синты', '#f05cc0'), ('fx', 'Эффекты', '#7fb3c8'), ('rap', 'Выкрики и рэп', '#9ad04a'),
          ('voice', 'Женский вокал', '#f0a0a0')]
STYLES = [('', 'все стили'), ('euro', 'евродэнс'), ('house', 'хаус'), ('trance', 'транс'), ('dream', 'дрим-хаус')]

kits = {b: json.loads((OUT / str(b) / 'manifest.json').read_text(encoding='utf-8')) for b in (128, 140)}
for b, man in kits.items():  # в браузер — только нужное
    kits[b] = [{k: e.get(k) for k in ('group', 'name', 'bars', 'loop', 'chord', 'family', 'theme', 'style', 'text', 'file')}
               for e in man]
mixes = sorted(p.name for p in OUT.glob('mix-*.wav'))
html = """<!doctype html><meta charset=utf-8><title>Dance With Me! — кит</title>
<meta name=viewport content="width=device-width,initial-scale=1">
<style>
body{background:#14161c;color:#e8e8e8;font:15px system-ui;margin:16px}
h1{font-size:20px;margin:0 0 4px} .sub{color:#9aa;margin-bottom:12px;max-width:900px}
.bar{position:sticky;top:0;background:#14161c;padding:8px 0;display:flex;gap:8px;align-items:center;z-index:2;flex-wrap:wrap}
button,select,input{background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 10px;font:inherit}
button{cursor:pointer} button.on{outline:2px solid #fff} .tempo.on{background:#555}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0}
.tab{color:#111;font-weight:600;border:none} .tab.on{outline:3px solid #fff}
.row{margin:4px 0;display:flex;flex-wrap:wrap;align-items:center;gap:3px}
.row .t{min-width:170px;color:#bbb;font-size:13px}
.s{display:inline-block;padding:5px 8px;border-radius:5px;cursor:pointer;color:#111;font-weight:600;user-select:none;font-size:13px}
.s.on{outline:3px solid #fff;filter:brightness(1.25)} .s small{font-weight:400;opacity:.7}
#pos{font:600 18px monospace;color:#7f7;min-width:110px}
audio{width:300px;vertical-align:middle}
.mix{margin:3px 0;font-size:13px}
</style>
<h1>Lavochka Music Studio — «Dance With Me!» · кит</h1>
<div class=sub>Щелчок по сэмплу — слой включается с ближайшего такта и играет вместе с остальными. Звёздочки — аккорды Am · F · C · G.
«Авто-аккорды» сами переключают * → ** → *** → **** каждые 2 такта (нарезка Cut на 1 такт звучит на аккорде дважды).
Тема — строка: 4 аккорда, нарезки Cut, вся последовательность Am-F-C-G, Reverse.</div>
<div class=bar><button class="tempo on" data-b=128>128 BPM</button><button class=tempo data-b=140>140 BPM</button>
<select id=style>""" + ''.join(f'<option value="{k}">{v}</option>' for k, v in STYLES) + """</select>
<input id=q placeholder="поиск" size=12>
<button id=auto class=on>Авто-аккорды</button><button id=stop>Стоп всё</button><span id=pos>—</span><span id=count></span></div>
<div class=tabs id=tabs></div>
<div id=kit></div>
<h2>Случайные миксы (собраны скриптом из этих же сэмплов по правилам: стиль, гармония по 2 такта на аккорд)</h2>
""" + ''.join(f'<div class=mix>{m} <audio controls preload=none src="{m}"></audio></div>' for m in mixes) + """
<script>
const KITS=""" + json.dumps(kits, ensure_ascii=False, separators=(',', ':')) + """, GROUPS=""" + json.dumps(GROUPS, ensure_ascii=False) + """;
const CH=['Am','F','C','G'];
let bpm=128, ctx, buf={}, on=new Map(), t0=0, timer=null, auto=true, group='loop', style='', q='';
const kit=()=>KITS[bpm], barS=()=>240/bpm;
function visible(){return kit().filter(e=>e.group===group&&(!style||!e.style||e.style===style)&&(!q||(e.name+' '+(e.text||'')).toLowerCase().includes(q)))}
function tabs(){const t=document.getElementById('tabs');t.innerHTML='';
 for(const [g,title,col] of GROUPS){const n=kit().filter(e=>e.group===g).length; if(!n)continue;
  const b=document.createElement('button');b.className='tab'+(g===group?' on':'');b.style.background=col;b.textContent=title+' · '+n;
  b.onclick=()=>{group=g;tabs();draw()};t.appendChild(b)}}
function draw(){const k=document.getElementById('kit');k.innerHTML='';const col=GROUPS.find(x=>x[0]===group)[2];
 const items=visible(); document.getElementById('count').textContent=items.length+' сэмплов';
 const rows=new Map(); for(const e of items){const key=e.theme||e.name; if(!rows.has(key))rows.set(key,[]); rows.get(key).push(e)}
 for(const [key,list] of rows){const r=document.createElement('div');r.className='row';
  r.innerHTML='<span class=t>'+key+(list[0].style?' · '+list[0].style:'')+'</span>';
  for(const e of list){const s=document.createElement('span');s.className='s'+(on.has(e.name)?' on':'');s.style.background=col;
   s.title=e.text||'';
   s.innerHTML=e.name.replace(key,'').trim()||e.name; s.innerHTML+=' <small>'+e.bars+'т'+(e.chord?' '+e.chord:'')+'</small>';
   s.onclick=()=>toggle(e,s);r.appendChild(s)}
  k.appendChild(r)}}
async function load(e){const key=bpm+'/'+e.file; if(!buf[key]){const r=await fetch(bpm+'/'+e.file);buf[key]=await ctx.decodeAudioData(await r.arrayBuffer())} return buf[key]}
async function toggle(e,el){ctx=ctx||new AudioContext(); if(ctx.state!=='running')await ctx.resume();
 if(on.has(e.name)){on.delete(e.name);el.classList.remove('on');return}
 await load(e); if(e.family) for(const x of kit()) if(x.family===e.family) await load(x);
 on.set(e.name,{e,next:null}); el.classList.add('on'); if(!timer){t0=ctx.currentTime+0.1;timer=setInterval(tick,25)}}
function tick(){const now=ctx.currentTime, bar=barS(); const ahead=now+0.15;
 for(const [name,st] of on){const e=st.e; if(st.next===null){st.next=t0+Math.ceil((now+0.05-t0)/bar)*bar}
  while(st.next<ahead){let x=e; if(auto&&e.family){const step=Math.floor(Math.round((st.next-t0)/bar)/2)%4;
     x=kit().find(y=>y.family===e.family&&y.chord===CH[step])||e}
   const src=ctx.createBufferSource();src.buffer=buf[bpm+'/'+x.file];src.connect(ctx.destination);src.start(st.next);
   const rep=e.loop||(auto&&e.family);
   st.next+=rep? x.bars*bar : 1e9}}
 const b=Math.floor((now-t0)/bar);document.getElementById('pos').textContent='такт '+(b+1)+' · '+CH[Math.floor(b/2)%4];}
document.querySelectorAll('.tempo').forEach(b=>b.onclick=()=>{stopAll();bpm=+b.dataset.b;document.querySelectorAll('.tempo').forEach(x=>x.classList.toggle('on',x===b));tabs();draw()});
function stopAll(){on.clear();clearInterval(timer);timer=null;if(ctx){ctx.close();ctx=null;buf={}}draw();document.getElementById('pos').textContent='—'}
document.getElementById('stop').onclick=stopAll;
document.getElementById('auto').onclick=e=>{auto=!auto;e.target.classList.toggle('on',auto)};
document.getElementById('style').onchange=e=>{style=e.target.value;draw()};
document.getElementById('q').oninput=e=>{q=e.target.value.toLowerCase();draw()};
tabs();draw();
</script>"""
(OUT / 'index.html').write_text(html, encoding='utf-8')
print(OUT / 'index.html', sum(len(v) for v in kits.values()) // 2, 'сэмплов')
