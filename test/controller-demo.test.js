import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('controller demo page presents the mobile Codex and Claude workflow', () => {
  const html = readFileSync(resolve('public/controller-demo.html'), 'utf8');

  assert.match(html, /手机上的 Codex \/ Claude 控制器/);
  assert.match(html, /TinyConnect 控制台/);
  assert.match(html, /AI 任务编排/);
  assert.match(html, /审批与交付/);
  assert.match(html, /data-action="approve"/);
  assert.match(html, /data-terminal-stream/);
});
