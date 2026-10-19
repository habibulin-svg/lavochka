/* Команды на сервере (не через сайт): завести Мастера, выдать/забрать право, посмотреть игрока.
 * На сервере: `ssh -t lavochka lavochka-admin <команда>` (обёртка deploy/lavochka-admin.sh: переменные базы из
 * /etc/lavochka.env, запуск от имени lavochka). Локально (база в памяти) смысла нет.
 *
 *   create-master <почта> [имя]     — пароль спросит дважды (не виден), выдаст ключ для приложения-кодов
 *                                      (Яндекс Ключ, Google Authenticator…), проверит код и даст право master
 *   grant <почта> <право> [дней]     — выдать право (без дней — бессрочно); права: src/core/rights.ts
 *   revoke <почта> <право>
 *   user <почта>                     — кто это и какие права */
import { createInterface } from 'node:readline';
import { RIGHTS } from '../src/core/rights';
import { checkTotp, hashPassword, newTotpSecret, otpauthUrl } from './accounts/crypto';
import { cleanName, normEmail, validEmail, validPassword } from './accounts/accounts';
import { storeFromEnv } from './accounts';

const store = storeFromEnv((s) => console.log(s));

function ask(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(q, (a) => (rl.close(), ok(a.trim()))));
}

/** Ввод без эха (пароль). */
function askHidden(q: string): Promise<string> {
  return new Promise((ok, bad) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return bad(new Error('нужен терминал: ssh -t lavochka lavochka-admin …'));
    process.stdout.write(q);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let s = '';
    const on = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', on);
          process.stdout.write('\n');
          return ok(s);
        }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') s = s.slice(0, -1);
        else s += c;
      }
    };
    stdin.on('data', on);
  });
}

async function userOf(email: string) {
  const u = await store.userByEmail(normEmail(email));
  if (!u) throw new Error('нет игрока с почтой ' + email);
  return u;
}

async function main() {
  const [cmd, a, b, c] = process.argv.slice(2);
  await store.init();
  if (cmd === 'create-master') {
    const email = normEmail(a);
    if (!validEmail(email)) throw new Error('укажите почту: lavochka-admin create-master <почта> [имя]');
    const name = cleanName(b) ?? 'Мастер';
    const pw = await askHidden('Пароль Мастера (от 12 знаков): ');
    if (!validPassword(pw) || pw.length < 12) throw new Error('пароль — от 12 знаков');
    if ((await askHidden('Ещё раз: ')) !== pw) throw new Error('пароли не совпали');
    const secret = newTotpSecret();
    console.log('\nВторой фактор. В приложении-генераторе кодов (Яндекс Ключ, Google Authenticator, …) добавьте аккаунт');
    console.log('вручную — ключом:\n');
    console.log('   ' + secret.replace(/(.{4})/g, '$1 ').trim());
    console.log('\n(или ссылкой: ' + otpauthUrl(secret, email) + ')\n');
    for (let i = 0; ; i++) {
      const code = (await ask('Код из приложения (6 цифр): ')).replace(/\s/g, '');
      if (checkTotp(secret, code)) break;
      if (i >= 4) throw new Error('код не подошёл — проверьте время на телефоне и запустите команду заново');
      console.log('Не подошёл, ещё раз.');
    }
    let u = await store.userByEmail(email);
    if (u) await store.updateUser(u.id, { passwordHash: await hashPassword(pw), totpSecret: secret, emailVerified: true, name });
    else u = await store.createUser({ email, name, passwordHash: await hashPassword(pw), emailVerified: true });
    await store.updateUser(u.id, { totpSecret: secret });
    await store.grant(u.id, 'master', null, null);
    await store.deleteUserSessions(u.id);
    console.log(`\nГотово: ${email} — Мастер. Вход на сайте: почта, пароль и код из приложения.`);
  } else if (cmd === 'grant' || cmd === 'revoke') {
    if (!Object.hasOwn(RIGHTS, b ?? '')) throw new Error('право — одно из: ' + Object.keys(RIGHTS).join(', '));
    const u = await userOf(a);
    if (cmd === 'grant') {
      const days = Number(c) || 0;
      await store.grant(u.id, b, days ? Date.now() + days * 86_400_000 : null, null);
      console.log(`${u.email}: ${b} ${days ? 'на ' + days + ' дн.' : 'бессрочно'}`);
    } else {
      await store.revoke(u.id, b);
      console.log(`${u.email}: ${b} снято`);
    }
  } else if (cmd === 'user') {
    const u = await userOf(a);
    const rights = await store.rights(u.id, Date.now());
    console.log(`#${u.id} ${u.name} <${u.email}>${u.emailVerified ? '' : ' (почта не подтверждена)'}, с ${new Date(u.createdAt).toLocaleDateString('ru-RU')}`);
    console.log('права: ' + (rights.map((r) => r.right + (r.until ? ' до ' + new Date(r.until).toLocaleDateString('ru-RU') : '')).join(', ') || 'нет'));
  } else {
    console.log('команды: create-master <почта> [имя] | grant <почта> <право> [дней] | revoke <почта> <право> | user <почта>');
  }
}

main()
  .then(() => store.close())
  .catch(async (e) => {
    console.error('Ошибка: ' + (e as Error).message);
    await store.close();
    process.exit(1);
  });
