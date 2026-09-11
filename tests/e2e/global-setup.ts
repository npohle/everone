import type { FullConfig } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { startCaddy } from './lib/caddy.ts';

export default async function globalSetup(config: FullConfig) {

  const runId = process.env.RUN_ID;
  const artefactsDir = path.join("tests", "artefacts", runId!);
  fs.mkdirSync(artefactsDir, { recursive: true });

  process.env.ARTEFACTS_DIR = artefactsDir;

  console.log(`Artefacts directory: ${artefactsDir}`);

  const { pid, port } = await startCaddy(artefactsDir);
  console.log(`Caddy (pid ${pid}) is serving https://npohle.github.io:${port}/everone/ (https://127.0.0.1:${port}/everone/)`);

}
