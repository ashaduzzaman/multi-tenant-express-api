import { defineConfig } from 'drizzle-kit';

const adminUrl = process.env.DATABASE_ADMIN_URL;
if (!adminUrl) {
  throw new Error(
    'DATABASE_ADMIN_URL is required for drizzle-kit. Run with: tsx --env-file=.env ...',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: adminUrl,
  },
  verbose: true,
  strict: true,
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
});
