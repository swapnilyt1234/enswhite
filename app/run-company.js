import { spawn } from 'node:child_process';
import { VENDORS } from './company-store.js';
const children = [];
let stopping = false;
function stop() { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); }
function launch(args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('exit', code => { if (!stopping) { stop(); process.exitCode = code || 1; } });
  return child;
}
for (const vendor of VENDORS) launch(['app/vendor-server.js', vendor.id]);
try {
  for (const vendor of VENDORS) {
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { ready = (await fetch(`http://127.0.0.1:${vendor.port}/api/info`, { signal: AbortSignal.timeout(1000) })).ok; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    if (!ready) throw new Error(`${vendor.name} did not start`);
  }
  launch(['app/company-server.js']);
} catch (error) { console.error(error.message); stop(); process.exitCode = 1; }
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
