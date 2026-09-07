{ ... }:
{
  home = {
    username = "your-username";
    homeDirectory = "/Users/your-username";
    stateVersion = "25.05";
  };

  programs.home-manager.enable = true;

  programs.opencode-harness = {
    enable = true;
    context7.enable = true;
    plugins = {
      contextMode.enable = true;
      aide.enable = true;
      superpowers.enable = true;
    };
    herdrWorktrees = {
      enable = true;
      focusNewTab = true;
      kittyFallback = true;
    };
  };
}
