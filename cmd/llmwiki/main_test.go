package main

import "testing"

func TestBuild(t *testing.T) {
	if Version == "" {
		t.Fatal("Version should be set")
	}
	if newRootCmd() == nil {
		t.Fatal("root command should not be nil")
	}
}
