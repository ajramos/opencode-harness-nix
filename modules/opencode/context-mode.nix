{ lib, ... }:
{
  options.programs.opencode-harness.plugins.contextMode.enable =
    lib.mkEnableOption "the pinned context-mode OpenCode plugin";
}
