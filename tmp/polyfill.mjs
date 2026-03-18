// Pre-import polyfill for Node.js test environment
// Handles: localStorage, window, import.meta.env (via tsx tsconfig alias)
globalThis.localStorage = {
  getItem:    () => null,
  setItem:    () => {},
  removeItem: () => {}
};
globalThis.window = globalThis;

// tsx exposes import.meta.env via the VITE_ prefix convention;
// stub it so api.ts doesn't throw
const metaEnv = { VITE_API_URL: 'http://localhost:3001/api', MODE: 'test', DEV: false, PROD: false, SSR: false };
// Patch for tsx's handling of import.meta.env
if (typeof process !== 'undefined') {
  process.env.VITE_API_URL = 'http://localhost:3001/api';
}
// tsx 4.x uses __define_import_meta_env__ or similar
globalThis.__define_import_meta_env__ = metaEnv;
