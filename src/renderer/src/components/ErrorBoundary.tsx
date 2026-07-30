import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * 顶层错误边界：任意子组件渲染抛错时展示可读信息，
 * 避免渲染器崩溃导致整窗黑屏（Electron 无错误边界时整棵 React 树会被卸载）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error('[ErrorBoundary] 渲染异常：', error);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="p-6 text-[13px] text-rose-300">
          <p className="font-semibold">界面渲染出错</p>
          <pre className="mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-800/60 p-3 text-[11px] text-slate-400">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 cursor-pointer rounded-lg bg-brand/80 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-brand"
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
