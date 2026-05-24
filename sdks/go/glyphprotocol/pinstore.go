package glyphprotocol

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// Pin mirrors @glyphp/types.Pin.
type Pin struct {
	ToolName     string         `json:"toolName"`
	ApprovedAt   string         `json:"approvedAt"`
	Card         map[string]any `json:"card"`
	RevokedAt    string         `json:"revokedAt,omitempty"`
	RevokeReason string         `json:"revokeReason,omitempty"`
}

// PinStore is the contract every consumer pin backend implements.
type PinStore interface {
	Get(toolName string) (*Pin, error)
	Put(pin Pin) error
	All() ([]Pin, error)
}

// MemoryPinStore is an in-process store, suitable for tests.
type MemoryPinStore struct {
	mu   sync.RWMutex
	pins map[string]Pin
}

func NewMemoryPinStore() *MemoryPinStore {
	return &MemoryPinStore{pins: map[string]Pin{}}
}

func (m *MemoryPinStore) Get(toolName string) (*Pin, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if p, ok := m.pins[toolName]; ok {
		return &p, nil
	}
	return nil, nil
}

func (m *MemoryPinStore) Put(pin Pin) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.pins[pin.ToolName] = pin
	return nil
}

func (m *MemoryPinStore) All() ([]Pin, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Pin, 0, len(m.pins))
	for _, p := range m.pins {
		out = append(out, p)
	}
	return out, nil
}

// FilePinStore persists pins to a JSON file with atomic writes.
type FilePinStore struct {
	Path string
	mu   sync.Mutex
}

type filePayload struct {
	Version int   `json:"version"`
	Pins    []Pin `json:"pins"`
}

func (f *FilePinStore) load() (map[string]Pin, error) {
	out := map[string]Pin{}
	raw, err := os.ReadFile(f.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return out, nil
		}
		return nil, err
	}
	var payload filePayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	for _, p := range payload.Pins {
		out[p.ToolName] = p
	}
	return out, nil
}

func (f *FilePinStore) Get(toolName string) (*Pin, error) {
	pins, err := f.load()
	if err != nil {
		return nil, err
	}
	if p, ok := pins[toolName]; ok {
		return &p, nil
	}
	return nil, nil
}

func (f *FilePinStore) All() ([]Pin, error) {
	pins, err := f.load()
	if err != nil {
		return nil, err
	}
	out := make([]Pin, 0, len(pins))
	for _, p := range pins {
		out = append(out, p)
	}
	return out, nil
}

func (f *FilePinStore) Put(pin Pin) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	pins, err := f.load()
	if err != nil {
		return err
	}
	pins[pin.ToolName] = pin
	payload := filePayload{Version: 1, Pins: make([]Pin, 0, len(pins))}
	for _, p := range pins {
		payload.Pins = append(payload.Pins, p)
	}
	body, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	dir := filepath.Dir(f.Path)
	if dir == "" {
		dir = "."
	}
	tmp, err := os.CreateTemp(dir, ".pins-*.json")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(body); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), f.Path)
}
