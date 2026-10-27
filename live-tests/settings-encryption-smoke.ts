// 一次性验证脚本：stub electron.safeStorage，跑 Settings 真实加解密往返。
// 不在 CI 中运行（依赖 Electron 运行时的 safeStorage），仅本地冒烟用。
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import Module from 'node:module';

// ── stub electron：safeStorage 用 AES-256-GCM 模拟系统密钥链行为 ──
const KEY = crypto.createHash('sha256').update('smoke-key').digest();
const origLoad = Module._load;
Module._load = function (request: string, ...rest: unknown[]) {
  if (request === 'electron') {
    return {
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (plain: string) => {
          const iv = crypto.randomBytes(12);
          const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
          const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
          return Buffer.concat([iv, cipher.getAuthTag(), enc]);
        },
        decryptString: (buf: Buffer) => {
          const iv = buf.subarray(0, 12);
          const tag = buf.subarray(12, 28);
          const data = buf.subarray(28);
          const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
          decipher.setAuthTag(tag);
          return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
        },
      },
    };
  }
  // @ts-expect-error 透传余下参数
  return origLoad.apply(this, [request, ...rest]);
};

async function main() {
  const { Settings } = await import('../src/main/settings');

    const file = path.join(os.tmpdir(), `settings-smoke-${Date.now()}.json`);

  // 1) 旧版明文配置：加载后内存中应为明文（向后兼容）
  fs.writeFileSync(file, JSON.stringify({ ai: { baseUrl: 'https://api.example.com', apiKey: 'sk-legacy-plain', model: 'gpt' } }));
  const s1 = new Settings(file);
  assert.strictEqual(s1.get().ai?.apiKey, 'sk-legacy-plain', '旧版明文应原样加载');

  // 1b) 加载即迁移：明文 key 在构造时就被加密重写，不用等用户改设置
  const migrated = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(migrated.ai.apiKey.startsWith('enc:v1:'), '加载后应立即加密落盘');
  assert.ok(!migrated.ai.apiKey.includes('sk-legacy-plain'), '迁移后不得残留明文');

  // 2) 保存后落盘必须是加密态（enc:v1: 前缀，且不含明文）
  s1.update({ ai: { baseUrl: 'https://api.example.com', apiKey: 'sk-legacy-plain', model: 'gpt' } });
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(onDisk.ai.apiKey.startsWith('enc:v1:'), '落盘应为 enc:v1: 前缀');
  assert.ok(!onDisk.ai.apiKey.includes('sk-legacy-plain'), '落盘不得包含明文');
  assert.strictEqual(s1.get().ai?.apiKey, 'sk-legacy-plain', '内存中应保持明文');

  // 3) 重新加载：从加密文件解密回明文
  const s2 = new Settings(file);
  assert.strictEqual(s2.get().ai?.apiKey, 'sk-legacy-plain', '重启后应解密回明文');

  // 4) 空 key 不加密（避免无意义损耗）
  s2.update({ ai: { baseUrl: '', apiKey: '', model: '' } });
  const onDisk2 = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(onDisk2.ai.apiKey, '', '空 key 应原样落盘');

  fs.rmSync(file, { force: true });
  console.log('settings 加解密冒烟通过：明文兼容 / 落盘加密 / 重启解密 / 空 key 直通 ✅');

  console.log("settings smoke done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
