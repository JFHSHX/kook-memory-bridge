# kook-memory-bridge

tg-memory-bridge 的 KOOK 后端原型：**KOOK 频道存密文 + 本地索引存明文**，AES-256-GCM 端侧加密，零依赖（Node ≥18 内置能力）。

## 威胁模型与结论

| 对手 | XOR（已否决） | 本方案 AES-256-GCM |
|---|---|---|
| 人眼 / 关键词机审 | 能挡 | 能挡 |
| 平台主动分析 | 分钟级破解（同钥多消息 + 可预测消息头 = two-time pad） | 挡得住（认证加密，含完整性校验） |

- 明文只落本机（`~/.dsh/kook-memory/`，本地信任根），KOOK 群上只有 `kmb1:` 密文
- 密钥两种来源（`config.json`，0600，与 bot token 同级）：
  - **随机 key**：首次运行自动生成 32 字节（64 hex），仅存本机
  - **passphrase**：config 里写 `passphrase` → scrypt(N=2^14) 派生 256 位 GCM 密钥，`kdfSalt` 本机自动生成——多端重建只需记住口令
  - ⚠️ 人记的低熵口令（16 字符 ASCII ≈ 38 bit 熵）**绝不能直接当 AES 密钥**，必须走 KDF；换 passphrase = 旧密文全部作废
- 每条消息独立随机 IV；密文被篡改时解密直接失败（GCM auth tag）

## 快速开始

```bash
npm test          # mock 全链路 e2e（不需要 KOOK 账号）
node cli.js status
```

## 实弹接入（五步）

1. KOOK 注册并实名 → [developer.kookapp.cn](https://developer.kookapp.cn) 创建应用 → 拿 bot token
2. 机器人拉进你的私人服务器，授予「管理消息」权限（置顶需要）
3. 取目标文字频道 id（KOOK 网页端频道链接里的一串 id）
4. 填 `~/.dsh/kook-memory/config.json` 的 `botToken` / `channelId`
5. `node cli.js retain "第一条记忆" fact` → 去 KOOK 客户端确认频道里是乱码（= 成功）

## CLI

```
node cli.js retain "内容" [tag1,tag2]   # 写入（群上密文，索引明文）
node cli.js edit <id> "新内容"          # 原位更新（双侧）
node cli.js forget <id>                 # 双侧删除
node cli.js pin|unpin <id>              # 置顶 / 取消
node cli.js recall "关键词"             # 本地召回
node cli.js peek "<kmb1:...>"           # 手工解一条密文
node cli.js status
```

## 结构

```
src/crypto.js   AES-256-GCM：kmb1:<base64(iv|tag|ct)>，每条随机 IV
src/config.js   ~/.dsh/kook-memory/config.json 自动生成（密钥 0600）
src/kook.js     KOOK REST 最小客户端：create/update/delete/pin/unpin/list
src/store.js    本地 JSONL 索引：明文 + 关键词召回
src/bridge.js   编排：Defense 钩子 → 加密 → KOOK；索引双侧同步
mock/           KOOK /api/v3 内存 mock（应答封包与官方一致）
test/e2e.js     mock 全链路：发/改/删/钉/召回/篡改拒绝/历史回读
```

## Roadmap

- [ ] 实弹验证：KOOK type 9 原位 update（文档称仅 9/10 可改，待真机确认）
- [ ] 接入 tg-memory-bridge 的 Memory Defense（30+ 类 redact）钩子
- [ ] 置顶画像卡（明文摘要当目录）与 digest 三态对账
- [ ] 并入 DSH 插件（对齐 tg-memory-bridge 的生命周期钩子）

## License

MIT
