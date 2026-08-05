#!/usr/bin/env node

// Cross compiles the Rust TUI and drops each binary into the matching npm
// platform package. Mirrors apps/tui/scripts/build.ts for the Bun based TUI.

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const targets = [
	{
		id: "darwin-arm64",
		rustTarget: "aarch64-apple-darwin",
		binaryName: "bizi",
		packageDirectory: "bizi-rs-darwin-arm64",
	},
	{
		id: "darwin-x64",
		rustTarget: "x86_64-apple-darwin",
		binaryName: "bizi",
		packageDirectory: "bizi-rs-darwin-x64",
	},
	{
		id: "win32-x64",
		rustTarget: "x86_64-pc-windows-msvc",
		binaryName: "bizi.exe",
		packageDirectory: "bizi-rs-win32-x64",
	},
	{
		id: "win32-arm64",
		rustTarget: "aarch64-pc-windows-msvc",
		binaryName: "bizi.exe",
		packageDirectory: "bizi-rs-win32-arm64",
	},
];

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function compile(target) {
	const build = spawnSync(
		"cargo",
		["build", "-p", "bizi-tui", "--release", "--target", target.rustTarget],
		{ cwd: repositoryRoot, stdio: "inherit" }
	);

	if (build.status !== 0) {
		throw new Error(`Compile failed for target ${target.id}`);
	}

	const sourcePath = join(
		repositoryRoot,
		"target",
		target.rustTarget,
		"release",
		target.binaryName
	);
	const outputPath = join(
		appRoot,
		"packages",
		target.packageDirectory,
		"bin",
		target.binaryName
	);

	mkdirSync(dirname(outputPath), { recursive: true });
	copyFileSync(sourcePath, outputPath);
	if (!target.binaryName.endsWith(".exe")) {
		chmodSync(outputPath, 0o755);
	}

	process.stdout.write(`Built ${target.id} -> ${outputPath}\n`);
}

const [requestedTarget] = process.argv.slice(2);

if (!requestedTarget || requestedTarget === "all") {
	for (const target of targets) {
		compile(target);
	}
	process.exit(0);
}

const target = targets.find((candidate) => candidate.id === requestedTarget);

if (!target) {
	throw new Error(`Unsupported compile target: ${requestedTarget}`);
}

compile(target);
