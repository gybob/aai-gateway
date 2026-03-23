import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as {
  name: string;
  version: string;
};

export const AAI_GATEWAY_NAME = packageJson.name;
export const AAI_GATEWAY_VERSION = packageJson.version;
