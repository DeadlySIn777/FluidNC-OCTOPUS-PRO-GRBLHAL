import path from 'node:path';

// True when `candidate` is neither `directory` itself nor anywhere inside it.
// path.relative() returns an absolute path when the two are on different Windows
// drives; that result is outside, not a relative path that happens not to start with '..'.
export function isOutsideDirectory(directory, candidate, pathApi = path) {
  const rel = pathApi.relative(pathApi.resolve(directory), pathApi.resolve(candidate));
  if (rel === '') return false;
  if (pathApi.isAbsolute(rel)) return true;
  return rel === '..' || rel.startsWith(`..${pathApi.sep}`);
}
