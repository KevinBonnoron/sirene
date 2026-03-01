{
  description = "Sirene development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      system = "x86_64-linux";
      pkgs = nixpkgs.legacyPackages.${system};
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
      ];
    in {
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
          python311
          uv
          patchelf
        ] ++ desktopLibs;

        LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath (desktopLibs ++ [ pkgs.stdenv.cc.cc.lib pkgs.zlib pkgs.ffmpeg_6-full.lib ]);

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

          # Auto-install Python dependencies on first use
          if [ ! -d "$PWD/.venv" ]; then
            echo "→ Setting up Python virtual environment..."
            uv venv .venv
            source .venv/bin/activate
            unset PYTHONPATH
            uv pip install -e './inference[cpu]'
            uv pip install 'fish-speech==0.1.0' --no-deps
            PIP="uv pip" ./inference/setup.sh
          else
            source .venv/bin/activate
            unset PYTHONPATH
          fi

        '';
      };
    };
}
