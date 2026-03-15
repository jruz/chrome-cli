{ bun2nix, revision ? "dirty" }:
bun2nix.mkDerivation {
  packageJson = ./package.json;
  src = ./.;
  module = "cli.ts";

  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };

  extraBunBuildFlags = [
    "--define" "process.env.REVISION='${revision}'"
  ];
}
