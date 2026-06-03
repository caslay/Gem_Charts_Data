const http = require('http');

const options = {
  hostname: '127.0.0.1',
  port: 4000,
  path: '/api/market-data?symbol=ETHUSDC&interval=5m',
  method: 'GET',
  headers: {
    // NextAuth bypass header or standard development headers if any
    'Cookie': ''
  }
};

const req = http.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
  res.setEncoding('utf8');
  let rawData = '';
  res.on('data', (chunk) => { rawData += chunk; });
  res.on('end', () => {
    try {
      console.log('Raw data length:', rawData.length);
      if (res.statusCode === 307 || res.statusCode === 302) {
        console.log('Redirect location:', res.headers.location);
        return;
      }
      const parsedData = JSON.parse(rawData);
      console.log('Parsed API Keys:', Object.keys(parsedData));
      if (parsedData.ipda_metrics) {
        console.log('ipda_metrics keys:', Object.keys(parsedData.ipda_metrics));
        console.log('full_structure_map keys:', Object.keys(parsedData.ipda_metrics.full_structure_map || {}));
        const fsm = parsedData.ipda_metrics.full_structure_map || {};
        console.log('swings count:', fsm.swings?.length);
        console.log('swing_points count:', fsm.swing_points?.length);
        console.log('structural_events count:', fsm.structural_events?.length);
        console.log('dealingRange:', fsm.dealingRange);
        if (fsm.swings && fsm.swings.length > 0) {
          console.log('First 5 swings:', fsm.swings.slice(0, 5));
        }
        if (fsm.swing_points && fsm.swing_points.length > 0) {
          console.log('First 5 swing_points:', fsm.swing_points.slice(0, 5));
        }
        if (fsm.structural_events && fsm.structural_events.length > 0) {
          console.log('First 5 structural_events:', fsm.structural_events.slice(0, 5));
        }
      } else {
        console.log('No ipda_metrics found!');
      }
    } catch (e) {
      console.error(e.message);
      console.log('First 500 chars of response:', rawData.slice(0, 500));
    }
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
