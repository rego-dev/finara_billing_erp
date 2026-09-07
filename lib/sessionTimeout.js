const WARNING_MS = 60000;

function getSessionPhase({ lastActivity, now, timeoutMinutes }) {
  const timeoutMs = timeoutMinutes * 60000;
  const idleMs = now - lastActivity;
  if (idleMs >= timeoutMs) return 'expired';
  if (idleMs >= timeoutMs - WARNING_MS) return 'warning';
  return 'active';
}

function formatCountdown(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

module.exports = { WARNING_MS, getSessionPhase, formatCountdown };
