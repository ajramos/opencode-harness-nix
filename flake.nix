{
  description = "Composable Home Manager modules for an OpenCode development harness";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    herdr.url = "github:herdrdev/herdr/v0.7.3";
  };

  outputs = inputs@{ nixpkgs, herdr, ... }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };
      launcher = pkgs.callPackage ./packages/herdr-worktree-terminal.nix {
        herdrPackage = herdr.packages.${system}.default;
      };
    in
    {
      packages.${system} = {
        default = launcher;
        herdr-worktree-terminal = launcher;
      };

      checks.${system}.herdr-worktree-terminal = pkgs.runCommand "herdr-worktree-terminal-check" { } ''
        ${pkgs.bash}/bin/bash ${./tests/herdr-worktree-terminal.bash} \
          ${pkgs.lib.getExe launcher} ${pkgs.lib.getExe pkgs.jq}
        touch $out
      '';

      formatter.${system} = pkgs.nixfmt-rfc-style;
    };
}
