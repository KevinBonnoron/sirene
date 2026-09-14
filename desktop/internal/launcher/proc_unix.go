//go:build !windows

package launcher

import (
	"os/exec"
	"syscall"
)

// A process group lets Stop take uvicorn's children (backend workers) down
// with it instead of leaving orphans behind.
func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func terminate(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	if pgid, err := syscall.Getpgid(cmd.Process.Pid); err == nil {
		_ = syscall.Kill(-pgid, syscall.SIGTERM)
		return
	}
	_ = cmd.Process.Signal(syscall.SIGTERM)
}
