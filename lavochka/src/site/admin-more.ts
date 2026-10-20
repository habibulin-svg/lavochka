/* Админка: разделы «Игроки», «Ошибки», «Обращения» (src/site/admin.ts открывает их по адресу). */
export async function drawTab(tab: string, body: HTMLElement): Promise<void> {
  body.innerHTML = `<div class="adm-card"><p>Раздел «${tab}» — скоро.</p></div>`;
}
