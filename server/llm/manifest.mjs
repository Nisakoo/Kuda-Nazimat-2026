import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, realpath, writeFile } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Freeze already prepared local artifacts. No downloads, model load, or inference. */
export async function artifactManifest(directory, output) {
  const root = await realpath(directory);
  const destination = resolve(output);
  const entries = {};
  async function walk(path) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '__pycache__') continue;
      const full = join(path, entry.name);
      if (full === destination) continue;
      const info = await lstat(full);
      if (info.isSymbolicLink()) throw new Error('Сначала скопируйте snapshot как обычные файлы: symlink запрещены.');
      if (info.isDirectory()) await walk(full);
      else if (info.isFile()) {
        const name = relative(root, full).split('\\').join('/');
        if (isAbsolute(name) || name.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Недопустимый путь артефакта.');
        const hash = createHash('sha256');
        for await (const chunk of createReadStream(full)) hash.update(chunk);
        entries[name] = hash.digest('hex');
        if (Object.keys(entries).length > 10000) throw new Error('Слишком много файлов в snapshot.');
      } else throw new Error('Snapshot содержит специальный файл.');
    }
  }
  await walk(root);
  if (!Object.keys(entries).length) throw new Error('Snapshot пуст.');
  // Do not silently change the approved pin of a previously prepared snapshot.
  const serialized = JSON.stringify(entries, null, 2) + '\n';
  if (Buffer.byteLength(serialized) > 65536) throw new Error('Manifest превышает лимит worker 64 KiB. Подготовьте минимальный snapshot.');
  await writeFile(destination, serialized, { flag: 'wx', mode: 0o600 });
  return Object.keys(entries).length;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [directory, output, extra] = process.argv.slice(2);
    if (!directory || !output || extra) throw new Error('Использование: node server/llm/manifest.mjs /snapshot /new-manifest.json');
    const count = await artifactManifest(directory, output);
    process.stdout.write(`Зафиксированы хеши ${count} локальных файлов. Это не проверка происхождения или квалификация модели.\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
