import { config } from "dotenv";
import path from "node:path";

// Runs once before any test file. Loads .env.test FIRST so that
// src/config/env.ts (a cached module-level singleton) picks up test
// values — the test suite always talks to a dedicated test database, never
// dev or prod, and uses a low BCRYPT_ROUNDS so auth tests stay fast.
config({ path: path.resolve(process.cwd(), ".env.test") });
