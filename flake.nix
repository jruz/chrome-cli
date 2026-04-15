{
  description = "CLI tool for controlling Chrome via CDP";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs, ... }:
    let
      forAllSystems = fn: nixpkgs.lib.genAttrs [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ] (system: fn (import nixpkgs { inherit system; }));
    in
    {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
            pkgs.just
            pkgs.nushell
            pkgs.woodpecker-cli
          ];

          shellHook = ''
            echo ""
            echo "  Bun: ${pkgs.bun.version}"
            echo "  Woodpecker CLI: ${pkgs.woodpecker-cli.version}"
            echo ""
          '';
        };
      });
    };
}
