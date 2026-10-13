import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

const moneyMessage =
  'Money and decimal values are parsed from strings with src/lib/money/parse.ts (parseAmountToCents, parseDecimal) and computed with decimal.js (src/lib/money). Never use floating-point parsing or formatting.'

// no-restricted-syntax options are replaced (not merged) per config block, so each block below
// builds its list from these shared pieces.
const bannedCoerce = [
  {
    selector: "MemberExpression[object.property.name='coerce'][property.name='number']",
    message: `z.coerce.number() is not allowed: it goes through a JS float. ${moneyMessage}`,
  },
  {
    // `import { coerce } from 'zod'` then `coerce.number()`.
    selector: "CallExpression[callee.object.name='coerce'][callee.property.name='number']",
    message: `coerce.number() is not allowed: it goes through a JS float. ${moneyMessage}`,
  },
]

const bannedNumber = [
  {
    selector: "CallExpression[callee.name='Number']",
    message: `Number() is not allowed here. ${moneyMessage}`,
  },
  {
    selector: "NewExpression[callee.name='Number']",
    message: `Number() is not allowed here. ${moneyMessage}`,
  },
  {
    selector: "MemberExpression[object.name='globalThis'][property.name='Number']",
    message: `globalThis.Number is not allowed here. ${moneyMessage}`,
  },
  {
    // z.string().transform(Number), z.preprocess(Number, ...), arr.map(Number)
    selector: "CallExpression > Identifier.arguments[name='Number']",
    message: `Passing Number as a function (transform(Number), map(Number)) is not allowed here. ${moneyMessage}`,
  },
]

const bannedMoneyCoercions = [
  {
    selector: "UnaryExpression[operator='+']",
    message: `Unary plus coerces to a JS float and is not allowed here. ${moneyMessage}`,
  },
  {
    selector: "CallExpression[callee.name='parseInt']",
    message: `parseInt() is not allowed here. ${moneyMessage}`,
  },
  {
    selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseInt']",
    message: `Number.parseInt() is not allowed here. ${moneyMessage}`,
  },
  {
    selector: "MemberExpression[property.name='toPrecision']",
    message: `.toPrecision() is not allowed here. ${moneyMessage}`,
  },
  {
    selector: "MemberExpression[property.name='toLocaleString']",
    message: `.toLocaleString() is not allowed here; format at the display edge with Intl.NumberFormat in src/lib/money/format.ts. ${moneyMessage}`,
  },
]

// Tenant isolation guards (review items S3/S4). app.org_id is the setting the row-level security
// policies read, and set_config is how it is written; only withTenant may touch either.
const bannedTenantSetting = [
  {
    selector: 'Literal[value=/app\.org_id|set_config/]',
    message:
      'app.org_id and set_config belong to src/server/db/tenant.ts (withTenant). Never set the tenant context anywhere else.',
  },
  {
    selector: 'TemplateElement[value.raw=/app\.org_id|set_config/]',
    message:
      'app.org_id and set_config belong to src/server/db/tenant.ts (withTenant). Never set the tenant context anywhere else.',
  },
]

const dbAccessPatterns = {
  group: ['@/server/db/client', '@/server/db/tenant', '**/db/client', '**/db/tenant'],
  message:
    'Import the database client and withTenant only from src/server/db, auth, audit, queries.ts or actions.ts files. Everything else goes through a queries.ts or actions.ts module.',
}
const schemaPatterns = {
  group: ['@/server/db/schema', '@/server/db/schema/*', '**/db/schema', '**/db/schema/*'],
  message:
    'Database schema modules are server-only; src/app and src/components must go through a queries.ts or actions.ts module (and types it exports).',
}

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Money rules (CLAUDE.md): no float parsing, no toFixed, no z.coerce.number(), anywhere.
    rules: {
      'no-restricted-globals': ['error', { name: 'parseFloat', message: moneyMessage }],
      'no-restricted-properties': [
        'error',
        { object: 'Number', property: 'parseFloat', message: moneyMessage },
        { object: 'globalThis', property: 'parseFloat', message: moneyMessage },
        { object: 'window', property: 'parseFloat', message: moneyMessage },
        { object: 'self', property: 'parseFloat', message: moneyMessage },
        { property: 'toFixed', message: moneyMessage },
      ],
      'no-restricted-syntax': ['error', ...bannedCoerce],
    },
  },
  {
    // Application code: the tenant setting is written only by withTenant.
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...bannedCoerce, ...bannedTenantSetting] },
  },
  {
    // No Number() coercion where amounts are parsed or validated.
    files: [
      'src/lib/money/**/*.{ts,tsx}',
      'src/server/**/*.{ts,tsx}',
      'src/app/**/actions.ts',
      'src/components/**/*-form.tsx',
      'src/components/**/decimal-input.tsx',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...bannedCoerce, ...bannedNumber, ...bannedTenantSetting],
    },
  },
  {
    // The pure money library and the server layer additionally ban the other ways of
    // turning text into a JS number or formatting one.
    files: ['src/lib/money/**/*.{ts,tsx}', 'src/server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...bannedCoerce,
        ...bannedNumber,
        ...bannedMoneyCoercions,
        ...bannedTenantSetting,
      ],
    },
  },
  {
    // Import boundaries: the database client and withTenant are reachable only from the data
    // layer; the schema is not importable from UI code at all. no-restricted-imports options are
    // replaced per block, so the UI block repeats the first list.
    files: ['**/*.{ts,tsx,mjs}'],
    ignores: [
      'src/server/db/**',
      'src/server/auth/**',
      'src/server/audit/**',
      'src/server/**/queries.ts',
      'src/server/**/actions.ts',
      'tests/**',
      'scripts/**',
      '**/*.test.{ts,tsx}',
    ],
    rules: { 'no-restricted-imports': ['error', { patterns: [dbAccessPatterns] }] },
  },
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [dbAccessPatterns, schemaPatterns] }],
    },
  },
  {
    // The setting that scopes a transaction to an organization is written in one place, and tests
    // may poke at it. These blocks come last so they replace the lists above for their files.
    files: ['tests/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...bannedCoerce] },
  },
  {
    files: ['src/server/db/tenant.ts', 'src/server/**/*.test.ts', 'src/lib/money/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...bannedCoerce, ...bannedNumber, ...bannedMoneyCoercions],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    '.data/**',
    'next-env.d.ts',
  ]),
])

export default eslintConfig
