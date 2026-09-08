import type { FullConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import net from "node:net";

export default async function globalTeardown(config: FullConfig) {


    const state = fs.existsSync(String(process.env.STATE_FILE)) ? JSON.parse(fs.readFileSync(String(process.env.STATE_FILE), 'utf8')) : null;
    if (state) {
      console.log(`Stopping Caddy file server (pid ${state.pid})`);
      try {
        process.kill(state.pid);
      } catch {
        // already gone
      }
      fs.rmSync(String(process.env.STATE_FILE), { force: true });
    }
    return;

    
}