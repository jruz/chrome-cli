{
  description = "CLI tool for controlling Chrome via CDP";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    unstable.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, unstable, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        unstablePkgs = import unstable { inherit system; };
        sandboxPath = pkgs.lib.makeBinPath [
          unstablePkgs.bun
          pkgs.bash
          pkgs.coreutils
          pkgs.findutils
          pkgs.git
          pkgs.gnugrep
          pkgs.gnused
        ];
        sandbox = pkgs.writeShellScriptBin "sandbox" ''
          SELF_DIR="$(dirname "$(readlink -f "$0")")"
          ARGS=(
            --unshare-user
            --unshare-ipc
            --unshare-uts
            --unshare-cgroup
            --share-net
            --die-with-parent
            --ro-bind /nix /nix
            --ro-bind /etc/resolv.conf /etc/resolv.conf
            --ro-bind /etc/ssl /etc/ssl
            --ro-bind-try /etc/static /etc/static
            --ro-bind-try /etc/nix /etc/nix
            --ro-bind-try /run/current-system/sw /run/current-system/sw
            --symlink ${pkgs.coreutils}/bin/env /usr/bin/env
            --symlink ${pkgs.bash}/bin/bash /bin/sh
            --tmpfs "$HOME"
            --bind "$(pwd)" "$(pwd)"
            --bind /tmp /tmp
            --ro-bind "$(git rev-parse --git-common-dir)" "$(git rev-parse --git-common-dir)"
            --ro-bind-try "$HOME/.gitconfig" "$HOME/.gitconfig"
            --ro-bind-try "$HOME/.ssh/known_hosts" "$HOME/.ssh/known_hosts"
            --setenv PATH "${sandboxPath}:$SELF_DIR"
            --setenv HOME "$HOME"
            --dev /dev
            --proc /proc
          )
          ARGS+=(
            --bind-try "$HOME/.bun" "$HOME/.bun"
          )
          exec ${pkgs.bubblewrap}/bin/bwrap "''${ARGS[@]}" -- "$@"
        '';
        defaultPackages = with pkgs; [
          deadnix
          fd
          nixfmt
          sandbox
          statix
          woodpecker-cli
        ];
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = defaultPackages;

          shellHook = ''
            echo ""
            echo "  chrome-cli Dev Shell"
            echo "  ───────────────────────────"
            echo "  bun          ${unstablePkgs.bun.version} (sandbox)"
            echo ""
          '';
        };
      });
}
