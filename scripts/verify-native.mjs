import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { PNG } from "pngjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const workspace = await mkdtemp(join(tmpdir(), "composer-native-"));
const client = new Client({ name: "native-verification", version: "1.0.0" });
const env = { ICON_WORKSPACE: workspace };
if (process.env.ICON_COMPOSER_APP)
  env.ICON_COMPOSER_APP = process.env.ICON_COMPOSER_APP;
async function call(name, args) {
  const result = await client.callTool(
    { name, arguments: args },
    { timeout: 60000 },
  );
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  return result;
}
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(root, "dist/server.js")],
      env,
      stderr: "pipe",
    }),
  );
  const status = JSON.parse(
    (await call("composer_status", {})).content[0].text,
  );
  assert.equal(status.available, true, "Apple Icon Composer required");
  for (const platform of ["iOS", "macOS"]) {
    const name = platform.toLowerCase();
    const source = new PNG({ width: 128, height: 128 });
    source.data.fill(255);
    const pngBase64 = PNG.sync.write(source).toString("base64");
    const spec = {
      background: "#123456",
      platform,
      groups: [
        {
          name: "Material",
          shadow: "chromatic",
          shadowOpacity: 0.2,
          specular: true,
          blur: 0.1,
          translucency: 0.1,
          lighting: "individual",
          layers: [
            {
              name: "Tile",
              pngBase64,
              darkPngBase64: pngBase64,
              glass: true,
              scale: 0.5,
              x: 10,
              y: 10,
            },
          ],
        },
      ],
    };
    await call("create_icon", { name, spec });
    for (const rendition of [
      "Default",
      "Dark",
      "TintedLight",
      "TintedDark",
      "ClearLight",
      "ClearDark",
    ]) {
      const size = rendition === "Default" ? 1024 : 32;
      const rendered = await call("render_icon", {
        name,
        size,
        rendition,
        tintColor: 0.6,
        tintStrength: 0.7,
        opaqueBackground: "#ffffff",
      });
      const bytes = Buffer.from(
        rendered.content.find((x) => x.type === "image").data,
        "base64",
      );
      assert.equal(bytes[25], 2, "Export must have no alpha channel");
      const decoded = PNG.sync.read(bytes);
      assert.equal(decoded.width, size);
      assert.equal(decoded.height, size);
      const saved = JSON.parse(
        rendered.content.find((x) => x.type === "text").text,
      ).path;
      assert.deepEqual(await readFile(join(workspace, saved)), bytes);
    }
  }
  process.stdout.write(
    `Native MCP verification passed: Icon Composer ${status.version}; iOS/macOS, six appearances, PNG layers, chromatic shadows, 32/1024 px, opaque RGB exports.\n`,
  );
} finally {
  await client.close();
  await rm(workspace, { recursive: true, force: true });
}
