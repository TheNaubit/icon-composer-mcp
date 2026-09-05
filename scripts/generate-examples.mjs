import { readFile, writeFile, mkdtemp, cp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = fileURLToPath(new URL("..", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "composer-gallery-"));
const client = new Client({ name: "gallery-builder", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist/server.js")],
  env: { ICON_WORKSPACE: workspace },
  stderr: "pipe",
});
const modes = [
  "Default",
  "Dark",
  "TintedLight",
  "TintedDark",
  "ClearLight",
  "ClearDark",
];
async function call(name, args) {
  const result = await client.callTool(
    { name, arguments: args },
    { timeout: 60000 },
  );
  if (result.isError) throw new Error(JSON.stringify(result.content));
  return result;
}
try {
  await client.connect(transport);
  const status = await call("composer_status", {});
  if (!JSON.parse(status.content[0].text).available)
    throw new Error("Apple Icon Composer is not available.");
  await mkdir(join(root, "docs/images"), { recursive: true });
  for (const name of ["orbit", "bloom", "prism"]) {
    const recipe = JSON.parse(
      await readFile(join(root, "examples", name + ".json"), "utf8"),
    );
    await call("create_icon", recipe);
    await cp(
      join(workspace, name + ".icon"),
      join(root, "examples", name + ".icon"),
      { recursive: true },
    );
    for (const rendition of modes) {
      const rendered = await call("render_icon", {
        name,
        rendition,
        size: 512,
        inline: true,
      });
      const image = rendered.content.find((x) => x.type === "image");
      await writeFile(
        join(root, "docs/images", `${name}-${rendition}.png`),
        Buffer.from(image.data, "base64"),
      );
    }
    const small = await call("render_icon", { name, size: 32 });
    await writeFile(
      join(root, "docs/images", `${name}-32.png`),
      Buffer.from(small.content.find((x) => x.type === "image").data, "base64"),
    );
  }
  process.stdout.write(
    "Generated 3 editable documents and 21 native PNG previews through MCP.\n",
  );
} finally {
  await client.close();
  await rm(workspace, { recursive: true, force: true });
}
