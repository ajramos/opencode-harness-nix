{ pkgs }:
pkgs.stdenvNoCC.mkDerivation {
  pname = "opencode-worktree-session-safe";
  version = "1.1.0-harness.3";
  src = pkgs.fetchurl {
    url = "https://registry.npmjs.org/@tmegit/opencode-worktree-session/-/opencode-worktree-session-1.1.0.tgz";
    hash = "sha256-QNLTdE7y78y3ayZ/vZfDOd2gP533Jc8ux3J1LKQ2ycs=";
  };
  nativeBuildInputs = [ pkgs.nodejs ];
  dontConfigure = true;
  dontBuild = true;
  postPatch = ''
    node ${./patch-worktree-session.mjs} dist/opencode-worktree-session.js
    cp ${./worktree-safety.mjs} dist/worktree-safety.mjs
    cp ${./worktree-state.mjs} dist/worktree-state.mjs
  '';
  installPhase = ''
    mkdir -p $out
    cp dist/opencode-worktree-session.js $out/opencode-worktree-session.mjs
    cp dist/worktree-safety.mjs $out/
    cp dist/worktree-state.mjs $out/
    cp LICENSE $out/
  '';
}
