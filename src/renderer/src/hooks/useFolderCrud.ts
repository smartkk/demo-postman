import { useCallback, useState } from 'react';

interface UseFolderCrudArgs {
  /** 列出全部文件夹（后端 API 的 listXFolders）。 */
  listFolders: () => Promise<string[]>;
  /** 新建文件夹（后端 API 的 createXFolder）。 */
  createFolder: (name: string) => Promise<void>;
}

interface UseFolderCrudReturn {
  /** 当前文件夹列表（供 <Select>/分组展示使用）。 */
  folders: string[];
  /** 直接设置文件夹列表（供 refresh 一次性同步 projects + folders 时复用）。 */
  setFolders: React.Dispatch<React.SetStateAction<string[]>>;
  /** 新建文件夹输入框的受控值。 */
  newFolderName: string;
  setNewFolderName: React.Dispatch<React.SetStateAction<string>>;
  /** 仅重新拉取文件夹列表。 */
  refreshFolders: () => Promise<void>;
  /**
   * 新建文件夹：trim 后忽略空名，创建成功后清空输入并刷新列表。
   * 返回创建成功的名称；空名被忽略时返回 null。
   */
  addFolder: () => Promise<string | null>;
}

/**
 * 抽出「文件夹（分组）」相关的重复状态与逻辑。
 *
 * ChainList / BatchList 与 ChainPanel / BatchPanel 此前各自复制了一份
 * `folders` 状态、`newFolderName` 状态与 `addFolder` 函数（逻辑逐字相同）。
 * 统一到这里后，三处（实为四处）调用点只需传入各自的 API 函数即可。
 */
export function useFolderCrud({
  listFolders,
  createFolder,
}: UseFolderCrudArgs): UseFolderCrudReturn {
  const [folders, setFolders] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState('');

  const refreshFolders = useCallback(async () => {
    const list = await listFolders();
    setFolders(list);
  }, [listFolders]);

  const addFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return null;
    await createFolder(name);
    setNewFolderName('');
    await refreshFolders();
    return name;
  }, [newFolderName, createFolder, refreshFolders]);

  return {
    folders,
    setFolders,
    newFolderName,
    setNewFolderName,
    refreshFolders,
    addFolder,
  };
}
