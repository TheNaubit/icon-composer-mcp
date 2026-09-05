import { it, expect, afterEach } from "vitest";
import {
  mkdtemp,
  rm,
  symlink,
  readFile,
  writeFile,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IconStore } from "@/store";
const spec = {
  background: "#223344",
  groups: [
    {
      name: "Mark",
      layers: [
        {
          name: "Circle",
          svg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="100"/></svg>',
        },
      ],
    },
  ],
};
const dirs: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "icon-test-"));
  dirs.push(root);
  return { root, store: await IconStore.open(root) };
}
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((x) => rm(x, { recursive: true, force: true })),
  );
});
it("creates a native bundle, reads source and lists names", async () => {
  const { root, store } = await setup();
  const created = await store.create("orbit", spec);
  expect(created.revision).toMatch(/^[a-f0-9]{64}$/);
  expect((await store.inspect("orbit")).spec.background).toBe("#223344");
  expect(await store.list()).toEqual(["orbit"]);
  expect(
    JSON.parse(await readFile(join(root, "orbit.icon/icon.json"), "utf8"))
      .groups,
  ).toHaveLength(1);
});
it("never overwrites and updates into a new bundle with revision checks", async () => {
  const { store } = await setup();
  const a = await store.create("orbit", spec);
  await expect(store.create("orbit", spec)).rejects.toThrow();
  await expect(
    store.update("orbit", "next", "0".repeat(64), spec),
  ).rejects.toThrow("changed");
  await store.update("orbit", "next", a.revision, {
    ...spec,
    background: "#112233",
  });
  expect((await store.inspect("orbit")).spec.background).toBe("#223344");
  expect((await store.inspect("next")).spec.background).toBe("#112233");
});
it("rejects traversal, symlinks and oversized source files", async () => {
  const { root, store } = await setup();
  await expect(store.create("../escape", spec)).rejects.toThrow();
  await symlink(root, join(root, "escape.icon"));
  await expect(store.inspect("escape")).rejects.toThrow();
  await store.create("orbit", spec);
  await rm(join(root, "orbit.icon/source.json"));
  await symlink("/etc/passwd", join(root, "orbit.icon/source.json"));
  await expect(store.inspect("orbit")).rejects.toThrow();
});
it("rejects unowned bundles and malformed or large sources", async () => {
  const { root, store } = await setup();
  await mkdir(join(root, "foreign.icon"));
  await expect(store.inspect("foreign")).rejects.toThrow();
  await writeFile(
    join(root, "foreign.icon/source.json"),
    "x".repeat(2 * 1024 * 1024 + 1),
  );
  await expect(store.inspect("foreign")).rejects.toThrow();
  await writeFile(join(root, "foreign.icon/source.json"), "{}");
  await expect(store.inspect("foreign")).rejects.toThrow();
});
it("rejects relative or symlinked workspace roots", async () => {
  await expect(IconStore.open(".")).rejects.toThrow();
  const { root } = await setup();
  await symlink(root, join(root, "link"));
  await expect(IconStore.open(join(root, "link"))).rejects.toThrow();
});

it("refuses to silently discard edits made in the native editor", async () => {
  const { root, store } = await setup();
  await store.create("orbit", spec);
  const path = join(root, "orbit.icon/icon.json");
  const document = JSON.parse(await readFile(path, "utf8"));
  document.groups[0].name = "Edited in native app";
  await writeFile(path, JSON.stringify(document));
  await expect(store.inspect("orbit")).rejects.toThrow("modified");
});
it("checks asset directories and contents against the source", async () => {
  const { root, store } = await setup();
  await store.create("orbit", spec);
  const path = join(root, "orbit.icon/Assets/g0-l0.svg");
  await writeFile(path, "<svg/>");
  await expect(store.inspect("orbit")).rejects.toThrow("modified");
  await rm(join(root, "orbit.icon/Assets"), { recursive: true });
  await symlink(root, join(root, "orbit.icon/Assets"));
  await expect(store.inspect("orbit")).rejects.toThrow();
});

it("rejects workspaces writable by another account", async () => {
  const { chmod } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "icon-public-"));
  dirs.push(root);
  await chmod(root, 0o777);
  await expect(IconStore.open(root)).rejects.toThrow("owner");
});
it("rejects untracked files before treating a document as verified", async () => {
  const { root, store } = await setup();
  await store.create("orbit", spec);
  await writeFile(join(root, "orbit.icon/extra.txt"), "untracked");
  await expect(store.inspect("orbit")).rejects.toThrow("unexpected");
  await rm(join(root, "orbit.icon/extra.txt"));
  await writeFile(join(root, "orbit.icon/Assets/extra.txt"), "untracked");
  await expect(store.inspect("orbit")).rejects.toThrow("unexpected");
});
it("bounds persisted workspace entries", async () => {
  const { root, store } = await setup();
  await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      writeFile(join(root, `output-${i}.png`), ""),
    ),
  );
  await expect(store.create("orbit", spec)).rejects.toThrow("limit");
});
