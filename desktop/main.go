package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	"github.com/KevinBonnoron/sirene/desktop/internal/launcher"
	"github.com/KevinBonnoron/sirene/server/sirene"
)

func main() {
	paths, err := launcher.Default()
	if err != nil {
		log.Fatal(err)
	}
	logFile, err := os.OpenFile(filepath.Join(paths.Log, "desktop.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		log.Fatal(err)
	}
	defer logFile.Close()
	log.SetOutput(io.MultiWriter(os.Stderr, logFile))

	inferencePort, err := launcher.ReservePort()
	if err != nil {
		log.Fatal(err)
	}
	serverPort, err := freePort()
	if err != nil {
		log.Fatal(err)
	}
	serverAddr := fmt.Sprintf("127.0.0.1:%d", serverPort)

	pb := sirene.New(sirene.Options{
		DataDir:      paths.PBData,
		InferenceURL: fmt.Sprintf("http://127.0.0.1:%d", inferencePort.Port()),
		UIDir:        os.Getenv("SIRENE_UI_DIR"),
	})
	go func() {
		if err := sirene.Serve(pb, serverAddr); err != nil {
			log.Printf("server stopped: %v", err)
		}
	}()
	if err := launcher.WaitHealthy(context.Background(), "http://"+serverAddr+"/api/health", 30*time.Second); err != nil {
		log.Fatal(err)
	}
	log.Printf("Sirene listening on http://%s", serverAddr)

	ctx, cancel := context.WithCancel(context.Background())
	var (
		procMu sync.Mutex
		proc   *launcher.Process
	)
	go func() {
		p, err := launcher.Bootstrap(ctx, paths, inferencePort, log.Printf)
		if err != nil {
			log.Printf("inference bootstrap failed: %v", err)
			return
		}
		procMu.Lock()
		proc = p
		procMu.Unlock()
	}()

	app := application.New(application.Options{
		Name:        "Sirene",
		Description: "Self-hosted multi-backend text-to-speech platform",
		Linux:       application.LinuxOptions{ProgramName: "sirene"},
		Mac:         application.MacOptions{ApplicationShouldTerminateAfterLastWindowClosed: true},
		OnShutdown: func() {
			cancel()
			procMu.Lock()
			if proc != nil {
				proc.Stop()
			}
			procMu.Unlock()
			sirene.Shutdown(pb)
		},
	})

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Sirene",
		Width:  1280,
		Height: 800,
		URL:    "http://" + serverAddr,
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// freePort asks the kernel for an unused loopback port; both the server and
// the inference worker need one up front (uvicorn takes --port).
func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}
