#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const usage =
  "Usage: icon-composer-client tools | call TOOL [arguments.json]\nSet ICON_WORKSPACE to an absolute directory before running.\n";
const client = new Client({ name: "icon-composer-client", version: "1.0.1" });
try {
  const [command, tool, file, ...extra] = process.argv.slice(2);
  if (
    !process.env.ICON_WORKSPACE ||
    extra.length ||
    !["tools", "call"].includes(command ?? "") ||
    (command === "tools" && tool) ||
    (command === "call" && !tool)
  )
    throw new Error("usage");
  let args: Record<string, unknown> = {};
  if (file) {
    const info = await stat(file);
    if (!info.isFile() || info.size > 2 * 1024 * 1024) throw new Error("size");
    args = JSON.parse(await readFile(file, "utf8"));
  }
  const env: Record<string, string> = {
    ICON_WORKSPACE: process.env.ICON_WORKSPACE,
  };
  if (process.env.ICON_COMPOSER_APP)
    env.ICON_COMPOSER_APP = process.env.ICON_COMPOSER_APP;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("./server.js", import.meta.url))],
    env,
    stderr: "pipe",
  });
  await client.connect(transport);
  const result =
    command === "tools"
      ? await client.listTools()
      : await client.callTool(
          { name: tool!, arguments: args },
          { timeout: 60000 },
        );
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if ("isError" in result && result.isError) process.exitCode = 1;
} catch {
  process.stderr.write(
    usage +
      "Request failed; check the command, JSON arguments, and workspace configuration.\n",
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
