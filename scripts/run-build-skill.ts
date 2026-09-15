import { main } from './build-skill';

/**
 * Thin entry point invoked by `npm run build` (via `vite-node`, not `tsx` -- see
 * `build-skill.ts`'s own module comment for why). Kept separate from `build-skill.ts` itself so
 * that module never self-invokes on import, which is what lets
 * `tests/unit/build-skill.test.ts` import its pure functions side-effect-free.
 */
main();
