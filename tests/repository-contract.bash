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
  .github/workflows/checks.yml
)

for path in "${required[@]}"; do
  test -f "$path" || {
    printf 'missing required file: %s\n' "$path" >&2
    exit 1
  }
done

grep -Fq 'github:ajramos/opencode-harness-nix#darwin' README.md
grep -Fq 'home-manager switch -b pre-opencode-harness --flake path:.' README.md
grep -Fq 'macos-26' .github/workflows/checks.yml
grep -Fq 'nix build ./templates/darwin#homeConfigurations.your-username.activationPackage --override-input opencode-harness path:$PWD --no-link --print-build-logs' .github/workflows/checks.yml
grep -Fq 'gitleaks git --redact --no-banner .' .github/workflows/checks.yml
grep -Fq 'templates.darwin' flake.nix
grep -Fq 'private.nix' templates/darwin/.gitignore

if grep -r -E -o --exclude-dir=.git --exclude-dir=.superpowers \
  '/Users/[[:alnum:]_.-]+' . \
  | grep -v -E ':/Users/(your-username|test-user)$'; then
  printf 'personal absolute path found in public implementation\n' >&2
  exit 1
fi

printf 'repository contract: PASS\n'
