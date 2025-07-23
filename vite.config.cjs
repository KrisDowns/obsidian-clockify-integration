const path = require('path');
const { defineConfig } = require('vite');
const svelte = require('@sveltejs/vite-plugin-svelte');
const sveltePreprocess = require('svelte-preprocess');

// This is the CommonJS version of the Vite configuration, required when "type": "module" is set in package.json
module.exports = defineConfig({
	plugins: [
		svelte.default({
			preprocess: [sveltePreprocess.default({ postcss: true })],
		}),
	],
	build: {
		lib: {
			entry: path.resolve(__dirname, 'main.ts'),
			name: 'obsidian-clockify-reports',
			fileName: () => 'main.js',
			formats: ['es'],
		},
		rollupOptions: {
			external: ['obsidian', 'moment'],
		},
		emptyOutDir: false,
		outDir: '.',
	},
});
