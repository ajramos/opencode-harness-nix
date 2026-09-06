{ lib, ... }:
{
  options.programs.opencode-harness.plugins.aide.enable =
    lib.mkEnableOption "the pinned Aide OpenCode plugin";
}
