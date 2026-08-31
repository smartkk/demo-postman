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
function killNodeWithCmd(match) {
  try {
    const out = execSync(
      `wmic process where "name='node.exe' and commandline like '%${match}%'" get processid`,
      { encoding: 'utf8' }
    );
    const pids = out
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d+$/.test(l));
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
      } catch (e) {
        /* ignore */
      }
    }
  } catch (e) {
    /* ignore */
  }
}

// 结束 Electron 渲染进程（携带已排定的定时任务计时器）
killByImage('electron.exe');
// 结束本项目对应的 dev 服务器，避免旧进程残留计时器
killNodeWithCmd('demo-postman');

console.log('已结束相关进程（electron 及本项目 dev）');
