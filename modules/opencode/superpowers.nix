{ lib, ... }:
{
  options.programs.opencode-harness.plugins.superpowers.enable =
    lib.mkEnableOption "the pinned Superpowers OpenCode plugin";
}
