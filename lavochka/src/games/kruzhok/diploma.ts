/* Шахматный кружок — грамота за пройденную часть пути: лист в духе грамот Дома пионеров, который можно распечатать
 * или сохранить в PDF (печать браузера). Открывается в новом окне. */
import { esc } from '../../core/util';
import { settings } from '../../core/settings';

export function openDiploma(part: string, date: string, stars: number) {
  const w = window.open('', '_blank');
  if (!w) return false;
  const name = settings.name?.trim() || 'Ученик кружка';
  w.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Грамота — ${esc(part)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  body { margin: 0; font-family: 'PT Serif', Georgia, serif; background: #e9e1cc; }
  .g { box-sizing: border-box; width: 297mm; height: 210mm; margin: 0 auto; padding: 18mm 24mm; background: #fffaf0; position: relative;
       border: 6mm solid #b5262a; outline: 1.5mm solid #d9a520; outline-offset: -9mm; text-align: center; color: #3a1a08; }
  .star { font-size: 44px; color: #b5262a; }
  h1 { font-size: 64px; letter-spacing: 6px; margin: 4mm 0 2mm; color: #b5262a; font-weight: 700; }
  .sub { font-size: 20px; text-transform: uppercase; letter-spacing: 3px; }
  .who { font-size: 40px; margin: 10mm 0 4mm; font-style: italic; border-bottom: 1px solid #3a1a08; display: inline-block; padding: 0 12mm 2mm; }
  .what { font-size: 22px; line-height: 1.5; max-width: 200mm; margin: 4mm auto; }
  .foot { position: absolute; left: 24mm; right: 24mm; bottom: 20mm; display: flex; justify-content: space-between; font-size: 18px; }
  .sign { border-top: 1px solid #3a1a08; padding-top: 2mm; min-width: 70mm; }
  .print { position: fixed; top: 10px; right: 10px; font-size: 16px; padding: 8px 14px; }
  @media print { .print { display: none; } body { background: none; } }
</style></head><body>
<button class="print" onclick="print()">Распечатать</button>
<div class="g">
  <div class="star">★</div>
  <h1>ГРАМОТА</h1>
  <div class="sub">шахматный кружок «Вечером на лавочке»</div>
  <div class="who">${esc(name)}</div>
  <div class="what">за успешную сдачу зачёта по разделу<br><b>«${esc(part)}»</b><br>и старание в занятиях · ⭐ ${stars} звёзд кружка</div>
  <div class="foot"><div class="sign">${esc(date)}</div><div class="sign">Руководитель кружка — Михалыч</div></div>
</div></body></html>`);
  w.document.close();
  return true;
}
