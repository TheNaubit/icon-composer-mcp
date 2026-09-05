import { execFile } from "node:child_process";
import process from "node:process";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { nativeStatus, renderNative, renditions } from "../src/native.js";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));

const mockedExecFile = vi.mocked(execFile);

function succeed(command: string, args: readonly string[], stdout = "ok") {
  mockedExecFile.mockImplementationOnce(
    (file, receivedArgs, _options, callback) => {
      expect(file).toBe(command);
      expect(receivedArgs).toEqual(args);
      callback?.(null, stdout, "");
      return undefined as never;
    },
  );
}

describe("native icon rendering", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    delete process.env.ICON_COMPOSER_APP;
  });

  it("exposes the supported Icon Composer renditions", () => {
    expect(renditions).toEqual([
      "Default",
      "Dark",
      "TintedLight",
      "TintedDark",
      "ClearLight",
      "ClearDark",
    ]);
  });

  it("verifies Apple signing before rendering a square iOS rendition", async () => {
    const executable =
      "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool";
    succeed("/usr/bin/codesign", [
      "--verify",
      "--strict",
      "--deep",
      "--requirements",
      'anchor apple and identifier "com.apple.IconComposerTool"',
      executable,
    ]);
    succeed(executable, [
      "/tmp/icon.icon",
      "--export-image",
      "--output-file",
      "/tmp/output.png",
      "--platform",
      "iOS",
      "--rendition",
      "Default",
      "--width",
      "512",
      "--height",
      "512",
      "--scale",
      "1",
    ]);

    await renderNative("/tmp/icon.icon", "/tmp/output.png", {
      rendition: "Default",
      size: 512,
      platform: "iOS",
    });

    expect(mockedExecFile).toHaveBeenCalledTimes(2);
    expect(mockedExecFile).toHaveBeenNthCalledWith(
      1,
      "/usr/bin/codesign",
      expect.any(Array),
      expect.objectContaining({
        env: { LANG: "C", PATH: "/usr/bin:/bin" },
        maxBuffer: 64 * 1024,
        timeout: 15_000,
      }),
      expect.any(Function),
    );
  });

  it("passes optional tint controls and accepts the configured app bundle only", async () => {
    process.env.ICON_COMPOSER_APP = "/Applications/Icon Composer.app";
    const executable =
      "/Applications/Icon Composer.app/Contents/Executables/ictool";
    succeed("/usr/bin/codesign", [
      "--verify",
      "--strict",
      "--deep",
      "--requirements",
      'anchor apple and identifier "com.apple.IconComposerTool"',
      executable,
    ]);
    succeed(executable, [
      "/tmp/icon.icon",
      "--export-image",
      "--output-file",
      "/tmp/output.png",
      "--platform",
      "macOS",
      "--rendition",
      "TintedDark",
      "--width",
      "1024",
      "--height",
      "1024",
      "--scale",
      "1",
      "--tint-color",
      "0.25",
      "--tint-strength",
      "0.75",
    ]);

    await renderNative("/tmp/icon.icon", "/tmp/output.png", {
      rendition: "TintedDark",
      size: 1024,
      platform: "macOS",
      tintColor: 0.25,
      tintStrength: 0.75,
    });
  });

  it("rejects invalid runtime options without launching a process", async () => {
    await expect(
      renderNative("/tmp/icon.icon", "/tmp/output.png", {
        rendition: "Unknown" as "Default",
        size: 15,
        platform: "iOS",
      }),
    ).rejects.toThrow("Invalid native rendering options.");

    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it("rejects a missing options object without launching a process", async () => {
    await expect(
      renderNative("/tmp/icon.icon", "/tmp/output.png", undefined as never),
    ).rejects.toThrow("Invalid native rendering options.");

    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it("does not use a malformed app bundle override", async () => {
    process.env.ICON_COMPOSER_APP = "relative.app";

    await expect(nativeStatus()).resolves.toEqual({ available: false });
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it("returns unavailable on non-macOS hosts", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    await expect(nativeStatus()).resolves.toEqual({ available: false });
  });

  it("returns the verified numeric short version and conceals native failures", async () => {
    const executable =
      "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool";
    succeed("/usr/bin/codesign", [
      "--verify",
      "--strict",
      "--deep",
      "--requirements",
      'anchor apple and identifier "com.apple.IconComposerTool"',
      executable,
    ]);
    succeed(
      executable,
      ["--version"],
      '{"bundle-version":"99.1","short-bundle-version":"1.6"}',
    );

    await expect(nativeStatus()).resolves.toEqual({
      available: true,
      version: "1.6",
    });

    mockedExecFile.mockImplementationOnce(
      (_file, _args, _options, callback) => {
        callback?.(
          new Error("/private/secret: failed"),
          "",
          "sensitive detail",
        );
        return undefined as never;
      },
    );

    await expect(
      renderNative("/tmp/icon.icon", "/tmp/output.png", {
        rendition: "Default",
        size: 16,
        platform: "iOS",
      }),
    ).rejects.toThrow("Native rendering is unavailable.");
  });

  it("does not expose an unrecognised version payload", async () => {
    const executable =
      "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool";
    succeed("/usr/bin/codesign", [
      "--verify",
      "--strict",
      "--deep",
      "--requirements",
      'anchor apple and identifier "com.apple.IconComposerTool"',
      executable,
    ]);
    succeed(
      executable,
      ["--version"],
      '{"short-bundle-version":"1.6 /private/secret"}',
    );

    await expect(nativeStatus()).resolves.toEqual({ available: true });
  });
});
