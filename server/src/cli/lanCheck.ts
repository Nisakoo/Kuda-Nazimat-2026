import { loadServerConfig } from '../app/config.ts';
import { lanCheck } from '../app/selfCheck.ts';
try {
  const { config } = await loadServerConfig();
  console.log(`Окружение: ${config.env}`);
  const checks = await lanCheck(config);
  for (const check of checks) console.log(`${check.ok ? 'OK  ' : 'FAIL'} ${check.name.padEnd(11)} ${check.detail}`);
  if (checks.some((check) => !check.ok)) { console.log('\nЗапуск невозможен: исправьте строки FAIL.'); process.exitCode = 1; }
} catch (error) { console.error(error instanceof Error ? error.message : 'Ошибка проверки'); process.exitCode = 1; }
