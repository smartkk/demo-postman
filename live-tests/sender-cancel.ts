// 验证 sender.ts 修复：取消信号在重定向链中透传；直接慢请求取消不回归。
import { sendRequest } from '../src/main/request/sender';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

async function main() {
  // 1) 正常重定向链（301/302 → 200）应成功完成
  try {
    const r = await sendRequest({
      method: 'GET',
      url: 'http://127.0.0.1:19080/redirect-a',
    });
    check('重定向链正常完成', r.status === 200 && r.body.includes('final'), `status=${r.status}`);
  } catch (e) {
    check('重定向链正常完成', false, String(e));
  }

  // 2) 重定向链中取消 → 应拒绝为「已取消」（第二跳为慢接口，取消必须透传）
  {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 300);
    try {
      await sendRequest(
        { method: 'GET', url: 'http://127.0.0.1:19080/redirect-slow' },
        0,
        c.signal
      );
      check('重定向链中取消生效', false, '请求意外成功');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      check('重定向链中取消生效', msg === '已取消', msg);
    } finally {
      clearTimeout(t);
    }
  }

  // 3) 直接慢请求取消（既有行为，防回归）
  {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 300);
    try {
      await sendRequest({ method: 'GET', url: 'http://127.0.0.1:19080/slow' }, 0, c.signal);
      check('直接慢请求取消', false, '请求意外成功');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      check('直接慢请求取消', msg === '已取消', msg);
    } finally {
      clearTimeout(t);
    }
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
