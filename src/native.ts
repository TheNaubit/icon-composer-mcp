import { execFile } from "node:child_process";
import process from "node:process";

const DEFAULT_ICTOOL =
  "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool";
const CODESIGN = "/usr/bin/codesign";
const APP_OVERRIDE = "ICON_COMPOSER_APP";
const PROCESS_TIMEOUT_MS = 15_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const SAFE_ENV = { LANG: "C", PATH: "/usr/bin:/bin" };
const ICTOOL_IDENTIFIER = "com.apple.IconComposerTool";
const VERSION_PATTERN = /^\d+(?:\.\d+){0,3}$/;

export const renditions = [
  "Default",
  "Dark",
  "TintedLight",
  "TintedDark",
  "ClearLight",
  "ClearDark",
] as const;

type Rendition = (typeof renditions)[number];
type Platform = "iOS" | "macOS";

export interface NativeRenderOptions {
  rendition: Rendition;
  size: number;
  platform: Platform;
  tintColor?: number;
  tintStrength?: number;
}

interface ProcessResult {
  stdout: string;
}

function appOverride(): string | null | undefined {
  const bundle = process.env[APP_OVERRIDE];

  if (bundle === undefined) {
    return undefined;
  }

  if (!bundle.startsWith("/") || !bundle.endsWith(".app")) {
    return null;
  }

  return `${bundle}/Contents/Executables/ictool`;
}

function executablePath(): string | undefined {
  const override = appOverride();

  if (override === null) {
    return undefined;
  }

  return override ?? DEFAULT_ICTOOL;
}

function validOptions(options: NativeRenderOptions): boolean {
  if (typeof options !== "object" || options === null) {
    return false;
  }

  return (
    renditions.includes(options.rendition) &&
    (options.platform === "iOS" || options.platform === "macOS") &&
    Number.isInteger(options.size) &&
    options.size >= 16 &&
    options.size <= 1024 &&
    validTintValue(options.tintColor) &&
    validTintValue(options.tintStrength)
  );
}

function validTintValue(value: number | undefined): boolean {
  return (
    value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1)
  );
}

function shortVersion(stdout: string): string | undefined {
  try {
    const value: unknown = JSON.parse(stdout);
    if (typeof value !== "object" || value === null) {
      return undefined;
    }

    const version = (value as { [key: string]: unknown })[
      "short-bundle-version"
    ];
    return typeof version === "string" && VERSION_PATTERN.test(version)
      ? version
      : undefined;
  } catch {
    return undefined;
  }
}

function run(file: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: "utf8",
        env: SAFE_ENV,
        maxBuffer: MAX_OUTPUT_BYTES,
        timeout: PROCESS_TIMEOUT_MS,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }

        resolve({ stdout });
      },
    );
  });
}

async function verifiedExecutable(): Promise<string | undefined> {
  if (process.platform !== "darwin") {
    return undefined;
  }

  const executable = executablePath();
  if (executable === undefined) {
    return undefined;
  }

  try {
    await run(CODESIGN, [
      "--verify",
      "--strict",
      "--deep",
      "--requirements",
      `anchor apple and identifier "${ICTOOL_IDENTIFIER}"`,
      executable,
    ]);
    return executable;
  } catch {
    return undefined;
  }
}

export async function nativeStatus(): Promise<{
  available: boolean;
  version?: string;
}> {
  const executable = await verifiedExecutable();
  if (executable === undefined) {
    return { available: false };
  }

  try {
    const { stdout } = await run(executable, ["--version"]);
    const version = shortVersion(stdout);
    return version === undefined
      ? { available: true }
      : { available: true, version };
  } catch {
    return { available: false };
  }
}

export async function renderNative(
  inputDirectory: string,
  outputFile: string,
  options: NativeRenderOptions,
): Promise<void> {
  if (!validOptions(options)) {
    throw new Error("Invalid native rendering options.");
  }

  const executable = await verifiedExecutable();
  if (executable === undefined) {
    throw new Error("Native rendering is unavailable.");
  }

  const args = [
    inputDirectory,
    "--export-image",
    "--output-file",
    outputFile,
    "--platform",
    options.platform,
    "--rendition",
    options.rendition,
    "--width",
    String(options.size),
    "--height",
    String(options.size),
    "--scale",
    "1",
  ];

  if (options.tintColor !== undefined) {
    args.push("--tint-color", String(options.tintColor));
  }
  if (options.tintStrength !== undefined) {
    args.push("--tint-strength", String(options.tintStrength));
  }

  try {
    await run(executable, args);
  } catch {
    throw new Error("Native rendering is unavailable.");
  }
}
