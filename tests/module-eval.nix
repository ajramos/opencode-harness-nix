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

  homeEvaluation = home-manager.lib.homeManagerConfiguration {
    inherit pkgs;
    modules = [
      module
      baseHome
    ];
  };

  # Retain only tested values, not a full Home Manager module graph per case.
  mkHome =
    modules:
    let
      evaluated = homeEvaluation.extendModules { inherit modules; };
      result.config = {
        programs.opencode-harness.context7 = {
          inherit (evaluated.config.programs.opencode-harness.context7) enable;
        };
        programs.opencode = {
          inherit (evaluated.config.programs.opencode) enable settings;
        };
        home = {
          packages = map toString evaluated.config.home.packages;
          inherit (evaluated.config.home) sessionVariables;
        };
      };
    in
    builtins.deepSeq result result;

  mkEnabled =
    harnessConfig:
    mkHome [
      baseHome
      {
        programs.opencode-harness = {
          enable = true;
        }
        // harnessConfig;
      }
    ];

  disabled = mkHome [
    baseHome
  ];

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

  expectedAtlassian = {
    type = "remote";
    url = "https://mcp.atlassian.com/v2/mcp";
    enabled = true;
  };
  atlassianOnly = mkEnabled { mcp.atlassian.enable = true; };
  atlassianOff = mkEnabled { mcp.atlassian.enable = false; };
  atlassianMasterDisabled = mkEnabled {
    enable = false;
    mcp.atlassian.enable = true;
  };
  overriddenAtlassian = mkEnabled {
    mcp.atlassian.enable = true;
    extraSettings.mcp = {
      atlassian.url = "https://example.com/mcp";
      custom = {
        type = "remote";
        url = "https://example.com/custom";
      };
    };
  };
  disabledAtlassian = mkEnabled {
    mcp.atlassian.enable = true;
    extraSettings.mcp.atlassian.enabled = false;
  };

  expectedLsps = {
    nix = {
      package = pkgs.nixd;
      id = "nixd";
      settings.command = [ "${pkgs.nixd}/bin/nixd" ];
    };
    typescript = {
      package = pkgs.typescript-language-server;
      id = "typescript";
      settings.command = [
        "${pkgs.typescript-language-server}/bin/typescript-language-server"
        "--stdio"
      ];
    };
    python = {
      package = pkgs.pyright;
      id = "pyright";
      settings.command = [
        "${pkgs.pyright}/bin/pyright-langserver"
        "--stdio"
      ];
    };
    bash = {
      package = pkgs.bash-language-server;
      id = "bash";
      settings.command = [
        "${pkgs.bash-language-server}/bin/bash-language-server"
        "start"
      ];
    };
    yaml = {
      package = pkgs.yaml-language-server;
      id = "yaml-ls";
      settings.command = [
        "${pkgs.yaml-language-server}/bin/yaml-language-server"
        "--stdio"
      ];
    };
    json = {
      package = pkgs.vscode-langservers-extracted;
      id = "json-ls";
      settings = {
        command = [
          "${pkgs.vscode-langservers-extracted}/bin/vscode-json-language-server"
          "--stdio"
        ];
        extensions = [
          ".json"
          ".jsonc"
        ];
      };
    };
    go = {
      package = pkgs.gopls;
      id = "gopls";
      settings.command = [ "${pkgs.gopls}/bin/gopls" ];
    };
  };
  allLspOptions = pkgs.lib.mapAttrs (_: _: { enable = true; }) expectedLsps;
  expectedLspSettings = pkgs.lib.mapAttrs' (
    _: server: pkgs.lib.nameValuePair server.id server.settings
  ) expectedLsps;
  expectedLspPackages = pkgs.lib.mapAttrsToList (_: server: toString server.package) expectedLsps;
  noLsps = mkEnabled { };
  allLsps = mkEnabled { lsp = allLspOptions; };
  masterDisabled = mkEnabled {
    enable = false;
    lsp = allLspOptions;
  };
  overriddenLsps = mkEnabled {
    lsp = allLspOptions;
    extraSettings.lsp = {
      pyright = {
        command = [
          "/custom/pyright"
          "--stdio"
        ];
        initialization.python.analysis.typeCheckingMode = "strict";
        env.PYRIGHT_PYTHON_FORCE_VERSION = "latest";
      };
      nixd.disabled = true;
      json-ls.extensions = [ ".json" ];
    };
  };
  disabledLsps = mkEnabled {
    lsp = allLspOptions;
    extraSettings.lsp = false;
  };
  customLsp = mkEnabled {
    extraSettings.lsp.custom = {
      command = [ "/custom/server" ];
      extensions = [ ".custom" ];
    };
  };
  template = home-manager.lib.homeManagerConfiguration {
    inherit pkgs;
    modules = [
      module
      ../templates/darwin/home.nix
    ];
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
assert !(noLsps.config.programs.opencode.settings ? mcp);
assert !(atlassianOff.config.programs.opencode.settings ? mcp);
assert atlassianOnly.config.programs.opencode.settings.mcp == { atlassian = expectedAtlassian; };
assert atlassianOnly.config.home.packages == noLsps.config.home.packages;
assert atlassianMasterDisabled.config.programs.opencode.enable == false;
assert atlassianMasterDisabled.config.programs.opencode.settings == { };
assert atlassianMasterDisabled.config.home.packages == disabled.config.home.packages;
assert
  overriddenAtlassian.config.programs.opencode.settings.mcp == {
    atlassian = expectedAtlassian // {
      url = "https://example.com/mcp";
    };
    custom = {
      type = "remote";
      url = "https://example.com/custom";
    };
  };
assert
  disabledAtlassian.config.programs.opencode.settings.mcp.atlassian == expectedAtlassian
  // {
    enabled = false;
  };
assert template.config.programs.opencode.settings.mcp.atlassian == expectedAtlassian;
assert !(noLsps.config.programs.opencode.settings ? lsp);
assert pkgs.lib.intersectLists expectedLspPackages noLsps.config.home.packages == [ ];
assert masterDisabled.config.programs.opencode.enable == false;
assert masterDisabled.config.programs.opencode.settings == { };
assert masterDisabled.config.home.packages == disabled.config.home.packages;
assert pkgs.lib.all (
  name:
  let
    server = expectedLsps.${name};
    only = mkEnabled { lsp.${name}.enable = true; };
    without = mkEnabled {
      lsp = allLspOptions // {
        ${name}.enable = false;
      };
    };
  in
  only.config.programs.opencode.settings.lsp == {
    ${server.id} = server.settings;
  }
  &&
    pkgs.lib.subtractLists noLsps.config.home.packages only.config.home.packages
    == [ (toString server.package) ]
  && pkgs.lib.subtractLists only.config.home.packages noLsps.config.home.packages == [ ]
  &&
    without.config.programs.opencode.settings.lsp
    == builtins.removeAttrs expectedLspSettings [ server.id ]
  && !(builtins.elem (toString server.package) without.config.home.packages)
) (builtins.attrNames expectedLsps);
assert allLsps.config.programs.opencode.settings.lsp == expectedLspSettings;
assert pkgs.lib.all (
  package: builtins.elem package allLsps.config.home.packages
) expectedLspPackages;
assert
  pkgs.lib.subtractLists (
    noLsps.config.home.packages ++ expectedLspPackages
  ) allLsps.config.home.packages == [ ];
assert pkgs.lib.subtractLists allLsps.config.home.packages noLsps.config.home.packages == [ ];
assert
  overriddenLsps.config.programs.opencode.settings.lsp == expectedLspSettings
  // {
    pyright = {
      command = [
        "/custom/pyright"
        "--stdio"
      ];
      initialization.python.analysis.typeCheckingMode = "strict";
      env.PYRIGHT_PYTHON_FORCE_VERSION = "latest";
    };
    nixd = expectedLspSettings.nixd // {
      disabled = true;
    };
    json-ls = expectedLspSettings.json-ls // {
      extensions = [ ".json" ];
    };
  };
assert disabledLsps.config.programs.opencode.settings.lsp == false;
assert disabledLsps.config.home.packages == allLsps.config.home.packages;
assert overriddenLsps.config.home.packages == allLsps.config.home.packages;
assert
  customLsp.config.programs.opencode.settings.lsp == {
    custom = {
      command = [ "/custom/server" ];
      extensions = [ ".custom" ];
    };
  };
assert customLsp.config.home.packages == noLsps.config.home.packages;
assert template.config.programs.opencode.settings.lsp == expectedLspSettings;
assert pkgs.lib.all (
  package: builtins.elem package (map toString template.config.home.packages)
) expectedLspPackages;
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
  # Store paths alone do not prove that the selected executables exist.
  ${pkgs.lib.concatMapStringsSep "\n" (server: ''
    test -x ${pkgs.lib.escapeShellArg (builtins.head server.command)}
  '') (builtins.attrValues template.config.programs.opencode.settings.lsp)}
  touch $out
''
