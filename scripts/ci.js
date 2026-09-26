import { spawnSync } from "node:child_process";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const steps = ["lint", "typecheck", "schema:check", "cloudflare:check", "waitlist:check", "secrets:check", "test", "audit"];

for (const step of steps) {
  console.log(`\n[ci] npm run ${step}`);
  const result = spawnSync(npm, ["run", step], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
