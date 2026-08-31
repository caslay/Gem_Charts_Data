import * as fs from 'fs';
import * as path from 'path';

function inspectTelemetry() {
  const oldPath = path.join(process.cwd(), 'scratch', 'Old_version_SWEEP_RECLAIM_ETHUSDC_5m_7ea78a23.json');
  const newPath = path.join(process.cwd(), 'scratch', 'Premium-descount-fix-SWEEP_RECLAIM_ETHUSDC_5m_2f34fa77.json');

  const oldData = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  const newData = JSON.parse(fs.readFileSync(newPath, 'utf8'));

  console.log('=== OLD DATA TELEMETRY ===');
  console.log(JSON.stringify(oldData.telemetry || oldData.metrics || oldData.summary, null, 2));

  console.log('\n=== NEW DATA TELEMETRY ===');
  console.log(JSON.stringify(newData.telemetry || newData.metrics || newData.summary, null, 2));

  // Compare telemetry side by side
  const tOld = oldData.telemetry || {};
  const tNew = newData.telemetry || {};

  console.log('\n=== SIDE-BY-SIDE TELEMETRY COMPARISON ===');
  const keys = Array.from(new Set([...Object.keys(tOld), ...Object.keys(tNew)]));
  for (const k of keys) {
    console.log(`${k.padEnd(35)}: OLD = ${String(tOld[k]).padEnd(15)} | NEW = ${String(tNew[k])}`);
  }
}

inspectTelemetry();
