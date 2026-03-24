{ stdenv, lib, fetchurl, patchelf }:

let
  version = "0.1.0";
  base = "https://codeberg.org/jruz/chrome-cli/releases/download/v${version}";

  sources = {
    x86_64-linux = fetchurl {
      url = "${base}/chrome-cli-linux-x64";
      hash = "sha256:0l7aff757pkhwv46s46c4gdfvpf7dlr72bgvg5xdyzs4p092w9dd";
    };
    aarch64-linux = fetchurl {
      url = "${base}/chrome-cli-linux-arm64";
      hash = "sha256:185iy5yrgdb5q2x95syvaywxnmmr4cim68fy14saaxgjiaaa8b9q";
    };
    x86_64-darwin = fetchurl {
      url = "${base}/chrome-cli-darwin-x64";
      hash = "sha256:14ab2xa1w6x0fzf4gyyninkbdj5h88qflhnmvw8cki10d94077w6";
    };
    aarch64-darwin = fetchurl {
      url = "${base}/chrome-cli-darwin-arm64";
      hash = "sha256:02kjhiy0sx2zzs33vyr3qkgahgfz4ymhbyrp0yjb64py0dxi0jnm";
    };
  };

  src = sources.${stdenv.hostPlatform.system}
    or (throw "unsupported system: ${stdenv.hostPlatform.system}");

in stdenv.mkDerivation {
  pname = "chrome-cli";
  inherit version;

  dontUnpack = true;
  dontPatchShebangs = true;
  dontStrip = true;

  nativeBuildInputs = lib.optionals stdenv.hostPlatform.isLinux [ patchelf ];

  installPhase = ''
    install -Dm755 ${src} $out/bin/chrome-cli
  '' + lib.optionalString stdenv.hostPlatform.isLinux ''
    patchelf --set-interpreter "$(cat $NIX_CC/nix-support/dynamic-linker)" $out/bin/chrome-cli
  '';
}
