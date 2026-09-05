import { it, expect, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const run = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((x) => rm(x, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "icon-stdio-"));
  dirs.push(root);
  return root;
}
it("lists tools and creates an icon through the real CLI and stdio process", async () => {
  const root = await setup();
  const env = { PATH: process.env.PATH, ICON_WORKSPACE: root };
  const options = { env, timeout: 15000 };
  const tools = await run(
    process.execPath,
    ["dist/client.js", "tools"],
    options,
  );
  expect(JSON.parse(tools.stdout).tools).toHaveLength(6);
  expect(tools.stderr).toBe("");
  const created = await run(
    process.execPath,
    ["dist/client.js", "call", "create_icon", "examples/orbit.json"],
    options,
  );
  expect(JSON.parse(JSON.parse(created.stdout).content[0].text).name).toBe(
    "orbit",
  );
  const list = await run(
    process.execPath,
    ["dist/client.js", "call", "list_icons"],
    options,
  );
  expect(JSON.parse(JSON.parse(list.stdout).content[0].text).icons).toEqual([
    "orbit",
  ]);
});
it("returns nonzero status for invalid usage, JSON and tool failures without leaking paths", async () => {
  const root = await setup();
  const options = {
    env: { PATH: process.env.PATH, ICON_WORKSPACE: root },
    timeout: 15000,
  };
  await expect(
    run(process.execPath, ["dist/client.js", "wrong"], options),
  ).rejects.toMatchObject({ code: 1 });
  const file = join(root, "bad.json");
  await writeFile(file, "{");
  await expect(
    run(
      process.execPath,
      ["dist/client.js", "call", "read_icon", file],
      options,
    ),
  ).rejects.toMatchObject({ code: 1 });
  await writeFile(file, JSON.stringify({ name: "missing" }));
  try {
    await run(
      process.execPath,
      ["dist/client.js", "call", "read_icon", file],
      options,
    );
    expect.fail("Should reject");
  } catch (error: any) {
    expect(error.code).toBe(1);
    expect(error.stdout).not.toContain(root);
  }
});
it("fails closed when the server workspace is missing", async () => {
  await expect(
    run(process.execPath, ["dist/server.js"], {
      env: { PATH: process.env.PATH },
      timeout: 5000,
    }),
  ).rejects.toMatchObject({ code: 1, stdout: "" });
});
