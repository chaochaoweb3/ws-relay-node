// Runtime wrapper v2: front HTTP layer (health 200 on /) + Xray on loopback.
const fs = require('fs');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const { unzipSync } = require('fflate');

const PORT = parseInt(process.env.PORT || '8080', 10);
const UUID = process.env.UUID || '';
const XRAY_PORT = 10000;
const WORK = '/tmp/xray';
const URL = 'https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip';

async function ensureXray() {
  fs.mkdirSync(WORK, { recursive: true });
  const bin = WORK + '/xray';
  if (fs.existsSync(bin)) return bin;
  console.log('downloading xray...');
  const res = await fetch(URL, { redirect: 'follow' });
  if (!res.ok) throw new Error('download failed: ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  const files = unzipSync(buf, { filter: (f) => f.name === 'xray' });
  fs.writeFileSync(bin, Buffer.from(files['xray']));
  fs.chmodSync(bin, 0o755);
  console.log('xray ready');
  return bin;
}

async function main() {
  const bin = await ensureXray();
  const cfg = {
    log: { loglevel: 'warning' },
    inbounds: [{
      listen: '127.0.0.1', port: XRAY_PORT, protocol: 'vless',
      settings: { clients: [{ id: UUID }], decryption: 'none' },
      streamSettings: { network: 'ws', wsSettings: { path: '/ray' } }
    }],
    outbounds: [{ protocol: 'freedom' }]
  };
  fs.writeFileSync(WORK + '/config.json', JSON.stringify(cfg));
  const child = spawn(bin, ['run', '-config', WORK + '/config.json'], { stdio: 'inherit' });
  child.on('exit', (c) => { console.log('xray exited', c); process.exit(c || 1); });

  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    }
  });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/ray')) { socket.destroy(); return; }
    const upstream = net.connect(XRAY_PORT, '127.0.0.1', () => {
      const headers = Object.entries(req.headers).map(([k, v]) => k + ': ' + v).join('\r\n');
      upstream.write(req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\r\n' + headers + '\r\n\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  server.listen(PORT, '0.0.0.0', () => console.log('front layer listening on ' + PORT));
}
main().catch((e) => { console.error(e); process.exit(1); });
