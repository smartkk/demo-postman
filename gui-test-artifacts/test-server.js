// 本地测试目标服务：供 GUI 测试中手动发送 / 链式 / 批量 / 定时调用使用
const http = require('http');
const fs = require('fs');
const path = require('path');

let counter = 0;
const hits = [];

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    counter++;
    hits.push({
      t: Date.now(),
      method: req.method,
      url: req.url,
      body,
      auth: req.headers.authorization || null,
      ua: req.headers['user-agent'] || null,
    });
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/api/hello') {
      res.end(JSON.stringify({ message: 'hello from test server', token: 'TKN-9527', n: counter }));
    } else if (u.pathname === '/api/echo') {
      res.end(JSON.stringify({
        echoed: body,
        receivedAuth: req.headers.authorization || null,
        receivedContentType: req.headers['content-type'] || null,
      }));
    } else if (u.pathname === '/api/headers') {
      res.end(JSON.stringify({ path: req.url, headers: req.headers }));
    } else if (u.pathname === '/api/counter') {
      res.end(JSON.stringify({ count: counter }));
    } else if (u.pathname === '/api/error') {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'boom' }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found' }));
    }
  });
});

server.listen(8765, '127.0.0.1', () => console.log('test server listening on 8765'));

setInterval(() => {
  fs.writeFileSync(path.join(__dirname, 'hits.json'), JSON.stringify({ counter, hits }, null, 2));
}, 800);
