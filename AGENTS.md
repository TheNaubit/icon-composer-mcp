# Contributing guidance

This directory contains a local MCP server for editable Apple Icon Composer documents.

## Scope

Keep changes focused on icon composition: static SVG or PNG layers, editable groups, materials, fills, appearances, revisions, and native previews. Do not add image generation, raster vectorization, network downloads, hosted services, or unrelated product integrations.

## Repository map

- `src/model.ts` defines and validates the managed icon specification and maps it to native document JSON.
- `src/svg.ts` and `src/png.ts` enforce static artwork boundaries.
- `src/store.ts` owns the dedicated workspace, copy-on-write revisions, bundle files, and rendered PNG outputs.
- `src/mcp.ts` registers the six tools and the `compose-icon` prompt.
- `src/native.ts` verifies and invokes Apple’s signed `ictool`.
- `examples/*.json` are complete MCP create requests.
- `scripts/generate-examples.mjs` produces the checked-in native gallery on macOS.

## Development

Use Node.js 24 or newer and the checked-in lockfile. Run `npm ci` before local work. Before submitting changes, run:

```sh
npm run format:check
npm run typecheck
npm run coverage
npm run build
```

Run `npm run examples` on macOS when changing native document mapping or example recipes. It invokes Apple Icon Composer and refreshes the editable example bundles and preview images.

## Change rules

- Use extensionless `@/` imports for source modules. Keep the TypeScript and test aliases aligned. `npm run build` type-checks and bundles the two CLI entry points with esbuild.
- Preserve strict input validation and generic public errors.
- Never accept a filesystem path from a tool call.
- Keep `source.json` as the managed specification authority.
- Preserve immutable updates: revisions require an expected hash and a new output name.
- Do not commit credentials, private paths, generated temporary workspaces, or unrelated files.
- Update the README when a public tool, schema, command, or verified limitation changes.
