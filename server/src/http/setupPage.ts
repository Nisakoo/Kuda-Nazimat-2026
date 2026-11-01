import type { CertificateInfo } from '../tls/certificate.ts';

export interface SetupView { readonly info: CertificateInfo; readonly host: string }

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const date = (value: Date) => value.toISOString().slice(0, 10);

/** TLS-010: static trust page, the same over HTTP and HTTPS; no scripts, no players, no internal paths. */
export function setupPage({ info, host }: SetupView): string {
  const game = escape(`https://${host}/`);
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Вавилон — доверие сертификату</title>
<style>
  body { font: 17px/1.5 system-ui, sans-serif; max-width: 760px; margin: 24px auto; padding: 0 16px; color: #1f1a14; background: #fbf7ef; }
  h1 { font-size: 26px; } h2 { font-size: 19px; margin-top: 28px; }
  .print { font: 600 20px/1.6 ui-monospace, monospace; word-spacing: 6px; background: #fff; border: 2px solid #c9b48a; border-radius: 8px; padding: 10px 14px; }
  .button { display: inline-block; padding: 10px 18px; border-radius: 8px; background: #8a5a1f; color: #fff; text-decoration: none; font-weight: 600; margin: 6px 8px 6px 0; }
  .muted { color: #6b5f50; font-size: 15px; } li { margin: 4px 0; }
</style>
</head>
<body>
<h1>Вавилон: один раз доверьтесь серверу</h1>
<p>Игра работает по защищённому соединению. Сертификат выпустил ноутбук ведущего, поэтому браузер ещё не знает его. Сделайте это один раз на этом устройстве.</p>
<p><a class="button" href="/server.crt" download="babylon-server.crt">1. Скачать сертификат</a></p>
<h2>2. Сверьте отпечаток с экраном ведущего</h2>
<p>SHA-256:</p>
<p class="print">${escape(info.fingerprint)}</p>
<p class="muted">Windows показывает SHA-1: <span class="print" style="font-size:15px">${escape(info.fingerprintSha1)}</span></p>
<p>Если отпечаток не совпадает с тем, что показывает ведущий, не устанавливайте файл: его могли подменить в сети.</p>
<h2>3. Установите сертификат</h2>
<p><strong>macOS (Safari, Chrome, Edge)</strong></p>
<ol>
  <li>Откройте скачанный файл: он попадёт в «Связку ключей», связка «Вход».</li>
  <li>Дважды щёлкните сертификат «${escape(info.names[0] ?? '')}», раскройте «Доверие».</li>
  <li>«При использовании этого сертификата» → «Всегда доверять», закройте окно и подтвердите паролем.</li>
</ol>
<p><strong>Windows (Chrome, Edge)</strong></p>
<ol>
  <li>Откройте скачанный файл → «Установить сертификат» → «Текущий пользователь».</li>
  <li>«Поместить все сертификаты в следующее хранилище» → «Обзор» → «Доверенные корневые центры сертификации».</li>
  <li>«Готово», в предупреждении сверьте отпечаток SHA-1 и нажмите «Да».</li>
</ol>
<p><strong>Linux, ChromeOS (Chrome, Chromium)</strong></p>
<ol><li>Откройте <code>chrome://certificate-manager</code> → «Локальные сертификаты» → «Установленные вами» → «Импорт» в доверенные, выберите файл.</li></ol>
<p><strong>Firefox (любая ОС)</strong></p>
<ol>
  <li>Настройки → «Приватность и защита» → «Сертификаты» → «Просмотр сертификатов» → вкладка «Серверы» → «Добавить исключение».</li>
  <li>Адрес <code>${game}</code> → «Получить сертификат» → «Просмотреть»: сверьте SHA-256.</li>
  <li>Оставьте «Постоянно хранить это исключение» → «Подтвердить».</li>
</ol>
<p>После установки перезапустите браузер.</p>
<h2>4. Проверьте</h2>
<p><a class="button" href="${game}">Открыть игру</a></p>
<p class="muted">Замок без предупреждений — всё готово. Сертификат действует до ${date(info.notAfter)}. Адреса в сертификате: ${escape(info.names.join(', '))}. Если ведущий выпустит новый сертификат, эту страницу нужно пройти заново.</p>
</body>
</html>
`;
}
