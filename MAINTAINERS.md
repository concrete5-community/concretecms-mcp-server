# Maintainers guide

## Publishing a new release

Releases are automated. The [`Release` workflow](.github/workflows/release.yml)
runs on GitHub Actions whenever a version-like tag is pushed to the upstream
repository, builds the `.mcpb` extension, and creates a GitHub release with that
file attached. You do not build or upload anything by hand.

### 1. Make sure `main` is ready

The release is cut from whatever the tag points at, so get `main` green first.
The [`Build` workflow](.github/workflows/build.yml) runs on every push to `main`
and every pull request, on Node 22, 24 and 26, and must pass:

- `npm run lint:check`
- `npm run build`
- `npm run verify:oauth`
- `npm run verify:security`
- `npm audit --audit-level=moderate`
- `npx mcpb validate manifest.json` and `npx mcpb pack`

### 2. Choose the version

The project follows [semantic versioning](https://semver.org/). The version is
taken from the tag name; it is **not** stored in the repository. Do not edit the
`version` field in `package.json` (it stays `0.0.0`) or in `manifest.json`: the
workflow writes the real version into `manifest.json` at build time, and that
change is never committed.

### 3. Create and push the tag

Tag the commit on `main` that you want to release, then push the tag to the
upstream remote (that is where the workflow runs):

```bash
git tag -a 1.2.3 -m "1.2.3"
git push upstream 1.2.3
```

Accepted tag formats: `1.2.3`, `v1.2.3` or `v.1.2.3`. A tag whose version part is
only digits and separators (for example `1.2.3`) is published as a stable
release; a version part that contains letters (for example `1.2.3-beta.1`) is
flagged as a prerelease. Anything that is not version-like is ignored.

### 4. What the workflow does

1. Extracts the version from the tag and decides stable vs. prerelease.
2. `npm ci` and installs `@anthropic-ai/mcpb`.
3. Writes the version into `manifest.json` (in the runner only).
4. `npm run pack`, which produces `concretecms-mcp-server.mcpb`.
5. Creates the GitHub release as a draft, attaches the `.mcpb` file, then
   publishes it with auto-generated release notes.

The release then shows up on the
[Releases page](https://github.com/concrete5-community/concretecms-mcp-server/releases),
where users download the `.mcpb` extension.

## About `npm run build`

`npm run build` just runs `tsc`, compiling `src/` into `dist/`. You do **not**
need to run it as part of publishing: `npm run pack` builds before it packs, so
the package always contains a fresh build.

Run `npm run build` yourself only during development, to compile and type-check
after changing the sources. It also runs automatically before `npm start`
(`prestart` hook) and before `npm publish` (`prepublishOnly` hook).

To build the extension locally for testing, run `npm run pack`. It runs
`scripts/pack.mjs`, which first compiles a fresh `dist/`, then assembles a clean
staging directory (`manifest.json`, `package.json`, `dist/` without the compiled
tests, `openapi.yml`, `LICENSE`, and production-only `node_modules`) and packs
that. Only the runtime files end up in `concretecms-mcp-server.mcpb`.

The script uses the `mcpb` CLI from the `@anthropic-ai/mcpb` package, which is
not a project dependency: it must be installed and on the `PATH`, otherwise the
script stops with instructions. The release workflow installs it globally;
install it the same way locally:

```bash
npm install -g @anthropic-ai/mcpb
```
