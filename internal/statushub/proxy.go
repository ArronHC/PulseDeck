package statushub

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/komari-monitor/komari/database/models"
)

var errProxyCore = errors.New("no proxy core found; install mihomo or sing-box on the server PATH")

var proxyCoreNames = [...]string{"mihomo", "sing-box"}

type ProxyCapabilities struct {
	HasProxyCore bool     `json:"has_proxy_core"`
	ProxyCores   []string `json:"proxy_cores"`
}

func (s *Service) ProxyCapabilities() ProxyCapabilities {
	capabilities := ProxyCapabilities{ProxyCores: []string{}}
	for _, name := range proxyCoreNames {
		if _, err := exec.LookPath(name); err == nil {
			capabilities.ProxyCores = append(capabilities.ProxyCores, name)
		}
	}
	capabilities.HasProxyCore = len(capabilities.ProxyCores) > 0
	return capabilities
}

func proxyURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "socks5" && u.Scheme != "socks5h") {
		return nil, InputError("proxy_url must be an HTTP, HTTPS, or SOCKS5 URL")
	}
	return u, nil
}

func nativeProxy(n models.SubNode) (*url.URL, error) {
	if n.ConfigKind == "uri" {
		u, err := url.Parse(n.RawConfig)
		if err != nil {
			return nil, InputError("invalid proxy node address")
		}
		u.Scheme = strings.ToLower(u.Scheme)
		if u.Scheme == "socks" {
			u.Scheme = "socks5"
		}
		u.Host, u.Path, u.RawPath, u.RawQuery, u.Fragment = net.JoinHostPort(n.Host, strconv.Itoa(n.Port)), "", "", "", ""
		return proxyURL(u.String())
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(n.RawConfig), &config); err != nil {
		return nil, InputError("invalid proxy node configuration")
	}
	scheme := n.Protocol
	if n.Protocol == "http" && tlsEnabled(config["tls"]) {
		scheme = "https"
	}
	target := &url.URL{Scheme: scheme, Host: net.JoinHostPort(n.Host, strconv.Itoa(n.Port))}
	if user, password := asString(config["username"]), asString(config["password"]); user != "" || password != "" {
		target.User = url.UserPassword(user, password)
	}
	return target, nil
}

func tlsEnabled(config any) bool {
	switch cfg := config.(type) {
	case bool:
		return cfg
	case map[string]any:
		return asBool(cfg["enabled"])
	}
	return false
}

func asBool(v any) bool {
	switch value := v.(type) {
	case bool:
		return value
	case string:
		return value == "true" || value == "1"
	}
	return false
}

func (s *Service) clientForProxy(proxy *url.URL) (*http.Client, func()) {
	client := *s.http
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyURL(proxy)
	client.Transport = transport
	return &client, transport.CloseIdleConnections
}

func (s *Service) clientForNode(ctx context.Context, n models.SubNode) (*http.Client, func(), error) {
	if n.Protocol == "http" || n.Protocol == "socks5" {
		p, err := nativeProxy(n)
		if err != nil {
			return nil, nil, err
		}
		client, closeClient := s.clientForProxy(p)
		return client, closeClient, nil
	}
	p, stopCore, err := startCore(ctx, n)
	if err != nil {
		return nil, nil, err
	}
	client, closeClient := s.clientForProxy(p)
	return client, func() {
		closeClient()
		stopCore()
	}, nil
}

func startCore(ctx context.Context, n models.SubNode) (*url.URL, func(), error) {
	names := proxyCoreNames
	if n.ConfigKind == "sing-box" {
		names[0], names[1] = names[1], names[0]
	}
	installed, supported := false, false
	for _, name := range names {
		path, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		installed = true
		outbound := coreOutbound(n, name)
		if outbound == nil {
			continue
		}
		supported = true
		p, stop, err := runCore(ctx, name, path, outbound)
		if err == nil {
			return p, stop, nil
		}
		if ctx.Err() != nil {
			return nil, nil, ctx.Err()
		}
	}
	switch {
	case !installed:
		return nil, nil, errProxyCore
	case !supported:
		return nil, nil, InputError("installed proxy core cannot use this configuration; install the matching core or import a native configuration")
	default:
		return nil, nil, InputError("proxy core failed to start; verify the installed core version and proxy configuration")
	}
}

func runCore(ctx context.Context, name, path string, outbound map[string]any) (*url.URL, func(), error) {
	dir, err := os.MkdirTemp("", "komari-proxy-")
	if err != nil {
		return nil, nil, err
	}
	ctx, cancel := context.WithCancel(ctx)
	cleanup := func() {
		cancel()
		_ = os.RemoveAll(dir)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		cleanup()
		return nil, nil, err
	}
	addr := listener.Addr().String()
	port := listener.Addr().(*net.TCPAddr).Port
	cfg, args := coreConfig(name, dir, port, outbound)
	configPath := filepath.Join(dir, "config.json")
	body, err := json.Marshal(cfg)
	if err == nil {
		err = os.WriteFile(configPath, body, 0600)
	}
	_ = listener.Close()
	if err != nil {
		cleanup()
		return nil, nil, err
	}

	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		cleanup()
		return nil, nil, err
	}
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	stop := func() {
		cancel()
		<-done
		cleanup()
	}
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(40 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			stop()
			return nil, nil, ctx.Err()
		case <-done:
			stop()
			return nil, nil, errors.New("proxy core exited before its listener started")
		case <-timer.C:
			stop()
			return nil, nil, errors.New("proxy core listener timed out")
		case <-ticker.C:
			dialer := net.Dialer{Timeout: 100 * time.Millisecond}
			if conn, err := dialer.DialContext(ctx, "tcp", addr); err == nil {
				_ = conn.Close()
				return &url.URL{Scheme: "socks5", Host: addr}, stop, nil
			}
		}
	}
}

func coreConfig(core, dir string, port int, outbound map[string]any) (map[string]any, []string) {
	path := filepath.Join(dir, "config.json")
	if core == "mihomo" {
		outbound["name"] = "node"
		return map[string]any{
			"socks-port": port, "bind-address": "127.0.0.1", "allow-lan": false, "mode": "rule", "log-level": "silent",
			"proxies": []any{outbound}, "rules": []string{"MATCH,node"},
		}, []string{"-d", dir, "-f", path}
	}
	outbound["tag"] = "node"
	return map[string]any{
		"log":       map[string]any{"disabled": true},
		"inbounds":  []any{map[string]any{"type": "socks", "listen": "127.0.0.1", "listen_port": port}},
		"outbounds": []any{outbound}, "route": map[string]any{"final": "node"},
	}, []string{"run", "-c", path}
}

func coreOutbound(n models.SubNode, core string) map[string]any {
	var config map[string]any
	if n.ConfigKind == "clash" || n.ConfigKind == "sing-box" {
		if err := json.Unmarshal([]byte(n.RawConfig), &config); err != nil {
			return nil
		}
		if n.ConfigKind == "clash" && core == "mihomo" {
			// A single outbound cannot use links to other configured proxies.
			delete(config, "dialer-proxy")
			if !builtInPlugin(asString(config["plugin"])) {
				return nil
			}
			config["server"], config["port"] = n.Host, n.Port
			return config
		}
		if n.ConfigKind == "sing-box" && core == "sing-box" {
			delete(config, "detour")
			if !builtInPlugin(asString(config["plugin"])) {
				return nil
			}
			config["server"], config["server_port"] = n.Host, n.Port
			return config
		}
	}
	if n.Protocol == "ssr" {
		if core == "sing-box" {
			return nil
		}
		if config != nil && n.ConfigKind == "clash" {
			return config
		}
		return ssrOutbound(n)
	}
	p, ok := proxyOptionsFor(n, config)
	if !ok {
		return nil
	}
	if core == "mihomo" {
		return p.mihomo(n)
	}
	return p.singbox(n)
}

func builtInPlugin(name string) bool {
	switch name {
	case "", "obfs", "obfs-local", "simple-obfs", "v2ray-plugin", "shadow-tls", "restls":
		return true
	default:
		return false
	}
}

type proxyOptions struct {
	uuid, password, cipher, flow      string
	network, path, host, service, sni string
	plugin, pluginOpts, obfs, obfsKey string
	publicKey, shortID, fingerprint   string
	alpn                              []string
	alterID                           int
	tls, insecure                     bool
}

func proxyOptionsFor(n models.SubNode, config map[string]any) (proxyOptions, bool) {
	var p proxyOptions
	switch n.ConfigKind {
	case "vmess-json":
		if json.Unmarshal([]byte(n.RawConfig), &config) != nil {
			return p, false
		}
		p.uuid, p.cipher, p.alterID = asString(config["id"]), asString(config["scy"]), asPort(config["aid"])
		p.network, p.path, p.host = asString(config["net"]), asString(config["path"]), asString(config["host"])
		p.tls, p.sni = asString(config["tls"]) == "tls", asString(config["sni"])
		p.fingerprint = asString(config["fp"])
		p.alpn = stringList(config["alpn"])
		if p.network == "grpc" {
			p.service = p.path
		}
	case "uri":
		p = uriOptions(n)
	case "clash":
		p = clashOptions(config)
	case "sing-box":
		p = singOptions(config)
	default:
		return p, false
	}
	switch n.Protocol {
	case "vless", "vmess":
		return p, p.uuid != ""
	case "tuic":
		return p, p.uuid != "" && p.password != ""
	case "ss":
		return p, p.password != "" && p.cipher != "" && builtInPlugin(p.plugin)
	case "trojan", "hysteria2":
		return p, p.password != ""
	default:
		return p, false
	}
}

func uriOptions(n models.SubNode) proxyOptions {
	var p proxyOptions
	if n.Protocol == "ss" {
		p.cipher, p.password, p.plugin, p.pluginOpts = ssOptions(n.RawConfig)
		return p
	}
	u, err := url.Parse(n.RawConfig)
	if err != nil {
		return p
	}
	q := u.Query()
	if u.User != nil {
		p.uuid = u.User.Username()
		p.password, _ = u.User.Password()
		if n.Protocol == "trojan" || n.Protocol == "hysteria2" {
			p.password = u.User.Username()
			if password, ok := u.User.Password(); ok {
				p.password += ":" + password
			}
		}
	}
	p.network, p.path, p.host, p.service = q.Get("type"), q.Get("path"), q.Get("host"), q.Get("serviceName")
	p.flow, p.sni, p.fingerprint = q.Get("flow"), q.Get("sni"), q.Get("fp")
	p.publicKey, p.shortID = q.Get("pbk"), q.Get("sid")
	p.tls = q.Get("security") == "tls" || q.Get("security") == "reality" || n.Protocol == "trojan" || n.Protocol == "hysteria2" || n.Protocol == "tuic"
	p.insecure, p.alpn = asBool(q.Get("allowInsecure")) || asBool(q.Get("insecure")), stringList(q.Get("alpn"))
	p.obfs, p.obfsKey = q.Get("obfs"), q.Get("obfs-password")
	return p
}

func stringList(v any) []string {
	out := []string{}
	switch value := v.(type) {
	case string:
		for _, part := range strings.Split(value, ",") {
			if part = strings.TrimSpace(part); part != "" {
				out = append(out, part)
			}
		}
	case []any:
		for _, part := range value {
			if str := asString(part); str != "" {
				out = append(out, str)
			}
		}
	}
	return out
}

func asObject(v any) map[string]any {
	value, _ := v.(map[string]any)
	return value
}

func clashOptions(c map[string]any) proxyOptions {
	p := proxyOptions{
		uuid: asString(c["uuid"]), password: asString(c["password"]), cipher: asString(c["cipher"]),
		alterID: asPort(c["alterId"]), flow: asString(c["flow"]), network: asString(c["network"]),
		sni: asString(c["servername"]), tls: asBool(c["tls"]), insecure: asBool(c["skip-cert-verify"]),
		alpn: stringList(c["alpn"]), fingerprint: asString(c["client-fingerprint"]),
		plugin: asString(c["plugin"]), obfs: asString(c["obfs"]), obfsKey: asString(c["obfs-password"]),
	}
	if p.sni == "" {
		p.sni = asString(c["sni"])
	}
	reality := asObject(c["reality-opts"])
	p.publicKey, p.shortID = asString(reality["public-key"]), asString(reality["short-id"])
	switch p.network {
	case "ws":
		ws := asObject(c["ws-opts"])
		p.path = asString(ws["path"])
		p.host = asString(asObject(ws["headers"])["Host"])
	case "grpc":
		p.service = asString(asObject(c["grpc-opts"])["grpc-service-name"])
	case "h2", "http":
		transport := asObject(c[p.network+"-opts"])
		hosts := stringList(transport["host"])
		if len(hosts) > 0 {
			p.host = hosts[0]
		}
		p.path = asString(transport["path"])
		if paths := stringList(transport["path"]); p.path == "" && len(paths) > 0 {
			p.path = paths[0]
		}
	}
	if p.plugin != "" {
		opts := asObject(c["plugin-opts"])
		if mode := asString(opts["mode"]); mode != "" {
			p.pluginOpts = "mode=" + mode
		}
		if host := asString(opts["host"]); host != "" {
			p.pluginOpts += ";host=" + host
		}
		if path := asString(opts["path"]); path != "" {
			p.pluginOpts += ";path=" + path
		}
		if asBool(opts["tls"]) {
			p.pluginOpts += ";tls"
		}
	}
	return p
}

func singOptions(c map[string]any) proxyOptions {
	tls := asObject(c["tls"])
	transport := asObject(c["transport"])
	p := proxyOptions{
		uuid: asString(c["uuid"]), password: asString(c["password"]), cipher: asString(c["method"]),
		alterID: asPort(c["alter_id"]), flow: asString(c["flow"]), network: asString(transport["type"]),
		path: asString(transport["path"]), host: asString(asObject(transport["headers"])["Host"]),
		service: asString(transport["service_name"]), tls: asBool(tls["enabled"]),
		sni: asString(tls["server_name"]), insecure: asBool(tls["insecure"]), alpn: stringList(tls["alpn"]),
		fingerprint: asString(asObject(tls["utls"])["fingerprint"]),
		plugin:      asString(c["plugin"]), pluginOpts: asString(c["plugin_opts"]),
	}
	if p.cipher == "" {
		p.cipher = asString(c["security"])
	}
	if hosts := stringList(transport["host"]); p.host == "" && len(hosts) > 0 {
		p.host = hosts[0]
	}
	reality := asObject(tls["reality"])
	p.publicKey, p.shortID = asString(reality["public_key"]), asString(reality["short_id"])
	obfs := asObject(c["obfs"])
	p.obfs, p.obfsKey = asString(obfs["type"]), asString(obfs["password"])
	return p
}

func ssOptions(raw string) (cipher, password, plugin, options string) {
	_, rest, _ := strings.Cut(raw, "://")
	rest, _, _ = strings.Cut(rest, "#")
	user, host, ok := splitUserHost(rest)
	if !ok {
		address, query, _ := strings.Cut(rest, "?")
		decoded, valid := decodeBase64(address)
		if !valid {
			return
		}
		user, host, ok = splitUserHost(string(decoded) + "?" + query)
		if !ok {
			return
		}
	}
	user, _ = url.PathUnescape(user)
	if !strings.Contains(user, ":") {
		if decoded, ok := decodeBase64(user); ok {
			user = string(decoded)
		}
	}
	cipher, password, _ = strings.Cut(user, ":")
	_, query, _ := strings.Cut(host, "?")
	values, _ := url.ParseQuery(query)
	plugin, options, _ = strings.Cut(values.Get("plugin"), ";")
	return
}

func ssrOutbound(n models.SubNode) map[string]any {
	_, encoded, _ := strings.Cut(n.RawConfig, "://")
	raw, ok := decodeBase64(encoded)
	if !ok {
		return nil
	}
	address, params, _ := strings.Cut(string(raw), "/?")
	parts := strings.Split(address, ":")
	if len(parts) < 6 {
		return nil
	}
	i := len(parts) - 6
	pass, _ := decodeBase64(parts[i+5])
	q, _ := url.ParseQuery(params)
	protoParam, _ := decodeBase64(q.Get("protoparam"))
	obfsParam, _ := decodeBase64(q.Get("obfsparam"))
	return map[string]any{
		"type": "ssr", "server": n.Host, "port": n.Port, "protocol": parts[i+2], "cipher": parts[i+3],
		"obfs": parts[i+4], "password": string(pass), "protocol-param": string(protoParam), "obfs-param": string(obfsParam),
	}
}

func putString(m map[string]any, key, value string) {
	if value != "" {
		m[key] = value
	}
}

func (p proxyOptions) mihomo(n models.SubNode) map[string]any {
	o := map[string]any{"type": n.Protocol, "server": n.Host, "port": n.Port, "udp": true}
	putString(o, "uuid", p.uuid)
	putString(o, "password", p.password)
	putString(o, "flow", p.flow)
	putString(o, "client-fingerprint", p.fingerprint)
	putString(o, "obfs", p.obfs)
	putString(o, "obfs-password", p.obfsKey)
	switch n.Protocol {
	case "vmess":
		o["alterId"], o["cipher"] = p.alterID, "auto"
		putString(o, "cipher", p.cipher)
	case "ss":
		o["cipher"] = p.cipher
		if p.plugin != "" {
			plugin := p.plugin
			if plugin == "obfs-local" || plugin == "simple-obfs" {
				plugin = "obfs"
			}
			opts := map[string]any{}
			for _, token := range strings.Split(p.pluginOpts, ";") {
				k, v, _ := strings.Cut(token, "=")
				switch k {
				case "obfs", "mode":
					opts["mode"] = v
				case "obfs-host", "host":
					opts["host"] = v
				case "path":
					opts["path"] = v
				case "tls":
					opts["tls"] = true
				}
			}
			o["plugin"], o["plugin-opts"] = plugin, opts
		}
	}
	if p.tls {
		if n.Protocol == "vmess" || n.Protocol == "vless" {
			o["tls"] = true
			putString(o, "servername", p.sni)
		} else {
			putString(o, "sni", p.sni)
		}
		o["skip-cert-verify"] = p.insecure
		if len(p.alpn) > 0 {
			o["alpn"] = p.alpn
		}
		if p.publicKey != "" {
			o["reality-opts"] = map[string]any{"public-key": p.publicKey, "short-id": p.shortID}
		}
	}
	switch p.network {
	case "", "tcp":
	case "ws":
		ws := map[string]any{"path": p.path}
		if p.host != "" {
			ws["headers"] = map[string]string{"Host": p.host}
		}
		o["network"], o["ws-opts"] = "ws", ws
	case "grpc":
		o["network"], o["grpc-opts"] = "grpc", map[string]string{"grpc-service-name": p.service}
	case "h2", "http":
		o["network"], o["h2-opts"] = "h2", map[string]any{"host": []string{p.host}, "path": p.path}
	default:
		return nil
	}
	return o
}

func (p proxyOptions) singbox(n models.SubNode) map[string]any {
	o := map[string]any{"type": n.Protocol, "server": n.Host, "server_port": n.Port}
	switch n.Protocol {
	case "vmess":
		o["uuid"], o["alter_id"], o["security"] = p.uuid, p.alterID, "auto"
		putString(o, "security", p.cipher)
	case "vless":
		o["uuid"] = p.uuid
		putString(o, "flow", p.flow)
	case "trojan":
		o["password"] = p.password
	case "tuic":
		o["uuid"], o["password"] = p.uuid, p.password
	case "ss":
		o["type"], o["method"], o["password"] = "shadowsocks", p.cipher, p.password
		plugin, opts := p.plugin, p.pluginOpts
		switch plugin {
		case "simple-obfs", "obfs", "obfs-local":
			plugin = "obfs-local"
			opts = strings.ReplaceAll(strings.ReplaceAll(opts, "mode=", "obfs="), ";host=", ";obfs-host=")
		}
		putString(o, "plugin", plugin)
		putString(o, "plugin_opts", opts)
	case "hysteria2":
		o["password"] = p.password
		if p.obfs != "" {
			o["obfs"] = map[string]string{"type": p.obfs, "password": p.obfsKey}
		}
	}
	if p.tls || n.Protocol == "trojan" || n.Protocol == "hysteria2" || n.Protocol == "tuic" {
		tls := map[string]any{"enabled": true, "insecure": p.insecure}
		putString(tls, "server_name", p.sni)
		if len(p.alpn) > 0 {
			tls["alpn"] = p.alpn
		}
		if p.fingerprint != "" {
			tls["utls"] = map[string]any{"enabled": true, "fingerprint": p.fingerprint}
		}
		if p.publicKey != "" {
			tls["reality"] = map[string]any{"enabled": true, "public_key": p.publicKey, "short_id": p.shortID}
		}
		o["tls"] = tls
	}
	switch p.network {
	case "", "tcp":
	case "ws":
		t := map[string]any{"type": p.network}
		putString(t, "path", p.path)
		if p.host != "" {
			t["headers"] = map[string]string{"Host": p.host}
		}
		o["transport"] = t
	case "httpupgrade":
		t := map[string]any{"type": p.network}
		putString(t, "path", p.path)
		putString(t, "host", p.host)
		o["transport"] = t
	case "grpc":
		o["transport"] = map[string]string{"type": "grpc", "service_name": p.service}
	case "h2", "http":
		o["transport"] = map[string]any{"type": "http", "host": []string{p.host}, "path": p.path}
	case "quic":
		o["transport"] = map[string]string{"type": "quic"}
	default:
		return nil
	}
	return o
}
