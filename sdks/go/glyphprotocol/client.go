package glyphprotocol

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const protocolVersion = "1.0"

// Client is a minimal HTTP client for a Glyph server. Mirrors `Client` from
// the TypeScript and Python SDKs.
type Client struct {
	BaseURL    string
	AuthToken  string
	HTTPClient *http.Client
}

// NewClient builds a Client with sensible defaults (30s timeout).
func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL:    trimTrailing(baseURL),
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}
}

func trimTrailing(s string) string {
	for len(s) > 0 && s[len(s)-1] == '/' {
		s = s[:len(s)-1]
	}
	return s
}

func (c *Client) do(ctx context.Context, method, path string, body any) (*http.Response, error) {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(buf)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, reader)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("content-type", "application/json")
	}
	if c.AuthToken != "" {
		req.Header.Set("authorization", "Bearer "+c.AuthToken)
	}
	return c.HTTPClient.Do(req)
}

func decode(res *http.Response, into any) error {
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		buf, _ := io.ReadAll(res.Body)
		return fmt.Errorf("glyph: HTTP %d: %s", res.StatusCode, string(buf))
	}
	return json.NewDecoder(res.Body).Decode(into)
}

// Health returns the /health response body.
func (c *Client) Health(ctx context.Context) (map[string]any, error) {
	res, err := c.do(ctx, "GET", "/health", nil)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	return out, decode(res, &out)
}

// Handshake performs POST /handshake.
func (c *Client) Handshake(ctx context.Context, consumerID string) (map[string]any, error) {
	res, err := c.do(ctx, "POST", "/handshake", map[string]any{
		"protocolVersion":    protocolVersion,
		"consumerId":         consumerID,
		"contextBudget":      50000,
		"preferredCardDepth": "standard",
	})
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	return out, decode(res, &out)
}

// Lexicon fetches /lexicon.
func (c *Client) Lexicon(ctx context.Context) ([]map[string]any, error) {
	res, err := c.do(ctx, "GET", "/lexicon", nil)
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	return out, decode(res, &out)
}

// GetCard fetches /glyphs/:name?depth=rich (or your override).
func (c *Client) GetCard(ctx context.Context, name, depth string) (map[string]any, error) {
	if depth == "" {
		depth = "rich"
	}
	res, err := c.do(ctx, "GET", "/glyphs/"+url.PathEscape(name)+"?depth="+url.QueryEscape(depth), nil)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	return out, decode(res, &out)
}

// GetKeyRegistry returns the server's KeyRegistry, or (nil, nil) on 404.
func (c *Client) GetKeyRegistry(ctx context.Context) (map[string]any, error) {
	res, err := c.do(ctx, "GET", "/keys", nil)
	if err != nil {
		return nil, err
	}
	if res.StatusCode == 404 {
		res.Body.Close()
		return nil, nil
	}
	out := map[string]any{}
	return out, decode(res, &out)
}

// Prepare obtains a confirmation ticket for a glyph that requires one.
func (c *Client) Prepare(ctx context.Context, name string, input map[string]any) (map[string]any, error) {
	res, err := c.do(ctx, "POST", "/glyphs/"+url.PathEscape(name)+"/prepare", map[string]any{"input": input})
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	return out, decode(res, &out)
}

// CallOptions configures a Call.
type CallOptions struct {
	ConfirmationToken string
	CallID            string
}

// Call performs POST /glyphs/:name/call and returns the sealed envelope.
func (c *Client) Call(ctx context.Context, name string, input map[string]any, opts CallOptions) (map[string]any, error) {
	body := map[string]any{"input": input}
	if opts.ConfirmationToken != "" {
		body["confirmationToken"] = opts.ConfirmationToken
	}
	if opts.CallID != "" {
		body["callId"] = opts.CallID
	}
	res, err := c.do(ctx, "POST", "/glyphs/"+url.PathEscape(name)+"/call", body)
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	return out, decode(res, &out)
}

// ErrNotFound is returned by helpers that decode an explicit 404.
var ErrNotFound = errors.New("glyph: not found")
