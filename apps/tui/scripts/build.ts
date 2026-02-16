import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solidPlugin from "../../../node_modules/@opentui/solid/scripts/solid-plugin";

interface TargetConfig {
	id: string;
	bunTarget: string;
	openTuiCorePackage: string;
	outputPath: string;
}

const targetConfigs: TargetConfig[] = [
	{
		id: "darwin-arm64",
		bunTarget: "bun-darwin-arm64",
		openTuiCorePackage: "@opentui/core-darwin-arm64",
		outputPath: "../packages/bizi-darwin-arm64/bin/bizi",
	},
	{
		id: "darwin-x64",
		bunTarget: "bun-darwin-x64",
		openTuiCorePackage: "@opentui/core-darwin-x64",
		outputPath: "../packages/bizi-darwin-x64/bin/bizi",
	},
	{
		id: "windows-x64",
		bunTarget: "bun-windows-x64",
		openTuiCorePackage: "@opentui/core-win32-x64",
		outputPath: "../packages/bizi-win32-x64/bin/bizi.exe",
	},
	{
		id: "windows-arm64",
		// Bun does not currently support compiling a native Windows arm64 executable.
		// We compile an x64 binary so arm64 users can run it via Windows x64 emulation.
		bunTarget: "bun-windows-x64",
		openTuiCorePackage: "@opentui/core-win32-x64",
		outputPath: "../packages/bizi-win32-arm64/bin/bizi.exe",
	},
];

const appRoot = fileURLToPath(new URL("../", import.meta.url));
const nodeModulesRoot = fileURLToPath(
	new URL("../../../node_modules/", import.meta.url)
);

async function pathExists(path: string) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function ensureOpenTuiCorePackage(packageName: string) {
	const packageJsonPath = join(nodeModulesRoot, packageName, "package.json");
	if (await pathExists(packageJsonPath)) {
		return;
	}

	const corePackageJsonPath = join(
		nodeModulesRoot,
		"@opentui",
		"core",
		"package.json"
	);
	const corePackage = JSON.parse(
		await readFile(corePackageJsonPath, "utf8")
	) as {
		version: string;
	};

	const temporaryDirectory = await mkdtemp(join(tmpdir(), "bizi-opentui-"));
	const packageSpec = `${packageName}@${corePackage.version}`;

	try {
		// biome-ignore lint/correctness/noUndeclaredVariables: Bun runtime
		const pack = Bun.spawnSync(["npm", "pack", packageSpec, "--silent"], {
			cwd: temporaryDirectory,
			stdout: "pipe",
			stderr: "inherit",
		});

		if (pack.exitCode !== 0) {
			throw new Error(`Failed to download ${packageSpec}`);
		}

		const tarballName = new TextDecoder()
			.decode(pack.stdout)
			.trim()
			.split("\n")
			.pop();

		if (!tarballName) {
			throw new Error(
				`Could not resolve packed tarball for ${packageSpec}`
			);
		}

		// biome-ignore lint/correctness/noUndeclaredVariables: Bun runtime
		const unpack = Bun.spawnSync(
			[
				"tar",
				"-xzf",
				join(temporaryDirectory, tarballName),
				"-C",
				temporaryDirectory,
			],
			{
				cwd: temporaryDirectory,
				stdout: "inherit",
				stderr: "inherit",
			}
		);

		if (unpack.exitCode !== 0) {
			throw new Error(`Failed to unpack ${packageSpec}`);
		}

		await mkdir(dirname(packageJsonPath), { recursive: true });
		await rm(join(nodeModulesRoot, packageName), {
			recursive: true,
			force: true,
		});
		await cp(
			join(temporaryDirectory, "package"),
			join(nodeModulesRoot, packageName),
			{
				recursive: true,
			}
		);
	} finally {
		await rm(temporaryDirectory, { recursive: true, force: true });
	}
}

async function bundleForRuntime() {
	// biome-ignore lint/correctness/noUndeclaredVariables: Bun runtime
	const result = await Bun.build({
		entrypoints: ["./src/index.tsx"],
		target: "bun",
		outdir: "./dist",
		plugins: [solidPlugin],
		minify: true,
	});

	if (!result.success) {
		throw new Error("Bundle step failed.");
	}
}

async function compileTarget(targetId: string) {
	const target = targetConfigs.find((item) => item.id === targetId);
	if (!target) {
		throw new Error(`Unsupported compile target: ${targetId}`);
	}
	await ensureOpenTuiCorePackage(target.openTuiCorePackage);

	const outputFile = new URL(target.outputPath, import.meta.url);
	const outputPath = fileURLToPath(outputFile);
	const bundlePath = fileURLToPath(
		new URL("../dist/index.js", import.meta.url)
	);
	await mkdir(dirname(outputPath), { recursive: true });
	// biome-ignore lint/correctness/noUndeclaredVariables: Bun runtime
	const compile = Bun.spawnSync(
		[
			"bun",
			"build",
			bundlePath,
			"--compile",
			"--target",
			target.bunTarget,
			"--outfile",
			outputPath,
		],
		{
			cwd: appRoot,
			stdout: "inherit",
			stderr: "inherit",
		}
	);

	if (compile.exitCode !== 0) {
		throw new Error(`Compile failed for target ${targetId}`);
	}
}

async function compileAll() {
	for (const target of targetConfigs) {
		await compileTarget(target.id);
	}
}

const [command, maybeTarget] = process.argv.slice(2);

if (!command || command === "bundle") {
	await bundleForRuntime();
	process.exit(0);
}

if (command === "compile") {
	if (!maybeTarget) {
		throw new Error(
			"Missing target. Example: bun run scripts/build.ts compile darwin-arm64"
		);
	}
	await bundleForRuntime();
	await compileTarget(maybeTarget);
	process.exit(0);
}

if (command === "compile-all") {
	await bundleForRuntime();
	await compileAll();
	process.exit(0);
}

throw new Error(`Unknown command: ${command}`);
