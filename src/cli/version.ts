import { createRequire } from "node:module";

export function runVersion(): void {
  const require = createRequire(import.meta.url);
  let version = "0.0.0";
  try {
    const pkg = require("../../package.json") as { version?: string };
    version = pkg.version ?? version;
  } catch {
    // package metadata unavailable when bundled oddly
  }
  console.log(`llmwiki ${version}`);
  console.log("commit: unknown");
  console.log("built: unknown");
}
