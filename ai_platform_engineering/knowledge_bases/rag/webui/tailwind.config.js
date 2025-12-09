export default {
	content: ['./index.html', './src/**/*.{ts,tsx}'],
	theme: {
		extend: {
			colors: {
				brand: {
					50: '#f0fdfe',   // Very light tint of brand-600
					100: '#ccf7fc',   // Light tint
					200: '#99eff9',   // Lighter tint  
					300: '#66e7f6',   // Medium-light tint
					400: '#33dff3',   // Medium tint
					500: '#1ac8dd',   // Darker tint leading to base
					600: '#02a9bb', // Base color for fallback
					700: '#02a9bb', // Hover color
					800: '#007EA3', // Click/active color
					900: '#024b6b',
				},
			},
			backgroundImage: {
				'brand-gradient': 'linear-gradient(0deg, rgba(0, 40, 64, 1) 0%, rgba(0, 126, 163, 1) 5%, rgba(21, 212, 212, 1) 95%, rgba(6, 235, 212, 1) 100%)',
				'brand-gradient-hover': 'linear-gradient(0deg, #02a9bb 0%, #02a9bb 100%)',
				'brand-gradient-active': 'linear-gradient(0deg, #007EA3 0%, #007EA3 100%)',
			},
		},
	},
	plugins: [],
} 