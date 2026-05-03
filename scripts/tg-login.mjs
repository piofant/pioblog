/**
 * tg-login.mjs — одноразовый helper для генерации TG_SESSION_STRING.
 *
 * Запуск (локально, не в CI):
 *   TG_API_ID=12345 TG_API_HASH=abcdef... node scripts/tg-login.mjs
 *
 * Что попросит:
 *   1. Phone (в формате +79..., с +)
 *   2. SMS-код из Telegram
 *   3. 2FA пароль (если есть)
 *
 * На выходе — длинная строка sessionString, которую кладёшь в GitHub
 * Settings → Secrets как TG_SESSION_STRING. Один раз — живёт месяцами.
 *
 * Эта строка даёт ПОЛНЫЙ доступ к твоему TG-аккаунту. Никому не показывай,
 * не коммить в репо. Если утекла — Telegram → Settings → Devices → Terminate.
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;

if (!apiId || !apiHash) {
	console.error('💥 Set TG_API_ID и TG_API_HASH в env (получи на my.telegram.org)');
	console.error('   TG_API_ID=12345 TG_API_HASH=abc... node scripts/tg-login.mjs');
	process.exit(1);
}

const stringSession = new StringSession(''); // empty → создадим новую

console.log('\n🔐 Логинимся в TG для получения session string...\n');

const client = new TelegramClient(stringSession, apiId, apiHash, {
	connectionRetries: 5,
});

await client.start({
	phoneNumber: async () => await input.text('📱 Phone (+79...): '),
	password: async () => await input.text('🔑 2FA password (если есть, иначе Enter): '),
	phoneCode: async () => await input.text('💬 Код из TG: '),
	onError: (err) => console.error('error:', err),
});

console.log('\n✅ Логин успешен!\n');
console.log('━'.repeat(72));
console.log('TG_SESSION_STRING:');
console.log(client.session.save());
console.log('━'.repeat(72));
console.log('\n📋 Скопируй строку выше → GitHub repo → Settings → Secrets and variables');
console.log('   → Actions → New repository secret → Name: TG_SESSION_STRING');
console.log('\n   Также добавь TG_API_ID и TG_API_HASH тем же путём.');
console.log('\n⚠️  Эта строка = доступ ко всему аккаунту. Не коммить, не показывай.\n');

await client.disconnect();
process.exit(0);
