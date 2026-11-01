import type { BabylonState, ChatEntry, NpcReply } from '../../../shared/babylon/types.ts';
import type { AudioOrigin } from '../audio/WorldAudio';

export interface PresentedAudioMessage { readonly id: string; readonly stream: string; readonly origin: AudioOrigin }
const chatId = (message: ChatEntry): string => `babel-chat:${JSON.stringify([message.authorId, message.id])}`;
const npcPair = (reply: NpcReply, origin: AudioOrigin): readonly PresentedAudioMessage[] => [
  { id: `babel-npc:${reply.id}:question`, stream: 'babel-npc', origin },
  { id: `babel-npc:${reply.id}:answer`, stream: 'babel-npc', origin },
];

/** Only delivered text was presented. A pending translation is not an audio history baseline. */
export function babylonAudioHistory(state: BabylonState | null | undefined): readonly PresentedAudioMessage[] {
  if (!state) return [];
  return [
    ...state.messages.filter(message => message.status === 'delivered').map(message => ({ id: chatId(message), stream: 'babel-chat', origin: 'history' as const })),
    ...state.replies.flatMap(reply => npcPair(reply, 'history')),
  ];
}

/** Silent baselines must precede live playback, including when both streams change in one poll. */
export function babylonAudioChanges(before: BabylonState | null | undefined, after: BabylonState, panel: string | null, target: string | null): readonly PresentedAudioMessage[] {
  const silent: PresentedAudioMessage[] = []; const live: PresentedAudioMessage[] = [];
  const queue = (event: PresentedAudioMessage) => { (event.origin === 'live' ? live : silent).push(event); };
  for (const message of after.messages) {
    if (message.status !== 'delivered' || before?.messages.some(old => old.id === message.id && old.authorId === message.authorId && old.status === 'delivered')) continue;
    queue({ id: chatId(message), stream: 'babel-chat', origin: before && panel === 'chat' ? 'live' : 'history' });
  }
  for (const reply of after.replies) {
    if (before?.replies.some(old => old.id === reply.id)) continue;
    for (const event of npcPair(reply, before && panel === 'interaction' && target === reply.npcId ? 'live' : 'history')) queue(event);
  }
  return [...silent, ...live];
}
