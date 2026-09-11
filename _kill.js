const { execSync } = require('child_process');

// 按镜像名直接结束进程（无需解析 PID，更可靠）
function killByImage(name) {
  try {
    execSync(`taskkill /F /IM ${name}`, { stdio: 'ignore' });
  } catch (e) {
    /* 无该进程时忽略 */
  }
}

// 结束命令行中包含指定关键字的 node 进程（仅限本项目相关的 vite/electron-vite dev 进程）
// 注意：wmic 在较新的 Windows 上已被移除，改用 PowerShell CIM 查询，失败时再回退到 wmic。
function killNodeWithCmd(match) {
  const pids = listNodePids(match);
  for (const pid of pids) {
    try {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    } catch (e) {
      /* ignore */
    }
  }
  return pids;
}

/** 查询命令行包含 match 的 node.exe 进程 PID 列表。 */
function listNodePids(match) {
  const parse = (out) =>
    out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d+$/.test(l));

  // 首选：PowerShell CIM（Win10 1809+ / Win11 均可用）
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*${match}*' } | ForEach-Object { $_.ProcessId }"`,
      { encoding: 'utf8' }
    );
    const pids = parse(out);
    if (pids.length) return pids;
    return [];
  } catch (e) {
    /* 继续回退 */
  }

  // 回退：wmic（旧版 Windows）
  try {
    const out = execSync(
      `wmic process where "name='node.exe' and commandline like '%${match}%'" get processid`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    );
    return parse(out);
  } catch (e) {
    return [];
  }
}

// 结束 Electron 渲染进程（携带已排定的定时任务计时器）
killByImage('electron.exe');
// 结束本项目对应的 dev 服务器，避免旧进程残留计时器
const killed = killNodeWithCmd('demo-postman');

console.log(
  `已结束相关进程（electron 及本项目 dev${killed.length ? `，node PID: ${killed.join(', ')}` : '，无残留 node 进程'}）`
);
