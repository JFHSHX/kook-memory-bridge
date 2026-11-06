'use strict';
// 配置目录：$KOOK_MEMORY_HOME（测试覆盖）或 ~/.dsh/kook-memory
// config.json 首次运行自动生成，密钥随机产生，仅存本机（0600）。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { newKeyHex } = require('./crypto');

function homeDir() {
  return process.env.KOOK_MEMORY_HOME || path.join(os.homedir(), '.dsh', 'kook-memory');
}

function loadOrCreate() {
  const dir = homeDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'config.json');
  if (!fs.existsSync(file)) {
    const cfg = {
      apiBase: 'https://www.kookapp.cn/api/v3', // KOOK 官方 REST 基址，测试时可指向 mock
      botToken: '',                              // developer.kookapp.cn 创建应用后获得
      channelId: '',                             // 目标文字频道 id
      key: newKeyHex(),                          // AES-256-GCM 密钥（64 hex）
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 });
    console.error('[kook-memory] 已生成初始配置 ' + file + '（新密钥已自动生成）');
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!cfg.key) throw new Error('config.json 缺少 key；删除该文件后重新运行即可重新初始化');
  return cfg;
}

function indexPath() { return path.join(homeDir(), 'index.jsonl'); }

module.exports = { loadOrCreate, homeDir, indexPath };
