.PHONY: build run test lint clean install build-web build-go build-linux-amd64 build-linux-arm64 build-darwin-amd64 build-darwin-arm64

# Binary name
BINARY := lwiki

# Go parameters
GOCMD := go
GOBUILD := $(GOCMD) build
GOTEST := $(GOCMD) test
GOLINT := golangci-lint
GOMOD := $(GOCMD) mod

# Version info (injected via ldflags)
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")
BUILD_DATE ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")

LDFLAGS := -s -w \
	-X main.Version=$(VERSION) \
	-X main.Commit=$(COMMIT) \
	-X main.BuildDate=$(BUILD_DATE)

# Web frontend
WEB_DIR := web
WEB_BUILD := $(WEB_DIR)/dist

## Build targets
build: build-web build-go

build-go:
	$(GOBUILD) -ldflags "$(LDFLAGS)" -o $(BINARY) ./cmd/llmwiki/

build-web:
	cd $(WEB_DIR) && npm run build

## Run targets
run: build
	./$(BINARY) serve

dev:
	$(GOCMD) run ./cmd/llmwiki/ serve

## Test targets
test:
	$(GOTEST) -race -count=1 ./...

test-cover:
	$(GOTEST) -race -count=1 -coverprofile=coverage.out ./...
	$(GOCMD) tool cover -html=coverage.out -o coverage.html

## Lint
lint:
	$(GOLINT) run ./...

## Dependency management
tidy:
	$(GOMOD) tidy

## Cross-compilation targets
build-linux-amd64:
	GOOS=linux GOARCH=amd64 $(GOBUILD) -ldflags "$(LDFLAGS)" -o $(BINARY)-linux-amd64 ./cmd/llmwiki/

build-linux-arm64:
	GOOS=linux GOARCH=arm64 $(GOBUILD) -ldflags "$(LDFLAGS)" -o $(BINARY)-linux-arm64 ./cmd/llmwiki/

build-darwin-amd64:
	GOOS=darwin GOARCH=amd64 $(GOBUILD) -ldflags "$(LDFLAGS)" -o $(BINARY)-darwin-amd64 ./cmd/llmwiki/

build-darwin-arm64:
	GOOS=darwin GOARCH=arm64 $(GOBUILD) -ldflags "$(LDFLAGS)" -o $(BINARY)-darwin-arm64 ./cmd/llmwiki/

## Clean
clean:
	rm -f $(BINARY) $(BINARY)-linux-amd64 $(BINARY)-linux-arm64 $(BINARY)-darwin-amd64 $(BINARY)-darwin-arm64
	rm -f coverage.out coverage.html
	rm -rf $(WEB_BUILD)

## Install
PREFIX ?= $(HOME)/.local

install: build
	install -d $(PREFIX)/bin
	install -m 755 $(BINARY) $(PREFIX)/bin/$(BINARY)

## Uninstall
uninstall:
	rm -f $(PREFIX)/bin/$(BINARY)

## Help
help:
	@echo "Available targets:"
	@echo "  build       - Build web frontend + Go binary"
	@echo "  build-go    - Build Go binary only"
	@echo "  build-web   - Build web frontend only"
	@echo "  run         - Build and start server"
	@echo "  dev         - Run with go run (no web build)"
	@echo "  test        - Run all tests with race detector"
	@echo "  test-cover  - Run tests with coverage report"
	@echo "  lint        - Run golangci-lint"
	@echo "  tidy        - Tidy Go modules"
	@echo "  clean       - Remove build artifacts"
	@echo "  install     - Install binary to PREFIX/bin (default: ~/.local/bin)"
	@echo "  uninstall   - Remove installed binary"
