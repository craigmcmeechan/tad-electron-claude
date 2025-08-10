const esbuild = require("esbuild");

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
		]
	});

	// Webview build context
	const webviewCtx = await esbuild.context({
		entryPoints: ['src/webview/index.tsx'],
		bundle: true,
		format: 'esm',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'browser',
		outfile: 'dist/webview.js',
		logLevel: 'silent',
		plugins: [esbuildProblemMatcherPlugin],
		loader: {
		  '.css': 'text',
		  '.png': 'file',
		  '.jpg': 'file',
		  '.svg': 'file',
		},
		define: {
		  'process.env.NODE_ENV': production ? '"production"' : '"development"',
		},
		jsx: 'automatic', // This enables JSX support
	});

	if (watch) {
		await Promise.all([
			ctx.watch(),
			webviewCtx.watch()
		]);
		console.log('Watching for changes...');
	} else {
		await Promise.all([
			ctx.rebuild(),
			webviewCtx.rebuild()
		]);
		await ctx.dispose();
        await webviewCtx.dispose();

        // Copy assets to dist folder
        const fs = require('fs');
        const path = require('path');
        const assetsSrcPath = path.join(__dirname, 'src', 'assets');
        const assetsDestPath = path.join(__dirname, 'dist', 'src', 'assets');
		
        if (fs.existsSync(assetsSrcPath)) {
            // Node 20+: use built-in recursive copy
            fs.cpSync(assetsSrcPath, assetsDestPath, { recursive: true });
            console.log('Assets copied to dist/src/assets/');
        } else {
			console.log('Assets directory not found at:', assetsSrcPath);
		}

        // If a workspace-level builder exists under .tad/builder,
        // copy its key files into src/assets/builder so that packaging bundles it.
        try {
            const workspaceBuilderDir = path.join(__dirname, '.tad', 'builder');
            const srcAssetsBuilderDir = path.join(__dirname, 'src', 'assets', 'builder');
            const wsBuildJs = path.join(workspaceBuilderDir, 'build.js');
            const wsPkgJson = path.join(workspaceBuilderDir, 'package.json');

            if (fs.existsSync(workspaceBuilderDir) && (fs.existsSync(wsBuildJs) || fs.existsSync(wsPkgJson))) {
                fs.mkdirSync(srcAssetsBuilderDir, { recursive: true });
                if (fs.existsSync(wsBuildJs)) {
                    fs.cpSync(wsBuildJs, path.join(srcAssetsBuilderDir, 'build.js'));
                    console.log('Synced builder: .tad/builder/build.js -> src/assets/builder/build.js');
                }
                if (fs.existsSync(wsPkgJson)) {
                    fs.cpSync(wsPkgJson, path.join(srcAssetsBuilderDir, 'package.json'));
                    console.log('Synced builder: .tad/builder/package.json -> src/assets/builder/package.json');
                }
            }
        } catch (e) {
            console.warn('Warning: failed to sync workspace builder into src/assets/builder:', e && e.message ? e.message : e);
        }
		
        console.log('Build complete!');
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
