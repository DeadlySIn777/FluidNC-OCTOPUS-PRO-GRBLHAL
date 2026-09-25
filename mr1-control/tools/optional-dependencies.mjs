import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Optional developer tools are resolved locally, or from an explicit operator path.
export async function importDependency(name, entry = 'index.mjs') {
  try {
    return await import(name);
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes(`'${name}'`)) throw error;
    const modules = process.env.MR1_BUNDLED_NODE_MODULES;
    if (!modules) throw new Error(`Optional dependency ${name} is missing. Install it locally or set MR1_BUNDLED_NODE_MODULES to your node_modules directory.`, { cause: error });
    return import(pathToFileURL(resolve(modules, name, entry)).href);
  }
}
