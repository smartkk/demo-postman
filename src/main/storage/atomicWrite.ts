import fs from 'node:fs';
import path from 'node:path';

/**
 * 原子写入 JSON 文件：先写 .tmp 临时文件，再 rename 覆盖目标，原文件备份为 .bak。
 *
 * 避免「写一半进程被中断」导致数据文件损坏（之前 batchStore / chainStore 各抄了一份，
 * 这里统一收口）。
 */
export function atomicWriteJson(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  if (fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, filePath + '.bak');
  }
  fs.renameSync(tmp, filePath);
}
