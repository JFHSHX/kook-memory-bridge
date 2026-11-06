'use strict';
// AES-256-GCM 端侧加密。密文格式: kmb1:<base64(iv 12B | authTag 16B | ciphertext)>
// key 只存本机 config.json，群上只出现密文。
const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');

const PREFIX = 'kmb1:';

function encrypt(plain, keyBuf) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyBuf, iv);
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64');
}

function decrypt(blob, keyBuf) {
  const s = String(blob);
  if (!s.startsWith(PREFIX)) throw new Error('不是 kmb1 密文（缺少版本前缀）');
  const raw = Buffer.from(s.slice(PREFIX.length), 'base64');
  if (raw.length < 29) throw new Error('密文过短，已损坏');
  const d = createDecipheriv('aes-256-gcm', keyBuf, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
}

function isCiphertext(s) { return String(s).startsWith(PREFIX); }
function newKeyHex() { return randomBytes(32).toString('hex'); }

function keyFromHex(hex) {
  const b = Buffer.from(hex, 'hex');
  if (b.length !== 32) throw new Error('key 必须是 64 位 hex（32 字节）');
  return b;
}

module.exports = { encrypt, decrypt, isCiphertext, newKeyHex, keyFromHex };
