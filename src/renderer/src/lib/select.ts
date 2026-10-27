/**
 * 只读文本块（<pre>）的点击选中辅助。
 *
 * 问题：焦点落在只读 <pre> 上时按 Ctrl+C，Chromium 在选区为空的情况下
 * 会回退为「复制整页文档」，表现为全页字符被选中高亮。
 * 解决：单击 <pre> 时，若本次点击没有产生人工选区，则自动选中该块自身，
 * 使 Ctrl+C 只复制这一块（指定范围），而不是整页。
 */
export function selectPreOnClick(e: React.MouseEvent<HTMLElement>) {
  const el = e.currentTarget;
  const sel = window.getSelection();
  if (!sel) return;
  // 已有选区且落在当前块内：保留用户手动选择，不覆盖。
  if (sel.rangeCount > 0 && !sel.getRangeAt(0).collapsed) {
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) return;
  }
  const r = document.createRange();
  r.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Ctrl/Cmd+A 作用域化：只选中「鼠标所在面板」的内容。
 *
 * 问题：默认行为会选中整个文档，侧边栏、工具栏、主面板的文字一起被高亮，
 * 既难用又会让随后的 Ctrl+C 复制出整页内容。
 * 解决：在面板根元素上标记 data-select-scope，按 Ctrl/Cmd+A 时按鼠标位置
 * 定位所在面板，仅选中该面板内容；若鼠标停在只读文本块（响应体 <pre>、
 * 结果表格等）上，则进一步只选中该块；不在任何面板内则不做全选。
 * 焦点在输入控件内时，只有鼠标也停在该控件上才保留原生「选中控件内文本」。
 *
 * @returns 卸载函数，用于移除监听。
 */
export function installSelectScope(): () => void {
  let x = -1;
  let y = -1;
  let hasPoint = false;

  const onMove = (e: MouseEvent) => {
    x = e.clientX;
    y = e.clientY;
    hasPoint = true;
  };

  const isEditable = (el: Element | null): boolean => {
    const e = el as HTMLElement | null;
    if (!e) return false;
    return e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || !!e.isContentEditable;
  };

  /** 找到坐标所属的作用域面板（最近的带 data-select-scope 的祖先）。 */
  const scopeOf = (el: Element | null): HTMLElement | null =>
    el ? (el.closest('[data-select-scope]') as HTMLElement | null) : null;

  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key.toLowerCase() !== 'a') return;

    // 优先按鼠标位置定位面板，其次回退到当前焦点所在面板
    const hovered = hasPoint ? document.elementFromPoint(x, y) : null;
    const scope = scopeOf(hovered) || scopeOf(document.activeElement);

    // 焦点在输入控件内时，仅当鼠标就停在该控件上（或取不到鼠标位置）才走
    // 浏览器原生的「选中控件内文本」；否则以鼠标所在面板为准。
    // 否则会出现「焦点还留在响应区的搜索框，按 Ctrl+A 只选中那个空输入框」的情况。
    const ae = document.activeElement as HTMLElement | null;
    if (ae && isEditable(ae)) {
      if (!hovered || ae === hovered || ae.contains(hovered)) return;
    }

    // 未落在任何面板内：阻止整页全选（默认行为会把所有面板一起选中）
    e.preventDefault();
    const current = window.getSelection();
    if (!scope) {
      current?.removeAllRanges();
      return;
    }

    // 鼠标停在某个只读文本块（响应体 <pre>、结果表格等）上时只选中该块，
    // 否则选中整个面板内容。
    const block = hovered
      ? (hovered.closest('pre, table, [data-select-block]') as HTMLElement | null)
      : null;
    const target = block && scope.contains(block) ? block : scope;

    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  document.addEventListener('mousemove', onMove, { passive: true });
  // 捕获阶段：先于应用内其它快捷键处理，确保能阻止整页全选
  document.addEventListener('keydown', onKey, true);
  return () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('keydown', onKey, true);
  };
}
