# Contributing

Thanks for helping improve Icon Composer Kit. Contributions should make local, editable icon composition clearer, safer, or more reliable.

## Before you start

Read [`README.md`](README.md) for the supported MCP surface and schema. Keep proposals within the project’s scope: composing static SVG or PNG artwork into editable Apple Icon Composer documents and producing native previews on macOS.

## Development workflow

```sh
npm ci
npm run format:check
npm run typecheck
npm run coverage
npm run build
```

Use a dedicated temporary `ICON_WORKSPACE` for manual checks. The native gallery command requires macOS and Apple Icon Composer:

```sh
npm run examples
```

That command regenerates the three example bundles and their six appearance previews plus 32 px previews. Review generated changes carefully before committing them.

## Pull requests

Explain the user-visible behavior, the validation performed, and any platform limitation. Include focused tests for changes to schemas, file boundaries, revisions, error handling, or renderer invocation. Update the README when the public contract changes.

Do not include secrets, personal paths, private project references, network credentials, or generated temporary files. Keep commits small and use conventional prefixes such as `feat:`, `fix:`, `docs:`, `test:`, or `chore:`.

## Security

Please do not publish sensitive details in an issue. Follow the reporting instructions in [`SECURITY.md`](SECURITY.md).
