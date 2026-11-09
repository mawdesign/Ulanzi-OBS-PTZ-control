// Entry point run by Ulanzi Studio (Node). Studio passes its address and port on the command line;
// the vendored SDK reads them, so nothing is hard-coded here.
import { startService } from './service.js';

const service = startService();

// Studio ending this process must not leave a camera moving: stop everything first, then exit.
let exiting = false;
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, async () => {
    if (exiting) return;
    exiting = true;
    const bail = setTimeout(() => process.exit(0), 3000); // never hang on a stuck OBS
    await service.stop().catch(() => {});
    clearTimeout(bail);
    process.exit(0);
  });
}
