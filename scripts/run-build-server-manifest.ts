import { main } from './build-server-manifest';

/**
 * Thin entry point invoked by `npm run build` (via `vite-node`, same reasoning as
 * `run-build-skill.ts`). Kept separate from `build-server-manifest.ts` so that module never
 * self-invokes on import, which is what lets a future test import its pure functions
 * side-effect-free.
 */
main();
