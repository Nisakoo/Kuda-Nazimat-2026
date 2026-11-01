import { expect, it } from 'vitest';
import type { BabylonState, ChatEntry, NpcReply } from '../../../shared/babylon/types.ts';
import { babylonAudioChanges, babylonAudioHistory } from './audioPresentation';

const chat = (authorId: string, id: string, status: ChatEntry['status'] = 'delivered'): ChatEntry => ({ id, authorId, authorName: authorId, text: 'Test', language: 'en', translated: true, status, createdAt: 0 });
const state = (messages: readonly ChatEntry[] = [], replies: readonly NpcReply[] = []): BabylonState => ({
  v: 2, playerId: 'p1', backend: 'test', languages: ['ru', 'en'], profile: { native: 'ru', learning: 'en' }, introSeen: true,
  party: null, availableParties: [], availablePartiesTruncated: false, availableParty: null, partyPositions: [], taskTitle: '', taskTarget: null, task: '', goatGuide: null, inventory: { dates: 0, 'red-fruit': 0, 'yellow-fruit': 0, water: 0, fabric: 0 },
  fed: [], stones: [], words: [], messages, replies,
});

it('baselines only delivered messages and permits a pending translation to mumble on first delivery', () => {
  const pending = state([chat('p2', 'm1', 'translating')]);
  expect(babylonAudioHistory(pending)).toEqual([]);
  const delivered = state([chat('p2', 'm1')]);
  expect(babylonAudioChanges(pending, delivered, 'chat', null)).toEqual([{ id: 'babel-chat:["p2","m1"]', stream: 'babel-chat', origin: 'live' }]);
  expect(babylonAudioHistory(delivered)).toEqual([{ id: 'babel-chat:["p2","m1"]', stream: 'babel-chat', origin: 'history' }]);
  expect(babylonAudioChanges(delivered, delivered, 'chat', null)).toEqual([]);
});

it('uses authorId and id together for comparison and audio identity', () => {
  const before = state([chat('p2', 'same')]); const after = state([chat('p2', 'same'), chat('p3', 'same')]);
  expect(babylonAudioChanges(before, after, 'chat', null)).toEqual([{ id: 'babel-chat:["p3","same"]', stream: 'babel-chat', origin: 'live' }]);
  const ids = babylonAudioHistory(after).map(event => event.id);
  expect(new Set(ids).size).toBe(2);
});

it('processes hidden NPC history before a live visible chat event from the same poll', () => {
  const reply = { id: 'r1', npcId: 'guide', question: 'Q', text: 'A', language: 'en' as const };
  const events = babylonAudioChanges(state(), state([chat('p2', 'm1')], [reply]), 'chat', null);
  expect(events.map(event => [event.stream, event.origin])).toEqual([['babel-npc', 'history'], ['babel-npc', 'history'], ['babel-chat', 'live']]);
  expect(babylonAudioChanges(undefined, state([chat('p2', 'm1')], [reply]), 'chat', null).every(event => event.origin === 'history')).toBe(true);
});

it('emits 2 distinct stable utterance identities for one new shown BABEL question/answer pair', () => {
  const reply = { id: 'r1', npcId: 'guide', question: 'Q', text: 'A', language: 'en' as const };
  const after = state([], [reply]);
  const events = babylonAudioChanges(state(), after, 'interaction', 'guide');
  expect(events).toEqual([
    { id: 'babel-npc:r1:question', stream: 'babel-npc', origin: 'live' },
    { id: 'babel-npc:r1:answer', stream: 'babel-npc', origin: 'live' },
  ]);
  expect(babylonAudioHistory(after)).toEqual(events.map(event => ({ ...event, origin: 'history' })));
  expect(babylonAudioChanges(undefined, after, 'interaction', 'guide')).toEqual(events.map(event => ({ ...event, origin: 'history' })));
  expect(babylonAudioChanges(after, after, 'interaction', 'guide')).toEqual([]);
});

it('does not replay hidden messages or old replies when a panel opens or polling repeats', () => {
  const reply = { id: 'r1', npcId: 'guide', question: 'Q', text: 'A', language: 'en' as const };
  const after = state([chat('p2', 'm1')], [reply]);
  expect(babylonAudioChanges(state(), after, null, null).every(event => event.origin === 'history')).toBe(true);
  expect(babylonAudioChanges(after, after, 'chat', null)).toEqual([]);
  expect(babylonAudioChanges(after, after, 'interaction', 'guide')).toEqual([]);
});
