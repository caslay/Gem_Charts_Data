import fs from 'fs';
import path from 'path';

const study = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'scratch', 'pm2_champion_full_study_output.json'), 'utf8')
);

console.log('Study output loaded successfully.');
