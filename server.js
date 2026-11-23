// Runtime wrapper: download Xray at startup, generate config from env, run it.
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { unzipSync } = require('fflate');

const PORT = process.env.PORT || '8080';
const UUID = process.env.UUID || '';
const WORK = '/tmp/xray';
const URL = 'https://github.com/XTLS/Xray-core/releases/latest/download/Xray-linux-64.zip';

async function main() {
  fs.mkdirSync(WORK, { recursive: true });
  const bin = WORK + '/xray';
  if (!fs.existsSync(bin)) {
    console.log('downloading xray...');
    const res = await fetch(URL, { redirect: 'follow' });
    if (!res.ok) throw new Error('download failed: ' + res.status);
    const buf = new Uint8Array(await res.arrayBuffer());
    const files = unzipSync(buf, { filter: (f) => f.name === 'xray' });
    fs.writeFileSync(bin, Buffer.from(files['xray']));
    fs.chmodSync(bin, 0o755);
    console.log('xray ready');
  }
  const cfg = {
    log: { loglevel: 'warning' },
    inbounds: [{
      listen: '0.0.0.0', port: parseInt(PORT, 10), protocol: 'vless',
      settings: { clients: [{ id: UUID }], decryption: 'none' },
      streamSettings: { network: 'ws', wsSettings: { path: '/ray' } }
    }],
    outbounds: [{ protocol: 'freedom' }]
  };
  fs.writeFileSync(WORK + '/config.json', JSON.stringify(cfg));
  const child = spawn(bin, ['run', '-config', WORK + '/config.json'], { stdio: 'inherit' });
  child.on('exit', (c) => { console.log('xray exited', c); process.exit(c || 1); });
}
main().catch((e) => { console.error(e); process.exit(1); });
