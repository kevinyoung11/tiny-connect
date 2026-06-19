import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('main page exposes agent console shell and module import', () => {
  const html = readFileSync(resolve('public/index.html'), 'utf8');
  const js = readFileSync(resolve('public/client.js'), 'utf8');
  const css = readFileSync(resolve('public/styles.css'), 'utf8');

  assert.match(html, /id="agentBtn"/);
  assert.match(html, /id="agentSheet"/);
  assert.match(html, /id="agentTaskForm"/);
  assert.match(html, /id="agentTaskList"/);
  assert.match(html, /id="agentApprovalList"/);
  assert.match(html, /id="agentOutput"/);
  assert.match(html, /id="agentDelivery"/);
  assert.match(js, /import \{ initAgentConsole \} from '\.\/agent-console\.js';/);
  assert.match(js, /initAgentConsole\(/);
  assert.match(css, /\.agent-sheet/);
});
