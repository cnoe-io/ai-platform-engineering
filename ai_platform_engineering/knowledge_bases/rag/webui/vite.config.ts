/// <reference types="node" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
	plugins: [react()],
	server: {
		port: 5173,
		strictPort: true,
		proxy: {
			'/v1': {
				target: process.env['VITE_API_BASE'] || 'http://localhost:9446',
				changeOrigin: true,
			},
			'/healthz': {
				target: process.env['VITE_API_BASE'] || 'http://localhost:9446',
				changeOrigin: true,
			},
		},
	},
}) 