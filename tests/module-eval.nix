{
  pkgs,
  inputs,
  module,
}:

let
  inherit (inputs) home-manager;

  baseHome = {
    home.username = "test-user";
    home.homeDirectory = "/Users/test-user";
    home.stateVersion = "25.05";
  };

  disabled = home-manager.lib.homeManagerConfiguration {
    inherit pkgs;
    modules = [
      module
      baseHome
    ];
  };

  enabled = home-manager.lib.homeManagerConfiguration {
    inherit pkgs;
    modules = [
      module
      baseHome
      {
        programs.opencode-harness = {
          enable = true;
          plugins = {
            contextMode.enable = true;
            aide.enable = true;
            superpowers.enable = true;
          };
          herdrWorktrees.enable = true;
          extraSettings = {
            autoupdate = true;
            theme = "system";
            plugin = [ "custom-plugin@2.0.0" ];
          };
        };
      }
    ];
  };

  expectedPlugins = [
    "context-mode@1.0.169"
    "@jmylchreest/aide-plugin@0.1.15"
    "superpowers@git+https://github.com/obra/superpowers.git#b36e0829c6d0140e93cfef2ca599b1b07d4a7797"
    "@tmegit/opencode-worktree-session@1.1.0"
    "custom-plugin@2.0.0"
  ];

  linuxPkgs = import inputs.nixpkgs { system = "x86_64-linux"; };
  unsupported = builtins.tryEval (
    (home-manager.lib.homeManagerConfiguration {
      pkgs = linuxPkgs;
      modules = [
        module
        {
          home.username = "test-user";
          home.homeDirectory = "/home/test-user";
          home.stateVersion = "25.05";
          programs.opencode-harness.enable = true;
        }
      ];
    }).activationPackage.drvPath
  );

  launcherPath = enabled.config.home.sessionVariables.OPENCODE_TERMINAL;
in
assert disabled.config.programs.opencode.enable == false;
assert disabled.config.programs.opencode.settings == { };
assert !(disabled.config.home.sessionVariables ? OPENCODE_TERMINAL);
assert enabled.config.programs.opencode.enable;
assert enabled.config.programs.opencode.settings.autoupdate;
assert enabled.config.programs.opencode.settings.theme == "system";
assert enabled.config.programs.opencode.settings.plugin == expectedPlugins;
assert
  builtins.match "/nix/store/.+-herdr-worktree-terminal/bin/herdr-worktree-terminal" launcherPath
  != null;
assert unsupported.success == false;
pkgs.runCommand "opencode-harness-module-eval" { } ''
  touch $out
''
