// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	site: 'https://docs.elevenidllc.com',
	trailingSlash: 'always',
	integrations: [
		starlight({
			title: 'ElevenID Docs',
			logo: {
				src: './src/assets/logo.svg',
				replacesTitle: false,
			},
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/ElevenID' }],
			editLink: {
				baseUrl: 'https://github.com/ElevenID/marty-docs/edit/main/',
			},
			customCss: [],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Installation', slug: 'getting-started/installation' },
						{ label: 'Authentication', slug: 'getting-started/authentication' },
						{ label: 'Quick Start', slug: 'getting-started/quickstart' },
					],
				},
				{
					label: 'CLI Reference',
					autogenerate: { directory: 'cli' },
				},
				{
					label: 'API',
					items: [
						{ label: 'Overview', slug: 'api/overview' },
						{ label: 'Verification', slug: 'api/verification' },
						{ label: 'Issuance', slug: 'api/issuance' },
						{ label: 'Trust Registry', slug: 'api/trust-registry' },
					],
				},
				{
					label: 'Concepts',
					autogenerate: { directory: 'concepts' },
				},
				{
					label: 'Guides',
					autogenerate: { directory: 'guides' },
				},
			],
		}),
	],
});
