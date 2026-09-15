import { z } from 'zod';

const envSchema = z.object({
  // App
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('*')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean)),

  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_ADMIN_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
  DB_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(5_000),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ISSUER: z.string().default('multitenant-api'),
  JWT_AUDIENCE: z.string().default('multitenant-api'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  COOKIE_ACCESS_NAME: z.string().default('mt_access'),
  COOKIE_REFRESH_NAME: z.string().default('mt_refresh'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // Rate limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}

export const env: Env = loadEnv();
