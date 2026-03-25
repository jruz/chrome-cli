{ stdenv, lib, fetchurl, patchelf }:

let
  version = "0.1.0";
  base = "https://codeberg.org/jruz/chrome-cli/releases/download/v${version}";
  hashes = import ./hashes.nix;

  sources = {
    x86_64-linux = fetchurl {
      url = "${base}/chrome-cli-linux-x64";
      hash = hashes.x86_64-linux;
    };
    aarch64-linux = fetchurl {
      url = "${base}/chrome-cli-linux-arm64";
      hash = hashes.aarch64-linux;
    };
    x86_64-darwin = fetchurl {
      url = "${base}/chrome-cli-darwin-x64";
      hash = hashes.x86_64-darwin;
    };
    aarch64-darwin = fetchurl {
      url = "${base}/chrome-cli-darwin-arm64";
      hash = hashes.aarch64-darwin;
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
