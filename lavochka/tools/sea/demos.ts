/* Прогон показов правил с выводом событий: npx tsx tools/sea/demos.ts */
import { RiggedRng, SeededRng } from '../../src/core/rng';
import { def } from '../../src/games/sea/def';
for (const sec of def.rules.sections) {
  const d = sec.demo;
  if (!d) continue;
  console.log('\n== ' + sec.title);
  const rng = new RiggedRng(new SeededRng(20240607));
  let s = d.setup!(def, rng);
  for (const st of d.steps) {
    rng.rig(st.rig);
    const r = def.apply(s, st.seat, st.action, rng);
    if (!r) { console.log('  ОТКЛОНЁН', JSON.stringify(st.action)); break; }
    console.log('  ' + (st.caption ?? '').slice(0, 60));
    for (const e of r.events) console.log('     ', JSON.stringify(e).slice(0, 200));
    s = r.state;
  }
}
