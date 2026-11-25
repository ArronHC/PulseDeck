package statushub

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/komari-monitor/komari/database/models"
	"go.yaml.in/yaml/v3"
	"golang.org/x/net/idna"
)

const maxSubscriptionNodes = 10000

type usage struct {
	Upload, Download, Total, Expire int64
}

func parseUserinfo(header string) usage {
	var value usage
	for _, part := range strings.Split(header, ";") {
		key, raw, ok := strings.Cut(part, "=")
		if !ok {
			continue
		}
		n, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
		if err != nil || n < 0 {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "upload":
			value.Upload = n
		case "download":
			value.Download = n
		case "total":
			value.Total = n
		case "expire":
			value.Expire = n
		}
	}
	return value
}

func parseSubscription(content string) ([]models.SubNode, error) {
	content = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(content), "\ufeff"))
	if len(content) > maxHTTPBody {
		return nil, InputError("subscription exceeds the size limit")
	}
	type config map[string]any
	var sing struct {
		Outbounds []config `json:"outbounds"`
	}
	var clash struct {
		Proxies []config `yaml:"proxies"`
	}
	var nodes []models.SubNode
	asNode := func(p config, kind, nameKey, portKey string) {
		raw, err := json.Marshal(p)
		if err != nil {
			return
		}
		n := newNode(asString(p[nameKey]), asString(p["type"]), asString(p["server"]), asPort(p[portKey]), kind, string(raw))
		if n != nil {
			nodes = append(nodes, *n)
		}
	}
	switch {
	case strings.HasPrefix(content, "{") && json.Unmarshal([]byte(content), &sing) == nil && sing.Outbounds != nil:
		for _, p := range sing.Outbounds {
			asNode(p, "sing-box", "tag", "server_port")
		}
	case strings.Contains(content, "proxies") && yaml.Unmarshal([]byte(content), &clash) == nil && clash.Proxies != nil:
		for _, p := range clash.Proxies {
			asNode(p, "clash", "name", "port")
		}
	default:
		if !strings.Contains(content, "://") {
			if decoded, ok := decodeBase64(content); ok {
				content = string(decoded)
			}
		}
		for line := range strings.SplitSeq(content, "\n") {
			if n := parseURI(strings.TrimSpace(line)); n != nil {
				nodes = append(nodes, *n)
			}
		}
	}
	seen := make(map[string]bool, len(nodes))
	out := make([]models.SubNode, 0, len(nodes))
	for _, node := range nodes {
		if !seen[node.Fingerprint] {
			out = append(out, node)
			seen[node.Fingerprint] = true
		}
	}
	if len(out) == 0 {
		return nil, InputError("subscription has no supported proxy nodes")
	}
	if len(out) > maxSubscriptionNodes {
		return nil, InputError("subscription has too many proxy nodes")
	}
	return out, nil
}

func decodeBase64(value string) ([]byte, bool) {
	value = strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\r', '\n':
			return -1
		}
		return r
	}, value)
	value = strings.TrimRight(value, "=")
	for _, enc := range []*base64.Encoding{base64.RawStdEncoding, base64.RawURLEncoding} {
		if decoded, err := enc.DecodeString(value); err == nil {
			return decoded, true
		}
	}
	return nil, false
}

func asString(v any) string {
	if value, ok := v.(string); ok {
		return value
	}
	return ""
}

func asPort(v any) int {
	switch value := v.(type) {
	case int:
		return value
	case float64:
		if value >= 1 && value <= 65535 && value == float64(int(value)) {
			return int(value)
		}
	case string:
		n, _ := strconv.Atoi(value)
		return n
	}
	return 0
}

func normalizeProtocol(proto string) string {
	switch strings.ToLower(strings.TrimSpace(proto)) {
	case "hy2", "hysteria2":
		return "hysteria2"
	case "socks", "socks5", "socks5h":
		return "socks5"
	case "shadowsocks":
		return "ss"
	case "shadowsocksr":
		return "ssr"
	case "https":
		return "http"
	case "vmess", "vless", "trojan", "ss", "ssr", "tuic", "http":
		return strings.ToLower(strings.TrimSpace(proto))
	default:
		return ""
	}
}

func newNode(name, proto, host string, port int, kind, config string) *models.SubNode {
	proto = normalizeProtocol(proto)
	host = strings.ToLower(strings.Trim(strings.TrimSpace(host), "[]"))
	if net.ParseIP(host) == nil {
		ascii, err := idna.Lookup.ToASCII(host)
		if err != nil {
			return nil
		}
		host = ascii
	}
	if proto == "" || !validHost(host) || port < 1 || port > 65535 {
		return nil
	}
	name = strings.TrimSpace(name)
	if name == "" {
		name = net.JoinHostPort(host, strconv.Itoa(port))
	}
	identity := sha256.Sum256([]byte(strings.Join([]string{proto, name, host, strconv.Itoa(port)}, "\x00")))
	g := resolveGeo(name)
	return &models.SubNode{
		Fingerprint: hex.EncodeToString(identity[:]), Name: name, Protocol: proto, Host: host, Port: port,
		ConfigKind: kind, RawConfig: config, CountryCode: g.code, CountryName: g.country, City: g.city,
		Lat: g.lat, Lng: g.lng, HasCoordinates: g.located, Enabled: true, TestStatus: "untested",
	}
}

func parseURI(raw string) *models.SubNode {
	scheme, rest, ok := strings.Cut(raw, "://")
	if !ok {
		return nil
	}
	scheme = strings.ToLower(scheme)
	switch scheme {
	case "vmess":
		if value, ok := decodeBase64(rest); ok {
			var cfg map[string]any
			if json.Unmarshal(value, &cfg) == nil {
				return newNode(asString(cfg["ps"]), scheme, asString(cfg["add"]), asPort(cfg["port"]), "vmess-json", string(value))
			}
		}
	case "ssr":
		return parseSSR(rest, raw)
	case "ss":
		name := ""
		if value, frag, ok := strings.Cut(rest, "#"); ok {
			rest = value
			name, _ = url.PathUnescape(frag)
		}
		if _, _, found := strings.Cut(rest, "@"); !found {
			value, query, _ := strings.Cut(rest, "?")
			if decoded, ok := decodeBase64(value); ok {
				rest = string(decoded)
				if query != "" {
					rest += "?" + query
				}
			}
		}
		_, after, ok := splitUserHost(rest)
		if !ok {
			return nil
		}
		u, err := url.Parse("ss://" + after)
		if err != nil {
			return nil
		}
		return newNode(name, scheme, u.Hostname(), asPort(u.Port()), "uri", raw)
	}
	u, err := url.Parse(raw)
	if err != nil {
		return nil
	}
	port := asPort(u.Port())
	if u.Port() == "" {
		switch scheme {
		case "https", "vmess", "vless", "trojan", "hysteria2", "hy2", "tuic":
			port = 443
		case "http":
			port = 80
		case "socks", "socks5", "socks5h":
			port = 1080
		}
	}
	return newNode(u.Fragment, scheme, u.Hostname(), port, "uri", raw)
}

func splitUserHost(value string) (string, string, bool) {
	at := strings.LastIndex(strings.SplitN(value, "?", 2)[0], "@")
	if at < 0 {
		return "", "", false
	}
	return value[:at], value[at+1:], true
}

func parseSSR(encoded, raw string) *models.SubNode {
	body, ok := decodeBase64(encoded)
	if !ok {
		return nil
	}
	address, params, _ := strings.Cut(string(body), "/?")
	parts := strings.Split(address, ":")
	if len(parts) < 6 {
		return nil
	}
	i := len(parts) - 6
	query, _ := url.ParseQuery(params)
	name, _ := decodeBase64(query.Get("remarks"))
	return newNode(string(name), "ssr", strings.Join(parts[:i+1], ":"), asPort(parts[i+1]), "uri", raw)
}
