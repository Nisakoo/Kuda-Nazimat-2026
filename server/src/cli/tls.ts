import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadServerConfig } from '../app/config.ts';
import { lanAddresses } from '../common/network.ts';
import { certificateCheck } from '../app/selfCheck.ts';
import { certificateNames, loadCertificate, renewCertificate } from '../tls/store.ts';

const USAGE = 'Использование: npm --prefix server run tls -- status | init | renew --yes | export <файл> [--env ...] [--config <путь>]';

/** TLS-014: no network, no game database; only the certificate directory. */
async function main(): Promise<void> {
  const args = process.argv.slice(2); const yes = args.includes('--yes');
  const { config, args: parsed } = await loadServerConfig(args.filter((arg) => arg !== '--yes'));
  const [command, target] = parsed.rest;
  const addresses = lanAddresses(); const names = certificateNames(config.tls, addresses);
  if (command === 'status') {
    const check = certificateCheck(config, addresses);
    process.stdout.write(`${check.ok ? 'OK ' : 'ОШИБКА '}${check.detail}\n`);
    process.exitCode = check.ok ? 0 : 1;
  } else if (command === 'init') {
    const certificate = await loadCertificate(config.tls, names, new Date());
    process.stdout.write(`${certificate.created ? 'Создан' : 'Уже есть'} сертификат ${certificate.certPath}\nSHA-256: ${certificate.info.fingerprint}\nАдреса: ${certificate.info.names.join(', ')}\n`);
    if (certificate.uncovered.length) process.stdout.write(`Не покрыты текущие адреса: ${certificate.uncovered.join(', ')} — tls renew --yes\n`);
  } else if (command === 'renew') {
    if (!yes) { process.stderr.write('Новый сертификат нужно будет заново установить на всех устройствах игроков. Подтвердите: tls renew --yes\n'); process.exitCode = 1; return; }
    const certificate = await renewCertificate(config.tls, names, new Date());
    process.stdout.write(`Выпущен новый сертификат ${certificate.certPath}\nSHA-256: ${certificate.info.fingerprint}\nПерезапустите сервер и попросите игроков пройти страницу /setup заново.\n`);
  } else if (command === 'export' && target) {
    const certificate = await loadCertificate(config.tls, names, new Date());
    await writeFile(resolve(target), certificate.cert, { flag: 'wx' });
    process.stdout.write(`Сертификат (без ключа) сохранён: ${resolve(target)}\nSHA-256: ${certificate.info.fingerprint}\n`);
  } else { process.stderr.write(`${USAGE}\n`); process.exitCode = 1; }
}

main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'Ошибка'}\n`); process.exitCode = 1; });
