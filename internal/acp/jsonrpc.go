package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
)

const rpcMaxLineBytes = 1024 * 1024

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	ID      any             `json:"id,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	ID      any             `json:"id,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

type NotificationHandler func(method string, params json.RawMessage)
type RequestHandler func(ctx context.Context, method string, params json.RawMessage) (any, error)

var errRPCMethodNotFound = errors.New("JSON-RPC method not found")

type conn struct {
	proc *process

	writeMu sync.Mutex
	nextID  int64

	pendingMu sync.Mutex
	pending   map[int64]chan rpcResponse
	readErr   error
	done      chan struct{}
	closeOnce sync.Once

	handlerMu           sync.RWMutex
	notificationHandler NotificationHandler
	requestHandler      RequestHandler
}

func newConn(proc *process) *conn {
	c := &conn{
		proc:    proc,
		pending: map[int64]chan rpcResponse{},
		done:    make(chan struct{}),
	}
	go c.readLoop()
	return c
}

func (c *conn) setNotificationHandler(handler NotificationHandler) {
	c.handlerMu.Lock()
	defer c.handlerMu.Unlock()
	c.notificationHandler = handler
}

func (c *conn) setRequestHandler(handler RequestHandler) {
	c.handlerMu.Lock()
	defer c.handlerMu.Unlock()
	c.requestHandler = handler
}

func (c *conn) readLoop() {
	scanner := bufio.NewScanner(c.proc.stdout)
	scanner.Buffer(make([]byte, 64*1024), rpcMaxLineBytes)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		var msg rpcMessage
		if err := json.Unmarshal(line, &msg); err != nil {
			c.fail(fmt.Errorf("decode ACP JSON-RPC message: %w", err))
			return
		}
		switch {
		case msg.Method == "" && msg.ID != nil:
			c.dispatchResponse(msg)
		case msg.Method != "" && msg.ID == nil:
			c.dispatchNotification(msg)
		case msg.Method != "":
			go c.dispatchRequest(msg)
		default:
			c.fail(fmt.Errorf("invalid ACP JSON-RPC message"))
			return
		}
	}
	if err := scanner.Err(); err != nil {
		c.fail(fmt.Errorf("read ACP JSON-RPC stream: %w", err))
		return
	}
	c.fail(io.EOF)
}

func (c *conn) dispatchResponse(msg rpcMessage) {
	id, ok := rpcIDInt64(msg.ID)
	if !ok {
		return
	}
	c.pendingMu.Lock()
	ch := c.pending[id]
	delete(c.pending, id)
	c.pendingMu.Unlock()
	if ch != nil {
		ch <- rpcResponse{ID: msg.ID, Result: msg.Result, Error: msg.Error}
	}
}

func (c *conn) dispatchNotification(msg rpcMessage) {
	c.handlerMu.RLock()
	handler := c.notificationHandler
	c.handlerMu.RUnlock()
	if handler != nil {
		handler(msg.Method, msg.Params)
	}
}

func (c *conn) dispatchRequest(msg rpcMessage) {
	c.handlerMu.RLock()
	handler := c.requestHandler
	c.handlerMu.RUnlock()
	if handler == nil {
		_ = c.writeResponse(rpcResponse{JSONRPC: "2.0", ID: msg.ID, Error: &rpcError{Code: -32601, Message: "Method not found"}})
		return
	}
	result, err := handler(context.Background(), msg.Method, msg.Params)
	if err != nil {
		code := -32603
		if errors.Is(err, errRPCMethodNotFound) {
			code = -32601
		}
		_ = c.writeResponse(rpcResponse{JSONRPC: "2.0", ID: msg.ID, Error: &rpcError{Code: code, Message: err.Error()}})
		return
	}
	raw, err := json.Marshal(result)
	if err != nil {
		_ = c.writeResponse(rpcResponse{JSONRPC: "2.0", ID: msg.ID, Error: &rpcError{Code: -32603, Message: err.Error()}})
		return
	}
	_ = c.writeResponse(rpcResponse{JSONRPC: "2.0", ID: msg.ID, Result: raw})
}

func (c *conn) Call(ctx context.Context, method string, params any, out any) error {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-c.done:
		return c.currentReadErr()
	default:
	}
	c.writeMu.Lock()
	c.nextID++
	id := c.nextID
	c.writeMu.Unlock()

	rawParams, err := marshalParams(params)
	if err != nil {
		return err
	}
	ch := make(chan rpcResponse, 1)
	c.pendingMu.Lock()
	c.pending[id] = ch
	c.pendingMu.Unlock()

	req := rpcRequest{JSONRPC: "2.0", Method: method, ID: id, Params: rawParams}
	if err := c.write(req); err != nil {
		c.removePending(id)
		return err
	}

	select {
	case resp := <-ch:
		if resp.Error != nil {
			return fmt.Errorf("ACP %s: %s", method, resp.Error.Message)
		}
		if out == nil || len(resp.Result) == 0 {
			return nil
		}
		if err := json.Unmarshal(resp.Result, out); err != nil {
			return fmt.Errorf("decode %s response: %w", method, err)
		}
		return nil
	case <-ctx.Done():
		c.removePending(id)
		return ctx.Err()
	case <-c.done:
		c.removePending(id)
		return c.currentReadErr()
	}
}

func (c *conn) Notify(method string, params any) error {
	rawParams, err := marshalParams(params)
	if err != nil {
		return err
	}
	return c.write(rpcRequest{JSONRPC: "2.0", Method: method, Params: rawParams})
}

func (c *conn) writeResponse(resp rpcResponse) error {
	return c.write(resp)
}

func (c *conn) write(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	return c.proc.write(data)
}

func (c *conn) removePending(id int64) {
	c.pendingMu.Lock()
	delete(c.pending, id)
	c.pendingMu.Unlock()
}

func (c *conn) fail(err error) {
	c.closeOnce.Do(func() {
		c.pendingMu.Lock()
		c.readErr = err
		pending := c.pending
		c.pending = map[int64]chan rpcResponse{}
		c.pendingMu.Unlock()
		close(c.done)
		for _, ch := range pending {
			select {
			case ch <- rpcResponse{Error: &rpcError{Code: -32000, Message: err.Error()}}:
			default:
			}
		}
	})
}

func (c *conn) currentReadErr() error {
	c.pendingMu.Lock()
	defer c.pendingMu.Unlock()
	if c.readErr == nil {
		return io.EOF
	}
	return c.readErr
}

func marshalParams(params any) (json.RawMessage, error) {
	if params == nil {
		return nil, nil
	}
	raw, err := json.Marshal(params)
	if err != nil {
		return nil, fmt.Errorf("marshal JSON-RPC params: %w", err)
	}
	return raw, nil
}

func rpcIDInt64(id any) (int64, bool) {
	switch v := id.(type) {
	case float64:
		return int64(v), v == float64(int64(v))
	case int64:
		return v, true
	case json.Number:
		n, err := v.Int64()
		return n, err == nil
	default:
		return 0, false
	}
}
