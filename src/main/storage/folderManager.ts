/**
 * 分组（文件夹）管理的共享逻辑。
 *
 * interfaceStore / batchStore / chainStore 三份存储原本各自实现了一份几乎相同的
 * 文件夹 CRUD（createFolder / deleteFolder / listFolders），且删组时「清空组内项目的
 * folder 字段」的循环也复制了三遍。这里把纯分组逻辑抽出来，由各 store 通过回调接入
 * 自己的数据集合与持久化动作，避免逻辑分叉导致三处行为不一致。
 */
export interface FolderItemLike {
  folder?: string;
}

export class FolderManager {
  private folders: string[] = [];

  /**
   * @param allItems  返回当前所有可被分组的项目（用于删除分组时清空其 folder 字段）
   * @param onChange  分组变更后触发（由各 store 负责 save + emitChange）
   */
  constructor(
    private readonly allItems: () => Iterable<FolderItemLike>,
    private readonly onChange: () => void
  ) {}

  /** 载入 / 覆盖分组列表（load / import 时调用）。 */
  setAll(folders: string[]): void {
    this.folders = [...folders];
  }

  /** 当前所有分组（返回副本，避免外部直接改内部数组）。 */
  list(): string[] {
    return [...this.folders];
  }

  /** 新建分组：自动 trim 并去重（空名或已存在则忽略）。 */
  create(name: string): void {
    const n = name.trim();
    if (!n || this.folders.includes(n)) return;
    this.folders.push(n);
    this.onChange();
  }

  /** 删除分组：从列表中移除，同时把属于该组的项目移回「未分组」。 */
  delete(name: string): void {
    this.folders = this.folders.filter((f) => f !== name);
    for (const item of this.allItems()) {
      if (item.folder === name) item.folder = '';
    }
    this.onChange();
  }
}
