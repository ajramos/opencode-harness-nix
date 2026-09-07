{ inputs }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.opencode-harness;
in
{
  imports = [
    ./base.nix
    ./context7.nix
    ./context-mode.nix
    ./aide.nix
    ./superpowers.nix
    (import ./herdr-worktrees.nix { inherit inputs; })
  ];

  assertions = lib.optional cfg.enable {
    assertion = pkgs.stdenv.hostPlatform.system == "aarch64-darwin";
    message = "opencode-harness v0.1.0 supports only aarch64-darwin.";
  };
}
