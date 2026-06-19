import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('production docker image installs bash for runner compatibility', () => {
  const dockerfile = readFileSync('Dockerfile', 'utf8');

  assert.match(dockerfile, /apk add --no-cache[^\n]*bash/);
});
