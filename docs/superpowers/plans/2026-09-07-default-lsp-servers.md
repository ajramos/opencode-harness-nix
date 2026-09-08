# Default LSP Servers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seven independently configurable, Nix-installed language servers to the OpenCode harness and enable all of them in the default Darwin template.

**Architecture:** A focused Home Manager module owns the LSP options, packages, and generated OpenCode settings. It uses OpenCode's built-in server IDs where available, registers JSON as a custom server, and gives `extraSettings` higher priority so consumers can override generated values without losing unrelated servers.

**Tech Stack:** Nix flakes, Home Manager, OpenCode LSP configuration, Nixpkgs language-server packages, Bash repository checks.

**Spec:** `docs/superpowers/specs/2026-09-07-default-lsp-servers-design.md`

## Global Constraints

- Support only `aarch64-darwin` under the existing platform assertion.
- Keep every LSP option disabled for module consumers unless explicitly enabled.
- Enable all seven selected LSPs in `templates/darwin/home.nix`.
- Install language servers from the repository's pinned Nixpkgs input.
- Use absolute Nix store executable paths in OpenCode commands.
- Do not install language runtimes, compilers, formatters, or project dependencies.
- Preserve `extraSettings` as the final override for generated LSP settings.
- Do not change existing plugin, Herdr, or private MCP behavior.
- Do not add Atlassian or any other MCP integration in this change.
- Do not commit unless the user explicitly requests it.

## File Map

- `modules/opencode/lsp.nix`: independent LSP enable options, package selection, and generated OpenCode LSP settings.
- `modules/opencode/default.nix`: imports the new LSP module.
- `modules/opencode/base.nix`: merges generated LSP settings before consumer `extraSettings`.
- `tests/module-eval.nix`: verifies disabled, independent, aggregate, package, command, and override behavior.
- `templates/darwin/home.nix`: enables the recommended seven-server set.
- `README.md`: documents defaults, opt-in usage, disabling, and toolchain responsibility.
- `tests/repository-contract.bash`: protects the documented default server list and template configuration.

---

### Task 1: LSP Module and Merge Contract

**Files:**
- Create: `modules/opencode/lsp.nix`
- Modify: `modules/opencode/default.nix:13-19`
- Modify: `modules/opencode/base.nix:9-26`
- Modify: `tests/module-eval.nix:40-65,92-118`

**Interfaces:**
- Consumes: `programs.opencode-harness.enable`, seven `programs.opencode-harness.lsp.<name>.enable` booleans, `pkgs`, and `programs.opencode-harness.extraSettings`.
- Produces: internal read-only option `programs.opencode-harness.generatedLspSettings`, selected `home.packages`, and merged `programs.opencode.settings.lsp` entries.

- [ ] **Step 1: Add failing independent and aggregate module evaluations**

Add these configurations after `herdrWorktreesOnly` in `tests/module-eval.nix`:

```nix
  nixLspOnly = mkEnabled { lsp.nix.enable = true; };

  allLsps = mkEnabled {
    lsp = {
      nix.enable = true;
      typescript.enable = true;
      python.enable = true;
      bash.enable = true;
      yaml.enable = true;
      json.enable = true;
      go.enable = true;
    };
    extraSettings.lsp.pyright.initialization.python.analysis.typeCheckingMode = "strict";
  };

  expectedLspCommands = {
    nixd = [ "${pkgs.nixd}/bin/nixd" ];
    typescript = [ "${pkgs.typescript-language-server}/bin/typescript-language-server" "--stdio" ];
    pyright = [ "${pkgs.pyright}/bin/pyright-langserver" "--stdio" ];
    bash = [ "${pkgs.bash-language-server}/bin/bash-language-server" "start" ];
    yaml-ls = [ "${pkgs.yaml-language-server}/bin/yaml-language-server" "--stdio" ];
    json-ls = [ "${pkgs.vscode-langservers-extracted}/bin/vscode-json-language-server" "--stdio" ];
    gopls = [ "${pkgs.gopls}/bin/gopls" ];
  };

  expectedLspPackages = [
    pkgs.nixd
    pkgs.typescript-language-server
    pkgs.pyright
    pkgs.bash-language-server
    pkgs.yaml-language-server
    pkgs.vscode-langservers-extracted
    pkgs.gopls
  ];
```

Add these assertions before the unsupported-platform assertions:

```nix
assert nixLspOnly.config.programs.opencode.settings.lsp == {
  nixd.command = expectedLspCommands.nixd;
};
assert nixLspOnly.config.home.packages == [ pkgs.nixd ];
assert allLsps.config.programs.opencode.settings.lsp.nixd.command == expectedLspCommands.nixd;
assert allLsps.config.programs.opencode.settings.lsp.typescript.command == expectedLspCommands.typescript;
assert allLsps.config.programs.opencode.settings.lsp.pyright.command == expectedLspCommands.pyright;
assert allLsps.config.programs.opencode.settings.lsp.bash.command == expectedLspCommands.bash;
assert allLsps.config.programs.opencode.settings.lsp.yaml-ls.command == expectedLspCommands.yaml-ls;
assert allLsps.config.programs.opencode.settings.lsp.json-ls == {
  command = expectedLspCommands.json-ls;
  extensions = [ ".json" ".jsonc" ];
};
assert allLsps.config.programs.opencode.settings.lsp.gopls.command == expectedLspCommands.gopls;
assert
  allLsps.config.programs.opencode.settings.lsp.pyright.initialization.python.analysis.typeCheckingMode
  == "strict";
assert
  builtins.all (package: builtins.elem package allLsps.config.home.packages) expectedLspPackages;
assert builtins.length allLsps.config.home.packages == builtins.length expectedLspPackages;
```

- [ ] **Step 2: Run the evaluation and confirm that the new options are missing**

Run on a machine with Nix:

```bash
nix build .#checks.aarch64-darwin.module-eval --no-link --print-build-logs
```

If host Nix is unavailable, run the evaluation-only fallback:

```bash
docker run --rm -v "$PWD:/work" -w /work nixos/nix:2.31.2 nix --extra-experimental-features 'nix-command flakes' flake check --no-build --show-trace
```

Expected: failure because `programs.opencode-harness.lsp` does not exist.

- [ ] **Step 3: Implement the focused LSP module**

Create `modules/opencode/lsp.nix`:

```nix
{
  config,
  lib,
  pkgs,
  ...
}:

let
  root = config.programs.opencode-harness;
  cfg = root.lsp;
  servers = {
    nix = {
      inherit (cfg.nix) enable;
      package = pkgs.nixd;
      id = "nixd";
      command = [ "${pkgs.nixd}/bin/nixd" ];
    };
    typescript = {
      inherit (cfg.typescript) enable;
      package = pkgs.typescript-language-server;
      id = "typescript";
      command = [ "${pkgs.typescript-language-server}/bin/typescript-language-server" "--stdio" ];
    };
    python = {
      inherit (cfg.python) enable;
      package = pkgs.pyright;
      id = "pyright";
      command = [ "${pkgs.pyright}/bin/pyright-langserver" "--stdio" ];
    };
    bash = {
      inherit (cfg.bash) enable;
      package = pkgs.bash-language-server;
      id = "bash";
      command = [ "${pkgs.bash-language-server}/bin/bash-language-server" "start" ];
    };
    yaml = {
      inherit (cfg.yaml) enable;
      package = pkgs.yaml-language-server;
      id = "yaml-ls";
      command = [ "${pkgs.yaml-language-server}/bin/yaml-language-server" "--stdio" ];
    };
    json = {
      inherit (cfg.json) enable;
      package = pkgs.vscode-langservers-extracted;
      id = "json-ls";
      command = [ "${pkgs.vscode-langservers-extracted}/bin/vscode-json-language-server" "--stdio" ];
      extensions = [ ".json" ".jsonc" ];
    };
    go = {
      inherit (cfg.go) enable;
      package = pkgs.gopls;
      id = "gopls";
      command = [ "${pkgs.gopls}/bin/gopls" ];
    };
  };
  enabledServers = lib.filterAttrs (_: server: server.enable) servers;
  enabledPackages = lib.unique (lib.mapAttrsToList (_: server: server.package) enabledServers);
  generatedLspSettings = lib.mapAttrs' (
    _: server:
    lib.nameValuePair server.id (
      { inherit (server) command; }
      // lib.optionalAttrs (server ? extensions) { inherit (server) extensions; }
    )
  ) enabledServers;
in
{
  options.programs.opencode-harness = {
    lsp = lib.genAttrs [ "nix" "typescript" "python" "bash" "yaml" "json" "go" ] (
      name: {
        enable = lib.mkEnableOption "the ${name} language server";
      }
    );

    generatedLspSettings = lib.mkOption {
      type = lib.types.attrs;
      default = { };
      internal = true;
      readOnly = true;
      description = "OpenCode LSP settings generated by enabled harness language servers.";
    };
  };

  config = lib.mkIf root.enable {
    programs.opencode-harness.generatedLspSettings = generatedLspSettings;
    home.packages = enabledPackages;
  };
}
```

- [ ] **Step 4: Import the module and merge generated settings before consumer overrides**

Add `./lsp.nix` to `imports` in `modules/opencode/default.nix` immediately after `./base.nix`:

```nix
  imports = [
    ./base.nix
    ./lsp.nix
    ./context-mode.nix
    ./aide.nix
    ./superpowers.nix
    (import ./herdr-worktrees.nix { inherit inputs; })
  ];
```

In `modules/opencode/base.nix`, add this binding after `settingsWithoutPlugins`:

```nix
  generatedSettings = lib.optionalAttrs (cfg.generatedLspSettings != { }) {
    lsp = cfg.generatedLspSettings;
  };
```

Replace the `settings` merge with:

```nix
  settings =
    lib.recursiveUpdate (
      lib.recursiveUpdate { autoupdate = false; } generatedSettings
    ) settingsWithoutPlugins
    // {
      plugin = lib.unique (pinnedPlugins ++ extraPlugins);
    };
```

This order guarantees that `extraSettings.lsp` overrides generated nested values while generated servers not mentioned by the consumer remain present.

- [ ] **Step 5: Run module evaluation and formatting**

Run:

```bash
nix fmt
nix build .#checks.aarch64-darwin.module-eval --no-link --print-build-logs
```

Expected: formatting succeeds and `module-eval` builds successfully.

If host Nix remains unavailable, run:

```bash
docker run --rm -v "$PWD:/work" -w /work nixos/nix:2.31.2 nix --extra-experimental-features 'nix-command flakes' flake check --no-build --show-trace
```

Expected: evaluation succeeds for the supported Darwin configuration; Docker is not expected to build Darwin derivations.

- [ ] **Step 6: Commit only if explicitly requested**

```bash
git add modules/opencode/lsp.nix modules/opencode/default.nix modules/opencode/base.nix tests/module-eval.nix
git commit -m "feat: add configurable language servers"
```

---

### Task 2: Default Template and Public Documentation

**Files:**
- Modify: `templates/darwin/home.nix:11-23`
- Modify: `README.md:30-57`
- Modify: `tests/repository-contract.bash:4-54`

**Interfaces:**
- Consumes: the seven `programs.opencode-harness.lsp.<name>.enable` options from Task 1.
- Produces: a default Darwin template with all seven servers enabled and a documented opt-in contract for existing Home Manager configurations.

- [ ] **Step 1: Add failing repository-contract checks for the public defaults**

Add the module to the `required` array in `tests/repository-contract.bash`:

```bash
  modules/opencode/lsp.nix
```

Add these checks after the existing README checks:

```bash
grep -Fq 'nix.enable = true;' templates/darwin/home.nix
grep -Fq 'typescript.enable = true;' templates/darwin/home.nix
grep -Fq 'python.enable = true;' templates/darwin/home.nix
grep -Fq 'bash.enable = true;' templates/darwin/home.nix
grep -Fq 'yaml.enable = true;' templates/darwin/home.nix
grep -Fq 'json.enable = true;' templates/darwin/home.nix
grep -Fq 'go.enable = true;' templates/darwin/home.nix
grep -Fq 'nixd' README.md
grep -Fq 'typescript-language-server' README.md
grep -Fq 'pyright' README.md
grep -Fq 'bash-language-server' README.md
grep -Fq 'yaml-language-server' README.md
grep -Fq 'vscode-json-language-server' README.md
grep -Fq 'gopls' README.md
```

- [ ] **Step 2: Run the repository contract and confirm it fails**

Run:

```bash
bash tests/repository-contract.bash
```

Expected: failure on the first missing template LSP enable line.

- [ ] **Step 3: Enable all seven servers in the Darwin template**

Add this block inside `programs.opencode-harness` in `templates/darwin/home.nix`, after `plugins`:

```nix
    lsp = {
      nix.enable = true;
      typescript.enable = true;
      python.enable = true;
      bash.enable = true;
      yaml.enable = true;
      json.enable = true;
      go.enable = true;
    };
```

- [ ] **Step 4: Document the default servers and consumer controls**

In the existing configuration example in `README.md`, add the same `lsp` block after `plugins`.

Add this section after the paragraph beginning `Every capability is optional`:

```markdown
## Language Servers

The Darwin starter template enables a reproducible language-server set installed from pinned Nixpkgs:

| Language | Server |
| --- | --- |
| Nix | `nixd` |
| TypeScript and JavaScript | `typescript-language-server` |
| Python | `pyright` |
| Bash | `bash-language-server` |
| YAML | `yaml-language-server` |
| JSON and JSONC | `vscode-json-language-server` |
| Go | `gopls` |

Consumers importing the module choose servers independently with `programs.opencode-harness.lsp.<name>.enable`. Leave an option unset or set it to `false` to omit that package and OpenCode entry. Use `extraSettings.lsp` for server-specific OpenCode overrides.

These options install language servers only. Project runtimes, compilers, dependencies, and formatter choices remain the responsibility of each project's development environment.
```

- [ ] **Step 5: Run focused checks and formatting**

Run:

```bash
nix fmt
bash tests/repository-contract.bash
bash tests/herdr-worktree-terminal.bash
```

Expected: all three commands pass.

- [ ] **Step 6: Run the complete verification suite**

Run on Apple Silicon macOS with Nix:

```bash
nix flake check --print-build-logs
```

Expected: all checks pass, including `module-eval` and `darwin-template-activation`, which proves all seven selected packages build for `aarch64-darwin`.

If host Nix is unavailable, run the evaluation-only fallback and record that Darwin builds remain unverified locally:

```bash
docker run --rm -v "$PWD:/work" -w /work nixos/nix:2.31.2 nix --extra-experimental-features 'nix-command flakes' flake check --no-build --show-trace
```

- [ ] **Step 7: Inspect the final diff for scope and credentials**

Run:

```bash
git status --short
```

Expected: only the approved LSP module, template, tests, and documentation changes appear; there are no credentials, MCP endpoints, runtime installations, or unrelated modifications.

- [ ] **Step 8: Commit only if explicitly requested**

```bash
git add templates/darwin/home.nix README.md tests/repository-contract.bash
git commit -m "docs: enable default language servers"
```
