#!/usr/bin/env bash
set -euo pipefail

launcher=${1:-scripts/herdr-worktree-terminal}
jq_bin=${2:-$(command -v jq)}
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT

mkdir -p "$fixture/bin" "$fixture/home" "$fixture/state"
mkdir -p "$fixture/worktrees/cxe-821" "$fixture/worktrees/cxe-832" "$fixture/worktrees/cxe 900"

cat >"$fixture/bin/herdr" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

record_dir=${HERDR_TEST_RECORD_DIR:?}
mode=${HERDR_TEST_MODE:-normal}

if [[ $1 == tab && $2 == create ]]; then
  printf 'create|%s\n' "$*" >>"$record_dir/herdr.log"
  label=''
  while (($#)); do
    if [[ $1 == --label ]]; then
      label=$2
      break
    fi
    shift
  done
  if [[ $mode == malformed ]]; then
    printf '{"result":{"tab":{"tab_id":"tab-%s"}}}\n' "$label"
  else
    printf '{"result":{"tab":{"tab_id":"tab-%s"},"root_pane":{"pane_id":"pane-%s"}}}\n' "$label" "$label"
  fi
  exit 0
fi

if [[ $1 == pane && $2 == run ]]; then
  printf 'run|%s|%s\n' "$3" "$4" >>"$record_dir/herdr.log"
  exit 0
fi

if [[ $1 == tab && $2 == close ]]; then
  printf 'close|%s\n' "$3" >>"$record_dir/herdr.log"
  exit 0
fi

exit 2
STUB

cat >"$fixture/bin/kitty" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf 'kitty' >>"${HERDR_TEST_RECORD_DIR:?}/kitty.log"
printf '|%q' "$@" >>"${HERDR_TEST_RECORD_DIR:?}/kitty.log"
printf '\n' >>"${HERDR_TEST_RECORD_DIR:?}/kitty.log"
STUB

chmod +x "$fixture/bin/herdr" "$fixture/bin/kitty"

run_launcher() {
  env \
    HOME="$fixture/home" \
    XDG_STATE_HOME="$fixture/state" \
    HERDR_WORKSPACE_ID=w-test \
    HERDR_TEST_MODE="${HERDR_TEST_MODE:-normal}" \
    HERDR_WORKTREE_FOCUS="${HERDR_WORKTREE_FOCUS:-1}" \
    HERDR_WORKTREE_KITTY_FALLBACK="${HERDR_WORKTREE_KITTY_FALLBACK:-1}" \
    HERDR_TEST_RECORD_DIR="$fixture" \
    HERDR_BIN="$fixture/bin/herdr" \
    JQ_BIN="$jq_bin" \
    KITTY_BIN="$fixture/bin/kitty" \
    bash "$launcher" "$@"
}

run_launcher --working-directory "$fixture/worktrees/cxe-821" -e opencode --session session-821 &
pid_821=$!
run_launcher --working-directory "$fixture/worktrees/cxe-832" -e opencode --session session-832 &
pid_832=$!
wait "$pid_821" "$pid_832"

grep -Fq 'run|pane-cxe-821|opencode --session session-821' "$fixture/herdr.log"
grep -Fq 'run|pane-cxe-832|opencode --session session-832' "$fixture/herdr.log"
test ! -e "$fixture/kitty.log"

run_launcher --working-directory "$fixture/worktrees/cxe 900" -e opencode --session session-900
grep -Fq 'run|pane-cxe 900|opencode --session session-900' "$fixture/herdr.log"

sentinel="$fixture/must-not-exist"
run_launcher --working-directory "$fixture/worktrees/cxe-821" -e opencode --prompt "value; touch $sentinel"
grep -Fq "run|pane-cxe-821|opencode --prompt value\\;\\ touch\\ $sentinel" "$fixture/herdr.log"
test ! -e "$sentinel"

HERDR_TEST_MODE=malformed run_launcher --working-directory "$fixture/worktrees/cxe-821" -e opencode --session malformed
grep -Fq 'close|tab-cxe-821' "$fixture/herdr.log"
grep -Fq "kitty|-d|$fixture/worktrees/cxe-821|-e|opencode|--session|malformed" "$fixture/kitty.log"

env \
  HOME="$fixture/home" \
  XDG_STATE_HOME="$fixture/state" \
  HERDR_WORKSPACE_ID= \
  HERDR_TEST_RECORD_DIR="$fixture" \
  HERDR_BIN="$fixture/bin/herdr" \
  JQ_BIN="$jq_bin" \
  KITTY_BIN="$fixture/bin/kitty" \
  bash "$launcher" --working-directory "$fixture/worktrees/cxe-832" -e opencode --session no-workspace
grep -Fq "kitty|-d|$fixture/worktrees/cxe-832|-e|opencode|--session|no-workspace" "$fixture/kitty.log"

if HERDR_WORKTREE_KITTY_FALLBACK=0 HERDR_TEST_MODE=malformed run_launcher \
  --working-directory "$fixture/worktrees/cxe-832" -e opencode --session no-fallback; then
  printf 'launcher unexpectedly succeeded with fallback disabled\n' >&2
  exit 1
fi

HERDR_WORKTREE_FOCUS=0 run_launcher --working-directory "$fixture/worktrees/cxe-832" -e opencode --session unfocused
grep -Fq -- '--no-focus' "$fixture/herdr.log"

if run_launcher --working-directory "$fixture/missing" -e opencode --session missing-dir; then
  printf 'launcher unexpectedly accepted a missing worktree\n' >&2
  exit 1
fi

test -s "$fixture/state/opencode-harness/worktree-terminal.log"
printf 'launcher behavior: PASS\n'
