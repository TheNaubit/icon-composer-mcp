import { it, expect, afterEach, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "@/mcp";
import { IconStore } from "@/store";
vi.mock("@/native", () => ({
  renditions: [
    "Default",
    "Dark",
    "TintedLight",
    "TintedDark",
    "ClearLight",
    "ClearDark",
  ],
  nativeStatus: async () => ({ available: false }),
  renderNative: async () => {
    throw new Error("sensitive /private/path");
  },
}));
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "icon-mcp-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const store = await IconStore.open(root);
  const server = createServer(store);
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  cleanup.push(
    () => server.close(),
    () => client.close(),
  );
  return { client, store };
}
const spec = {
  background: "#334455",
  groups: [
    {
      name: "Mark",
      layers: [
        {
          name: "Disc",
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="100"/></svg>',
        },
      ],
    },
  ],
};
function body(result: any) {
  return JSON.parse(result.content[0].text);
}
it("negotiates protocol and performs complete create/read/update/list lifecycle", async () => {
  const { client } = await setup();
  expect((await client.listTools()).tools).toHaveLength(6);
  expect((await client.listPrompts()).prompts).toHaveLength(1);
  expect(
    (await client.getPrompt({ name: "compose-icon" })).messages[0]?.content
      .type,
  ).toBe("text");
  expect(
    body(await client.callTool({ name: "composer_status", arguments: {} })),
  ).toEqual({ available: false });
  await client.callTool({
    name: "create_icon",
    arguments: { name: "orbit", spec },
  });
  const read = body(
    await client.callTool({ name: "read_icon", arguments: { name: "orbit" } }),
  );
  await client.callTool({
    name: "update_icon",
    arguments: {
      name: "orbit",
      outputName: "orbit-dark",
      expectedRevision: read.revision,
      spec: { ...spec, background: "#000000" },
    },
  });
  expect(
    body(await client.callTool({ name: "list_icons", arguments: {} })).icons,
  ).toEqual(["orbit", "orbit-dark"]);
});
it("rejects malicious tool input and conceals filesystem and renderer errors", async () => {
  const { client } = await setup();
  const result = await client.callTool({
    name: "read_icon",
    arguments: { name: "missing" },
  });
  expect(result.isError).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/ENOENT|\/Users|\/private/);
  const unsafe = await client.callTool({
    name: "create_icon",
    arguments: {
      name: "escape",
      spec: {
        ...spec,
        groups: [
          { name: "X", layers: [{ name: "X", svg: "<svg><script/></svg>" }] },
        ],
      },
    },
  });
  expect(unsafe.isError).toBe(true);
  await client.callTool({
    name: "create_icon",
    arguments: { name: "orbit", spec },
  });
  const failed = await client.callTool({
    name: "render_icon",
    arguments: { name: "orbit" },
  });
  expect(failed.isError).toBe(true);
  expect(JSON.stringify(failed)).not.toContain("sensitive");
});
it("reports revision conflicts and existing destinations clearly", async () => {
  const { client } = await setup();
  await client.callTool({
    name: "create_icon",
    arguments: { name: "orbit", spec },
  });
  expect(
    body(
      await client.callTool({
        name: "create_icon",
        arguments: { name: "orbit", spec },
      }),
    ).error,
  ).toContain("exists");
  expect(
    body(
      await client.callTool({
        name: "update_icon",
        arguments: {
          name: "orbit",
          outputName: "next",
          expectedRevision: "0".repeat(64),
          spec,
        },
      }),
    ).error,
  ).toContain("changed");
});
it("limits concurrent operations and calls per minute", async () => {
  const { client, store } = await setup();
  let release!: () => void;
  vi.spyOn(store, "list").mockImplementationOnce(
    () =>
      new Promise<string[]>((resolve) => {
        release = () => resolve([]);
      }),
  );
  const first = client.callTool({ name: "list_icons", arguments: {} });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(
    body(await client.callTool({ name: "list_icons", arguments: {} })).error,
  ).toContain("running");
  release();
  await first;
  for (let i = 0; i < 118; i++)
    await client.callTool({ name: "list_icons", arguments: {} });
  expect(
    body(await client.callTool({ name: "list_icons", arguments: {} })).error,
  ).toContain("Rate limit");
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61000);
  expect(
    body(await client.callTool({ name: "list_icons", arguments: {} })).icons,
  ).toEqual([]);
  vi.restoreAllMocks();
});
