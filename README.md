# ElevenID documentation

This repository builds the static developer documentation at
[docs.elevenidllc.com](https://docs.elevenidllc.com) with Astro and Starlight.
Content lives in `src/content/docs/`; navigation, site identity and the active
`src/assets/logo.svg` are configured in `astro.config.mjs`. Files in `public/`
are copied as static assets.

Use Node 24 or newer and install the reviewed lockfile:

```sh
npm ci
npm run dev
```

Build and check dependencies before review:

```sh
npm run build
npm audit --audit-level=moderate
```

`npm run preview` serves the generated `dist/` output locally. `npm run astro`
forwards Astro CLI commands. Keep generated `dist/`, `.astro/` and dependencies
out of Git; the existing Pages workflow owns publication.

The build temporarily overrides `postcss-nested` to 7.0.2 because Expressive
Code's 6.x dependency retains a vulnerable selector-parser. Version 7 supports
this project's Node 24 requirement and resolves the patched parser. Remove the
override when Starlight/Expressive Code select a maintained safe version on
their own. Recheck the production build, nested-selector output and audit when
changing it; keep the direct Starlight dependency on its declared release line.
