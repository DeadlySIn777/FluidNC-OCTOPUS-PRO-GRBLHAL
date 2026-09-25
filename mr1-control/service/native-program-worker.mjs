import { parentPort, workerData } from 'node:worker_threads';
import { prepareProgram } from './native-controller.mjs';

try {
  const { source, ...program } = prepareProgram(workerData.source, workerData.name, workerData.options);
  parentPort.postMessage({ program });
} catch (error) { parentPort.postMessage({ error: error.message }); }
