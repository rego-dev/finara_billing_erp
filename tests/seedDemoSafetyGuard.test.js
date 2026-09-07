const { assertSafeToWipe } = require('../prisma/seedDemo');

// Must-not-skip negative test: before the demo reset script is ever run against
// Railway, this proves it refuses to wipe anything if the "DEMO" code were ever
// misconfigured to point at a real business — e.g. an id collision, or a name
// that was renamed away from containing "Demo".
describe('seedDemo.assertSafeToWipe', () => {
  test('refuses when the resolved business is id 1', () => {
    expect(() => assertSafeToWipe({ id: 1, name: 'Demo Trading Co.' })).toThrow(/SAFETY ABORT/);
  });

  test('refuses when the resolved business is id 2', () => {
    expect(() => assertSafeToWipe({ id: 2, name: 'Demo Trading Co.' })).toThrow(/SAFETY ABORT/);
  });

  test('refuses when the name no longer contains "Demo"', () => {
    expect(() => assertSafeToWipe({ id: 4, name: 'BFaith on Print Adverting & Tailoring Services' })).toThrow(/SAFETY ABORT/);
  });

  test('refuses when the name is missing entirely', () => {
    expect(() => assertSafeToWipe({ id: 4, name: null })).toThrow(/SAFETY ABORT/);
  });

  test('allows a genuine demo business at any other id', () => {
    expect(() => assertSafeToWipe({ id: 4, name: 'Demo Trading Co.' })).not.toThrow();
    expect(() => assertSafeToWipe({ id: 17, name: 'Our Demo Company' })).not.toThrow();
  });
});
