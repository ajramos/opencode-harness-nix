{
  description = "Personal OpenCode harness configuration";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    opencode-harness = {
      url = "github:ajramos/opencode-harness-nix";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.home-manager.follows = "home-manager";
    };
  };

  outputs =
    {
      nixpkgs,
      home-manager,
      opencode-harness,
      ...
    }:
    let
      system = "aarch64-darwin";
      pkgs = import nixpkgs { inherit system; };
      privateModules = if builtins.pathExists ./private.nix then [ ./private.nix ] else [ ];
    in
    {
      homeConfigurations."your-username" = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;
        modules = [
          opencode-harness.homeModules.default
          ./home.nix
        ]
        ++ privateModules;
      };
    };
}
