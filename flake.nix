{
  description = "CLI tool for controlling Chrome via CDP";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    bun2nix = {
      url = "github:nix-community/bun2nix?tag=2.0.8";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, bun2nix, ... }:
    let
      revision = self.rev or "dirty";
      forAllSystems = fn: nixpkgs.lib.genAttrs [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ] (system: fn (import nixpkgs {
        inherit system;
        overlays = [ bun2nix.overlays.default ];
      }));
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.callPackage ./default.nix {
          inherit revision;
        };
      });

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
