---
title: Installation
description: Install the Marty CLI and verify your setup.
---

## Prerequisites

- **Node.js 18** or later
- **npm**, **yarn**, or **bun**

## Install the CLI

```bash
npm install -g @elevenid/marty-cli
```

Verify the installation:

```bash
marty --version
```

## Shell completions

Enable tab completions for your shell:

```bash
# Bash
marty completion bash >> ~/.bashrc

# Zsh
marty completion zsh >> ~/.zshrc

# Fish
marty completion fish > ~/.config/fish/completions/marty.fish
```

Reload your shell after adding completions.

## Next steps

- [Authenticate with your ElevenID account](/getting-started/authentication/)
