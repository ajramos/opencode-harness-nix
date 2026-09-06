# OpenCode Harness Nix Design

## Summary

`opencode-harness-nix` is a public Nix flake that provides composable Home Manager modules for an opinionated OpenCode environment. Its first release manages a safe base configuration, pinned OpenCode plugins, and isolated worktree sessions in Herdr with Kitty fallback on Apple Silicon macOS.

The project builds on Home Manager's official `programs.opencode` module. It does not duplicate OpenCode's configuration schema or package npm plugins as Nix derivations.

## Goals

- Make a useful OpenCode setup reproducible across machines.
- Let consumers enable Aide, context-mode, Superpowers, and Herdr worktree integration independently.
- Fix plugin versions in generated OpenCode configuration.
- Package the Herdr worktree launcher and its runtime dependencies with Nix.
- Keep credentials, private MCP endpoints, machine-specific binaries, and organization-specific configuration out of the public repository.
- Provide a Darwin template that consumers can initialize and customize.
- Verify module evaluation and launcher behavior in CI.

## Non-Goals For v0.1.0

- Managing Claude Code, Codex, or other coding agents.
- Installing Nix itself.
- Managing system-wide macOS settings through nix-darwin.
- Supporting Linux or Intel macOS.
- Packaging external npm plugins hermetically with Nix.
- Publishing private DoiT MCP configuration or personal model-provider settings.
- Automatically importing an existing `opencode.json`.

## Supported Environment

- Platform: `aarch64-darwin`.
- Configuration manager: standalone Home Manager with flakes enabled.
- Terminal workspace manager: Herdr.
- Fallback terminal: Kitty.
- OpenCode configuration API: Home Manager's `programs.opencode.settings`.

Nix and Home Manager are prerequisites. The README will link to their official installation documentation but will not run privileged installers.

## Repository Structure

```text
opencode-harness-nix/
|-- flake.nix
|-- flake.lock
|-- LICENSE
|-- README.md
|-- modules/
|   `-- opencode/
|       |-- default.nix
|       |-- base.nix
|       |-- context-mode.nix
|       |-- aide.nix
|       |-- superpowers.nix
|       `-- herdr-worktrees.nix
|-- packages/
|   `-- herdr-worktree-terminal.nix
|-- scripts/
|   `-- herdr-worktree-terminal
|-- templates/
|   `-- darwin/
|       |-- flake.nix
|       `-- home.nix
|-- tests/
|   |-- module-eval.nix
|   `-- herdr-worktree-terminal.bash
`-- .github/
    `-- workflows/
        `-- checks.yml
```

Each file has one responsibility: the package owns the executable and dependencies; each module owns one optional capability; the template demonstrates consumption; tests validate public behavior.

## Flake Outputs

The flake exposes:

- `homeModules.default`: imports all module definitions; all behavior remains disabled until `programs.opencode-harness.enable` is set.
- `homeModules.opencode`: the same module under an explicit name for consumers that avoid default outputs.
- `packages.aarch64-darwin.herdr-worktree-terminal`: packaged launcher.
- `packages.aarch64-darwin.default`: alias to the launcher package.
- `checks.aarch64-darwin.module-eval`: evaluates representative enabled and disabled module combinations.
- `checks.aarch64-darwin.herdr-worktree-terminal`: runs isolated concurrent-launch and Kitty-fallback tests.
- `checks.aarch64-darwin.darwin-template-activation`: builds a Home Manager activation package directly from the template home module and `homeModules.default`.
- `templates.darwin`: standalone Home Manager starter configuration.

The flake pins Nixpkgs and Home Manager in `flake.lock`. Home Manager follows the selected Nixpkgs input.

## Home Manager Interface

The module namespace is `programs.opencode-harness`.

```nix
programs.opencode-harness = {
  enable = true;
  plugins = {
    contextMode.enable = true;
    aide.enable = true;
    superpowers.enable = true;
  };
  herdrWorktrees = {
    enable = true;
    focusNewTab = true;
    kittyFallback = true;
  };
  extraSettings = { };
};
```

Behavior:

- `enable` enables Home Manager's `programs.opencode` and applies safe base settings.
- Each plugin option appends one exact, versioned plugin reference to `programs.opencode.settings.plugin`.
- `herdrWorktrees.enable` installs the launcher package and sets `home.sessionVariables.OPENCODE_TERMINAL` to its Nix store executable.
- `focusNewTab` controls whether Herdr receives `--focus` or `--no-focus`.
- `kittyFallback` controls whether a Herdr failure opens Kitty or exits with a diagnostic.
- `extraSettings` merges consumer-owned OpenCode settings after the public defaults, allowing local override without forking the module.

The module must assert `pkgs.stdenv.isDarwin` and `pkgs.stdenv.hostPlatform.isAarch64` when enabled. Unsupported platforms fail evaluation with a clear message rather than receiving an untested configuration.

## Plugin Management

v0.1.0 supports these independently enabled plugin references:

- `context-mode@1.0.169`.
- `@jmylchreest/aide-plugin@0.1.15`.
- `superpowers@git+https://github.com/obra/superpowers.git#b36e0829c6d0140e93cfef2ca599b1b07d4a7797` (Superpowers 6.3.0).
- `@tmegit/opencode-worktree-session@1.1.0`.

OpenCode downloads these references at runtime. The README must state that `flake.lock` makes Nix inputs reproducible, while npm/Git plugin retrieval is version-pinned but not hermetically built by Nix.

## Herdr Worktree Launcher

The launcher accepts the terminal contract emitted by `@tmegit/opencode-worktree-session`:

```text
--working-directory PATH -e COMMAND [ARGUMENT ...]
```

Execution flow:

1. Validate the working directory and command arguments.
2. Derive a human-readable tab label from the worktree basename.
3. If `HERDR_WORKSPACE_ID` and Herdr are available, create one new tab in that workspace with the worktree as its current directory.
4. Parse the returned `result.tab.tab_id` and `result.root_pane.pane_id` using `jq`.
5. Shell-quote the command arguments and execute them with `herdr pane run` against only the returned pane ID.
6. If pane launch fails, close only the newly created tab.
7. If configured, fall back to a separate Kitty process in the worktree.
8. Write success, failure, and fallback diagnostics beneath the XDG state directory.

Concurrent invocations share no mutable pane selection. Each invocation acts only on IDs returned by its own tab-creation response.

The flake pins Herdr `v0.7.3`, the version already smoke-tested with the launcher, through Herdr's official flake output. Nix supplies `herdr`, `jq`, and Kitty paths to the packaged script. The script does not depend on a user's mutable `PATH`.

## Configuration And Secret Boundaries

The public defaults may contain plugin names, public documentation URLs, and non-sensitive behavior settings. They must not contain:

- API keys, tokens, OAuth material, or credential files.
- Private endpoints or organization identifiers.
- Absolute paths under a contributor's home directory.
- DoiT-specific Zendesk, Mixpanel, PostHog, or internal model-provider configuration.
- Session state or generated OpenCode caches.

Consumers add credentials using OpenCode's `{env:VAR}` or `{file:path}` references through `extraSettings`. Example files use placeholder variable names but no working credential values.

A repository-wide secret scan runs in CI. The existing live `~/.config/opencode/opencode.json` is never copied into the repository.

## Template And Installation

Consumers initialize a separate personal configuration with:

```sh
nix flake init -t github:ajramos/opencode-harness-nix#darwin
```

The template asks the consumer to deliberately review the explicit `username`, `homeDirectory`, and `home.stateVersion` values before activation. `home.stateVersion` preserves compatibility behavior from the Home Manager release where the personal configuration begins; it does not pin Home Manager and should change later only after reviewing release notes and completing required migrations. It imports `homeModules.default` and demonstrates toggling each capability.

Activation uses Home Manager's backup option:

```sh
home-manager switch -b pre-opencode-harness --flake path:.#your-username
```

The README instructs users to inspect the activation diff and existing backup before deleting anything. The project does not overwrite unmanaged configuration through a custom installer.

## Migration Of The Current Machine

Migration is separate from creating the public module:

1. Install Nix and standalone Home Manager using their official instructions.
2. Create a consumer configuration from the Darwin template.
3. Enable the generic plugin and Herdr modules.
4. Translate private MCP and provider settings into a consumer-owned file that is excluded from Git.
5. Replace inline credentials with environment or file references and rotate credentials that should no longer remain inline.
6. Run `home-manager switch -b pre-opencode-harness --flake path:.#your-username` so ignored local settings remain in the flake source.
7. Restart OpenCode and verify plugin, MCP, Herdr, and Kitty behavior.
8. Keep the Home Manager backup until all existing integrations have been verified.

The initial repository implementation does not activate Home Manager on this machine because Nix is not currently installed and the private configuration has not been migrated.

## Testing

`nix flake check` is the single root verification entry point. On Apple Silicon Darwin it builds an activation package directly from `templates/darwin/home.nix` and `homeModules.default`. CI retains a separate nested-template build with an input override to validate the standalone template's input wiring.

Module checks verify:

- The disabled module emits no OpenCode settings, packages, or session variables.
- The enabled base turns on `programs.opencode` and emits the schema-backed settings.
- Each plugin contributes exactly one pinned reference.
- Each plugin toggle is evaluated independently, including the worktree plugin controlled by Herdr integration.
- Enabling all plugins produces no duplicate references.
- Herdr integration installs the launcher and defines an absolute `OPENCODE_TERMINAL` store path.
- Unsupported systems fail with the documented assertion.

Launcher checks use stub Herdr and Kitty executables to verify:

- Two concurrent worktree launches create distinct tabs and target distinct root panes.
- Each pane receives the matching OpenCode session ID.
- A malformed Herdr response closes the created tab and invokes Kitty when fallback is enabled.
- Missing Herdr context invokes Kitty when fallback is enabled.
- Disabling Kitty fallback returns non-zero and writes a diagnostic.
- Spaces and shell metacharacters in paths and command arguments remain data rather than becoming shell syntax.

GitHub Actions runs `nix flake check` on the standard arm64 `macos-26` runner. Third-party workflow actions are pinned to reviewed full commit SHAs with comments naming their release versions. The first public release requires a green workflow because Nix is not available locally at design time.

## Release And Versioning

- License: MIT.
- Initial release: `v0.1.0` after CI passes.
- Semantic versioning applies to module option names and observable launcher behavior.
- Plugin version updates arrive through reviewed pull requests with `nix flake check` evidence.
- Breaking option changes require a major version; new optional modules require a minor version; compatible fixes require a patch version.

## Success Criteria

- A new Apple Silicon Mac with Nix and Home Manager can consume the flake without personal path edits inside the module.
- A consumer can enable or disable each supported plugin independently.
- Two simultaneous OpenCode worktree launches open two isolated Herdr tabs with correctly paired sessions.
- A Herdr failure cannot inject a command into an existing pane.
- No secret or private organization configuration is present in Git history.
- `nix flake check` passes in GitHub Actions before `v0.1.0` is published.
