import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const markerName = '.kuda-uv-environment.json';
const usage = 'node server/llm/prepare.mjs mlx|ollama [--environment /absolute/new/env] [--offline]';

export function argumentsFor(args, env = process.env) {
  const options = { backend: env.KUDA_LLM_BACKEND || undefined, python: '3.12', offline: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (i === 0 && !arg.startsWith('--')) { options.backend = arg; continue; }
    if (seen.has(arg)) throw new Error(usage);
    seen.add(arg);
    if (arg === '--offline') options.offline = true;
    else if (arg === '--environment') {
      const value = args[++i];
      if (!value || value.startsWith('--') || /[\x00-\x1f]/.test(value)) throw new Error(usage);
      options.environment = value;
    } else throw new Error(usage);
  }
  if (!['mlx', 'ollama'].includes(options.backend)) throw new Error(usage);
  options.environment ??= join(homedir(), 'kuda-llm', options.backend === 'mlx' ? 'mlx-venv' : 'venv');
  if (!isAbsolute(options.environment)) throw new Error('--environment requires an absolute path');
  return options;
}

/** Preparation only. The game continues to spawn options.python directly. */
export async function prepareEnvironment(options, host = process, run = spawnSync) {
  const { backend, python, offline } = options;
  if (!['mlx', 'ollama'].includes(backend)) throw new Error('Unknown backend');
  if (backend === 'mlx' && (host.platform !== 'darwin' || host.arch !== 'arm64')) {
    throw new Error('MLX requires macOS Apple Silicon');
  }
  if (backend === 'ollama' && (!['darwin', 'linux'].includes(host.platform) || !['arm64', 'x64'].includes(host.arch))) {
    throw new Error('The current Ollama worker requires macOS/Linux arm64 or x64');
  }
  const environment = resolve(options.environment);
  const project = join(directory, 'envs', backend);
  const marker = join(environment, markerName);
  let exists = false;
  try {
    const info = await lstat(environment);
    exists = true;
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Not a regular directory');
    const metadata = await lstat(marker);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 1024) throw new Error('Invalid marker');
    const owner = JSON.parse(await readFile(marker, 'utf8'));
    if (owner.version !== 1 || owner.backend !== backend) throw new Error('Different owner');
  } catch (error) {
    if (exists || error.code !== 'ENOENT') {
      throw new Error('Existing environment is not owned by this backend. Keep it and choose --environment /absolute/new/env.');
    }
  }
  const call = (args) => {
    const result = run('uv', args, {
      stdio: 'inherit', env: { ...process.env, UV_PROJECT_ENVIRONMENT: environment },
    });
    if (result.error) throw new Error(`Cannot run uv: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`uv failed (${result.signal ?? result.status}); preparation is incomplete. Rerun the same command after fixing the cause.`);
  };
  const network = offline ? ['--offline'] : [];
  // Check the interpreter before claiming a destination. Never download Python implicitly.
  call(['python', 'find', '--no-python-downloads', ...network, python]);
  if (!exists) {
    await mkdir(dirname(environment), { recursive: true });
    await mkdir(environment); // No recursive overwrite, including racing creators.
    await writeFile(marker, JSON.stringify({ version: 1, backend }) + '\n', { flag: 'wx', mode: 0o600 });
  }
  const interpreter = join(environment, 'bin', 'python3');
  try { await lstat(interpreter); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    call(['venv', '--allow-existing', '--python', python, '--no-python-downloads', ...network, environment]);
  }
  call(['sync', '--project', project, '--locked', '--no-dev', '--python', python, '--no-python-downloads', ...network]);
  return interpreter;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const interpreter = await prepareEnvironment(argumentsFor(process.argv.slice(2)));
    process.stdout.write(`Python environment prepared: ${interpreter}\nModel files and game config have not been created.\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
