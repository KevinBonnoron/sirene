{
  description = "Sirene development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      desktopSystem = "x86_64-linux";
      desktopPkgs = nixpkgs.legacyPackages.${desktopSystem};
      version = "0.0.1";
      cliHashes = {
        "x86_64-linux"   = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        "aarch64-linux"  = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        "x86_64-darwin"  = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
        "aarch64-darwin" = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
      };
      cliAsset = system: {
        "x86_64-linux"   = "sirene-linux-x64";
        "aarch64-linux"  = "sirene-linux-arm64";
        "x86_64-darwin"  = "sirene-darwin-x64";
        "aarch64-darwin" = "sirene-darwin-arm64";
      }.${system};

      mkCli = system:
        let pkgs = nixpkgs.legacyPackages.${system};
            isLinux = pkgs.stdenv.hostPlatform.isLinux;
        in pkgs.stdenv.mkDerivation {
          pname = "sirene-cli";
          inherit version;

          src = pkgs.fetchurl {
            url = "https://github.com/KevinBonnoron/sirene/releases/download/v${version}/${cliAsset system}";
            hash = cliHashes.${system};
          };

          dontUnpack = true;
          # Bun --compile produces a statically-linked binary on macOS but a
          # dynamically-linked one on Linux. autoPatchelf on Linux only.
          nativeBuildInputs = pkgs.lib.optional isLinux pkgs.autoPatchelfHook;

          installPhase = ''
            runHook preInstall
            install -Dm755 $src $out/bin/sirene
            runHook postInstall
          '';

          meta = with pkgs.lib; {
            description = "Command-line client for Sirene TTS";
            homepage = "https://github.com/KevinBonnoron/sirene";
            license = licenses.mit;
            mainProgram = "sirene";
            platforms = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
          };
        };

      cliSystems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];

      gstPluginPath = desktopPkgs.lib.makeSearchPath "lib/gstreamer-1.0" (with desktopPkgs.gst_all_1; [ gstreamer gst-plugins-base gst-plugins-good ]);
      desktopLibs = with desktopPkgs; [
        webkitgtk_4_1
        gtk3
        glib
        glib-networking
        libsoup_3
        cairo
        pango
        gdk-pixbuf
        atk
        dbus
        libayatana-appindicator
        libx11
        libxcomposite
        libxdamage
        libxext
        libxfixes
        libxrandr
        gst_all_1.gstreamer
        gst_all_1.gst-plugins-base
        gst_all_1.gst-plugins-good
      ];

      desktopPackage = desktopPkgs.stdenv.mkDerivation {
        pname = "sirene";
        inherit version;

        src = desktopPkgs.fetchurl {
          url = "https://github.com/KevinBonnoron/sirene/releases/download/v${version}/stable-linux-x64-Sirene.tar.zst";
          hash = "sha256-zoIZ25VTl7oAifWNPSGYKmOmmG1aIMH15kZJWPZ7fF4=";
        };

        sourceRoot = "Sirene";

        nativeBuildInputs = with desktopPkgs; [ autoPatchelfHook makeWrapper zstd ];
        buildInputs = desktopLibs;
        autoPatchelfIgnoreMissingDeps = [ "libcrypt.so.1" ];

        installPhase = ''
          runHook preInstall
          chmod +x Resources/app/Resources/pocketbase
          mkdir -p $out/opt/sirene
          cp -r . $out/opt/sirene/
          mkdir -p $out/bin
          makeWrapper $out/opt/sirene/bin/launcher $out/bin/sirene \
            --set GST_PLUGIN_PATH "${gstPluginPath}"
          runHook postInstall
        '';

        meta = {
          description = "Self-hosted multi-backend text-to-speech platform";
          homepage = "https://github.com/KevinBonnoron/sirene";
          platforms = [ "x86_64-linux" ];
        };
      };

      forEach = systems: f: builtins.listToAttrs (map (s: { name = s; value = f s; }) systems);
    in {
      # Per-system CLI: `nix run github:KevinBonnoron/sirene#cli -- voice list`
      # works on Linux x64/arm64 and macOS x64/arm64.
      packages = forEach cliSystems (system: {
        cli = mkCli system;
      }) // {
        ${desktopSystem} = {
          # Default points at the desktop app on its only supported platform.
          default = desktopPackage;
          desktop = desktopPackage;
          cli = mkCli desktopSystem;
        };
      };

      apps = forEach cliSystems (system: {
        cli = {
          type = "app";
          program = "${(mkCli system)}/bin/sirene";
        };
      });

      devShells.${desktopSystem}.default = desktopPkgs.mkShell {
        packages = with desktopPkgs; [
          # runtime
          bun

          # db
          pocketbase

          # inference
          espeak-ng
          ffmpeg_6-full
          sox
          portaudio
          cmake
          pkg-config
          gcc
          uv
          patchelf
        ] ++ desktopLibs;

        LD_LIBRARY_PATH = desktopPkgs.lib.makeLibraryPath (desktopLibs ++ [ desktopPkgs.stdenv.cc.cc.lib desktopPkgs.zlib desktopPkgs.ffmpeg_6-full.lib ]);
        GST_PLUGIN_PATH = gstPluginPath;

        shellHook = ''
          echo "Sirene dev environment"

          # Auto-install Node dependencies
          if [ ! -d "$PWD/node_modules" ]; then
            echo "→ Installing Node dependencies..."
            bun install
          fi

          # Patch generic Linux binaries for NixOS (electrobun CLI)
          NIX_INTERP=$(patchelf --print-interpreter "$(which bun)" 2>/dev/null)
          if [ -n "$NIX_INTERP" ]; then
            for bin in \
              "$PWD/node_modules/electrobun/bin/electrobun" \
              "$PWD/desktop/node_modules/electrobun/bin/electrobun" \
              "$PWD/desktop/build/dev-linux-x64/Sirene-dev/bin/bun"; do
              if [ -f "$bin" ] && ! patchelf --print-interpreter "$bin" 2>/dev/null | grep -q nix; then
                patchelf --set-interpreter "$NIX_INTERP" "$bin" 2>/dev/null || true
              fi
            done
          fi

          # Auto-install Python dependencies on first use (base only - backends installed on demand)
          if [ ! -d "$PWD/.venv" ]; then
            echo "→ Setting up Python virtual environment..."
            uv venv --python 3.11 --seed .venv
            source .venv/bin/activate
            unset PYTHONPATH
            uv pip install -e './inference'
          else
            source .venv/bin/activate
            unset PYTHONPATH
          fi

        '';
      };
    };
}
