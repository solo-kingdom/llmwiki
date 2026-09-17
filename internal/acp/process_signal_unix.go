//go:build unix

package acp

import "syscall"

func unixSignal(sig processSignal) syscall.Signal {
	return syscall.Signal(sig.number())
}
