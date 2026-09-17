package acp

import "errors"

// processSignal is the platform-neutral subset of POSIX signals used by
// Terminate. The numeric values are the POSIX signal numbers, so they map to
// syscall.Signal on every Unix target without importing a platform package
// here.
type processSignal int

const (
	signalTerm processSignal = 15
	signalKill processSignal = 9
)

func (s processSignal) number() int { return int(s) }

// errProcessGone is the platform-neutral form of ESRCH: the target already
// exited, so there is nothing left to clean up.
var errProcessGone = errors.New("process already gone")
