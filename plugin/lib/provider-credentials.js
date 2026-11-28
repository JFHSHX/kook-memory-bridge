import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveProviderKey({ env = process.env, name = 'NS_API_KEY', explicit = '', allowCredentials = env === process.env, credentialsFile = '' } = {}) {
  if (explicit) return explicit;
  if (env?.[name]) return env[name];
  if (name === 'a' && env?.NS_API_KEY) return env.NS_API_KEY;
  if (!allowCredentials) return '';
  try {
    const file = credentialsFile || path.join(os.homedir(), '.dsh', '.credentials.yaml');
    const text = fs.readFileSync(file, 'utf8');
    const names = name === 'a' ? ['a', 'NS_API_KEY'] : [name];
    for (const candidate of names) {
      const match = text.match(new RegExp('^\\s*' + candidate + ':\\s*(.+?)\\s*$', 'm'));
      if (match) return match[1].trim().replace(/^["']|["']$/g, '');
    }
    return '';
  } catch {
    return '';
  }
}
