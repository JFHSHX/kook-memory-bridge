import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveProviderKey } from '../lib/provider-credentials.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kook-provider-key-'));
const file = path.join(dir, 'credentials.yaml');
fs.writeFileSync(file, 'a: "local-proxy-key"\n');
const nsFile = path.join(dir, 'ns.yaml');
fs.writeFileSync(nsFile, 'NS_API_KEY: "ns-proxy-key"\n');
assert.equal(resolveProviderKey({ env: {}, name: 'a', allowCredentials: true, credentialsFile: nsFile }), 'ns-proxy-key');
assert.equal(resolveProviderKey({ env: {}, name: 'a', allowCredentials: true, credentialsFile: file }), 'local-proxy-key');
assert.equal(resolveProviderKey({ env: { a: 'env-key' }, name: 'a', credentialsFile: file }), 'env-key');
assert.equal(resolveProviderKey({ env: {}, name: 'OTHER', credentialsFile: file }), '');
assert.equal(resolveProviderKey({ env: {}, name: 'a', allowCredentials: false, credentialsFile: file }), '');
console.log('✓ a 环境变量缺失时读取本机凭据，显式环境与隔离测试优先');
fs.rmSync(dir, { recursive: true, force: true });
