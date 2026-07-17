#!/usr/bin/env tsx
import './load-script-env';
import { db } from '../app/lib/db';
import { createDataLabBackup } from '../app/lib/dataLab/backup';

createDataLabBackup()
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => db.$disconnect());
