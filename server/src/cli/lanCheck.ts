import { loadConfig, serverArguments } from '../app/config.ts';
import { lanCheck } from '../app/selfCheck.ts';
try {
  const args = serverArguments();
  const loaded = await loadConfig(args.configPath);
  const checks = await lanCheck(args.port === undefined ? loaded : { ...loaded, port: args.port });
  for (const check of checks) console.log(`${check.ok ? 'OK  ' : 'FAIL'} ${check.name.padEnd(11)} ${check.detail}`);
  if (checks.some((check) => !check.ok)) { console.log('\nЗапуск невозможен: исправьте строки FAIL.'); process.exitCode = 1; }
} catch (error) { console.error(error instanceof Error ? error.message : 'Ошибка проверки'); process.exitCode = 1; }
