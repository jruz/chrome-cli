{
  description = "CLI tool for controlling Chrome via CDP";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    unstable.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      unstable,
      flake-utils,
      ...
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };
        unstablePkgs = import unstable { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            unstablePkgs.bun
            pkgs.woodpecker-cli
          ];

          shellHook = ''
            echo ""
            echo "  Bun: ${unstablePkgs.bun.version}"
            echo "  Woodpecker CLI: ${pkgs.woodpecker-cli.version}"
            echo ""
          '';
        };
      }
    );
}
