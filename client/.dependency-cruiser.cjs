module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'ui-through-app', severity: 'error',
      from: { path: '^src/ui/' },
      to: { path: '^src/(render|multiplayer)/' },
    },
    {
      name: 'three-inside-render', severity: 'error',
      from: { pathNot: '^src/render/three/' },
      to: { path: 'node_modules/(three|@types/three)/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      extensions: ['.ts', '.svelte', '.js', '.json'],
      exportsFields: ['exports'],
      conditionNames: ['svelte', 'browser', 'import', 'default'],
    },
  },
};
