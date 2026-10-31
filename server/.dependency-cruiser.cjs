/** SERVER-002: no cycles; the domain knows no IO, transport, storage or adapters. */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolvable', severity: 'error', from: {}, to: { couldNotResolve: true } },
    { name: 'no-client-code', severity: 'error', from: {}, to: { path: '(^|/)client/' } },
    {
      name: 'domain-is-pure',
      severity: 'error',
      from: { path: '^src/(game/World|world/(GameMap|access|npcContent))\\.ts$' },
      to: { path: '^node:|socket\\.io|^src/(app|http|realtime|persistence|auth|npc|cli)/|^src/world/loader\\.ts$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.test\\.ts$' },
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
