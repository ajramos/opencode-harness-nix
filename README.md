# OpenCode Harness Nix

Composable Home Manager modules for a pinned OpenCode setup with context-mode, Aide, Superpowers, and isolated Herdr worktree tabs.

## Support

The v0.1.x line supports Apple Silicon macOS (`aarch64-darwin`) with standalone Home Manager. Nix and Home Manager must already be installed.

## Start A Personal Configuration

```sh
mkdir opencode-home
cd opencode-home
nix flake init -t github:ajramos/opencode-harness-nix#darwin
```

Edit `your-username` and `/Users/your-username` in `flake.nix` and `home.nix`. Preview and activate with a backup:

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

Every capability is optional. Enabling `herdrWorktrees` also enables `@tmegit/opencode-worktree-session@1.1.0`, installs the launcher, and exports its Nix store path as `OPENCODE_TERMINAL`.

## Private Settings

Never put live credentials in this repository. OpenCode supports `{env:NAME}` and `{file:path}` references inside `extraSettings`.

The template can load `private.nix`, which its `.gitignore` excludes. Copy `private.nix.example` to `private.nix`, then use `path:.` in Home Manager commands so Nix includes the ignored file in the local flake source. A plain `--flake .` uses Git's tracked file set and will omit it.

## Worktree Isolation

The launcher creates a Herdr tab in `HERDR_WORKSPACE_ID`, reads the new root pane ID from Herdr's JSON response, and starts only the requested OpenCode session in that pane. It never targets the current pane. A failed launch closes only its newly created tab and, by default, opens Kitty in the worktree.

After `createworktree` finishes its response, `@tmegit/opencode-worktree-session` resumes the current conversation in the new worktree tab. The original tab intentionally runs `session_new`, leaving a blank OpenCode session ready for another task; the conversation and history moved to the worktree tab rather than being deleted or reset. `focusNewTab = true` (the default) shifts Herdr focus to the new tab.

Logs are written to `${XDG_STATE_HOME:-$HOME/.local/state}/opencode-harness/worktree-terminal.log`.

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
nix flake check --print-build-logs
```

Without host Nix, evaluation can run in Docker:

```sh
docker run --rm -v "$PWD:/work" -w /work nixos/nix:2.31.2 nix --extra-experimental-features 'nix-command flakes' flake check --no-build --show-trace
```

Full Darwin builds run in GitHub Actions on `macos-26`.

## License

MIT
