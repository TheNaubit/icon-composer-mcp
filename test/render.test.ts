import { it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { IconStore } from "@/store";
import { createServer } from "@/mcp";
import { renderNative } from "@/native";
vi.mock("@/native", () => ({
  renditions: [
    "Default",
    "Dark",
    "TintedLight",
    "TintedDark",
    "ClearLight",
    "ClearDark",
  ],
  nativeStatus: async () => ({ available: true, version: "1.6" }),
  renderNative: vi.fn(),
}));
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((x) => rm(x, { recursive: true, force: true })),
  );
  vi.resetAllMocks();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "icon-render-"));
  dirs.push(root);
  const store = await IconStore.open(root);
  await store.create("sample", {
    background: "#000000",
    groups: [
      {
        name: "Layer",
        layers: [{ name: "Shape", svg: '<svg><circle r="20"/></svg>' }],
      },
    ],
  });
  return { root, store };
}
function nativeSuccess() {
  vi.mocked(renderNative).mockImplementation(async (input, output, options) => {
    expect(
      JSON.parse(await readFile(join(input, "icon.json"), "utf8")).groups,
    ).toHaveLength(1);
    const png = new PNG({ width: options.size, height: options.size });
    png.data.fill(0);
    await writeFile(output, PNG.sync.write(png));
  });
}
it("snapshots validated assets, checks PNG output, and cleans temporary files", async () => {
  const { store, root } = await setup();
  nativeSuccess();
  const result = await store.render("sample", { rendition: "Dark", size: 32 });
  expect(result.path).toMatch(/^sample-Dark-[a-f0-9-]+\.png$/);
  expect(await readFile(join(root, result.path))).toEqual(result.bytes);
  expect((await readdir(root)).some((x) => x.startsWith(".render-"))).toBe(
    false,
  );
});
it("composites alpha into a real RGB export", async () => {
  const { store } = await setup();
  nativeSuccess();
  const result = await store.render("sample", {
    rendition: "Default",
    size: 32,
    opaqueBackground: "#123456",
  });
  expect(result.bytes[25]).toBe(2);
  expect([...PNG.sync.read(result.bytes).data.subarray(0, 4)]).toEqual([
    18, 52, 86, 255,
  ]);
});
it("rejects malformed or incorrectly sized native output and cleans up failures", async () => {
  const { store, root } = await setup();
  vi.mocked(renderNative).mockImplementation(async (_, output) => {
    await writeFile(output, "invalid");
  });
  await expect(
    store.render("sample", { rendition: "Default", size: 32 }),
  ).rejects.toThrow("requested PNG");
  expect(await readdir(root)).toEqual(["sample.icon"]);
  vi.mocked(renderNative).mockRejectedValue(new Error("native failed"));
  await expect(
    store.render("sample", { rendition: "Default", size: 32 }),
  ).rejects.toThrow();
  expect(await readdir(root)).toEqual(["sample.icon"]);
});
it("returns inline image content only when requested over MCP", async () => {
  const { store } = await setup();
  nativeSuccess();
  const server = createServer(store);
  const client = new Client({ name: "render-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  await client.connect(a);
  try {
    const result = await client.callTool({
      name: "render_icon",
      arguments: { name: "sample", size: 32 },
    });
    expect(result.isError).not.toBe(true);
    expect(result.content).toHaveLength(2);
    const noImage = await client.callTool({
      name: "render_icon",
      arguments: { name: "sample", size: 32, inline: false },
    });
    expect(noImage.content).toHaveLength(1);
  } finally {
    await client.close();
    await server.close();
  }
});
