#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { validateReport } from "./core.mjs";
import { readJsonArgument, writeJson } from "./io.mjs";

try {
  const args = process.argv.slice(2);
  const reportIndex = args.indexOf("--report");
  const requestIndex = args.indexOf("--request");
  let report;
  let request = null;
  if (reportIndex >= 0) {
    if (!args[reportIndex + 1]) throw new Error("--report requires a file path.");
    report = JSON.parse(await readFile(args[reportIndex + 1], "utf8"));
    if (requestIndex >= 0) {
      if (!args[requestIndex + 1]) throw new Error("--request requires a file path.");
      request = JSON.parse(await readFile(args[requestIndex + 1], "utf8"));
    }
  } else {
    const input = await readJsonArgument(args);
    if (input?.report) ({ report, request = null } = input);
    else report = input;
  }
  const errors = validateReport(report, request);
  writeJson({ valid: errors.length === 0, errors });
  if (errors.length > 0) process.exitCode = 1;
} catch (error) {
  writeJson({ valid: false, errors: [error instanceof Error ? error.message : String(error)] });
  process.exitCode = 2;
}
