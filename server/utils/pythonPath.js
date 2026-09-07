/**
 * Resolves the correct Python executable name for the current platform.
 * Windows: 'python' (python3 alias usually not set)
 * Linux/Mac: 'python3' preferred, falls back to 'python'
 */
const { execFileSync } = require('child_process');

function tryCmd(cmd) {
  try {
    execFileSync(cmd, ['--version'], { timeout: 3000, stdio: 'pipe' });
    return true;
  } catch { return false; }
}

let _resolved = null;
function getPython() {
  if (_resolved) return _resolved;
  if (process.platform === 'win32') {
    _resolved = tryCmd('python') ? 'python' : 'python3';
  } else {
    _resolved = tryCmd('python3') ? 'python3' : 'python';
  }
  return _resolved;
}

module.exports = { getPython };
