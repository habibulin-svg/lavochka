"""Страница прослушивания прототипа: сэмплы по группам, щелчок — включить/выключить слой (играет в такт с остальными),
миксы-образцы. Пишет index.html в G:/temp/studio/out/music-studio/proto (сервер — конфигурация «music-proto»).
"""
import json
import pathlib

OUT = pathlib.Path('G:/temp/studio/out/music-studio/proto')
GROUPS = [('loop', 'Лупы ударных', '#e8504f'), ('drum', 'Ударные', '#f08a3c'), ('bass', 'Бас', '#3c78f0'),
          ('layer', 'Подложки', '#8e5cf0'), ('keys', 'Клавишные', '#3cc0a0'), ('seq', 'Секвенции', '#f0c83c'),
          ('synth', 'Синты', '#f05cc0'), ('fx', 'Эффекты', '#7fb3c8'), ('rap', 'Выкрики', '#9ad04a')]

kits = {b: json.loads((OUT / str(b) / 'manifest.json').read_text(encoding='utf-8')) for b in (128, 140)}
mixes = sorted(p.name for p in OUT.glob('mix-*.wav'))
html = """<!doctype html><meta charset=utf-8><title>Dance With Me! — прототип</title>
<style>
body{background:#14161c;color:#e8e8e8;font:15px system-ui;margin:16px}
h1{font-size:20px;margin:0 0 4px} .sub{color:#9aa;margin-bottom:12px}
.bar{position:sticky;top:0;background:#14161c;padding:8px 0;display:flex;gap:8px;align-items:center;z-index:2;flex-wrap:wrap}
button{background:#2a2e38;color:#eee;border:1px solid #444;border-radius:6px;padding:6px 10px;cursor:pointer;font:inherit}
button.on{outline:2px solid #fff} .tempo.on{background:#555}
.g{margin:12px 0} .g h2{font-size:15px;margin:0 0 6px}
.s{display:inline-block;margin:3px;padding:6px 9px;border-radius:5px;cursor:pointer;color:#111;font-weight:600;user-select:none}
.s.on{outline:3px solid #fff;filter:brightness(1.25)} .s small{font-weight:400;opacity:.7}
#pos{font:600 18px monospace;color:#7f7;min-width:90px}
audio{width:340px;vertical-align:middle}
</style>
<h1>Lavochka Music Studio — «Dance With Me!» · звук-прототип</h1>
<div class=sub>Щелчок по сэмплу — слой включается с ближайшего такта и играет вместе с остальными. Звёздочки — аккорды Am · F · C · G.
Сэмплы со звёздочками одного вида ставь по очереди: «Авто-аккорды» сам переключает * → ** → *** → **** каждые 2 такта.</div>
<div class=bar><button class="tempo on" data-b=128>128 BPM</button><button class=tempo data-b=140>140 BPM</button>
<button id=auto class=on>Авто-аккорды</button><button id=stop>Стоп всё</button><span id=pos>—</span></div>
<div id=kit></div>
<h2>Миксы-образцы (собраны скриптом из этих же сэмплов)</h2>
""" + ''.join(f'<div>{m} <audio controls preload=none src="{m}"></audio></div>' for m in mixes) + """
<script>
const KITS=""" + json.dumps(kits, ensure_ascii=False) + """, GROUPS=""" + json.dumps(GROUPS, ensure_ascii=False) + """;
let bpm=128, ctx, buf={}, on=new Map(), t0=0, timer=null, auto=true;
const kit=()=>KITS[bpm], barS=()=>240/bpm;
function draw(){const k=document.getElementById('kit');k.innerHTML='';
 for(const [g,title,col] of GROUPS){const items=kit().filter(e=>e.group===g); if(!items.length)continue;
  const d=document.createElement('div');d.className='g';d.innerHTML='<h2>'+title+' · '+items.length+'</h2>';
  for(const e of items){const s=document.createElement('span');s.className='s'+(on.has(e.name)?' on':'');s.style.background=col;
   s.innerHTML=e.name+' <small>'+e.bars+' т'+(e.chord?' · '+e.chord:'')+'</small>';s.onclick=()=>toggle(e,s);d.appendChild(s)}
  k.appendChild(d)}}
async function load(e){const key=bpm+'/'+e.file; if(!buf[key]){const r=await fetch(bpm+'/'+e.file.replaceAll('\\\\','/'));buf[key]=await ctx.decodeAudioData(await r.arrayBuffer())} return buf[key]}
function family(e){return e.chord? e.name.replace(/ \\*+$/,''):null}
async function toggle(e,el){ctx=ctx||new AudioContext(); if(ctx.state!=='running')await ctx.resume();
 if(on.has(e.name)){on.delete(e.name);el.classList.remove('on');return}
 await load(e); for(const x of kit()) if(family(x)&&family(x)===family(e)) await load(x);
 on.set(e.name,{e,next:null}); el.classList.add('on'); if(!timer){t0=ctx.currentTime+0.1;timer=setInterval(tick,25)}}
function tick(){const now=ctx.currentTime, bar=barS(); const ahead=now+0.15;
 for(const [name,st] of on){const e=st.e; if(st.next===null){st.next=t0+Math.ceil((now+0.05-t0)/bar)*bar}
  while(st.next<ahead){let x=e; if(auto&&family(e)){const step=Math.round((st.next-t0)/bar/2)%4;
     x=kit().find(y=>family(y)===family(e)&&y.chord===['Am','F','C','G'][step])||e}
   const src=ctx.createBufferSource();src.buffer=buf[bpm+'/'+x.file];src.connect(ctx.destination);src.start(st.next);
   st.next+=x.bars*bar*(e.loop||auto&&family(e)?1:1e9)}}
 const b=Math.floor((now-t0)/bar);document.getElementById('pos').textContent='такт '+(b+1)+' · '+(['Am','F','C','G'][Math.floor(b/2)%4]);}
document.querySelectorAll('.tempo').forEach(b=>b.onclick=()=>{stopAll();bpm=+b.dataset.b;document.querySelectorAll('.tempo').forEach(x=>x.classList.toggle('on',x===b));draw()});
function stopAll(){on.clear();clearInterval(timer);timer=null;if(ctx){ctx.close();ctx=null;buf={}}draw();document.getElementById('pos').textContent='—'}
document.getElementById('stop').onclick=stopAll;
document.getElementById('auto').onclick=e=>{auto=!auto;e.target.classList.toggle('on',auto)};
draw();
</script>"""
(OUT / 'index.html').write_text(html, encoding='utf-8')
print(OUT / 'index.html')
