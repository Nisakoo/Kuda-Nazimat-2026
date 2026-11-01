import { DatabaseSync } from 'node:sqlite';
import { loadServerConfig } from '../app/config.ts';
try {
  const { config } = await loadServerConfig();
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try {
    console.log(`Окружение: ${config.env}. БД: ${config.dbPath}`);
    console.table(db.prepare('SELECT name AS имя, created_at AS создан, password_hash IS NOT NULL AS пароль, must_change_password AS сменить_пароль FROM accounts ORDER BY created_at').all());
    console.table(db.prepare('SELECT id AS playerId, map_id AS карта, x, y, z, updated_at AS обновлён FROM players').all());
    console.log('Действующие сессии:', db.prepare('SELECT count(*) AS count FROM sessions WHERE expires_at > ? AND revoked_at IS NULL').get(Date.now())!.count);
    console.table(db.prepare('SELECT d.player_id, d.npc_id, count(*) AS записей, (SELECT substr(question, 1, 60) FROM npc_dialogue q WHERE q.player_id = d.player_id AND q.npc_id = d.npc_id ORDER BY created_at DESC, id DESC LIMIT 1) AS последний_вопрос FROM npc_dialogue d GROUP BY d.player_id, d.npc_id').all());
  } finally { db.close(); }
} catch { console.error('Не удалось прочитать БД; проверьте --env, --config и dbPath.'); process.exitCode = 1; }
