import {
  evaluateOperationalSchedule,
  parseTimeString,
  convertLocalizedToUtcEpoch,
} from '../src/lib/operationalSchedule';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function runTests() {
  console.log('--- Starting Operational Schedule Unit Tests ---');

  // Test 1: parseTimeString
  console.log('Testing parseTimeString...');
  assert(parseTimeString('08:00').hours === 8 && parseTimeString('08:00').minutes === 0, '08:00 parsing');
  assert(parseTimeString('22:30').hours === 22 && parseTimeString('22:30').minutes === 30, '22:30 parsing');
  assert(parseTimeString('invalid').hours === 8 && parseTimeString('invalid').minutes === 0, 'invalid fallback');
  assert(parseTimeString(null).hours === 8 && parseTimeString(null).minutes === 0, 'null fallback');

  // Test 2: ALWAYS_ON mode
  console.log('Testing ALWAYS_ON mode...');
  const resAlwaysOn = evaluateOperationalSchedule({ scheduleMode: 'ALWAYS_ON' });
  assert(resAlwaysOn.isWithinActiveSchedule === true, 'ALWAYS_ON should always be within schedule');
  assert(resAlwaysOn.nextSessionOpenTimestamp === null, 'ALWAYS_ON has null nextSessionOpenTimestamp');

  // Test 3: SESSION_PRESET in Cairo (UTC+3)
  console.log('Testing SESSION_PRESET (08:00 - 22:00 Cairo)...');
  const baseDate = new Date('2026-09-13T00:00:00Z'); // midnight UTC = 03:00 Cairo
  const ms730Cairo = baseDate.getTime() + (4 * 3600 + 30 * 60) * 1000; // 04:30 UTC = 07:30 Cairo
  const ms800Cairo = baseDate.getTime() + (5 * 3600) * 1000; // 05:00 UTC = 08:00 Cairo
  const ms1430Cairo = baseDate.getTime() + (11 * 3600 + 30 * 60) * 1000; // 11:30 UTC = 14:30 Cairo
  const ms2159Cairo = baseDate.getTime() + (18 * 3600 + 59 * 60 + 59) * 1000; // 18:59:59 UTC = 21:59:59 Cairo
  const ms2200Cairo = baseDate.getTime() + (19 * 3600) * 1000; // 19:00 UTC = 22:00 Cairo
  const ms2330Cairo = baseDate.getTime() + (20 * 3600 + 30 * 60) * 1000; // 20:30 UTC = 23:30 Cairo

  // At 07:30 Cairo (Sleeping before open)
  const eval730 = evaluateOperationalSchedule({ scheduleMode: 'SESSION_PRESET' }, ms730Cairo);
  assert(eval730.isWithinActiveSchedule === false, '07:30 Cairo must be sleeping');
  assert(eval730.resumesAtFormatted === '08:00', 'Resumes at 08:00');
  assert(eval730.nextSessionOpenTimestamp !== null, 'Next open timestamp must be present');
  assert(eval730.nextSessionOpenTimestamp === ms800Cairo, `Expected ms800Cairo (${ms800Cairo}), got ${eval730.nextSessionOpenTimestamp}`);

  // Formatted next open must be 08:00:00 in Cairo
  const nextOpenFormatted730 = new Date(eval730.nextSessionOpenTimestamp!).toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Cairo',
    hour12: false,
  });
  assert(nextOpenFormatted730 === '08:00:00', `Expected 08:00:00, got ${nextOpenFormatted730}`);

  // At 08:00 Cairo (Session active)
  const eval800 = evaluateOperationalSchedule({ scheduleMode: 'SESSION_PRESET' }, ms800Cairo);
  assert(eval800.isWithinActiveSchedule === true, '08:00 Cairo must be active');
  assert(eval800.nextSessionOpenTimestamp === null, 'Active session has null next open');

  // At 14:30 Cairo (Session active)
  const eval1430 = evaluateOperationalSchedule({ scheduleMode: 'SESSION_PRESET' }, ms1430Cairo);
  assert(eval1430.isWithinActiveSchedule === true, '14:30 Cairo must be active');

  // At 21:59:59 Cairo (Session active right before close)
  const eval2159 = evaluateOperationalSchedule({ scheduleMode: 'SESSION_PRESET' }, ms2159Cairo);
  assert(eval2159.isWithinActiveSchedule === true, '21:59:59 Cairo must be active');

  // At 22:00:00 Cairo (Session ended)
  const eval2200 = evaluateOperationalSchedule({ scheduleMode: 'SESSION_PRESET' }, ms2200Cairo);
  assert(eval2200.isWithinActiveSchedule === false, '22:00 Cairo must be sleeping');
  assert(eval2200.resumesAtFormatted === '08:00', 'Resumes at 08:00');
  const expectedNextDayCairo = ms800Cairo + 24 * 3600 * 1000;
  assert(eval2200.nextSessionOpenTimestamp === expectedNextDayCairo, 'Expected tomorrow 08:00 Cairo');

  const nextOpenFormatted2200 = new Date(eval2200.nextSessionOpenTimestamp!).toLocaleTimeString('en-GB', {
    timeZone: 'Africa/Cairo',
    hour12: false,
  });
  assert(nextOpenFormatted2200 === '08:00:00', `Expected 08:00:00 tomorrow, got ${nextOpenFormatted2200}`);

  // At 23:30 Cairo (Late night)
  const eval2330 = evaluateOperationalSchedule({ scheduleMode: 'SESSION_PRESET' }, ms2330Cairo);
  assert(eval2330.isWithinActiveSchedule === false, '23:30 Cairo must be sleeping');
  assert(eval2330.nextSessionOpenTimestamp === expectedNextDayCairo, 'Expected tomorrow 08:00 Cairo');

  // Test 4: Overnight custom window (22:00 to 06:00 Cairo)
  console.log('Testing Overnight CUSTOM window (22:00 to 06:00)...');
  const overnightConfig = {
    scheduleMode: 'CUSTOM' as const,
    activeStart: '22:00',
    activeEnd: '06:00',
    timezone: 'Africa/Cairo',
  };
  // At 23:30 Cairo (inside overnight window)
  const evalOvernightActive = evaluateOperationalSchedule(overnightConfig, ms2330Cairo);
  assert(evalOvernightActive.isWithinActiveSchedule === true, '23:30 Cairo must be active in 22:00-06:00');

  // At 14:30 Cairo (outside overnight window)
  const evalOvernightSleep = evaluateOperationalSchedule(overnightConfig, ms1430Cairo);
  assert(evalOvernightSleep.isWithinActiveSchedule === false, '14:30 Cairo must be sleeping in 22:00-06:00');
  assert(evalOvernightSleep.resumesAtFormatted === '22:00', 'Resumes at 22:00');
  assert(evalOvernightSleep.nextSessionOpenTimestamp === ms2200Cairo, 'Expected today 22:00 Cairo');

  // Test 5: Same start and end (24-hour custom)
  console.log('Testing equal start and end (08:00 to 08:00)...');
  const equalConfig = {
    scheduleMode: 'CUSTOM' as const,
    activeStart: '08:00',
    activeEnd: '08:00',
    timezone: 'Africa/Cairo',
  };
  const evalEqual = evaluateOperationalSchedule(equalConfig, ms1430Cairo);
  assert(evalEqual.isWithinActiveSchedule === true, 'Equal start/end should be active 24h');

  // Test 6: Timezone validation & crash resilience
  console.log('Testing invalid timezone resilience & safe fallback...');
  const invalidTzConfig = {
    scheduleMode: 'CUSTOM' as const,
    activeStart: '08:00',
    activeEnd: '22:00',
    timezone: 'Invalid/NonExistent_Zone',
  };
  // Must not throw RangeError and must safely compute
  const evalInvalidTz = evaluateOperationalSchedule(invalidTzConfig, ms2330Cairo);
  assert(evalInvalidTz.isWithinActiveSchedule === false, 'Invalid timezone must safely fall back without throwing');
  assert(evalInvalidTz.currentTimezone === 'Africa/Cairo', 'Invalid timezone should fallback to Africa/Cairo');
  assert(evalInvalidTz.nextSessionOpenTimestamp !== null, 'Next session open must be computed safely');

  // Test 7: SESSION_PRESET strictly pegs to Africa/Cairo regardless of config.timezone
  console.log('Testing SESSION_PRESET Cairo enforcement...');
  const presetWithForeignTz = {
    scheduleMode: 'SESSION_PRESET' as const,
    timezone: 'America/New_York', // User had New York configured in Custom mode previously
  };
  const evalPresetForeign = evaluateOperationalSchedule(presetWithForeignTz, ms1430Cairo);
  assert(evalPresetForeign.currentTimezone === 'Africa/Cairo', 'SESSION_PRESET must strictly enforce Africa/Cairo');
  assert(evalPresetForeign.isWithinActiveSchedule === true, '14:30 Cairo must be active in SESSION_PRESET');

  // Test 8: DST transition calculations in Cairo and New York
  console.log('Testing DST transitions in Cairo and New York...');
  // Cairo April 2026 DST switch (UTC+2 -> UTC+3)
  const cairoSpringMs = convertLocalizedToUtcEpoch(2026, 4, 25, 8, 0, 0, 'Africa/Cairo');
  const cairoSpringFmt = new Date(cairoSpringMs).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour12: false });
  assert(cairoSpringFmt === '08:00:00', `Expected 08:00:00 Cairo in DST spring, got ${cairoSpringFmt}`);

  // Cairo October 2026 DST switch (UTC+3 -> UTC+2)
  const cairoFallMs = convertLocalizedToUtcEpoch(2026, 10, 31, 8, 0, 0, 'Africa/Cairo');
  const cairoFallFmt = new Date(cairoFallMs).toLocaleTimeString('en-GB', { timeZone: 'Africa/Cairo', hour12: false });
  assert(cairoFallFmt === '08:00:00', `Expected 08:00:00 Cairo in DST fall, got ${cairoFallFmt}`);

  // New York March 2026 DST switch
  const nySpringMs = convertLocalizedToUtcEpoch(2026, 3, 9, 8, 0, 0, 'America/New_York');
  const nySpringFmt = new Date(nySpringMs).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour12: false });
  assert(nySpringFmt === '08:00:00', `Expected 08:00:00 NY in DST spring, got ${nySpringFmt}`);

  console.log('--- All Operational Schedule Tests Passed Successfully! ---');
}

runTests();
