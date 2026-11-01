import { PASTURE_ORIGIN } from '../../../shared/city/catalogue.ts';
import { CityError, cityAction, cityView, discoverCity } from '../city/progress.ts';
import { createHash } from 'node:crypto';
import { EMPTY_INVENTORY } from '../../../shared/babylon/types.ts';
import type { BabylonRequest, BabylonResult, BabylonState, BabylonErrorCode, ChatEntry, Language } from '../../../shared/babylon/types.ts';
import type { NpcProfile, PlayerIdentity } from '../contracts.ts';
import type { BabylonStore, Generate, LanguagePort, Profile, Party, BabylonLocation, Message, NpcSessionScope, LanguageCallContext } from './ports.ts';
import { GOATS, GUIDE, ITEMS, NPCS, TASK_TITLE, task } from './content.ts';

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
  store: BabylonStore; language: LanguagePort; generate: Generate; now(): number; monotonicNow(): number; id(): string;
  location(accountId: string): BabylonLocation | null;
  peerLocation?(playerId: string): BabylonLocation | null;
  measure?(kind: 'chat' | 'npc' | 'suggest', durationMs: number, success: boolean): void;
  /** ADMIN-SRV-007: the live NPC (administrator edits applied); null when disabled or deleted, undefined when unknown. */
  npc?(npcId: string): { readonly profile: NpcProfile; readonly mapId: string; readonly x: number; readonly z: number } | null | undefined;
}
export class BabylonService {
  private readonly deps: BabylonDeps;
  private readonly pending = new Map<string, { fingerprint: string; npcSessionId?: string; promise: Promise<BabylonResult> }>();
  private readonly recentChat = new Map<string, number>();
  constructor(deps: BabylonDeps) { this.deps = deps; deps.store.interrupt(); }
  enrolled(playerId: string): boolean { return Boolean(this.deps.store.profile(playerId)?.groupId); }
  spawn(playerId: string): (BabylonLocation & { force: boolean }) | null {
    const p = this.deps.store.profile(playerId), g = p?.groupId && this.deps.store.party(p.groupId);
    if (!g) return null;
    const role = g.members.find(m => m.id === playerId)!.role;
    return { mapId: 'market', force: p!.spawnPending, position: g.size > 1 && role === 1 ? { x: 0, y: 0, z: PASTURE_ORIGIN.z + 6 } : { x: (role - (g.size > 1 ? 2 : 1)) * 1.5, y: 0, z: 8 } };
  }
  entered(playerId: string): void {
    const { store } = this.deps;
    store.transaction(() => { const p = store.profile(playerId); if (p?.spawnPending) { p.spawnPending = false; store.saveProfile(playerId, p); } });
  }
  state(identity: PlayerIdentity, scope?: NpcSessionScope): BabylonState {
    if (scope && (!scope.sessionId || !scope.isActive())) fail('UNAUTHORIZED', 'Сессия истекла');
    const { store, language, now } = this.deps;
    const p = store.profile(identity.playerId), g = p?.groupId ? store.party(p.groupId) : null, open = store.openParty();
    if (p && discoverCity(p, this.deps.location(identity.accountId))) store.saveProfile(identity.playerId, p);
    const role = g?.members.find(m => m.id === identity.playerId)?.role ?? 0;
    const partyPositions: BabylonState['partyPositions'][number][] = [];
    // Never enumerate the world. Resolve only this task's bounded member IDs.
    if (g?.members.some(member => member.id === identity.playerId)) {
      const seen = new Set<string>([identity.playerId]);
      for (const member of g.members.slice(0, 4)) {
        if (seen.has(member.id)) continue;
        seen.add(member.id);
        const location = this.deps.peerLocation?.(member.id);
        if (!location || location.mapId !== 'market') continue;
        const { x, z } = location.position;
        if (![x, z].every(value => Number.isFinite(value) && Math.abs(value) <= 1_000_000)) continue;
        partyPositions.push({ id: member.id, name: member.name, x, z });
      }
    }
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
      v: 2, city: cityView(p, g, role), playerId: identity.playerId, backend: language.mode, languages: language.languages,
      profile: p ? { native: p.native, learning: p.learning } : null, introSeen: p?.introSeen ?? false,
      party: g ? { id: g.id, size: g.size, count: g.members.length, role, members: g.members, started: g.startedAt !== null, completed: g.completedAt !== null, seconds: g.startedAt === null ? 0 : Math.max(0, Math.floor(((g.completedAt ?? now()) - g.startedAt) / 1000)) } : null,
      availableParty: open ? { size: open.size, count: open.members.length } : null,
      partyPositions,
      task: p && g ? task(p.learning, g.size, role, g.startedAt !== null, g.completedAt !== null) : '',
      taskTitle: p && g ? TASK_TITLE[p.learning] : '',
      taskTarget: g && g.startedAt !== null && g.completedAt === null ? { x: 0, z: -34 } : null,
      goatGuide: p && g && (g.size === 1 || role === 1) ? GUIDE[p.learning] : null,
      inventory: g?.inventory[identity.playerId] ?? { ...EMPTY_INVENTORY }, fed: g?.fed ?? [], stones: g?.stones ?? [], words: p?.words ?? [], messages, replies: scope ? store.npcReplies(identity.playerId, scope.sessionId) : [],
    };
  }
  async handle(identity: PlayerIdentity, packet: BabylonRequest, connectionId: string, authorize: () => Promise<boolean> = async () => true, scope?: NpcSessionScope): Promise<BabylonResult> {
    if (scope && (!scope.sessionId || !scope.isActive())) fail('UNAUTHORIZED', 'Сессия истекла');
    if (packet.action.type === 'npc' && !scope) fail('UNAUTHORIZED', 'Нужна действующая AUTH-сессия');
    if (packet.action.type === 'npc') this.checkNpcAccess(identity, packet.action.targetId);
    const result = await this.handleOperation(identity, packet, connectionId, authorize, scope);
    if (packet.action.type !== 'state' && !await authorize()) fail('UNAUTHORIZED', 'Доступ утрачен');
    if (packet.action.type === 'npc') this.checkNpcAccess(identity, packet.action.targetId);
    // Account operations can be pending in another AUTH session. Rebuild every caller snapshot.
    return { ...result, state: this.state(identity, scope) };
  }
  private handleOperation(identity: PlayerIdentity, packet: BabylonRequest, connectionId: string, authorize: () => Promise<boolean>, scope?: NpcSessionScope): Promise<BabylonResult> {
    if (packet.action.type === 'state') return Promise.resolve({ v: 2, requestId: packet.requestId, state: this.state(identity, scope) });
    const key = `${identity.playerId}:${packet.requestId}`, fingerprint = createHash('sha256').update(JSON.stringify(packet.action)).digest('hex');
    const saved = this.deps.store.operation(identity.playerId, packet.requestId);
    if (packet.action.type === 'npc' && saved && saved.npcSessionId !== scope?.sessionId) return Promise.reject(new BabylonError('CONFLICT', 'Запрос NPC принадлежит другой или прежней сессии'));
    if (saved && saved.fingerprint !== fingerprint) return Promise.reject(new BabylonError('CONFLICT', 'Этот requestId уже использован для другого действия'));
    if (saved?.status === 'complete') return Promise.resolve({ v: 2, requestId: packet.requestId, state: this.state(identity, scope), ...(saved.notice ? { notice: saved.notice } : {}), ...(saved.suggestion ? { suggestion: saved.suggestion } : {}) });
    const pending = this.pending.get(key); if (pending) { if (packet.action.type === 'npc' && pending.npcSessionId !== scope?.sessionId) return Promise.reject(new BabylonError('CONFLICT', 'Запрос NPC принадлежит другой сессии')); if (pending.fingerprint !== fingerprint) return Promise.reject(new BabylonError('CONFLICT', 'Повтор с другим содержимым')); return pending.promise; }
    const promise = this.execute(identity, packet, connectionId, fingerprint, authorize, scope).finally(() => this.pending.delete(key));
    this.pending.set(key, { fingerprint, ...(packet.action.type === 'npc' ? { npcSessionId: scope!.sessionId } : {}), promise }); return promise;
  }
  private pair(native: Language, learning: Language): void {
    if (native === learning || !this.deps.language.languages.includes(native) || !this.deps.language.languages.includes(learning)) fail('INVALID', 'Выберите два разных доступных языка');
  }
  private player(identity: PlayerIdentity): { profile: Profile; party: Party; role: number } {
    const profile = this.deps.store.profile(identity.playerId);
    if (!profile?.groupId) return fail('NOT_READY', 'Сначала подключитесь к игре');
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
  /** Synchronous role/range guard. Transports must recheck after their final await before sending an NPC result. */
  checkNpcAccess(identity: PlayerIdentity, targetId: string): void {
    const { party, role } = this.player(identity);
    if (party.size > 1 && role !== 1 && targetId === 'shepherd') fail('FORBIDDEN', 'Список пастуха доступен игроку 1.');
    this.near(identity, this.target(targetId));
  }
  /** Quest NPCs keep their task positions; the administrator's profile and on/off state apply (ADMIN-SRV-007). */
  private target(targetId: string): NpcProfile & { x: number; z: number } {
    const base = NPCS[targetId];
    const live = this.deps.npc?.(targetId);
    if (live === undefined) return base ?? fail('INVALID', 'Неизвестный собеседник');
    if (live === null) return fail(base ? 'FORBIDDEN' : 'INVALID', base ? 'Собеседник сейчас недоступен.' : 'Неизвестный собеседник');
    if (!base && live.mapId !== 'market') fail('INVALID', 'Неизвестный собеседник');
    const { id, name, topic, persona, greeting } = live.profile;
    return { id, name, topic, persona, greeting, x: base?.x ?? live.x, z: base?.z ?? live.z };
  }
  private async execute(identity: PlayerIdentity, packet: BabylonRequest, connectionId: string, fingerprint: string, authorize: () => Promise<boolean>, scope?: NpcSessionScope): Promise<BabylonResult> {
    const { store, id, now } = this.deps, a = packet.action, pid = identity.playerId;
    let notice: string | undefined, suggestion: string | undefined;
    const languageAction = a.type === 'chat' || a.type === 'npc' || a.type === 'suggest';
    if (languageAction) {
      const started = now(); let success = false;
      try { ({ notice, suggestion } = await this.languageAction(identity, packet, connectionId, fingerprint, authorize, scope)); success = true; }
      finally { this.deps.measure?.(a.type as 'chat' | 'npc' | 'suggest', now() - started, success); }
    } else store.transaction(() => {
      if (a.type === 'languages') {
        this.pair(a.native, a.learning);
        const profile = store.profile(pid) ?? { groupId: null, introSeen: false, spawnPending: false, words: [], replies: [] };
        store.saveProfile(pid, { ...profile, native: a.native, learning: a.learning });
      } else if (a.type === 'enroll' || a.type === 'create' || a.type === 'join') {
        const previous = store.profile(pid);
        const replacing = a.type === 'create' && a.replacePartyId !== undefined;
        if (replacing && previous?.groupId !== a.replacePartyId) fail('CONFLICT', 'Сохранённая игра изменилась. Обновите выбор и подтвердите замену ещё раз.');
        const oldParty = replacing && previous?.groupId ? store.party(previous.groupId) : null;
        if (replacing && !oldParty?.members.some(member => member.id === pid)) fail('CONFLICT', 'Сохранённая игра недоступна для замены.');
        if (previous?.groupId && !replacing) {
          if (a.type !== 'join') fail('CONFLICT', 'У вас уже есть игра. Подключитесь к ней, чтобы продолжить без потери прогресса.');
        } else {
          const languages = a.type === 'enroll' ? a : previous;
          if (!languages) fail('NOT_READY', 'Сначала сохраните языки в профиле');
          this.pair(languages!.native, languages!.learning);
          const waiting = store.openParty();
          const open = waiting?.id === oldParty?.id && oldParty?.members.length === 1 ? null : waiting;
          if (a.type === 'create' && open) fail('CONFLICT', 'На сервере уже ждёт группа. Используйте подключение.');
          if (a.type === 'join' && !open) fail('NOT_READY', 'Нет игры для подключения. Создайте игру.');
          const g: Party = (a.type === 'create' ? null : open) ?? { id: id(), size: a.type === 'join' ? 1 : a.size, members: [], startedAt: null, completedAt: null, fed: [], inventory: {}, stones: [], messages: [] };
          if ((a.type === 'enroll' && g.size !== a.size) || g.members.length >= g.size) fail('CONFLICT', 'Режим группы уже выбран первым игроком');
          const role = [1, 2, 3, 4].find(candidate => !g.members.some(member => member.role === candidate))!;
          g.members.push({ id: pid, name: identity.displayName, role });
          g.inventory[pid] = { ...EMPTY_INVENTORY };
          if (g.members.length === g.size) g.startedAt = now();
          store.saveParty(g); store.saveProfile(pid, { ...previous, native: languages!.native, learning: languages!.learning, groupId: g.id, introSeen: false, spawnPending: true, words: previous?.words ?? [], replies: previous?.replies ?? [] });
          if (oldParty) {
            oldParty.members = oldParty.members.filter(member => member.id !== pid);
            delete oldParty.inventory[pid];
            if (oldParty.members.length) store.saveParty(oldParty); else store.deleteParty(oldParty.id);
          }
        }
      } else {
        const { profile: p, party: g, role } = this.player(identity);
        switch (a.type) {
          case 'city-start': case 'city-step':
            try { notice = cityAction(g, role, a, target => this.near(identity, target)); }
            catch (error) { if (error instanceof CityError) fail('FORBIDDEN', error.message); throw error; }
            break;
          case 'intro-seen': p.introSeen = true; break;
          case 'word-save': {
            if (a.id) {
              const word = p.words.find(w => w.id === a.id); if (!word) fail('FORBIDDEN', 'Запись не найдена в вашем словаре');
              Object.assign(word!, { word: a.word, translation: a.translation, note: a.note, ...(a.example === undefined ? {} : { example: a.example }), ...(a.exampleTranslation === undefined ? {} : { exampleTranslation: a.exampleTranslation }) });
            } else {
              if (p.words.length >= 64) fail('INVALID', 'В словаре уже 64 записи');
              p.words.push({ id: id(), native: p.native, learning: p.learning, word: a.word, translation: a.translation, note: a.note, learned: false, example: a.example ?? '', exampleTranslation: a.exampleTranslation ?? '' });
            }
            break;
          }
          case 'word-learn': {
            const word = p.words.find(w => w.id === a.id); if (!word) fail('FORBIDDEN', 'Запись не найдена в вашем словаре');
            word!.learned = a.learned; break;
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
              this.near(identity, this.target(a.targetId));
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
    return { v: 2, requestId: packet.requestId, state: this.state(identity, scope), ...(notice ? { notice } : {}), ...(suggestion ? { suggestion } : {}) };
  }
  private async languageAction(identity: PlayerIdentity, packet: BabylonRequest, connectionId: string, fingerprint: string, authorize: () => Promise<boolean>, scope?: NpcSessionScope): Promise<{ notice?: string; suggestion?: string }> {
    const { store, now, language, generate } = this.deps, a = packet.action, pid = identity.playerId;
    const { profile, party, role } = this.player(identity);
    const operationScope = a.type === 'npc' ? { npcSessionId: scope!.sessionId } : {};
    const checkNpcSession = () => {
      if (a.type !== 'npc') return;
      if (!scope?.sessionId || !scope.isActive()) fail('UNAUTHORIZED', 'Сессия истекла');
      this.checkNpcAccess(identity, a.targetId);
    };
    let message: Message | undefined;
    let speaker: (NpcProfile & { x: number; z: number }) | undefined;
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
      speaker = this.target(a.targetId); this.near(identity, speaker);
    }
    const captured = message;
    const work = async (signal: AbortSignal, deadline: number, budget?: { expired(): boolean; deadlineAt?(): number }): Promise<string> => {
      // Keep a monotonic cap even for injected legacy Generate fixtures. Never recreate it after an await.
      let monotonicDeadline = this.deps.monotonicNow() + Math.max(0, deadline - now());
      const remaining = () => {
        const mono = this.deps.monotonicNow(), wall = now();
        monotonicDeadline = Math.min(monotonicDeadline, mono + deadline - wall);
        return monotonicDeadline - mono;
      };
      const callBudget = {
        expired: () => Boolean(budget?.expired() || signal.aborted || remaining() <= 0),
        deadlineAt: () => Math.min(budget?.deadlineAt?.() ?? deadline, deadline, now() + Math.max(0, remaining())),
      };
      const checkBudget = () => { if (callBudget.expired()) fail('UNAVAILABLE', 'Время запроса истекло'); };
      const context: LanguageCallContext = {
        sessionId: scope?.sessionId ?? '', player: identity, requestId: packet.requestId,
        requestKey: JSON.stringify([scope?.sessionId, pid, packet.requestId]), budget: callBudget,
        isActive: () => scope?.isActive() === true,
        authorize: async () => {
          const allowed = await authorize();
          checkBudget(); checkNpcSession();
          return allowed;
        },
      };
      checkBudget();
      if (!await authorize()) fail('UNAUTHORIZED', 'Доступ утрачен');
      // Admission may wait for authorization. Never restore the original end-to-end budget.
      checkBudget();
      checkNpcSession();
      store.transaction(() => {
        if (store.profile(pid)?.groupId !== party.id) fail('CONFLICT', 'Игра сменилась. Старый запрос отменён.');
        if (captured) {
          const current = store.party(party.id)!;
          const existing = current.messages.findIndex(m => m.id === captured.id && m.authorId === pid);
          for (const d of Object.values(captured.deliveries)) if (d.status !== 'delivered') { d.status = 'translating'; delete d.error; }
          if (existing < 0) current.messages.push(captured); else current.messages[existing] = captured;
          store.saveParty(current);
        }
        store.saveOperation(pid, packet.requestId, { fingerprint, ...operationScope, status: 'pending' });
      });
      const translations = new Map<Language, string>();
      let output = '';
      if (captured) {
        for (const d of Object.values(captured.deliveries)) if (d.status !== 'delivered' && !translations.has(d.language)) {
          translations.set(d.language, clean(await language.translate(captured.source, captured.sourceLanguage, d.language, signal, context)));
        }
      } else if (a.type === 'suggest') output = clean(await language.translate(a.word, profile.learning, profile.native, signal, context), 200);
      else if (a.type === 'npc') {
        const history = store.npcReplies(pid, scope!.sessionId, a.targetId).slice(-6);
        checkBudget(); checkNpcSession();
        output = clean(await language.answer(speaker!, a.text, profile.learning, history, signal, context));
      }
      if (signal.aborted || now() >= deadline || !await authorize()) fail('UNAUTHORIZED', 'Запрос отменён или сессия истекла');
      // Authorization is asynchronous. Recheck the queue's monotonic budget immediately before the terminal transaction.
      // The no-translation path uses its own injected monotonic budget without reserving an LLM slot.
      checkBudget();
      checkNpcSession();
      store.transaction(() => {
        if (store.profile(pid)?.groupId !== party.id) fail('CONFLICT', 'Игра сменилась. Старый запрос отменён.');
        if (captured) {
          const current = store.party(party.id)!;
          const saved = current.messages.find(m => m.id === captured.id && m.authorId === pid)!;
          for (const d of Object.values(saved.deliveries)) if (d.status !== 'delivered') { d.text = translations.get(d.language)!; d.status = 'delivered'; delete d.error; }
          store.saveParty(current);
        } else if (a.type === 'npc') {
          store.appendNpcReply(pid, scope!.sessionId, { id: packet.requestId, npcId: a.targetId, question: a.text, text: output, language: profile.learning });
        }
        store.saveOperation(pid, packet.requestId, { fingerprint, ...operationScope, status: 'complete', ...(a.type === 'suggest' ? { suggestion: output } : {}) });
      });
      return output || 'delivered';
    };
    // Matching languages and solo messages require no generation slot or model call.
    const noTranslation = captured && Object.values(captured.deliveries).every(d => d.status === 'delivered');
    const runWithoutGeneration = async () => {
      const controller = new AbortController(), deadline = now() + 8000;
      let monotonicDeadline = this.deps.monotonicNow() + 8000;
      const budget = { expired: () => {
        const mono = this.deps.monotonicNow(), wall = now();
        monotonicDeadline = Math.min(monotonicDeadline, mono + deadline - wall);
        if (mono >= monotonicDeadline || wall >= deadline) controller.abort();
        return controller.signal.aborted;
      } };
      return { ok: true as const, text: await work(controller.signal, deadline, budget) };
    };
    const result = noTranslation ? await runWithoutGeneration() : await generate(pid, connectionId, work, { requestId: packet.requestId, kind: a.type === 'npc' ? 'babel-npc' : a.type });
    if (!result.ok) {
      store.transaction(() => {
        const current = store.party(party.id);
        const saved = current?.messages.find(m => m.id === packet.requestId && m.authorId === pid);
        if (current && saved) { for (const d of Object.values(saved.deliveries)) if (d.status !== 'delivered') { d.status = 'error'; d.error = 'Не удалось перевести сообщение'; } store.saveParty(current); }
        const operation = store.operation(pid, packet.requestId);
        // A committed result remains authoritative even if completion reaches the queue after its deadline.
        if (operation?.status !== 'complete') store.saveOperation(pid, packet.requestId, { fingerprint, ...operationScope, status: 'failed' });
      });
      const saved = store.operation(pid, packet.requestId);
      if (saved?.status !== 'complete') fail(result.reason === 'player-busy' || result.reason === 'server-busy' ? 'RATE_LIMIT' : 'UNAVAILABLE', 'Переводчик занят или недоступен. Повторите запрос.');
    }
    const saved = store.operation(pid, packet.requestId);
    return saved?.suggestion ? { suggestion: saved.suggestion } : {};
  }
}
