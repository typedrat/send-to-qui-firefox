// theme.ts reads the colour-scheme preference when it loads; outside a browser there is none.
globalThis.window ??= globalThis as typeof window;
globalThis.matchMedia ??= () =>
  ({ matches: false, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList;
