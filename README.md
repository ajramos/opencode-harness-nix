# OpenCode Harness Nix

Composable Home Manager modules for a pinned OpenCode setup with Context7, context-mode, Aide, Superpowers, and isolated Herdr worktree tabs.

## Support

The v0.2.x line supports Apple Silicon macOS (`aarch64-darwin`) with standalone Home Manager. Install [Nix using the official macOS instructions](https://nixos.org/download/#nix-install-macos), then follow the official [standalone Home Manager installation](https://nix-community.github.io/home-manager/index.xhtml#sec-install-standalone).

## Start A Personal Configuration

```sh
mkdir opencode-home
cd opencode-home
nix flake init -t github:ajramos/opencode-harness-nix#darwin
```

Before activation, deliberately review all three machine-specific values: the username, replacing `your-username` both as the configuration name in `flake.nix` and as `home.username` in `home.nix`; `home.homeDirectory`, using the real absolute path for that user; and `home.stateVersion`.

`home.stateVersion` preserves Home Manager compatibility behavior from the release where this personal configuration begins; it does not select or pin the installed Home Manager version. Choose it deliberately for the initial activation. Do not change it casually after activation: review Home Manager release notes and perform any required migrations before changing it.

Preview and activate with a backup:

```sh
home-manager build --flake path:.#your-username
home-manager switch -b pre-opencode-harness --flake path:.#your-username
```

Keep the backup until OpenCode, plugins, MCP servers, Herdr, and Kitty fallback have been verified.

## Use From An Existing Home Manager Flake

Add `github:ajramos/opencode-harness-nix` as an input, make its `nixpkgs` and `home-manager` inputs follow yours, import `opencode-harness.homeModules.default`, and configure:

```nix
programs.opencode-harness = {
  enable = true;
  mcp.atlassian.enable = true;
  context7.enable = true;
  plugins = {
    contextMode.enable = true;
    aide.enable = true;
    superpowers.enable = true;
  };
  lsp = {
    nix.enable = true;
    typescript.enable = true;
    python.enable = true;
    bash.enable = true;
    yaml.enable = true;
    json.enable = true;
    go.enable = true;
  };
  herdrWorktrees = {
    enable = true;
    focusNewTab = true;
    kittyFallback = true;
  };
  extraSettings = { };
};
```

Every capability is optional. Enabling `context7` configures the public `https://mcp.context7.com/mcp/oauth` remote MCP endpoint. Enabling `herdrWorktrees` also enables the harness-patched `@tmegit/opencode-worktree-session@1.1.0`, installs the launcher, and exports its Nix store path as `OPENCODE_TERMINAL`. The plugin is loaded by file URL from the Nix store, not from a mutable npm cache. The npm tarball and original bundle are hash-checked; upstream terminal, configuration tools, and session handoff remain intact.

Context7 authentication is intentionally not declarative. On first use, OpenCode starts its remote MCP OAuth flow and stores the resulting credentials outside the Nix configuration; no OAuth token, API key, or generated credential enters the Nix store or this repository.

## Language Servers

The Darwin starter template enables these language servers from pinned Nixpkgs, with absolute Nix store commands in OpenCode:

| Option | Language | Server | OpenCode ID |
| --- | --- | --- | --- |
| `nix` | Nix | `nixd` | `nixd` |
| `typescript` | TypeScript and JavaScript | `typescript-language-server` | `typescript` |
| `python` | Python | `pyright` | `pyright` |
| `bash` | Bash | `bash-language-server` | `bash` |
| `yaml` | YAML | `yaml-language-server` | `yaml-ls` |
| `json` | JSON and JSONC | `vscode-json-language-server` | `json-ls` (custom) |
| `go` | Go | `gopls` | `gopls` |

For module consumers, all seven options default to `false`. Opt in independently using `programs.opencode-harness.lsp.<option>.enable`, as in the example above. In the template, change an enable value to `false` to omit that package and generated entry. This does not explicitly disable that built-in server: OpenCode can still discover or install it while LSP support is enabled by other settings.

`extraSettings.lsp` recursively overrides generated settings, preserving unrelated servers. For example:

```nix
programs.opencode-harness.extraSettings.lsp = {
  pyright.initialization.python.analysis.typeCheckingMode = "strict";
  nixd.disabled = true;
};
```

Commands, `env`, and extensions can also be overridden. Set `extraSettings.lsp = false;` to disable all LSPs in OpenCode. These overrides do not remove packages selected by the harness enable options; turn those options off to omit the packages as well.

These options install language servers and their required runtime dependencies, not a project's development toolchain. Project runtimes, compilers, dependencies, and formatter choices remain the responsibility of each project's development environment. Built-in IDs preserve OpenCode's root detection; JSON uses the project directory and handles `.json` and `.jsonc`.

## Atlassian MCP

The Darwin starter template enables the [official Atlassian Rovo MCP server](https://github.com/atlassian/atlassian-mcp-server) at `https://mcp.atlassian.com/v2/mcp`. For module consumers, `programs.opencode-harness.mcp.atlassian.enable` defaults to `false`. Enabling it generates a remote OpenCode MCP entry named `atlassian`, with no local server package or credentials in the Nix configuration.

Public endpoint does not mean anonymous access. Each user must authenticate with their own Atlassian account; existing product permissions and organization/admin access policies still apply. [OpenCode handles OAuth automatically](https://opencode.ai/docs/mcp-servers/#oauth), or you can explicitly authenticate after activating your configuration:

```sh
opencode mcp auth atlassian
```

This opens a browser for authorization. OAuth credentials are managed by OpenCode outside the declarative Nix configuration; never add them to this repository or Nix store. Quit and restart OpenCode after configuration changes so the running session loads the new settings. Authentication and live Atlassian access require per-user verification, not just a successful Nix evaluation.

Set `mcp.atlassian.enable = false;` to omit the harness default. `extraSettings.mcp` recursively overrides generated defaults while preserving unrelated entries. For example, `extraSettings.mcp.atlassian.enabled = false;` disables the generated server in OpenCode, and `extraSettings.mcp.atlassian.url` overrides its endpoint. Disabling the harness globally suppresses its generated settings as well.

## Private Settings

Never put live credentials in this repository. OpenCode supports `{env:NAME}` and `{file:path}` references inside `extraSettings`.

The template can load `private.nix`, which its `.gitignore` excludes. Copy `private.nix.example` to `private.nix`, then use `path:.` in Home Manager commands so Nix includes the ignored file in the local flake source. A plain `--flake .` uses Git's tracked file set and will omit it.

## Worktree Isolation

The launcher creates a Herdr tab in `HERDR_WORKSPACE_ID`, reads the new root pane ID from Herdr's JSON response, and starts only the requested OpenCode session in that pane. It never targets the current pane. A failed launch closes only its newly created tab and, by default, opens Kitty in the worktree.

After `createworktree` finishes its response, `@tmegit/opencode-worktree-session` resumes the current conversation in the new worktree tab. The original tab intentionally runs `session_new`, leaving a blank OpenCode session ready for another task; the conversation and history moved to the worktree tab rather than being deleted or reset. `focusNewTab = true` (the default) shifts Herdr focus to the new tab.

Logs are written to `${XDG_STATE_HOME:-$HOME/.local/state}/opencode-harness/worktree-terminal.log`.

### Worktree Safety

Deletion never stages, commits, pushes, or forces removal. Tracked changes, staged changes, nonignored untracked files, modified include copies, and unknown ignored files block cleanup. Files copied from `.worktreeinclude` are recorded by path and SHA-256 digest at creation; cleanup treats them as disposable only while both the source and copied file still match that recorded digest. A missing source, modified copy, or ignored file without a matching record preserves the worktree. Commits not reachable from any **locally known remote-tracking ref** also block cleanup, including repositories without remote-tracking refs. This is deliberately conservative and offline: fetch/push yourself if appropriate; stale remote refs are not proof of current remote durability. Branches are retained.

Cleanup failures preserve session tracking and the pending deletion record. Failed idle cleanup is not retried on every idle event; explicitly call `deleteworktree` again after resolving the cause. Automatic events use exact session IDs only: deleting an unrelated session from a recorded checkout cannot select that checkout's worktree by path. Only the explicit `deleteworktree` tool recovers a worktree using Git metadata, including paths outside `.opencode/worktrees` and missing plugin state. The main checkout is never a deletion target.

Session-state mutations serialize the entire read/modify/write with an exclusive `.opencode/worktree-session-state.json.lock` file in the main checkout. Mutators remain synchronous, matching the upstream call contract; contention waits at most approximately two seconds before reporting an error. Updates write and flush a private `0600` temporary file, then atomically rename it over the state file. Malformed JSON, invalid state records, and read errors refuse operations instead of resetting the state. An open reader sees the old complete snapshot, not a truncated file.

Locks are never stolen based on age or PID. Cleanup only unlinks the file still owned by its open descriptor, leaving replacement locks untouched. A crashed writer can leave a lock and temporary file; stop all writers, preserve and inspect the state, and explicitly remove the stale lock before retrying. **All writing OpenCode instances must use the patched plugin** for this protocol to work; quit old instances before deployment and restart them afterward. These guarantees assume a local filesystem and no hostile concurrent replacement of filesystem paths; the plugin does not freeze other processes that write worktree files during cleanup.

At creation, `.worktreeinclude` in the main checkout optionally lists ignored files to copy **before** scheduling the new terminal. For example:

```text
# Literal paths relative to the main checkout
config.env
.claude/settings.local.json
```

Blank lines and full-line `#` comments are ignored; surrounding whitespace is trimmed. Entries are literal regular-file paths, not glob patterns, directories, shell expressions, or negations. Absolute paths, `.`/`..` components, `.git` components, and symlink components are rejected. Files must be ignored and untracked in both checkouts; existing destinations are never overwritten. Missing entries or copy errors block launch, display an error, and retain the created worktree for inspection. Copies use mode `0600`. No file contents enter Nix builds or the store. This assumes no concurrent hostile filesystem mutation during copying; Node's portable filesystem API does not provide directory-relative `openat` traversal.

The existing detached post-worktree hook still runs after copying; do not use it for setup that must complete before launch. Failed copies are not automatically retried. Resolve the cause and manage the retained worktree explicitly before recreating it. Synchronous launch errors retain a failed pending-spawn record without repeated idle retries; open the retained session manually. Upstream detached terminal spawning still cannot reliably report asynchronous launch failures. Git subprocesses use argument arrays, and new branch names are restricted to ASCII letters, digits, `.`, `_`, `/`, and `-` plus Git's branch-name validation.

Existing globally configured npm plugin entries are not edited by this repository. Remove duplicate upstream entries in the consuming configuration when deploying; otherwise the unsafe plugin can still load alongside this one. Apply your Home Manager configuration separately, then quit and restart OpenCode. Editing this repository alone does not update an already running session.

## Reproducibility Boundary

`flake.lock` pins Nixpkgs, Home Manager, and Herdr. OpenCode fetches plugin references at runtime; this project pins their npm versions or Git commit but does not build those plugins as Nix derivations.

## Migrate An Existing OpenCode Setup

1. Start from the template and keep the current OpenCode configuration untouched.
2. Enable the generic modules needed by the machine.
3. Move private MCP and provider settings into the consumer configuration and replace credentials with environment or file references.
4. Run `home-manager build --flake path:.#your-username` and inspect the result.
5. Activate with `home-manager switch -b pre-opencode-harness --flake path:.#your-username`.
6. Restart OpenCode and verify plugins, private integrations, two concurrent Herdr worktrees, and Kitty fallback.

## Development

```sh
bash tests/herdr-worktree-terminal.bash
bash tests/repository-contract.bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -p 'test_lsp_functional.py' -v
nix flake check --print-build-logs
```

On Apple Silicon macOS, the root `nix flake check` builds a Home Manager activation package directly from `templates/darwin/home.nix` and `homeModules.default`. CI also builds the exact nested template flake with an input override, independently validating the template's input wiring.

The `worktree-session` check runs `tests/worktree-session.test.mjs` against the actual Nix-packaged bundle. It uses temporary Git repositories, synthetic ignored files, local fixture history, and a stubbed terminal boundary; no real worktrees, secret files, OpenCode sessions, or network remotes are used. Regressions cover safe disposal of unchanged recorded include copies, preservation of modified or unknown ignored data, exact-ID automatic events, four-process state updates and deletions, corrupt-state refusal, atomic reader snapshots, bounded lock contention, and ownership-safe cleanup after injected rename failures. Run just this check with `nix build .#checks.aarch64-darwin.worktree-session --no-link --print-build-logs`. Without Nix, set `WORKTREE_PLUGIN` to the patched bundle and run `node --test tests/worktree-session.test.mjs`. New repository files must be included in the flake source before Git-backed builds can see them.

The module check evaluates every LSP independently, template defaults, disabled options, and consumer overrides. Package assertions compare against a baseline because Home Manager also installs its own packages. The build phase checks `test -x` for all seven template commands. Evaluation alone verifies package attributes and settings, not executable existence or successful server startup.

The separate `lsp-functional` Darwin check launches all seven **actual generated template command arrays**, without substituting executables from `PATH`. A Python standard-library JSON-RPC client exchanges `initialize`/`initialized`, opens an intentionally invalid language fixture, and requires a nonempty error diagnostic for that document. It then requires a successful `shutdown` response and zero-status `exit`. The client handles Content-Length framing, server requests, and notifications, with bounded waits, stderr capture, and process-group cleanup. Each server gets a temporary project, HOME, caches, local Nix store (`NIX_REMOTE`, so nixd's workers do not lock the host database), and offline Go settings. Before launching nixd, `nix-store --init` initializes its temporary database once so the concurrent evaluation workers do not race on schema creation. Initialization failures and timeouts fail the check. Python, Go, ShellCheck, and the Nix CLI are check-only dependencies, not additions to the harness packages; TypeScript is supplied by its server package.

The local Python tests use fake subprocess servers to exercise fragmented UTF-8 frames, server requests, empty/unrelated diagnostics, RPC/startup/framing errors, blocked writes, notification floods, stalled reads/exits, and descendant cleanup. They do not require Nix or installed language servers. The existing macOS CI `nix flake check` runs these tests and the real Darwin protocol check automatically. To build only that check on Darwin, use `nix build .#checks.aarch64-darwin.lsp-functional --no-link --print-build-logs`.

This is **direct LSP protocol verification**, not an automated OpenCode integration check. OpenCode's `debug lsp diagnostics <file> --pure` is a separate integration entry point: an isolated probe with pinned OpenCode 1.18.25 and all seven module-generated Linux commands returned the expected error diagnostics. That probe used temporary HOME/XDG directories, disabled project config and LSP downloads, and supplied only the generated LSP settings through `OPENCODE_CONFIG_CONTENT`. It is not part of CI and does not establish Darwin integration, plugin compatibility, or behavior after Home Manager activation.

Without host Nix, evaluation can run in Docker:

```sh
docker run --rm -v "$PWD:/work" -w /work nixos/nix:2.31.2 nix --extra-experimental-features 'nix-command flakes' flake check --no-build --all-systems --show-trace
```

`--all-systems` ensures Linux-based Docker evaluates the Darwin checks rather than skipping them. Docker cannot build them on a Linux host. Full Darwin builds, including both activation-package paths, run in GitHub Actions on `macos-26`.

## License

MIT
