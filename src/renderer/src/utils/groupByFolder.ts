import type { InterfaceRecord } from '../../../shared/types';

export interface FolderBuckets {
  /** folder -> 该分组下的记录（顺序与输入一致） */
  buckets: Map<string, InterfaceRecord[]>;
  /** 抓取来源（source==='captured'）的记录总数 */
  capturedCount: number;
}

/**
 * 一次遍历完成「按文件夹分桶」+「抓取来源计数」。
 *
 * 优化点（P1-3）：此前 Sidebar 对每个分组各做一次全量 filter，
 * 复杂度 O(分组数 × 记录数)；这里单次遍历 O(记录数) 即可，
 * 记录上千后配合抓取时的高频更新开销差异明显。抽成纯函数便于单测。
 */
export function buildFolderBuckets(records: InterfaceRecord[]): FolderBuckets {
  const buckets = new Map<string, InterfaceRecord[]>();
  let capturedCount = 0;
  for (const it of records) {
    if (it.source === 'captured') capturedCount += 1;
    const f = it.folder || '';
    const bucket = buckets.get(f);
    if (bucket) bucket.push(it);
    else buckets.set(f, [it]);
  }
  return { buckets, capturedCount };
}
