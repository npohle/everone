// Self-signed certificate for the dev server.
//
// The suite serves the working copy on the app's registered https origin, so the
// dev server needs a certificate for that hostname. Chrome is launched with
// --ignore-certificate-errors, so a throwaway self-signed cert is enough.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** @returns {{key: string, cert: string, dir: string, cleanup: () => void}} */
export function createSelfSignedCert(host, { bin = "openssl" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "onedrive-e2e-cert-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  try {
    execFileSync(
      bin,
      [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", keyPath,
        "-out", certPath,
        "-days", "1",
        "-subj", `/CN=${host}`,
        "-addext", `subjectAltName=DNS:${host},DNS:localhost,IP:127.0.0.1`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    if (err.code === "ENOENT") {
      throw new Error(`${bin} is not installed — needed to create the dev server certificate`);
    }
    throw new Error(`Failed to create a self-signed certificate for ${host}: ${err.stderr ?? err.message}`);
  }
  return {
    dir,
    key: readFileSync(keyPath, "utf8"),
    cert: readFileSync(certPath, "utf8"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
