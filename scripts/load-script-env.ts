/** Load the repository .env for standalone tsx scripts without overwriting shell overrides. */
import { existsSync, readFileSync } from 'fs';
import path from 'path';

const file = path.resolve('.env');
if (existsSync(file)) {
  const nativeLoad = (process as NodeJS.Process & { loadEnvFile?: (file?: string) => void }).loadEnvFile;
  if (nativeLoad) {
    nativeLoad(file);
  } else {
    for (const sourceLine of readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const match = sourceLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if (value.startsWith('"')) {
        const end = value.indexOf('"', 1);
        value = end >= 1 ? value.slice(1, end) : value.slice(1);
      } else if (value.startsWith("'")) {
        const end = value.indexOf("'", 1);
        value = end >= 1 ? value.slice(1, end) : value.slice(1);
      } else {
        value = value.replace(/\s+#.*$/, '').trim();
      }
      process.env[match[1]] = value;
    }
  }
}
