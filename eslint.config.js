import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'

/**
 * One flat config for all three workspaces.
 *
 * A config per workspace was the other option and buys nothing here: flat
 * config selects by glob, `projectService` finds each file's own tsconfig by
 * itself, and four files that must be kept in step is four chances for the API
 * and the SPAs to drift into different rules for the same mistake.
 *
 * The type-aware rules are the reason this is worth having at all — they are
 * the ones that need the type checker and so cannot be replicated by a faster
 * linter. `no-floating-promises` in particular: this codebase runs real
 * background work, and a dropped `await` on a refund is not something review
 * reliably catches.
 */
export default tseslint.config(
  {
    // Nothing generated, built, or vendored. `packages/db/src/generated` is
    // Prisma's output and is gitignored — linting it would report thousands of
    // problems in a file nobody edits.
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'packages/db/src/generated/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'scripts/verify/screenshots/**',
    ],
  },

  js.configs.recommended,

  // ─── TypeScript, type-aware ────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // Resolves each file against the nearest tsconfig, so one config here
        // covers three workspaces with three different compiler setups.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      /**
       * The rules this whole setup is for. A promise dropped on the floor in an
       * Express handler is an unhandled rejection and a request that answers
       * 200 having done nothing.
       *
       * The codebase already marks its deliberate fire-and-forget calls with
       * `void` — `void ensureBucket()`, `void invalidateCatalog()` — which is
       * exactly what this rule accepts, so it should be quiet on correct code.
       */
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      /**
       * A warning, not an error, and the distinction is the point: this reports
       * an assertion the compiler can already prove redundant. That is worth
       * knowing and is never a bug, and 19 of them failing CI on day one is how
       * a team learns to run `lint` with `|| true`.
       */
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      /**
       * Off. An `async` function with no `await` is usually a smell and here is
       * twice a requirement: `logProvider.send` has to be async to satisfy the
       * `MailProvider` interface it implements, and `issueTokens` is async so
       * that signing can become asynchronous without changing its callers.
       * Neither is a mistake, and the rule cannot tell the difference.
       */
      '@typescript-eslint/require-await': 'off',

      /**
       * Off, deliberately, and not because they are wrong.
       *
       * The `no-unsafe-*` family fires on every value that reaches TypeScript
       * as `any` — which here means Prisma's `$queryRaw` results, Express's
       * `req.body` before Zod parses it, and the webhook payloads. Those are
       * genuinely untyped at the boundary and are narrowed a line later. Left
       * on, they produce hundreds of reports about code that is already
       * careful, and a lint run nobody reads catches nothing at all.
       *
       * Turn one back on when the boundary it covers has been given a type.
       */
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // `_next` is required by Express's error-handler arity even when unused.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // ─── the API: a Node process ───────────────────────────────────────────────
  {
    files: ['apps/api/**/*.ts', 'packages/db/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // ─── the two SPAs: a browser, and React's rules ────────────────────────────
  {
    files: ['apps/{admin,storefront}/**/*.{ts,tsx}'],
    /**
     * `configs.flat['recommended-latest']`, and the path matters. In
     * react-hooks v7 the top-level `configs['recommended-latest']` is still the
     * eslintrc shape — flat config rejects its string-array `plugins` key — and
     * `configs.flat` is a namespace holding the flat variants, not a config
     * itself.
     */
    extends: [reactHooks.configs.flat['recommended-latest'], reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      /**
       * `checksVoidReturn.attributes: false`, or this rule reports every
       * `onSubmit={handleSubmit(onSubmit)}` in the repo — 38 of them, all
       * correct. React genuinely ignores the returned promise for a JSX
       * handler, and react-hook-form's `handleSubmit` returns one by design.
       *
       * The other half of the rule is left on: passing an async function where
       * a `void` callback is expected in ordinary code is still an error.
       */
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      /**
       * New in react-hooks v7 and reported as warnings on purpose.
       *
       * These flag patterns that are legal today and that the React team wants
       * to discourage ahead of the compiler — setting state from an effect,
       * refs read during render, libraries whose store is not concurrent-safe.
       * Each is worth reading; none is a defect in code that ships and works.
       * Promote one to `error` after the app has been swept for it, not before.
       */
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/incompatible-library': 'warn',
      'react-hooks/refs': 'warn',

      /**
       * A hot-reload hint, not a correctness rule: a file exporting both a
       * component and a constant simply reloads less gracefully in dev.
       */
      'react-refresh/only-export-components': 'warn',
    },
  },

  // ─── config and scripts: not in any tsconfig ───────────────────────────────
  {
    // `vite.config.ts` and friends sit outside the `include` of the tsconfig
    // they live beside, so type-aware linting has no program for them. Lint
    // them without it rather than widening every tsconfig to suit the linter.
    files: ['**/*.config.{js,ts}', 'scripts/**/*.mjs', 'packages/db/prisma/**/*.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },

  // ─── the verification scripts ──────────────────────────────────────────────
  {
    /**
     * Playwright drivers, and half of each file runs in the *browser*: the
     * bodies of `page.evaluate()` are serialised and executed there, which is
     * why `document` is referenced in a file Node runs.
     *
     * They are also one-shot scripts written to prove a phase worked, not
     * shipped code. Held to correctness rules, not to tidiness — an unused
     * binding in a script that has already served its purpose is not worth a
     * red build.
     */
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
      'no-sparse-arrays': 'warn',
    },
  },

  /**
   * Last, and it must be last: this turns off every rule that would fight
   * Prettier over formatting. Layout is Prettier's job; correctness is this
   * file's.
   */
  prettier,
)
