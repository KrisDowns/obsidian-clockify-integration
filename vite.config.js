import { defineConfig } from 'vite';
import svelte from '@sveltejs/vite-plugin-svelte';
import sveltePreprocess from 'svelte-preprocess';
import path from 'path';

// This is the JavaScript version of the Vite configuration.
// It often resolves deep module-related errors.
export default defineConfig({
	plugins: [
		svelte({
			preprocess: [sveltePreprocess({ postcss: true })],
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
