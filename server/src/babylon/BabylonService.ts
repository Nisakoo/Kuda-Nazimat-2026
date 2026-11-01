import { createHash } from 'node:crypto';
import { EMPTY_INVENTORY } from '../../../shared/babylon/types.ts';
import type { BabylonRequest, BabylonResult, BabylonState, BabylonErrorCode, ChatEntry, Language } from '../../../shared/babylon/types.ts';
import type { PlayerIdentity } from '../contracts.ts';
import type { BabylonStore, Generate, LanguagePort, Profile, Party, BabylonLocation, Message } from './ports.ts';
import { GOATS, GUIDE, ITEMS, NPCS, task } from './content.ts';

export class BabylonError extends Error {
  readonly code: BabylonErrorCode;
  constructor(code: BabylonErrorCode, message: string) { super(message); this.code = code; }
}
const fail = (code: BabylonErrorCode, message: string): never => { throw new BabylonError(code, message); };
const clean = (text: string, limit = 4000): string => {
  if (typeof text !== 'string' || !text.trim() || text.length > limit || /[\x00-\x08\x0b-\x1f\x7f-\x9f]/.test(text)) return fail('UNAVAILABLE', 'Некорректный ответ переводчика');
  return text.trim();
};
export interface BabylonDeps {
  store: BabylonStore; language: LanguagePort; generate: Generate; now(): number; id(): string;
  location(accountId: string): BabylonLocation | null;
  measure?(kind: 'chat' | 'npc' | 'suggest', durationMs: number, success: boolean): void;
}
export class BabylonService {
  private readonly deps: BabylonDeps;
  private readonly pending = new Map<string, { fingerprint: string; promise: Promise<BabylonResult> }>();
  private readonly recentChat = new Map<string, number>();
  constructor(deps: BabylonDeps) { this.deps = deps; deps.store.interrupt(); }
  enrolled(playerId: string): boolean { return this.deps.store.profile(playerId) !== null; }
  spawn(playerId: string): (BabylonLocation & { force: boolean }) | null {
    const p = this.deps.store.profile(playerId), g = p && this.deps.store.party(p.groupId);
    if (!g) return null;
    const role = g.members.find(m => m.id === playerId)!.role;
    return { mapId: 'market', force: p!.spawnPending, position: g.size > 1 && role === 1 ? { x: 0, y: 0, z: -26 } : { x: (role - (g.size > 1 ? 2 : 1)) * 1.5, y: 0, z: 8 } };
  }
  entered(playerId: string): void {
    const { store } = this.deps;
    store.transaction(() => { const p = store.profile(playerId); if (p?.spawnPending) { p.spawnPending = false; store.saveProfile(playerId, p); } });
  }
  state(identity: PlayerIdentity): BabylonState {
    const { store, language, now } = this.deps;
    const p = store.profile(identity.playerId), g = p && store.party(p.groupId), open = store.openParty();
    const role = g?.members.find(m => m.id === identity.playerId)?.role ?? 0;
    const messages: ChatEntry[] = [];
    for (const m of g?.messages ?? []) {
      if (m.authorId === identity.playerId) {
        const values = Object.values(m.deliveries);
        const status = values.some(d => d.status === 'error') ? 'error' : values.every(d => d.status === 'delivered') ? 'delivered' : values.some(d => d.status === 'translating') ? 'translating' : 'sent';
        messages.push({ id: m.id, authorId: m.authorId, authorName: m.authorName, text: m.source, language: m.sourceLanguage, translated: false, status, createdAt: m.createdAt, ...(status === 'error' ? { error: 'Перевод не доставлен всем участникам. Можно повторить или нарисовать камень.' } : {}) });
      } else {
        const d = m.deliveries[identity.playerId];
        if (d?.status === 'delivered' && d.text !== null) messages.push({ id: m.id, authorId: m.authorId, authorName: m.authorName, text: d.text, language: d.language, translated: d.translated, status: 'delivered', createdAt: m.createdAt });
      }
    }
    return {
      v: 2, playerId: identity.playerId, backend: language.mode, languages: language.languages,
      profile: p ? { native: p.native, learning: p.learning } : null, introSeen: p?.introSeen ?? false,
      party: g ? { id: g.id, size: g.size, count: g.members.length, role, members: g.members, started: g.startedAt !== null, completed: g.completedAt !== null, seconds: g.startedAt === null ? 0 : Math.max(0, Math.floor(((g.completedAt ?? now()) - g.startedAt) / 1000)) } : null,
      availableParty: open ? { size: open.size, count: open.members.length } : null,
      task: p && g ? task(p.learning, g.size, role, g.startedAt !== null, g.completedAt !== null) : '',
      goatGuide: p && g && (g.size === 1 || role === 1) ? GUIDE[p.learning] : null,
      inventory: g?.inventory[identity.playerId] ?? { ...EMPTY_INVENTORY }, fed: g?.fed ?? [], stones: g?.stones ?? [], words: p?.words ?? [], messages, replies: p?.replies ?? [],
    };
  }
  handle(identity: PlayerIdentity, packet: BabylonRequest, connectionId: string, authorize: () => Promise<boolean> = async () => true): Promise<BabylonResult> {
    if (packet.action.type === 'state') return Promise.resolve({ v: 2, requestId: packet.requestId, state: this.state(identity) });
    const key = `${identity.playerId}:${packet.requestId}`, fingerprint = createHash('sha256').update(JSON.stringify(packet.action)).digest('hex');
    const saved = this.deps.store.operation(identity.playerId, packet.requestId);
    if (saved && saved.fingerprint !== fingerprint) return Promise.reject(new BabylonError('CONFLICT', 'Этот requestId уже использован для другого действия'));
    if (saved?.status === 'complete') return Promise.resolve({ v: 2, requestId: packet.requestId, state: this.state(identity), ...(saved.notice ? { notice: saved.notice } : {}), ...(saved.suggestion ? { suggestion: saved.suggestion } : {}) });
    const pending = this.pending.get(key); if (pending) { if (pending.fingerprint !== fingerprint) return Promise.reject(new BabylonError('CONFLICT', 'Повтор с другим содержимым')); return pending.promise; }
    const promise = this.execute(identity, packet, connectionId, fingerprint, authorize).finally(() => this.pending.delete(key));
    this.pending.set(key, { fingerprint, promise }); return promise;
  }
  private pair(native: Language, learning: Language): void {
    if (native === learning || !this.deps.language.languages.includes(native) || !this.deps.language.languages.includes(learning)) fail('INVALID', 'Выберите два разных доступных языка');
  }
  private player(identity: PlayerIdentity): { profile: Profile; party: Party; role: number } {
    const profile = this.deps.store.profile(identity.playerId);
    if (!profile) return fail('NOT_READY', 'Сначала выберите режим и языки');
    const party = this.deps.store.party(profile.groupId);
    if (!party) return fail('UNAVAILABLE', 'Задание недоступно');
    const role = party.members.find(m => m.id === identity.playerId)?.role;
    if (!role) return fail('FORBIDDEN', 'Вы не участник задания');
    return { profile, party, role };
  }
  private near(identity: PlayerIdentity, target: { x: number; z: number }): void {
    const location = this.deps.location(identity.accountId);
    if (!location || location.mapId !== 'market' || Math.hypot(location.position.x - target.x, location.position.y, location.position.z - target.z) > 2.7) fail('FORBIDDEN', 'Подойдите ближе к объекту на рынке');
  }
  private async execute(identity: PlayerIdentity, packet: BabylonRequest, connectionId: string, fingerprint: string, authorize: () => Promise<boolean>): Promise<BabylonResult> {
    const { store, id, now } = this.deps, a = packet.action, pid = identity.playerId;
    let notice: string | undefined, suggestion: string | undefined;
    const languageAction = a.type === 'chat' || a.type === 'npc' || a.type === 'suggest';
    if (languageAction) {
      const started = now(); let success = false;
      try { ({ notice, suggestion } = await this.languageAction(identity, packet, connectionId, fingerprint, authorize)); success = true; }
      finally { this.deps.measure?.(a.type as 'chat' | 'npc' | 'suggest', now() - started, success); }
    } else store.transaction(() => {
      if (a.type === 'enroll') {
        this.pair(a.native, a.learning);
        if (store.profile(pid)) fail('CONFLICT', 'Вы уже участвуете в задании. Языки меняются из меню.');
        const g = store.openParty() ?? { id: id(), size: a.size, members: [], startedAt: null, completedAt: null, fed: [], inventory: {}, stones: [], messages: [] };
        if (g.size !== a.size || g.members.length >= g.size) fail('CONFLICT', 'Режим группы уже выбран первым игроком');
        g.members.push({ id: pid, name: identity.displayName, role: g.members.length + 1 });
        g.inventory[pid] = { ...EMPTY_INVENTORY };
        if (g.members.length === g.size) g.startedAt = now();
        store.saveParty(g); store.saveProfile(pid, { native: a.native, learning: a.learning, groupId: g.id, introSeen: false, spawnPending: true, words: [], replies: [] });
      } else {
        const { profile: p, party: g, role } = this.player(identity);
        switch (a.type) {
          case 'languages': this.pair(a.native, a.learning); p.native = a.native; p.learning = a.learning; break;
          case 'intro-seen': p.introSeen = true; break;
          case 'word-save': {
            if (a.id) {
              const word = p.words.find(w => w.id === a.id); if (!word) fail('FORBIDDEN', 'Запись не найдена в вашем словаре');
              Object.assign(word!, { word: a.word, translation: a.translation, note: a.note });
            } else {
              if (p.words.length >= 64) fail('INVALID', 'В словаре уже 64 записи');
              p.words.push({ id: id(), native: p.native, learning: p.learning, word: a.word, translation: a.translation, note: a.note });
            }
            break;
          }
          case 'word-delete': {
            const index = p.words.findIndex(w => w.id === a.id); if (index < 0) fail('FORBIDDEN', 'Запись не найдена в вашем словаре');
            p.words.splice(index, 1); break;
          }
          case 'carve':
            if (g.stones.length >= 8) fail('INVALID', 'В задании уже 8 камней');
            g.stones.push({ id: packet.requestId, authorId: pid, authorName: identity.displayName, drawing: a.drawing, createdAt: now() }); break;
          case 'buy': case 'feed': {
            if (g.startedAt === null) fail('NOT_READY', 'Дождитесь остальных участников');
            if (g.completedAt !== null) fail('CONFLICT', 'Задание уже завершено');
            if (g.size > 1 && role === 1) fail('FORBIDDEN', 'Ваша роль — объяснять корм напарникам');
            const inventory = g.inventory[pid]!;
            if (a.type === 'buy') {
              if (ITEMS[a.item] !== a.targetId || !NPCS[a.targetId]) fail('INVALID', 'У торговца нет такого предмета');
              this.near(identity, NPCS[a.targetId]!);
              if (inventory[a.item] >= 8) fail('INVALID', 'Можно носить до 8 одинаковых предметов');
              inventory[a.item]++; notice = 'Предмет добавлен в сумку.';
            } else {
              const goat = GOATS.find(goat => goat.id === a.targetId); if (!goat) fail('INVALID', 'Неизвестная коза');
              this.near(identity, goat!);
              if (g.fed.includes(a.targetId)) fail('CONFLICT', 'Эта коза уже накормлена');
              if (!inventory[a.item]) fail('FORBIDDEN', 'У вас нет выбранного предмета');
              if (goat!.food !== a.item) notice = 'Коза отказалась. Предмет остался у вас.';
              else { inventory[a.item]--; g.fed.push(a.targetId); if (g.fed.length === 4) g.completedAt = now(); notice = 'Коза накормлена.'; }
            }
            break;
          }
          default: fail('INVALID', 'Недопустимое действие');
        }
        store.saveProfile(pid, p); store.saveParty(g);
      }
      store.saveOperation(pid, packet.requestId, { fingerprint, status: 'complete', ...(notice ? { notice } : {}) });
    });
    return { v: 2, requestId: packet.requestId, state: this.state(identity), ...(notice ? { notice } : {}), ...(suggestion ? { suggestion } : {}) };
  }
  private async languageAction(identity: PlayerIdentity, packet: BabylonRequest, connectionId: string, fingerprint: string, authorize: () => Promise<boolean>): Promise<{ notice?: string; suggestion?: string }> {
    const { store, now, language, generate } = this.deps, a = packet.action, pid = identity.playerId;
    const { profile, party, role } = this.player(identity);
    let message: Message | undefined;
    if (a.type === 'chat') {
      message = party.messages.find(m => m.id === packet.requestId && m.authorId === pid);
      if (!message) {
        if (party.startedAt === null) fail('NOT_READY', 'Дождитесь всех участников');
        if (party.messages.length >= 200) fail('RATE_LIMIT', 'История задания заполнена (200 сообщений)');
        if (now() - (this.recentChat.get(pid) ?? -Infinity) < 1000) fail('RATE_LIMIT', 'Подождите секунду перед следующим сообщением');
        this.recentChat.set(pid, now());
        message = { id: packet.requestId, authorId: pid, authorName: identity.displayName, source: a.text, sourceLanguage: profile.native, createdAt: now(), deliveries: {} };
        for (const member of party.members) if (member.id !== pid) {
          const recipient = store.profile(member.id)!;
          const translated = recipient.learning !== profile.native;
          message.deliveries[member.id] = { language: recipient.learning, translated, text: translated ? null : a.text, status: translated ? 'sent' : 'delivered' };
        }
      }
    } else if (a.type === 'npc') {
      if (party.size > 1 && role !== 1 && a.targetId === 'shepherd') fail('FORBIDDEN', 'Список пастуха доступен игроку 1. Свяжитесь с ним.');
      const npc = NPCS[a.targetId]; if (!npc) fail('INVALID', 'Неизвестный собеседник'); this.near(identity, npc!);
    }
    const captured = message;
    const work = async (signal: AbortSignal, deadline: number): Promise<string> => {
      store.transaction(() => {
        if (captured) {
          const current = store.party(party.id)!;
          const existing = current.messages.findIndex(m => m.id === captured.id && m.authorId === pid);
          for (const d of Object.values(captured.deliveries)) if (d.status !== 'delivered') { d.status = 'translating'; delete d.error; }
          if (existing < 0) current.messages.push(captured); else current.messages[existing] = captured;
          store.saveParty(current);
        }
        store.saveOperation(pid, packet.requestId, { fingerprint, status: 'pending' });
      });
      const translations = new Map<Language, string>();
      let output = '';
      if (captured) {
        for (const d of Object.values(captured.deliveries)) if (d.status !== 'delivered' && !translations.has(d.language)) {
          translations.set(d.language, clean(await language.translate(captured.source, captured.sourceLanguage, d.language, signal)));
        }
      } else if (a.type === 'suggest') output = clean(await language.translate(a.word, profile.learning, profile.native, signal), 200);
      else if (a.type === 'npc') output = clean(await language.answer(NPCS[a.targetId]!, a.text, profile.learning, profile.replies.filter(r => r.npcId === a.targetId).slice(-6), signal));
      if (signal.aborted || now() >= deadline || !await authorize()) fail('UNAUTHORIZED', 'Запрос отменён или сессия истекла');
      if (signal.aborted || now() >= deadline) fail('UNAVAILABLE', 'Время запроса истекло');
      store.transaction(() => {
        if (captured) {
          const current = store.party(party.id)!;
          const saved = current.messages.find(m => m.id === captured.id && m.authorId === pid)!;
          for (const d of Object.values(saved.deliveries)) if (d.status !== 'delivered') { d.text = translations.get(d.language)!; d.status = 'delivered'; delete d.error; }
          store.saveParty(current);
        } else if (a.type === 'npc') {
          const current = store.profile(pid)!;
          current.replies.push({ id: packet.requestId, npcId: a.targetId, question: a.text, text: output, language: profile.learning });
          current.replies = current.replies.slice(-50); store.saveProfile(pid, current);
        }
        store.saveOperation(pid, packet.requestId, { fingerprint, status: 'complete', ...(a.type === 'suggest' ? { suggestion: output } : {}) });
      });
      return output || 'delivered';
    };
    // Matching languages and solo messages require no generation slot or model call.
    const noTranslation = captured && Object.values(captured.deliveries).every(d => d.status === 'delivered');
    const result = noTranslation ? { ok: true as const, text: await work(new AbortController().signal, now() + 8000) } : await generate(pid, connectionId, work, { requestId: packet.requestId, kind: a.type === 'npc' ? 'babel-npc' : a.type });
    if (!result.ok) {
      store.transaction(() => {
        const current = store.party(party.id)!;
        const saved = current.messages.find(m => m.id === packet.requestId && m.authorId === pid);
        if (saved) { for (const d of Object.values(saved.deliveries)) if (d.status !== 'delivered') { d.status = 'error'; d.error = 'Не удалось перевести сообщение'; } store.saveParty(current); }
        const operation = store.operation(pid, packet.requestId);
        // A committed result remains authoritative even if completion reaches the queue after its deadline.
        if (operation?.status !== 'complete') store.saveOperation(pid, packet.requestId, { fingerprint, status: 'failed' });
      });
      const saved = store.operation(pid, packet.requestId);
      if (saved?.status !== 'complete') fail(result.reason === 'player-busy' || result.reason === 'server-busy' ? 'RATE_LIMIT' : 'UNAVAILABLE', 'Переводчик занят или недоступен. Повторите запрос.');
    }
    const saved = store.operation(pid, packet.requestId);
    return saved?.suggestion ? { suggestion: saved.suggestion } : {};
  }
}
