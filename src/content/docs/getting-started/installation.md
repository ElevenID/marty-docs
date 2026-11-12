---
title: Installation
description: Install the released native Marty CLI and verify its checksum.
---

## Install the native CLI

The examples in this documentation target **Marty CLI v0.3.6**. Download the
native binary for your operating system and architecture from the
[v0.3.6 release](https://github.com/ElevenID/marty-cli/releases/tag/v0.3.6), together
with its `SHA256SUMS` file. Linux, macOS, and Windows binaries are provided for
x64 and ARM64. Verify the downloaded binary against that release's checksum
before running it.

For Linux x64, run these commands in an empty download directory:

```sh
curl --fail --location --output marty-linux-x64 \
  https://github.com/ElevenID/marty-cli/releases/download/v0.3.6/marty-linux-x64
curl --fail --location --output SHA256SUMS \
  https://github.com/ElevenID/marty-cli/releases/download/v0.3.6/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
chmod 0755 marty-linux-x64
./marty-linux-x64 --version
```

Require an `OK` result for `marty-linux-x64`. Move the verified binary to a
directory on your `PATH` under the name `marty`. On other platforms, select the
matching release asset and use the platform's SHA-256 checksum utility.

The native CLI does not require Node.js. The npm launcher and its platform
packages are attached to the GitHub release but are not published to npm;
`npm install -g @elevenid/marty-cli` is not the supported installation path for
this release. The separate JavaScript API package and the course integration
example require **Node.js 24 or later**.

## Configure your deployment

Use the HTTPS origin of the deployment you operate, without an `/api` or `/v1`
suffix:

```sh
marty config set apiUrl https://gateway.example.org
marty orgs switch REPLACE_WITH_ORGANIZATION_UUID
marty --global-output json health
```

`health` checks connectivity. An authenticated template read in the
[quick start](/getting-started/quickstart/) checks your key and its scopes.
The native CLI uses the operating system's CA trust store. Install an explicitly
verified private CA in that trust store when testing a private deployment.
Node's `NODE_EXTRA_CA_CERTS` setting applies to the Node example, not the native CLI.

## Shell completions

```sh
marty completion bash >> ~/.bashrc
marty completion zsh >> ~/.zshrc
marty completion fish > ~/.config/fish/completions/marty.fish
```

Use the command for your shell and reload its configuration. For server
installation, follow the separate
[self-hosted deployment guide](/guides/self-hosted-deployment/).

Source: [released CLI installation and architecture](https://github.com/ElevenID/marty-cli/blob/v0.3.6/README.md).

## Next steps

- [Configure machine authentication](/getting-started/authentication/)
- [Run the quick start](/getting-started/quickstart/)
