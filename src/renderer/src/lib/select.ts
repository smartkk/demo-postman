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
