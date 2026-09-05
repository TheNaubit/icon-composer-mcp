# Security

## Threat model

This is a local stdio server for a trusted operator and potentially untrusted tool arguments and artwork. Each process receives an explicit `ICON_WORKSPACE`. There is no HTTP listener, authentication service, telemetry, asset downloader, or remote rendering API.

Tool requests can read managed icon specifications and create documents or previews in that workspace. Treat the configured directory as a capability: use a dedicated directory, never a home directory, application repository, or shared folder containing private material. An MCP host may send returned artwork to its own model provider; the host's privacy settings and tool approvals still apply.

The server is not an operating-system sandbox. A compromised user account, privileged process, malicious filesystem, permissive ACL, or modified Node installation is outside its security boundary. Use ordinary local filesystems on macOS or Linux, and keep the workspace and its parents under trusted control.

## Enforced boundaries

- Tool calls accept bounded logical names, never arbitrary paths. The root must belong to the current account and must not be writable by its group or other users. Managed directories and files receive the same ownership/mode checks.
- Symlink bundles and asset directories are rejected. File reads use `O_NOFOLLOW`, reject hard links and non-regular files, and enforce byte limits. Native rendering reconstructs a private temporary bundle from validated source.
- A managed bundle must contain exactly `icon.json`, `source.json`, and `Assets`, with exactly the expected artwork. Native GUI edits and unexpected files stop subsequent reads/renders/updates; they are not silently overwritten.
- New names are created exclusively. Updates check the expected revision and create a new document. A workspace lock excludes concurrent writers across processes. The server never deletes a user's existing icon or preview.
- The workspace is limited to 100 top-level entries before new writes. Each document's normalized source is limited to 2 MiB, each SVG to 256 KiB, each PNG input to 1 MiB and 1024 pixels per side, and each native preview to 6 MiB. Temporary output and the operation lock are cleaned up after handled failures. Disk usage still grows within these limits; archive finished work outside the active workspace.
- SVG uses an XML parser and an allowlist of static geometry, gradients, clipping and masking. External references, scripts, event handlers, styles, entity declarations and processing instructions are rejected. Element count and nesting are bounded.
- PNG framing, CRCs, dimensions, IHDR fields and animation/interlace restrictions are checked before decoding. The decoder's unbounded interlaced path is never entered. Imported PNGs are re-encoded from pixels, without source metadata.
- Apple `ictool` must satisfy `anchor apple and identifier "com.apple.IconComposerTool"`. It runs with fixed arguments, no shell, a minimal environment, a 15-second process timeout and bounded diagnostic output. The operator-controlled `ICON_COMPOSER_APP` override must remain in a trusted application bundle; it is never supplied by a tool call. Signature verification and execution are separate OS operations, so same-account tampering between them is outside the boundary.
- Valid tool operations are limited to 120 per minute per process, and only one operation runs at a time. Incoming MCP buffers are capped at 3 MiB. Protocol parsing and schema validation happen before the tool-operation limiter; the host controls the lifetime of its child process.
- MCP errors conceal filesystem paths, stacks and native stderr. Labels and SVG text returned by `read_icon` remain untrusted document content, not instructions.

Apple's renderer, OS signing services, the Node runtime and the installed dependencies remain trusted components. Runtime application code makes no network requests; operating-system trust services may perform their own checks. Installation and advisory checks use npm's registry.

## Dependencies and release checks

Direct dependencies are pinned, and the lockfile records registry URLs and integrity hashes. CI runs format, type, test and coverage checks. Dependency update proposals are automated. Run `npm audit` before a release; a clean advisory check is not a guarantee that all vulnerabilities are known.

Keep `node_modules`, temporary workspaces, coverage reports and environment files out of releases. Coverage reports contain local source paths. Inspect the package with `npm pack --dry-run` and review sample image metadata before publishing.

## Reporting a vulnerability

A private vulnerability-reporting endpoint is not currently configured. Do not include credentials, private artwork, or exploit details in a public issue. Ask the maintainer of the distribution you received for a private reporting channel before sending sensitive details.

When publishing a GitHub repository, the maintainer should enable **Security → Advisories → Private vulnerability reporting** and replace this paragraph with its verified reporting link. Do not invent a contact address or assume reporting is enabled.

Include the affected version, operating system, minimal synthetic reproduction, expected versus actual behavior, and impact. Test only inside a disposable workspace. The current supported line is 1.x; no response-time guarantee is offered.
