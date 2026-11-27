{
  description = "CLI tool for controlling Chrome via CDP";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        projectName = "chrome-cli";
        goVersion = builtins.head (builtins.match ".*\ngo ([^\n]+)\n.*" (builtins.readFile ./go.mod));
        release = builtins.fromJSON (builtins.readFile ./release.json);
        platform = release.platforms.${system};
        released = release.platforms ? ${system};
        sandbox = pkgs.writeShellScriptBin "sandbox" ''
          export PATH=${
            pkgs.lib.makeBinPath [
              pkgs.docker-client
              pkgs.git
              pkgs.coreutils
            ]
          }:"$PATH"
          exec ${pkgs.nushell}/bin/nu ${./scripts/sandbox.nu} "$@"
        '';
      in
      {
        packages = pkgs.lib.optionalAttrs released {
          default = pkgs.stdenvNoCC.mkDerivation {
            pname = projectName;
            inherit (release) version;
            src = pkgs.fetchurl {
              url = "https://github.com/jruz/${projectName}/releases/download/v${release.version}/${platform.asset}";
              inherit (platform) hash;
            };
            dontUnpack = true;
            dontStrip = true;
            installPhase = ''
              runHook preInstall
              install -Dm755 "$src" "$out/bin/${projectName}"
              install -Dm644 ${./LICENSE} "$out/share/licenses/${projectName}/LICENSE"
              runHook postInstall
            '';
            meta = {
              mainProgram = projectName;
              license = pkgs.lib.licenses.eupl12;
              platforms = builtins.attrNames release.platforms;
            };
          };
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            gh
            git
            just
            nushell
            sandbox
          ];

          shellHook = ''
            echo ""
            echo "  chrome-cli Development Shell"
            echo "  ──────────────────────"
            echo "  nixpkgs      ${pkgs.lib.trivial.release}"
            echo "  go           ${goVersion} (docker)"
            echo ""
          '';
        };
      }
    );
}
