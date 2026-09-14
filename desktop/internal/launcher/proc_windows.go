//go:build windows

package launcher

import (
	"os/exec"
	"strconv"
	"syscall"
)

// Not exported by package syscall; same value as windows.CREATE_NO_WINDOW.
const createNoWindow = 0x08000000

func setProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: syscall.CREATE_NEW_PROCESS_GROUP | createNoWindow}
}

func terminate(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	_ = exec.Command("taskkill", "/T", "/F", "/PID", strconv.Itoa(cmd.Process.Pid)).Run()
}
