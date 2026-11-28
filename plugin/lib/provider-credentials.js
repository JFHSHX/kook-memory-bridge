import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveProviderKey({ env = process.env, name = 'NS_API_KEY', explicit = '', allowCredentials = env === process.env, credentialsFile = '' } = {}) {
  if (explicit) return explicit;
  if (env?.[name]) return env[name];
  if (!allowCredentials || name !== 'a') return '';
  try {
    const file = credentialsFile || path.join(os.homedir(), '.dsh', '.credentials.yaml');
    const text = fs.readFileSync(file, 'utf8');
    const match = text.match(/^\s*a:\s*(.+?)\s*$/m);
    return match ? match[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}
