import fs from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { CaptureSettings } from '../shared/types';

const AI_DEFAULTS = { baseUrl: '', apiKey: '', model: '' };

const DEFAULTS: CaptureSettings = {
  includeHosts: [],
  excludeHosts: [],
  autoGroup: true,
  dedupByFullUrl: false,
  verifyTls: false,
  environments: { 默认: {} },
  activeEnv: '默认',
  ai: { ...AI_DEFAULTS },
};

/** 落盘的加密 AI API Key 前缀（无此前缀的按旧版明文兼容处理）。 */
const ENC_PREFIX = 'enc:v1:';

/**
 * 加密 AI API Key 后落盘（Windows DPAPI / macOS Keychain / Linux libsecret）。
 * 加密不可用（如无 keyring）或加密失败时按明文保存并告警，保证功能不中断。
 */
function encryptApiKey(key: string): string {
  if (!key || key.startsWith(ENC_PREFIX)) return key;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(key).toString('base64');
    }
    console.warn('[settings] 系统加密不可用，API Key 按明文保存');
  } catch (err) {
    console.error('[settings] API Key 加密失败，按明文保存', err);
  }
  return key;
}

/** 解密落盘的 AI API Key；旧版明文或无前缀值原样返回（向后兼容）。 */
function decryptApiKey(stored: string): string {
  if (!stored || !stored.startsWith(ENC_PREFIX)) return stored;
  try {
    return safeStorage.decryptString(
      Buffer.from(stored.slice(ENC_PREFIX.length), 'base64')
    );
  } catch (err) {
    console.error('[settings] API Key 解密失败（可能更换了系统账户）', err);
    return '';
  }
}

/**
 * 抓取设置：白名单（include/exclude 主机）与自动分组开关。
 * 持久化到 userData/settings.json，运行时可被 UI 修改并即时生效。
 * AI API Key 使用系统密钥链加密后落盘，内存中保持明文供调用。
 */
export class Settings {
  private data: CaptureSettings;
  private file: string;
  private listeners: Array<() => void> = [];

  constructor(file: string) {
    this.file = file;
    this.data = { ...DEFAULTS };
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = { ...DEFAULTS, ...raw };
        const storedKey = this.data.ai?.apiKey ?? '';
        // 旧版明文 key：加载后立即加密重写，不用等用户下次改设置才收敛
        if (storedKey && !storedKey.startsWith(ENC_PREFIX)) this.save();
        this.data.ai = {
          ...AI_DEFAULTS,
          ...this.data.ai,
          apiKey: decryptApiKey(storedKey),
        };
      }
    } catch (err) {
      console.error('[settings] 加载失败，使用默认', err);
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      // 仅加密 ai.apiKey，其余字段原样落盘
      const toSave: CaptureSettings = {
        ...this.data,
        ai: {
          ...AI_DEFAULTS,
          ...this.data.ai,
          apiKey: encryptApiKey(this.data.ai?.apiKey ?? ''),
        },
      };
      fs.writeFileSync(this.file, JSON.stringify(toSave, null, 2), 'utf8');
    } catch (err) {
      console.error('[settings] 保存失败', err);
    }
  }

  get(): CaptureSettings {
    return { ...this.data };
  }

  update(patch: Partial<CaptureSettings>): CaptureSettings {
    this.data = { ...this.data, ...patch };
    this.save();
    this.emit();
    return this.get();
  }

  onChange(cb: () => void): void {
    this.listeners.push(cb);
  }

  private emit(): void {
    for (const cb of this.listeners) cb();
  }
}

// 运行时注入的当前设置实例，供 sender 等在调用链上不便逐层透传 settings 的模块读取。
// 设置在 UI 中可随时修改并即时生效，无需层层传递。
let activeInstance: Settings | null = null;
export function bindSettingsInstance(s: Settings): void {
  activeInstance = s;
}
export function getActiveSettings(): Settings | null {
  return activeInstance;
}
