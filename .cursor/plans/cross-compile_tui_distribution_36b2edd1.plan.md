---
name: Cross-compile TUI distribution
overview: Set up `apps/tui` to cross-compile native binaries for macOS/Windows targets via Bun only in release workflows (after release creation), and publish them through per-platform optional dependency packages so users can install with any JS package manager and run a `bizi` executable.
todos:
  - id: design-package-layout
    content: Define main package + 4 per-platform package names/paths and binary locations
    status: completed
  - id: implement-cross-compile
    content: Add Bun compile automation for darwin-arm64, darwin-x64, win32-x64, win32-arm64 outputs
    status: completed
  - id: wire-optional-deps-launcher
    content: Configure main package optionalDependencies and launcher bin resolution/spawn logic
    status: completed
  - id: setup-publish-and-validation
    content: Document publish order and add local/CI smoke checks for install and execution
    status: completed
isProject: false
---

# Cross-Compile and Publish TUI Executable

## Current State

- `apps/tui` has a source entrypoint and a Bun build helper in `[/Users/ieedan/Documents/github/bizi/apps/tui/scripts/build.ts](/Users/ieedan/Documents/github/bizi/apps/tui/scripts/build.ts)`, but no compile targets/publish layout.
- The package in `[/Users/ieedan/Documents/github/bizi/apps/tui/package.json](/Users/ieedan/Documents/github/bizi/apps/tui/package.json)` is not yet structured as a cross-platform launcher package.

Essential snippet being extended:

```1:10:/Users/ieedan/Documents/github/bizi/apps/tui/scripts/build.ts
import solidPlugin from "../../../node_modules/@opentui/solid/scripts/solid-plugin";

// biome-ignore lint/correctness/noUndeclaredVariables: it's fine man
await Bun.build({
	entrypoints: ["./src/index.tsx"],
	target: "bun",
	outdir: "./dist",
	plugins: [solidPlugin],
});
```

## Target Package Topology (per-platform optional dependencies)

- Keep a top-level CLI package (`bizi`) that users install (`npm i -g bizi`, `pnpm dlx bizi`, etc.).
- Add 4 platform packages in workspace (publishable):
  - `@getbizi/bizi-darwin-arm64`
  - `@getbizi/bizi-darwin-x64`
  - `@getbizi/bizi-win32-x64`
  - `@getbizi/bizi-win32-arm64`
- Each platform package contains one compiled binary + `package.json` with `os`/`cpu` constraints and a `files` allowlist.
- Main `bizi` package uses `optionalDependencies` on those 4 packages and exposes a small JS launcher in `bin` that resolves installed platform package and executes its binary.

## Implementation Steps

1. **Restructure packaging metadata**
  - Update `[/Users/ieedan/Documents/github/bizi/apps/tui/package.json](/Users/ieedan/Documents/github/bizi/apps/tui/package.json)` to:
    - add `bin` entry pointing to launcher script,
    - add `optionalDependencies` for all platform packages,
    - add scripts split by intent (`build:bundle` for dev build only, `compile:*` for explicit/manual or CI-only use),
    - avoid compile commands in lifecycle hooks so installs never trigger compilation,
    - ensure only publish-safe files are included.
2. **Add cross-compile script**
  - Replace/extend `[/Users/ieedan/Documents/github/bizi/apps/tui/scripts/build.ts](/Users/ieedan/Documents/github/bizi/apps/tui/scripts/build.ts)` with a script that:
    - first performs plugin-aware bundle step,
    - then runs Bun compile for each target (`darwin-arm64`, `darwin-x64`, `windows-x64`, `windows-arm64`),
    - writes outputs into deterministic per-platform package folders,
    - names binaries correctly (`bizi` for macOS, `bizi.exe` for Windows).
3. **Create platform package directories**
  - Add workspace package folders (e.g. `packages/bizi-darwin-arm64`, etc.) with minimal `package.json` + `README` + `bin/` output location.
  - Set `os`/`cpu` in each package so npm-family installers auto-select compatibility.
4. **Add runtime launcher in main CLI package**
  - Add a small `bin` JS script in `apps/tui` that:
    - detects `process.platform` + `process.arch`,
    - maps to expected optional package,
    - resolves packaged binary path and `spawn`s it with stdio passthrough,
    - exits with a clear error if optional dependency is missing.
5. **Wire workspace + release flow**
  - Ensure root workspace at `[/Users/ieedan/Documents/github/bizi/package.json](/Users/ieedan/Documents/github/bizi/package.json)` picks up new packages (already covered by `packages/*`; verify naming/layout).
  - Update release workflow in `[/Users/ieedan/Documents/github/task-runner/.github/workflows/release.yml](/Users/ieedan/Documents/github/task-runner/.github/workflows/release.yml)` so compile runs only on release trigger.
  - Define publish order in release CI: compile binaries, publish platform packages first, then publish main `bizi` package.
6. **Validation matrix**
  - Local checks:
    - verify no compile step runs in normal local scripts or install lifecycle,
    - run package-manager install simulations (npm/pnpm/yarn) to verify optional deps resolution,
    - smoke-test launcher invocation with args passthrough.

## Delivery Outcome

- Users install one package (`bizi`) via any package manager.
- Installer fetches only compatible optional platform package.
- Running `bizi` executes native compiled binary for that OS/arch with no Bun runtime requirement.

## Notes / Risks to Handle During Implementation

- Bun target strings and cross-compilation support should be pinned to a tested Bun version in CI to avoid target drift.
- Optional dependencies can be skipped by some strict install flags (`--no-optional`), so launcher error messaging must be explicit.

