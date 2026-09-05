#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./mcp.js";
import { IconStore } from "./store.js";

try {
  const root = process.env.ICON_WORKSPACE;
  if (!root) throw new Error("Workspace required");
  const server = createServer(await IconStore.open(root));
  const transport = new StdioServerTransport(process.stdin, process.stdout, {
    maxBufferSize: 3 * 1024 * 1024,
  });
  server.server.onerror = () => {
    process.stderr.write("MCP request could not be processed.\n");
  };
  await server.connect(transport);
} catch {
  process.stderr.write(
    "Cannot start Icon Composer Kit. Set ICON_WORKSPACE to an absolute, dedicated, writable directory.\n",
  );
  process.exitCode = 1;
}
