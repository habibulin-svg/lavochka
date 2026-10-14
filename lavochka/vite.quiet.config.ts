// Служебный конфиг: dev-сервер без автообновления страницы (проверки в браузере, пока рядом правят код).
import base from './vite.config';
export default { ...base, server: { ...base.server, port: 5175, hmr: false, watch: null } };
