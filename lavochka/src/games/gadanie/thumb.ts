/* Превью карточки (?thumb=gadanie): скатерть, три карты таро и бубновый туз с червонной дамой. */
import { backUrl, smallUrl } from './faces';

export function mountThumb(el: HTMLElement) {
  const t = (c: number, x: number, y: number, r: number, w = 21) => `<img src="${smallUrl('taro', c)}" style="left:${x}%;top:${y}%;width:${w}%;transform:rotate(${r}deg)" alt="">`;
  const k = (c: number, x: number, y: number, r: number) => `<img src="${smallUrl('karty', c)}" style="left:${x}%;top:${y}%;width:17%;transform:rotate(${r}deg)" alt="">`;
  el.innerHTML = `<div class="gd-thumb">
    <img src="${backUrl('taro')}" style="left:4%;top:16%;width:19%;transform:rotate(-14deg)" alt="">
    ${t(18, 23, 9, -4)}${t(17, 41, 5, 0, 22)}${t(19, 60, 9, 5)}
    ${k(26, 76, 40, 14)}${k(33, 66, 50, 4)}
  </div>`;
}
