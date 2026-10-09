import { spawn } from "node:child_process";
import { startFixtureServer } from "./fixture-server.mjs";
const fixture = await startFixtureServer();
try {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/verify/a11y.mjs", fixture.base], { stdio: "inherit", windowsHide: true });
    child.on("error", reject); child.on("exit", resolve);
  });
  process.exitCode = result ?? 1;
} finally { await fixture.close(); }
