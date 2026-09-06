{ inputs }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  root = config.programs.opencode-harness;
  cfg = root.herdrWorktrees;
  launcher = pkgs.callPackage ../../packages/herdr-worktree-terminal.nix {
    herdrPackage = inputs.herdr.packages.${pkgs.stdenv.hostPlatform.system}.default;
    inherit (cfg) focusNewTab kittyFallback;
  };
in
{
  options.programs.opencode-harness.herdrWorktrees = {
    enable = lib.mkEnableOption "isolated Herdr tabs for OpenCode worktree sessions";

    focusNewTab = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether Herdr focuses each newly created worktree tab.";
    };

    kittyFallback = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether launcher failures open an independent Kitty window.";
    };
  };

  config = lib.mkIf (root.enable && cfg.enable) {
    home.packages = [ launcher ];
    home.sessionVariables.OPENCODE_TERMINAL = lib.getExe launcher;
  };
}
