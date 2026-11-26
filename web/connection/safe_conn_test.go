package connection

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// wsEchoServer upgrades every request and echoes each frame back.
func wsEchoServer(t *testing.T) *httptest.Server {
	t.Helper()
	var upgrader websocket.Upgrader
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			if err := conn.WriteMessage(mt, data); err != nil {
				return
			}
		}
	}))
}

func dialEcho(t *testing.T, server *httptest.Server) *SafeConn {
	t.Helper()
	url := "ws" + strings.TrimPrefix(server.URL, "http")
	conn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		t.Fatal(err)
	}
	return NewSafeConn(conn)
}

func TestSafeConnPingHandlerWritesPong(t *testing.T) {
	pong := make(chan string, 1)
	upgrader := websocket.Upgrader{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		conn.SetPongHandler(func(data string) error {
			pong <- data
			return nil
		})
		if err := conn.WriteControl(websocket.PingMessage, []byte("heartbeat"), time.Now().Add(time.Second)); err != nil {
			return
		}
		for {
			if _, _, err := conn.ReadMessage(); err != nil {
				return
			}
		}
	}))
	defer server.Close()
	sc := dialEcho(t, server)
	defer sc.Close()
	sc.SetPingHandler(func(data string) error {
		return sc.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(time.Second))
	})
	if err := sc.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	readDone := make(chan error, 1)
	go func() {
		_, _, err := sc.ReadMessage()
		readDone <- err
	}()

	select {
	case data := <-pong:
		if data != "heartbeat" {
			t.Fatalf("pong data = %q, want heartbeat", data)
		}
	case <-time.After(time.Second):
		t.Fatal("did not receive pong")
	}

	_ = sc.Close()
	<-readDone
}

func TestSafeConnJSONRoundTrip(t *testing.T) {
	server := wsEchoServer(t)
	defer server.Close()
	sc := dialEcho(t, server)
	defer sc.Close()

	want := "hello"
	if err := sc.WriteJSON(map[string]string{"message": want}); err != nil {
		t.Fatal(err)
	}

	var response map[string]string
	if err := sc.ReadJSON(&response); err != nil {
		t.Fatal(err)
	}
	if got := response["message"]; got != want {
		t.Fatalf("message = %q, want %q", got, want)
	}
}

func TestSafeConnPassesFramesThrough(t *testing.T) {
	server := wsEchoServer(t)
	defer server.Close()
	sc := dialEcho(t, server)
	defer sc.Close()

	if err := sc.WriteMessage(websocket.TextMessage, []byte("plain")); err != nil {
		t.Fatal(err)
	}
	_, data, err := sc.ReadMessage()
	if err != nil || string(data) != "plain" {
		t.Fatalf("read = %q err %v", data, err)
	}
}
