{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.programs.opencode-harness;
  jsonFormat = pkgs.formats.json { };
  pinnedPlugins =
    lib.optional cfg.plugins.contextMode.enable "context-mode@1.0.169"
    ++ lib.optional cfg.plugins.aide.enable "@jmylchreest/aide-plugin@0.1.15"
    ++ lib.optional cfg.plugins.superpowers.enable "superpowers@git+https://github.com/obra/superpowers.git#b36e0829c6d0140e93cfef2ca599b1b07d4a7797"
    ++ lib.optional cfg.herdrWorktrees.enable "@tmegit/opencode-worktree-session@1.1.0";
  extraPlugins =
    if cfg.extraSettings ? plugin && builtins.isList cfg.extraSettings.plugin then
      cfg.extraSettings.plugin
    else
      [ ];
  settingsWithoutPlugins = builtins.removeAttrs cfg.extraSettings [ "plugin" ];
  settings =
    lib.recursiveUpdate { autoupdate = false; } settingsWithoutPlugins
    // lib.optionalAttrs (pinnedPlugins != [ ] || extraPlugins != [ ]) {
      plugin = lib.unique (pinnedPlugins ++ extraPlugins);
    };
in
{
  options.programs.opencode-harness = {
    enable = lib.mkEnableOption "the OpenCode harness";

    extraSettings = lib.mkOption {
      inherit (jsonFormat) type;
      default = { };
      description = "Additional OpenCode settings; plugin entries are appended to enabled pinned plugins.";
    };
  };

  config = lib.mkIf cfg.enable {
    assertions = [
      {
        assertion = !(cfg.extraSettings ? plugin) || builtins.isList cfg.extraSettings.plugin;
        message = "programs.opencode-harness.extraSettings.plugin must be a list.";
      }
    ];

    programs.opencode = {
      enable = true;
      inherit settings;
    };
  };
}
