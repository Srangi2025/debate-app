import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const env = { ...process.env, NODE_ENV: "development" };
const children = [
  spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--webpack", ...process.argv.slice(2)], { stdio: "inherit", env }),
  spawn(process.execPath, ["scripts/judge-worker.mjs"], { stdio: "inherit", env }),
];
let closing = false;
function stop(code) {
  if (closing) return;
  closing = true;
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  const timeout = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    process.exit(code);
  }, 5000);
  timeout.unref();
  Promise.all(children.map(child => child.exitCode !== null || child.signalCode
    ? Promise.resolve() : new Promise(resolve => child.once("exit", resolve))))
    .then(() => process.exit(code));
}
for (const child of children) {
  child.once("error", error => { console.error(error.message); stop(1); });
  child.once("exit", code => { if (!closing) stop(code || 1); });
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
