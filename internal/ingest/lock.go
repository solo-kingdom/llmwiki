package ingest

import (
	"log"
	"strings"
	"sync"
	"time"
)

var lockThreshold = 5 * time.Second

type LockStats struct {
	Path         string
	WaitDuration time.Duration
	HoldDuration time.Duration
}

type PageLockManager struct {
	mu    sync.Mutex
	locks map[string]*pageLock
	stats chan LockStats
}

type pageLock struct {
	mu        sync.Mutex
	refCount  int
	waitStart time.Time
	lockTime  time.Time
}

func NewPageLockManager() *PageLockManager {
	return &PageLockManager{
		locks: make(map[string]*pageLock),
		stats: make(chan LockStats, 256),
	}
}

func (plm *PageLockManager) Lock(path string) {
	normalized := normalizePath(path)
	waitStart := time.Now()

	plm.mu.Lock()
	entry, ok := plm.locks[normalized]
	if !ok {
		entry = &pageLock{waitStart: waitStart}
		plm.locks[normalized] = entry
	}
	entry.refCount++
	plm.mu.Unlock()

	entry.mu.Lock()

	waitDuration := time.Since(waitStart)
	entry.lockTime = time.Now()

	if waitDuration > lockThreshold {
		log.Printf("[lock] %s: wait exceeded threshold (%v)", normalized, waitDuration)
	}

	select {
	case plm.stats <- LockStats{Path: normalized, WaitDuration: waitDuration}:
	default:
	}
}

func (plm *PageLockManager) Unlock(path string) {
	normalized := normalizePath(path)

	plm.mu.Lock()
	entry, ok := plm.locks[normalized]
	if !ok {
		plm.mu.Unlock()
		return
	}

	holdDuration := time.Since(entry.lockTime)
	if holdDuration > lockThreshold {
		log.Printf("[lock] %s: hold exceeded threshold (%v)", normalized, holdDuration)
	}

	select {
	case plm.stats <- LockStats{Path: normalized, HoldDuration: holdDuration}:
	default:
	}

	entry.refCount--
	if entry.refCount <= 0 {
		delete(plm.locks, normalized)
	}
	plm.mu.Unlock()

	entry.mu.Unlock()
}

func (plm *PageLockManager) Stats() <-chan LockStats {
	return plm.stats
}

func (plm *PageLockManager) ActiveLocks() []string {
	plm.mu.Lock()
	defer plm.mu.Unlock()
	paths := make([]string, 0, len(plm.locks))
	for p := range plm.locks {
		paths = append(paths, p)
	}
	return paths
}

func normalizePath(p string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimLeft(p, "/"), "/"))
}
