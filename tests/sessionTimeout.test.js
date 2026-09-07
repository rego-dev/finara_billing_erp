const { WARNING_MS, getSessionPhase, formatCountdown } = require('../lib/sessionTimeout');

describe('getSessionPhase', () => {
  const timeoutMinutes = 2; // 120000ms

  test('active when well within the timeout', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 30000, timeoutMinutes })).toBe('active');
  });

  test('warning exactly at timeout - WARNING_MS', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 120000 - WARNING_MS, timeoutMinutes })).toBe('warning');
  });

  test('still warning just before the timeout', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 119999, timeoutMinutes })).toBe('warning');
  });

  test('expired exactly at the timeout', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 120000, timeoutMinutes })).toBe('expired');
  });

  test('expired well past the timeout', () => {
    expect(getSessionPhase({ lastActivity: 0, now: 999999, timeoutMinutes })).toBe('expired');
  });
});

describe('formatCountdown', () => {
  test('formats under a minute as 0:SS', () => {
    expect(formatCountdown(45000)).toBe('0:45');
  });
  test('formats a full minute as 1:00', () => {
    expect(formatCountdown(60000)).toBe('1:00');
  });
  test('pads single-digit seconds', () => {
    expect(formatCountdown(5000)).toBe('0:05');
  });
  test('clamps negative values to 0:00', () => {
    expect(formatCountdown(-500)).toBe('0:00');
  });
  test('rounds up partial seconds so it never shows 0:00 while still counting down', () => {
    expect(formatCountdown(200)).toBe('0:01');
  });
});
