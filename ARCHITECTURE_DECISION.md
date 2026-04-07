# AI Discoverability & Documentation Architecture

**Date:** 2026-04-07
**Status:** Accepted

## Context

We are making ElevenID discoverable and usable by AI systems (LLM crawlers, developer copilots, agent frameworks). This requires machine-readable discovery files, structured documentation, and a clear interface for AI agents to interact with the platform.

## Decisions

### 1. Documentation site: Starlight at `docs.elevenidllc.com`

**Decision:** Host developer documentation as a separate Starlight (Astro) project at `docs.elevenidllc.com`.

**Rationale:**
- The existing `/docs` route in marty-ui renders Redoc (raw API reference from OpenAPI). This covers endpoint documentation but not guides, tutorials, or concept explanations.
- Blog posts cover conceptual topics but are time-stamped content—not suitable for evolving developer guides.
- Starlight provides built-in search (Pagefind), sidebar navigation, versioning, and MDX support.
- LLMs crawl `docs.*` subdomains heavily—a dedicated docs subdomain improves AI discoverability.
- Docs content is pure Markdown, easy to maintain without JSX knowledge.
- Deploys to Cloudflare Pages independently of the main UI.

**Project:** `marty-docs` at `/Volumes/Heart of Gold/Github/work/marty-docs`

**Structure:**
```
src/content/docs/
├── getting-started/     # Installation, auth, quickstart
├── cli/                 # Full CLI command reference
├── api/                 # REST API guides (supplements OpenAPI/Redoc)
├── concepts/            # Trust profiles, credential templates, MIP
└── guides/              # Integration walkthroughs
```

**Migration path:** The marty-ui `/docs` route (Redoc) remains as the interactive API reference. `docs.elevenidllc.com` becomes the canonical developer documentation. `llms.txt` will point to both.

### 2. AI agent interface: CLI, not MCP server

**Decision:** Direct AI agents to use the **Marty CLI** (`@elevenid/marty-cli`) as the primary interface. Do not build an MCP server or WebMCP server.

**Rationale:**
- The target AI users are **developer copilots** (GitHub Copilot, Cursor, Windsurf, Cline)—all of which have terminal access and can run CLI commands natively.
- The CLI already wraps every API operation: `verify`, `creds issue`, `trust list`, `ct inspect`, `compliance`, `flows`, etc.
- An MCP server would duplicate CLI functionality with additional infrastructure to maintain.
- WebMCP is still nascent; browser-based agents are not the current audience.
- The CLI supports `--json` output, making it easy for agents to parse structured responses.

**When to revisit:** If ElevenID targets non-developer personas (e.g., compliance officers using ChatGPT to query trust registries), an MCP server becomes warranted. That's a different product motion.

**Actions taken:**
- Updated the `/ai` page to position the CLI as the primary agent interface
- Removed MCP tool definitions from the `/ai` page
- CLI commands and examples are documented with `--json` output patterns

### 3. No developer tutorial page

**Decision:** Do not create a "Build an AI agent that verifies credentials" tutorial page.

**Rationale:** The CLI reference and quickstart guide serve this purpose. A dedicated tutorial risks becoming stale and implies a level of AI agent framework commitment we don't need to make yet.

### 4. AI discovery files (implemented)

The following static files are served from `marty-ui/ui/public/`:

| File | Purpose |
|------|---------|
| `/llms.txt` | Machine-readable site overview for AI crawlers |
| `/.well-known/ai-plugin.json` | AI plugin manifest pointing to OpenAPI spec |
| `/openapi.yaml` | OpenAPI 3.1 specification for core API endpoints |

### 5. Canonical concept pages (implemented)

Concept definition pages for LLM knowledge anchoring:

- `/what-is-verifiable-identity`
- `/what-is-credential-verification`
- `/what-is-open-badge`
- `/what-is-digital-credential`
- `/what-is-marty-protocol`

Each includes Schema.org `DefinedTerm` structured data, full SEO metadata, and cross-links to product pages.

### 6. AI crawler access (implemented)

`robots.txt` explicitly allows major AI crawlers: GPTBot, ChatGPT-User, Google-Extended, Anthropic-AI, ClaudeBot, PerplexityBot, Cohere-AI.

## File inventory

### marty-ui (existing repo)
- `ui/public/llms.txt`
- `ui/public/.well-known/ai-plugin.json`
- `ui/public/openapi.yaml`
- `ui/src/components/pages/AiCapabilityPage.jsx` — `/ai` route (CLI-focused)
- `ui/src/components/pages/WhatIs*.jsx` — 5 concept pages
- `ui/vite.config.ts` — prerender + sitemap + robots.txt config
- `nginx-tunnel.conf.template` — `.well-known/ai-plugin.json` location block

### marty-docs (new repo)
- Starlight project at `docs.elevenidllc.com`
- Getting started guides, CLI reference, API docs, concepts, integration guides
