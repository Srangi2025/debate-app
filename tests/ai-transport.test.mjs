import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiServiceHeaders } from '../lib/ai-transport.ts';

test('loopback development works without credentials', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.deepEqual(aiServiceHeaders(`http://${host}:8001`, ''), {});
  }
});

test('remote inference requires encrypted authenticated transport', () => {
  assert.deepEqual(aiServiceHeaders('https://ai.example', 'secret'), { Authorization: 'Bearer secret' });
  for (const [url, token] of [
    ['http://ai.example', 'secret'], ['https://ai.example', ''],
    ['https://localhost.evil.example', ''], ['https://user:pass@ai.example', 'secret'],
    ['https://ai.example?token=secret', 'secret'], ['ftp://localhost', 'secret'],
    ['https://ai.example', 'bad\r\nheader'],
  ]) assert.throws(() => aiServiceHeaders(url, token));
});
