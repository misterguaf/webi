// Entry point of the «proves» deployment only (gestio/wrangler.proves.toml). Local and test runtimes keep using
// gestio/worker.js directly. snapshot.generated.js is written by `npm run proves:deploy` and never committed.
import app from '../worker.js';
import snapshot from './snapshot.generated.js';
import { createProvesWorker } from './runtime.js';

export default createProvesWorker({ app, snapshot });
