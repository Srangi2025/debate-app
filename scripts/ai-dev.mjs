import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = fileURLToPath(new URL("../ai-service/", import.meta.url));
const python = join(directory, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error("AI virtual environment missing. Follow the Python setup in README.md.");
  process.exit(1);
}
const args = ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8001"];
if (existsSync(join(directory, ".env"))) args.push("--env-file", ".env");
const child = spawn(python, args, { cwd: directory, stdio: "inherit", env: process.env });
child.on("error", () => { console.error("Unable to start the Python service."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
