{
  pkgs,
  herdrPackage,
  focusNewTab ? true,
  kittyFallback ? true,
}:

pkgs.writeShellApplication {
  name = "herdr-worktree-terminal";
  runtimeInputs = [
    herdrPackage
    pkgs.jq
  ] ++ pkgs.lib.optional kittyFallback pkgs.kitty;
  text = ''
    export HERDR_WORKTREE_FOCUS_DEFAULT=${if focusNewTab then "1" else "0"}
    export HERDR_WORKTREE_KITTY_FALLBACK_DEFAULT=${if kittyFallback then "1" else "0"}
    ${builtins.readFile ../scripts/herdr-worktree-terminal}
  '';
}
