{
  description = "Sirene development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
      version = "0.0.1";
      gstPluginPath = pkgs.lib.makeSearchPath "lib/gstreamer-1.0" (with pkgs.gst_all_1; [ gstreamer gst-plugins-base gst-plugins-good ]);
      desktopLibs = with pkgs; [
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
    in {
      packages.${system}.default = pkgs.stdenv.mkDerivation {
        pname = "sirene";
        inherit version;

        src = pkgs.fetchurl {
          url = "https://github.com/KevinBonnoron/sirene/releases/download/v${version}/stable-linux-x64-Sirene.tar.zst";
          hash = "sha256-LEsgTD/2NWXUG4yKHI19o8Od5HzKFh3tTQbfP6zl2js=";
        };

        sourceRoot = "Sirene";

        nativeBuildInputs = with pkgs; [ autoPatchelfHook makeWrapper zstd ];
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

      devShells.${system}.default = pkgs.mkShell {
        packages = with pkgs; [
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

        LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath (desktopLibs ++ [ pkgs.stdenv.cc.cc.lib pkgs.zlib pkgs.ffmpeg_6-full.lib ]);
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

          # Auto-install Python dependencies on first use (base only — backends installed on demand)
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
