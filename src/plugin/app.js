// Entry point run by Ulanzi Studio (Node). Studio passes its address and port on the command line;
// the vendored SDK reads them, so nothing is hard-coded here.
import { startService } from './service.js';

startService();
