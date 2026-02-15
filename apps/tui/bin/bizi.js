#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const targetKey = `${process.platform}:${process.arch}`;

const targetByPlatform = {
	"darwin:arm64": {
		packageName: "@getbizi/bizi-darwin-arm64",
		binaryPath: "bin/bizi",
	},
	"darwin:x64": {
		packageName: "@getbizi/bizi-darwin-x64",
		binaryPath: "bin/bizi",
	},
	"win32:x64": {
		packageName: "@getbizi/bizi-win32-x64",
		binaryPath: "bin/bizi.exe",
	},
	"win32:arm64": {
		packageName: "@getbizi/bizi-win32-arm64",
		binaryPath: "bin/bizi.exe",
	},
};

const platformTarget = targetByPlatform[targetKey];

if (!platformTarget) {
	process.stderr.write(
		`bizi does not support ${process.platform}/${process.arch}.\n`
	);
	process.exit(1);
}

const require = createRequire(import.meta.url);

let binaryPath;

try {
	const packageJsonPath = require.resolve(
		`${platformTarget.packageName}/package.json`
	);
	binaryPath = join(dirname(packageJsonPath), platformTarget.binaryPath);
} catch {
	process.stderr.write(
		`Missing optional dependency ${platformTarget.packageName}. Reinstall without --no-optional.\n`
	);
	process.exit(1);
}

if (process.platform !== "win32") {
	try {
		accessSync(binaryPath, constants.X_OK);
	} catch {
		process.stderr.write(`bizi binary is not executable: ${binaryPath}\n`);
		process.exit(1);
	}
}

const result = spawnSync(binaryPath, process.argv.slice(2), {
	stdio: "inherit",
});

if (result.error) {
	process.stderr.write(
		`Failed to start bizi binary: ${result.error.message}\n`
	);
	process.exit(1);
}

if (result.signal) {
	process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
