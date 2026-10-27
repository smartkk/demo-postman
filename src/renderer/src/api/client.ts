import type { RendererApi } from '../../../shared/types';

declare global {
  interface Window {
    api: RendererApi;
  }
}

/**
 * 渲染进程统一 API 入口。
 *
 * 方法签名唯一来源是 shared/types.ts 的 RendererApi（preload 实现同样受其约束），
 * 此处直接引用 preload 暴露的 window.api，不再逐方法转发，避免双份维护。
 */
export const api: RendererApi = window.api;
