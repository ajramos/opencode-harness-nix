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

  mkEnabled =
    harnessConfig:
    home-manager.lib.homeManagerConfiguration {
      inherit pkgs;
      modules = [
        module
        baseHome
        {
          programs.opencode-harness = {
            enable = true;
          }
          // harnessConfig;
        }
      ];
    };

  disabled = home-manager.lib.homeManagerConfiguration {
    inherit pkgs;
    modules = [
      module
      baseHome
    ];
  };

  baseOnly = mkEnabled { };
  contextModeOnly = mkEnabled { plugins.contextMode.enable = true; };
  aideOnly = mkEnabled { plugins.aide.enable = true; };
  superpowersOnly = mkEnabled { plugins.superpowers.enable = true; };
  herdrWorktreesOnly = mkEnabled { herdrWorktrees.enable = true; };
  context7Only = mkEnabled { context7.enable = true; };
  context7WithExtraSettings = mkEnabled {
    context7.enable = true;
    extraSettings.mcp.private = {
      type = "remote";
      url = "https://mcp.example.invalid/mcp";
      enabled = true;
    };
  };

  enabled = mkEnabled {
    plugins = {
      contextMode.enable = true;
      aide.enable = true;
      superpowers.enable = true;
    };
    herdrWorktrees.enable = true;
    extraSettings = {
      autoupdate = true;
      share = "disabled";
      plugin = [ "custom-plugin@2.0.0" ];
    };
  };

  expectedPlugins = [
    "context-mode@1.0.169"
    "@jmylchreest/aide-plugin@0.1.15"
    "superpowers@git+https://github.com/obra/superpowers.git#b36e0829c6d0140e93cfef2ca599b1b07d4a7797"
    "@tmegit/opencode-worktree-session@1.1.0"
    "custom-plugin@2.0.0"
  ];

  linuxPkgs = import inputs.nixpkgs { system = "x86_64-linux"; };
  unsupportedModules = [
    module
    {
      home.username = "test-user";
      home.homeDirectory = "/home/test-user";
      home.stateVersion = "25.05";
      programs.opencode-harness.enable = true;
    }
  ];
  unsupportedModule = module {
    config.programs.opencode-harness.enable = true;
    lib = linuxPkgs.lib;
    pkgs = linuxPkgs;
  };
  failedUnsupportedAssertions = builtins.filter (
    assertion: !assertion.assertion
  ) unsupportedModule.assertions;
  unsupported = builtins.tryEval (
    (home-manager.lib.homeManagerConfiguration {
      pkgs = linuxPkgs;
      modules = unsupportedModules;
    }).activationPackage.drvPath
  );

  launcherPath = enabled.config.home.sessionVariables.OPENCODE_TERMINAL;
in
assert disabled.config.programs.opencode.enable == false;
assert disabled.config.programs.opencode.settings == { };
assert !(disabled.config.home.sessionVariables ? OPENCODE_TERMINAL);
assert !(disabled.config.programs.opencode-harness.context7.enable);
assert !(baseOnly.config.programs.opencode.settings ? mcp);
assert contextModeOnly.config.programs.opencode.settings.plugin == [ "context-mode@1.0.169" ];
assert aideOnly.config.programs.opencode.settings.plugin == [ "@jmylchreest/aide-plugin@0.1.15" ];
assert
  superpowersOnly.config.programs.opencode.settings.plugin == [
    "superpowers@git+https://github.com/obra/superpowers.git#b36e0829c6d0140e93cfef2ca599b1b07d4a7797"
  ];
assert
  herdrWorktreesOnly.config.programs.opencode.settings.plugin == [
    "@tmegit/opencode-worktree-session@1.1.0"
  ];
assert
  context7Only.config.programs.opencode.settings.mcp.context7 == {
    type = "remote";
    url = "https://mcp.context7.com/mcp/oauth";
    enabled = true;
  };
assert
  context7WithExtraSettings.config.programs.opencode.settings.mcp.context7
  == context7Only.config.programs.opencode.settings.mcp.context7;
assert
  context7WithExtraSettings.config.programs.opencode.settings.mcp.private == {
    type = "remote";
    url = "https://mcp.example.invalid/mcp";
    enabled = true;
  };
assert enabled.config.programs.opencode.enable;
assert enabled.config.programs.opencode.settings.autoupdate;
assert enabled.config.programs.opencode.settings.share == "disabled";
assert enabled.config.programs.opencode.settings.plugin == expectedPlugins;
assert
  builtins.match "/nix/store/.+-herdr-worktree-terminal/bin/herdr-worktree-terminal" launcherPath
  != null;
assert builtins.length failedUnsupportedAssertions == 1;
assert
  (builtins.head failedUnsupportedAssertions).message
  == "opencode-harness v0.2.0 supports only aarch64-darwin.";
assert unsupported.success == false;
pkgs.runCommand "opencode-harness-module-eval" { } ''
  touch $out
''
