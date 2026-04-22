import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('project exposes a Vercel serverless adapter without breaking local server startup', async () => {
  const [serverSource, adapterSource, vercelConfigSource] = await Promise.all([
    readFile(new URL('../server.js', import.meta.url), 'utf8'),
    readFile(new URL('../api/server.js', import.meta.url), 'utf8'),
    readFile(new URL('../vercel.json', import.meta.url), 'utf8')
  ]);

  assert.match(serverSource, /export async function handleRequest/);
  assert.match(serverSource, /export default handleRequest/);
  assert.match(serverSource, /http\.createServer\(handleRequest\)/);
  assert.match(serverSource, /process\.argv\[1\]/);
  assert.match(adapterSource, /export default function handler/);
  assert.match(adapterSource, /handleRequest\(req, res\)/);

  const vercelConfig = JSON.parse(vercelConfigSource);
  assert.deepEqual(vercelConfig.rewrites, [
    { source: '/admin/eval/api/:path*', destination: '/api/server' },
    { source: '/admin/eval/assets/:path*', destination: '/api/server' },
    { source: '/admin/eval', destination: '/api/server' },
    { source: '/', destination: '/api/server' }
  ]);
});
