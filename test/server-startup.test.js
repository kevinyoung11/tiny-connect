import test from 'node:test';
import assert from 'node:assert/strict';

test('server module imports without Supabase environment variables', async () => {
  const snapshot = snapshotEnv();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.DIRECT_URL;
  delete process.env.DATABASE_URL;
  delete process.env.Direct_Link;
  process.env.VERCEL = '1';

  try {
    const module = await import(`../server.js?test=${Date.now()}`);
    assert.equal(typeof module.default.listen, 'function');
  } finally {
    restoreEnv(snapshot);
  }
});

function snapshotEnv() {
  return {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    DIRECT_URL: process.env.DIRECT_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    Direct_Link: process.env.Direct_Link,
    VERCEL: process.env.VERCEL
  };
}

function restoreEnv(snapshot) {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}
