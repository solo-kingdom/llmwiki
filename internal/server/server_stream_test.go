package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestIsIngestSessionStream(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/s1/messages?stream=1", nil)
	req.Header.Set("Accept", "text/event-stream")
	if !isIngestSessionStream(req) {
		t.Fatal("expected stream request to be detected")
	}

	req2 := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/s1/messages", nil)
	if isIngestSessionStream(req2) {
		t.Fatal("expected non-stream POST to be excluded")
	}
}

func TestTimeoutUnlessStreamRoutesToInnerHandler(t *testing.T) {
	mw := timeoutUnlessStream(60)
	var innerCalled bool
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		innerCalled = true
	})

	stream := httptest.NewRequest(http.MethodPost, "/api/v1/ingest/sessions/s1/messages?stream=1", nil)
	stream.Header.Set("Accept", "text/event-stream")
	rec := httptest.NewRecorder()
	mw(inner).ServeHTTP(rec, stream)
	if !innerCalled {
		t.Fatal("stream route should reach inner handler")
	}
}
