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

  outputs =
    inputs@{
      nixpkgs,
      home-manager,
      herdr,
      ...
    }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };
      launcher = pkgs.callPackage ./packages/herdr-worktree-terminal.nix {
        herdrPackage = herdr.packages.${system}.default;
      };
      repositoryContract = pkgs.runCommand "opencode-harness-repository-contract" { } ''
        cp -R ${./.} source
        chmod -R u+w source
        cd source
        ${pkgs.bash}/bin/bash tests/repository-contract.bash
        touch $out
      '';
      module = import ./modules/opencode { inherit inputs; };
      templateHome = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;
        modules = [
          module
          ./templates/darwin/home.nix
        ];
      };
    in
    {
      packages.${system} = {
        default = launcher;
        herdr-worktree-terminal = launcher;
      };

      homeModules = {
        default = module;
        opencode = module;
      };

      templates.darwin = {
        path = ./templates/darwin;
        description = "Standalone Home Manager configuration for Apple Silicon macOS";
      };

      checks.${system} = {
        darwin-template-activation = templateHome.activationPackage;
        repository-contract = repositoryContract;

        herdr-worktree-terminal = pkgs.runCommand "herdr-worktree-terminal-check" { } ''
          ${pkgs.bash}/bin/bash ${./tests/herdr-worktree-terminal.bash} \
            ${pkgs.lib.getExe launcher} ${pkgs.lib.getExe pkgs.jq}
          touch $out
        '';

        module-eval = pkgs.callPackage ./tests/module-eval.nix {
          inherit inputs module;
        };
      };

      devShells.${system}.default = pkgs.mkShell {
        packages = [
          pkgs.gitleaks
          pkgs.nixfmt
          pkgs.shellcheck
        ];
      };

      formatter.${system} = pkgs.nixfmt;
    };
}
