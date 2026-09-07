{
  config,
  lib,
  ...
}:

let
  cfg = config.programs.opencode-harness;
in
{
  options.programs.opencode-harness.context7.enable =
    lib.mkEnableOption "the Context7 remote MCP server";

  config = lib.mkIf (cfg.enable && cfg.context7.enable) {
    programs.opencode.settings.mcp.context7 = {
      type = "remote";
      url = "https://mcp.context7.com/mcp/oauth";
      enabled = true;
    };
  };
}
