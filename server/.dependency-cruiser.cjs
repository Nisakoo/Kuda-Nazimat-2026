/** SERVER-002: no cycles; the domain knows no IO, transport, storage or adapters. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
    { name: 'services-no-adapters', severity: 'error', from: { path: '^src/(auth/AuthService|npc/(NpcDialogueService|GenerationQueue)|babylon/BabylonService|game/GameService)\\.ts$' }, to: { path: '^src/(http|realtime|persistence|app|cli)/|^src/npc/adapters/' } },
    { name: 'shared-is-pure', severity: 'error', from: { path: '^\\.\\./shared/' }, to: { pathNot: '^\\.\\./shared/' } },
    { name: 'domain-is-pure-node', severity: 'error', from: { path: '^src/(game/World|world/(GameMap|access|npcContent))\\.ts$' }, to: { dependencyTypes: ['core'] } },
    { name: 'no-client-code', severity: 'error', from: {}, to: { path: '(^|/)client/' } },
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '^src/(game/World|world/(GameMap|access|npcContent))\\.ts$' },
      to: { path: '^node:|socket\\.io|^src/(app|http|realtime|persistence|auth|npc|cli)/|^src/world/loader\\.ts$' },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
