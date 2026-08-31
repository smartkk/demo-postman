// 本地 E2E 测试服务器：模拟业务接口，供代理抓包 / 发送链路 / 批量并发验证使用。
import http from 'node:http';

const PORT = 19080;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const route = url.pathname;

  if (route === '/hello') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        route: 'hello',
        query: Object.fromEntries(url.searchParams),
        n: 1,
      })
    );
    return;
  }

  if (route === '/auth') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({ ok: true, auth: req.headers.authorization || null })
    );
    return;
  }

  if (route === '/echo') {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ echoed: body, ct: req.headers['content-type'] || null })
      );
    });
    return;
  }

  if (route === '/redirect-a') {
    res.writeHead(302, { location: '/redirect-b' });
    res.end();
    return;
  }

  // 重定向到慢接口：用于验证「重定向链中取消」能透传到第二跳
  if (route === '/redirect-slow') {
    res.writeHead(302, { location: '/slow' });
    res.end();
    return;
  }

  if (route === '/redirect-b') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ final: true }));
    return;
  }

  if (route === '/slow') {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('slow-done');
    }, 8000);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[test-server] listening on http://127.0.0.1:${PORT}`);
});
