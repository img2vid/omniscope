// Detached dev-server spawner: double-fork style, child gets PPID 1
import { spawn } from "node:child_process";
import fs from "node:fs";

const log = fs.openSync("/home/z/my-project/dev.log", "a");
const err = fs.openSync("/home/z/my-project/dev.log", "a");
const child = spawn("bun", ["run", "dev"], {
  cwd: "/home/z/my-project",
  detached: true,
  stdio: ["ignore", log, err],
  env: { ...process.env },
});
child.unref();
console.log("spawned dev server pid:", child.pid);
