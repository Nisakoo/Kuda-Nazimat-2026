import { describe, it, expect } from 'vitest';
import { createNpcDialogueService } from '../src/npc/NpcDialogueService.ts';
import { memoryStores } from './memory.ts';
import { systemClock, systemScheduler } from '../src/common/time.ts';
import { silentLogger } from '../src/common/logger.ts';
import type { NpcAnswerRequest, NpcResponder } from '../src/npc/NpcResponder.ts';

describe('NPC relationships & fact memory integration', () => {
  async function fixture() {
    const stores = memoryStores();
    let lastRequest: NpcAnswerRequest | undefined;
    const responder: NpcResponder = {
      async start() {},
      async stop() {},
      async answer(req) {
        lastRequest = req;
        return { text: 'Answer for ' + req.question };
      },
    };
    const service = createNpcDialogueService(
      { responder, dialogue: stores.dialogue, clock: systemClock, scheduler: systemScheduler, logger: silentLogger },
      { maxConcurrent: 1, maxUnfinished: 4, timeoutMs: 1000 }
    );
    await service.start();
    const ask = async (sessionId: string, playerId: string, npcId: string, question: string) => {
      const q = {
        sessionId,
        authorize: () => true,
        connectionId: 'conn-' + playerId,
        requestId: 'req-' + Math.random(),
        player: { playerId, displayName: 'Player ' + playerId },
        npc: { id: npcId, name: 'Potter', topic: 'Clay', persona: 'Potter persona', greeting: 'Hello' },
        question,
      };
      return service.ask(q);
    };
    return { stores, service, ask, getLastRequest: () => lastRequest };
  }

  it('starts in ordinary attitude by default', async () => {
    const { stores, ask, getLastRequest } = await fixture();
    await ask('s1', 'p1', 'npc1', 'How much does clay cost?');
    expect(getLastRequest()?.npc.attitude).toBe('ordinary');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('ordinary');
  });

  it('directed insult transitions ordinary -> displeased on successful answer', async () => {
    const { stores, ask, getLastRequest } = await fixture();
    await ask('s1', 'p1', 'npc1', 'Ты дурак!');
    expect(getLastRequest()?.npc.attitude).toBe('displeased');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('displeased');

    // Next question receives displeased attitude
    await ask('s1', 'p1', 'npc1', 'Where is the gate?');
    expect(getLastRequest()?.npc.attitude).toBe('displeased');
  });

  it('repeated insult stays displeased without escalating', async () => {
    const { stores, ask, getLastRequest } = await fixture();
    await ask('s1', 'p1', 'npc1', 'You are stupid');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('displeased');

    await ask('s1', 'p1', 'npc1', 'Shut up!');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('displeased');
    expect(getLastRequest()?.npc.attitude).toBe('displeased');
  });

  it('apology in displeased returns attitude strictly to ordinary', async () => {
    const { stores, ask, getLastRequest } = await fixture();
    await ask('s1', 'p1', 'npc1', 'You are an idiot');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('displeased');

    // Apologize
    await ask('s1', 'p1', 'npc1', 'I am sorry, forgive me');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('ordinary');
    expect(getLastRequest()?.npc.attitude).toBe('ordinary');

    // Repeated apology in ordinary does NOT grant friendly
    await ask('s1', 'p1', 'npc1', 'I apologize again');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('ordinary');
    expect(getLastRequest()?.npc.attitude).toBe('ordinary');
  });

  it('quotes, vocabulary questions and third-party insults do NOT degrade attitude', async () => {
    const { stores, ask, getLastRequest } = await fixture();
    await ask('s1', 'p1', 'npc1', 'He said "you are stupid"');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('ordinary');

    await ask('s1', 'p1', 'npc1', 'Что значит дурак?');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('ordinary');

    await ask('s1', 'p1', 'npc1', 'The king is stupid');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 's1')).toBe('ordinary');
  });

  it('new AUTH session starts fresh with ordinary attitude', async () => {
    const { stores, ask } = await fixture();
    await ask('session-old', 'p1', 'npc1', 'Ты дурак!');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 'session-old')).toBe('displeased');

    // New session for the same player
    expect(stores.dialogue.attitude?.('p1', 'npc1', 'session-new')).toBe('ordinary');
    await ask('session-new', 'p1', 'npc1', 'Hello potter');
    expect(stores.dialogue.attitude?.('p1', 'npc1', 'session-new')).toBe('ordinary');
  });

  it('extracts player facts and provides them to future requests', async () => {
    const { ask, getLastRequest } = await fixture();
    await ask('s1', 'p1', 'npc1', 'Меня зовут Лука, я пришел из Ура');
    // Next request receives the fact in prompt request
    await ask('s1', 'p1', 'npc1', 'What do you make here?');
    const facts = getLastRequest()?.facts;
    expect(facts).toBeDefined();
    expect(facts?.length).toBeGreaterThan(0);
    expect(facts?.[0]).toContain('Traveler said');
  });
});
