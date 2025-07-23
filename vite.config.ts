import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [
		svelte({
			preprocess: [sveltePreprocess({ postcss: true })],
		}),
	],
	build: {
		// Set up for building a library
		lib: {
			// The entry point for the library is main.ts
			entry: path.resolve(__dirname, 'main.ts'),
			// The name of the global variable when used in a browser
			name: 'obsidian-clockify-reports',
			// The output filename for the bundle
			fileName: () => 'main.js',
			// We want to output a single 'es' module
			formats: ['es'],
		},
		rollupOptions: {
			// Make sure to externalize dependencies that shouldn't be bundled
			// into your library. Obsidian and moment are provided by Obsidian itself.
			external: ['obsidian', 'moment'],
		},
		// Don't clear the output directory before building
		emptyOutDir: false,
		// Output the files directly to the root directory
		outDir: '.',
	},
});
