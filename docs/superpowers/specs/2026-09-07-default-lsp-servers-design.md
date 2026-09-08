# Default LSP Servers Design

## Goal

Provide a reproducible, useful set of language servers in the default Darwin template while allowing consumers of the Home Manager module to enable or disable each server independently.

## Scope

The default template will enable language-server support for:

| Language | Server |
| --- | --- |
| Nix | `nixd` |
| TypeScript and JavaScript | `typescript-language-server` |
| Python | `pyright` |
| Bash | `bash-language-server` |
| YAML | `yaml-language-server` |
| JSON and JSONC | `vscode-json-language-server` |
| Go | `gopls` |

This change does not choose or install project toolchains such as Go or Python runtimes. It only installs the language-server executables needed by OpenCode.

## Module Design

Add `modules/opencode/lsp.nix` and import it from `modules/opencode/default.nix`.

The module will expose one boolean option per language server under `programs.opencode-harness.lsp`:

```nix
programs.opencode-harness.lsp = {
  nix.enable = true;
  typescript.enable = true;
  python.enable = true;
  bash.enable = true;
  yaml.enable = true;
  json.enable = true;
  go.enable = true;
};
```

Each option defaults to `false`. This keeps importing consumers in control and preserves the harness convention that capabilities are optional. `templates/darwin/home.nix` explicitly enables all seven options to provide the recommended out-of-box setup.

When enabled, an option will:

1. Add the corresponding language-server package to `home.packages`.
2. Add an entry to `programs.opencode.settings.lsp` using an absolute executable path from the Nix store.
3. Reuse OpenCode's built-in LSP identifier where one exists, so OpenCode retains its built-in root detection while the harness replaces only the spawn command.

The exact Nix package attributes, executable names, and OpenCode built-in identifiers will be verified against the pinned Nixpkgs and current OpenCode documentation during implementation. If JSON and YAML are provided by one Nix package, the module may install that package once while still defining separate OpenCode entries.

## Configuration Merging

Generated LSP settings will form part of the harness base settings. `programs.opencode-harness.extraSettings` will continue to be recursively merged over those settings, allowing consumers to override initialization options, environment variables, extensions, commands, or disable an inherited server.

The existing special handling for the `plugin` array remains unchanged. LSP settings are ordinary nested OpenCode settings and do not require append semantics.

## Failure Handling

Nix evaluation resolves selected package attributes; Darwin builds verify their availability on the supported platform. The module check verifies executable paths with `test -x` at build time, not during evaluation. This check is part of flake verification and does not gate a consumer's standalone activation build. Absolute Nix store paths remove dependence on an ambient `PATH` for locating the language-server executable.

OpenCode configuration remains valid when no LSP option is enabled. The module will not set `lsp = false`, because that would prevent consumers from adding their own servers through `extraSettings`.

## Testing

Extend `tests/module-eval.nix` to verify:

- Each LSP can be enabled independently.
- An enabled LSP contributes its expected package and command.
- A disabled LSP contributes neither its setting nor its package.
- The complete configuration contains all seven expected LSP entries.
- `extraSettings.lsp` can override generated nested settings without removing unrelated generated servers.
- The default Darwin template evaluates and builds with all seven servers enabled.

Run the existing repository checks after implementation:

```sh
bash tests/herdr-worktree-terminal.bash
bash tests/repository-contract.bash
nix flake check --print-build-logs
```

## Documentation

Update `README.md` to list the default-template language servers, show how module consumers opt in, explain per-server disabling, and clarify that project runtimes and toolchains remain the consumer's responsibility.

## MCP Boundary

Public MCP integrations, including Atlassian, are separate from this LSP change. They require endpoint and authentication decisions and will be designed independently. No credentials will be stored in this repository.

## Acceptance Criteria

- The Home Manager module exposes independent options for all seven selected language servers.
- The Darwin template enables all seven language servers.
- Enabled servers are installed through the pinned Nixpkgs input.
- OpenCode receives absolute Nix store commands for enabled servers.
- Consumers can override generated LSP settings through `extraSettings`.
- Existing plugin, Herdr, and private MCP behavior remains unchanged.
- Module evaluation tests and the full flake checks pass.

## Out of Scope

- Installing language runtimes, compilers, formatters, or project dependencies.
- Configuring editor-specific LSP clients outside OpenCode.
- Adding or authenticating Atlassian or other public MCP servers.
- Supporting platforms beyond the current `aarch64-darwin` boundary.
