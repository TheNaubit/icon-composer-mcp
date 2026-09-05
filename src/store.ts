import { isDeepStrictEqual } from "node:util";
import { flattenPng } from "./png.js";
import { constants } from "node:fs";
import {
  mkdir,
  lstat,
  realpath,
  opendir,
  open,
  writeFile,
  mkdtemp,
  rm,
  rmdir,
} from "node:fs/promises";
import { isAbsolute, join, parse } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  iconName,
  iconSpec,
  assetsFor,
  toDocument,
  type IconSpec,
} from "./model.js";
import { renderNative, type NativeRenderOptions } from "./native.js";

const MAX_SOURCE = 2 * 1024 * 1024;
const revision = (spec: IconSpec) =>
  createHash("sha256").update(JSON.stringify(spec)).digest("hex");
export class PublicError extends Error {}

function checkOwner(info: { uid: number; mode: number }) {
  if (
    typeof process.getuid !== "function" ||
    info.uid !== process.getuid() ||
    (info.mode & 0o022) !== 0
  )
    throw new PublicError(
      "Use a directory and files writable only by their owner on macOS or Linux.",
    );
}
async function exactEntries(directory: string, expected: string[]) {
  const allowed = new Set(expected);
  const entries = await opendir(directory);
  for await (const entry of entries) {
    if (!allowed.delete(entry.name))
      throw new PublicError(
        "Icon contains unexpected files. Move them outside the bundle first.",
      );
  }
  if (allowed.size) throw new PublicError("Icon is missing required files.");
}
async function capacity(root: string) {
  let count = 0;
  const entries = await opendir(root);
  for await (const entry of entries) {
    if (entry.name !== ".operation-lock" && ++count >= 100)
      throw new PublicError(
        "Workspace limit reached (100 entries). Archive older outputs or select a new workspace.",
      );
  }
}

async function readBounded(file: string, max: number): Promise<Buffer> {
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await handle.stat();
    checkOwner(info);
    if (!info.isFile() || info.nlink !== 1 || info.size > max)
      throw new PublicError("File type or size is not supported.");
    const data = Buffer.alloc(max + 1);
    let bytesRead = 0;
    while (bytesRead < max + 1) {
      const read = await handle.read(
        data,
        bytesRead,
        max + 1 - bytesRead,
        bytesRead,
      );
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > max) throw new PublicError("File exceeds the size limit.");
    return data.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
async function writeBundle(directory: string, spec: IconSpec) {
  await mkdir(join(directory, "Assets"), { mode: 0o700 });
  for (const [name, content] of Object.entries(assetsFor(spec)))
    await writeFile(join(directory, "Assets", name), content, {
      flag: "wx",
      mode: 0o600,
    });
  await writeFile(
    join(directory, "icon.json"),
    JSON.stringify(toDocument(spec), null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  await writeFile(join(directory, "source.json"), JSON.stringify(spec) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
}

async function verifyBundle(directory: string, spec: IconSpec) {
  await exactEntries(directory, ["Assets", "icon.json", "source.json"]);
  const native = JSON.parse(
    (await readBounded(join(directory, "icon.json"), 262144)).toString("utf8"),
  );
  const assets = join(directory, "Assets");
  const info = await lstat(assets);
  checkOwner(info);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new PublicError("Icon assets must be a real directory.");
  await exactEntries(assets, Object.keys(assetsFor(spec)));
  if (!isDeepStrictEqual(native, toDocument(spec)))
    throw new PublicError(
      "The native document was modified outside this tool. Preserve it and create a new managed icon from the desired specification.",
    );
  for (const [name, content] of Object.entries(assetsFor(spec))) {
    const actual = await readBounded(join(assets, name), 1048576);
    if (!actual.equals(Buffer.from(content)))
      throw new PublicError(
        "Native artwork was modified outside this tool. Preserve it and create a new managed icon from the desired specification.",
      );
  }
}

/** The root is an operator capability, never an argument supplied by a tool call. */
export class IconStore {
  private constructor(
    private readonly root: string,
    private readonly identity: { dev: number; ino: number },
  ) {}
  static async open(root: string): Promise<IconStore> {
    if (!isAbsolute(root) || parse(root).root === root)
      throw new PublicError(
        "Set an absolute, dedicated ICON_WORKSPACE directory.",
      );
    await mkdir(root, { recursive: true, mode: 0o700 });
    const info = await lstat(root);
    checkOwner(info);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new PublicError("The workspace must be a real directory.");
    return new IconStore(await realpath(root), {
      dev: info.dev,
      ino: info.ino,
    });
  }
  private async guard() {
    const info = await lstat(this.root);
    checkOwner(info);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      info.ino !== this.identity.ino ||
      info.dev !== this.identity.dev
    )
      throw new PublicError("The workspace changed. Restart the server.");
  }
  private async directory(name: string) {
    await this.guard();
    const directory = join(this.root, iconName.parse(name) + ".icon");
    const info = await lstat(directory);
    checkOwner(info);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new PublicError("Icon must be a real workspace directory.");
    return directory;
  }
  async list(): Promise<string[]> {
    await this.guard();
    const result: string[] = [];
    const dir = await opendir(this.root);
    let count = 0;
    for await (const entry of dir) {
      if (++count > 1000)
        throw new PublicError(
          "Workspace has too many entries; use a smaller workspace.",
        );
      if (
        entry.isDirectory() &&
        entry.name.endsWith(".icon") &&
        iconName.safeParse(entry.name.slice(0, -5)).success
      )
        result.push(entry.name.slice(0, -5));
    }
    return result.sort();
  }
  async inspect(name: string) {
    const directory = await this.directory(name);
    const bytes = await readBounded(join(directory, "source.json"), MAX_SOURCE);
    const spec = iconSpec.parse(JSON.parse(bytes.toString("utf8")));
    await verifyBundle(directory, spec);
    return { name, revision: revision(spec), spec };
  }
  private async withWrite<T>(action: () => Promise<T>): Promise<T> {
    await this.guard();
    const lock = join(this.root, ".operation-lock");
    try {
      await mkdir(lock, { mode: 0o700 });
    } catch {
      throw new PublicError(
        "Workspace is busy. If a process crashed, stop all users of this workspace before removing .operation-lock.",
      );
    }
    try {
      await capacity(this.root);
      return await action();
    } finally {
      await rmdir(lock);
    }
  }
  async create(name: string, input: unknown) {
    return this.withWrite(() => this.createBundle(name, input));
  }
  private async createBundle(name: string, input: unknown) {
    const spec = iconSpec.parse(input);
    const safeName = iconName.parse(name);
    await this.guard();
    const destination = join(this.root, safeName + ".icon");
    try {
      await mkdir(destination, { mode: 0o700 });
    } catch {
      throw new PublicError(
        "That icon name already exists or cannot be created. Choose a new name.",
      );
    }
    try {
      await writeBundle(destination, spec);
    } catch (error) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
    return {
      name: safeName,
      path: safeName + ".icon",
      revision: revision(spec),
    };
  }
  async update(
    name: string,
    outputName: string,
    expectedRevision: string,
    input: unknown,
  ) {
    const current = await this.inspect(name);
    if (current.revision !== expectedRevision)
      throw new PublicError("The icon changed. Read it again before editing.");
    return this.create(outputName, input);
  }
  async render(
    name: string,
    options: Omit<NativeRenderOptions, "platform"> & {
      opaqueBackground?: string;
    },
  ) {
    return this.withWrite(() => this.renderBundle(name, options));
  }
  private async renderBundle(
    name: string,
    options: Omit<NativeRenderOptions, "platform"> & {
      opaqueBackground?: string;
    },
  ) {
    const { spec } = await this.inspect(name);
    await this.guard();
    const temporary = await mkdtemp(join(this.root, ".render-"));
    try {
      const bundle = join(temporary, "Preview.icon");
      await mkdir(bundle, { mode: 0o700 });
      await writeBundle(bundle, spec);
      const output = join(temporary, "preview.png");
      await renderNative(bundle, output, {
        ...options,
        platform: spec.platform,
      });
      const renderedBytes = await readBounded(output, 6 * 1024 * 1024);
      const bytes = options.opaqueBackground
        ? flattenPng(renderedBytes, options.opaqueBackground)
        : renderedBytes;
      if (
        bytes.length < 24 ||
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        bytes.readUInt32BE(16) !== options.size ||
        bytes.readUInt32BE(20) !== options.size
      )
        throw new PublicError("Renderer did not produce the requested PNG.");
      await this.guard();
      const filename = `${name}-${options.rendition}-${randomUUID()}.png`;
      await writeFile(join(this.root, filename), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      return { path: filename, bytes };
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}
