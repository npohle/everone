import type { FullConfig } from '@playwright/test';
import { stopCaddy } from './lib/caddy.ts';

export default async function globalTeardown(config: FullConfig) {
  await stopCaddy(String(process.env.ARTEFACTS_DIR));
}
