#!/usr/bin/env bash
set -euo pipefail

required=(
  README.md
  CHANGELOG.md
  LICENSE
  templates/darwin/flake.nix
  templates/darwin/home.nix
  templates/darwin/private.nix.example
  templates/darwin/.gitignore
  modules/opencode/context7.nix
  .github/workflows/checks.yml
)

for path in "${required[@]}"; do
  test -f "$path" || {
    printf 'missing required file: %s\n' "$path" >&2
    exit 1
  }
done

grep -Fq 'github:ajramos/opencode-harness-nix#darwin' README.md
grep -Fq 'https://nixos.org/download/#nix-install-macos' README.md
grep -Fq 'https://nix-community.github.io/home-manager/index.xhtml#sec-install-standalone' README.md
# shellcheck disable=SC2016 # Markdown backticks are literal contract text.
grep -Fq '`home.stateVersion` preserves Home Manager compatibility behavior' README.md
grep -Fq 'Do not change it casually after activation' README.md
grep -Fq 'home-manager switch -b pre-opencode-harness --flake path:.' README.md
grep -Fq 'https://mcp.context7.com/mcp/oauth' README.md
grep -Fq 'no OAuth token, API key, or generated credential enters the Nix store or this repository' README.md
grep -Fq 'context7.enable = true;' templates/darwin/home.nix
# shellcheck disable=SC2016 # Markdown backticks are literal contract text.
grep -Fq 'The original tab intentionally runs `session_new`, leaving a blank OpenCode session ready for another task; the conversation and history moved to the worktree tab rather than being deleted or reset.' README.md
grep -Fq 'macos-26' .github/workflows/checks.yml
grep -Fq 'uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6' .github/workflows/checks.yml
grep -Fq 'uses: cachix/install-nix-action@13d8dd58da0234aa297dedd986986ccb8e7f3e24 # v31' .github/workflows/checks.yml
# shellcheck disable=SC2016 # $PWD is literal workflow text.
grep -Fq 'nix build ./templates/darwin#homeConfigurations.your-username.activationPackage --override-input opencode-harness path:$PWD --no-link --print-build-logs' .github/workflows/checks.yml
grep -Fq 'gitleaks git --redact --no-banner .' .github/workflows/checks.yml
grep -Fq 'templates.darwin' flake.nix
grep -Fq 'darwin-template-activation' flake.nix
grep -Fq 'pkgs.nixfmt' flake.nix
if grep -Fq 'nixfmt-rfc-style' flake.nix; then
  printf 'deprecated nixfmt-rfc-style reference found in flake.nix\n' >&2
  exit 1
fi
grep -Fq 'private.nix' templates/darwin/.gitignore
grep -Fq 'herdr-worktree-terminal.bash' docs/superpowers/specs/2026-09-06-opencode-harness-nix-design.md
grep -Fq 'home-manager switch -b pre-opencode-harness --flake path:.#your-username' docs/superpowers/specs/2026-09-06-opencode-harness-nix-design.md
if grep -Fq 'herdr-worktree-terminal.zsh' docs/superpowers/specs/2026-09-06-opencode-harness-nix-design.md; then
  printf 'stale launcher test extension found in design spec\n' >&2
  exit 1
fi
if grep -Fq 'home-manager switch -b pre-opencode-harness --flake .' docs/superpowers/specs/2026-09-06-opencode-harness-nix-design.md; then
  printf 'Git-filtered Home Manager activation command found in design spec\n' >&2
  exit 1
fi

if grep -r -E -o --exclude=.git --exclude-dir=.git --exclude-dir=.superpowers \
  '/Users/[[:alnum:]_.-]+' . \
  | grep -v -E ':/Users/(your-username|test-user)$'; then
  printf 'personal absolute path found in public implementation\n' >&2
  exit 1
fi

printf 'repository contract: PASS\n'
