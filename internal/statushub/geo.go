package statushub

import (
	"strings"
	"unicode"

	"golang.org/x/text/language"
	"golang.org/x/text/language/display"
)

type geo struct {
	code, country, city string
	lat, lng            float64
	located             bool
}

type place struct {
	code, city, aliases string
	lat, lng            float64
}

// The first entry for each country is the default location for a flag or
// country-only label. City aliases take priority within that country.
var places = []place{
	{"JP", "Tokyo", "japan|tokyo|日本|东京|東京", 35.6762, 139.6503},
	{"JP", "Osaka", "osaka|大阪", 34.6937, 135.5023},
	{"JP", "Nagoya", "nagoya|名古屋", 35.1815, 136.9066},
	{"US", "Los Angeles", "united states|usa|america|los angeles|lax|美国|美國|洛杉矶|洛杉磯", 34.0522, -118.2437},
	{"US", "San Jose", "san jose|silicon valley|sjc|圣何塞|聖何塞|圣荷西|聖荷西|硅谷|矽谷", 37.3382, -121.8863},
	{"US", "San Francisco", "san francisco|sfo|旧金山|舊金山", 37.7749, -122.4194},
	{"US", "Seattle", "seattle|sea|西雅图|西雅圖", 47.6062, -122.3321},
	{"US", "New York", "new york|nyc|jfk|纽约|紐約", 40.7128, -74.006},
	{"US", "Chicago", "chicago|芝加哥", 41.8781, -87.6298},
	{"US", "Dallas", "dallas|达拉斯|達拉斯", 32.7767, -96.797},
	{"US", "Miami", "miami|迈阿密|邁阿密", 25.7617, -80.1918},
	{"HK", "Hong Kong", "hong kong|hongkong|hkg|香港", 22.3193, 114.1694},
	{"SG", "Singapore", "singapore|singapura|新加坡|狮城|獅城", 1.3521, 103.8198},
	{"TW", "Taipei", "taiwan|taipei|tpe|台湾|台灣|臺灣|台北|臺北", 25.033, 121.5654},
	{"TW", "Kaohsiung", "kaohsiung|高雄", 22.6273, 120.3014},
	{"DE", "Frankfurt", "germany|deutschland|frankfurt|fra|德国|德國|法兰克福|法蘭克福", 50.1109, 8.6821},
	{"DE", "Berlin", "berlin|柏林", 52.52, 13.405},
	{"GB", "London", "united kingdom|britain|england|uk|london|lon|英国|英國|伦敦|倫敦", 51.5072, -0.1276},
	{"KR", "Seoul", "south korea|korea|seoul|icn|韩国|韓國|首尔|首爾", 37.5665, 126.978},
	{"NL", "Amsterdam", "netherlands|holland|amsterdam|ams|荷兰|荷蘭|阿姆斯特丹", 52.3676, 4.9041},
	{"FR", "Paris", "france|paris|cdg|法国|法國|巴黎", 48.8566, 2.3522},
	{"CA", "Toronto", "canada|toronto|yyz|加拿大|多伦多|多倫多", 43.6532, -79.3832},
	{"CA", "Vancouver", "vancouver|温哥华|溫哥華", 49.2827, -123.1207},
	{"AU", "Sydney", "australia|sydney|澳大利亚|澳大利亞|澳洲|悉尼|雪梨", -33.8688, 151.2093},
	{"AU", "Melbourne", "melbourne|墨尔本|墨爾本", -37.8136, 144.9631},
	{"IN", "Mumbai", "india|mumbai|bombay|印度|孟买|孟買", 19.076, 72.8777},
	{"IN", "New Delhi", "new delhi|delhi|新德里|德里", 28.6139, 77.209},
	{"RU", "Moscow", "russia|moscow|俄罗斯|俄羅斯|莫斯科", 55.7558, 37.6173},
	{"TR", "Istanbul", "turkey|türkiye|istanbul|土耳其|伊斯坦布尔|伊斯坦堡", 41.0082, 28.9784},
	{"VN", "Ho Chi Minh City", "vietnam|ho chi minh|saigon|越南|胡志明|西贡|西貢", 10.8231, 106.6297},
	{"VN", "Hanoi", "hanoi|河内|河內", 21.0278, 105.8342},
	{"TH", "Bangkok", "thailand|bangkok|泰国|泰國|曼谷", 13.7563, 100.5018},
	{"MY", "Kuala Lumpur", "malaysia|kuala lumpur|马来西亚|馬來西亞|吉隆坡", 3.139, 101.6869},
	{"PH", "Manila", "philippines|manila|菲律宾|菲律賓|马尼拉|馬尼拉", 14.5995, 120.9842},
	{"AR", "Buenos Aires", "argentina|buenos aires|阿根廷|布宜诺斯艾利斯|布宜諾斯艾利斯", -34.6037, -58.3816},
	{"BR", "São Paulo", "brazil|brasil|são paulo|sao paulo|巴西|圣保罗|聖保羅", -23.5505, -46.6333},
	{"CH", "Zurich", "switzerland|zurich|zürich|瑞士|苏黎世|蘇黎世", 47.3769, 8.5417},
	{"SE", "Stockholm", "sweden|stockholm|瑞典|斯德哥尔摩|斯德哥爾摩", 59.3293, 18.0686},
	{"IT", "Milan", "italy|milan|milano|意大利|義大利|米兰|米蘭", 45.4642, 9.19},
	{"ES", "Madrid", "spain|españa|madrid|西班牙|马德里|馬德里", 40.4168, -3.7038},
	{"CN", "Shanghai", "china|shanghai|中国|中國|上海", 31.2304, 121.4737},
	{"CN", "Beijing", "beijing|北京", 39.9042, 116.4074},
	{"CN", "Shenzhen", "shenzhen|深圳", 22.5431, 114.0579},
	{"CN", "Guangzhou", "guangzhou|广州|廣州", 23.1291, 113.2644},
	{"MO", "Macao", "macao|macau|澳门|澳門", 22.1987, 113.5439},
	{"ID", "Jakarta", "indonesia|jakarta|印度尼西亚|印度尼西亞|印尼|雅加达|雅加達", -6.2088, 106.8456},
	{"NZ", "Auckland", "new zealand|auckland|新西兰|新西蘭|纽西兰|紐西蘭|奥克兰|奧克蘭", -36.8509, 174.7645},
	{"AE", "Dubai", "uae|dubai|阿联酋|阿聯酋|迪拜|杜拜", 25.2048, 55.2708},
	{"ZA", "Johannesburg", "south africa|johannesburg|南非|约翰内斯堡|約翰內斯堡", -26.2041, 28.0473},
	{"FI", "Helsinki", "finland|helsinki|芬兰|芬蘭|赫尔辛基|赫爾辛基", 60.1699, 24.9384},
	{"NO", "Oslo", "norway|oslo|挪威|奥斯陆|奧斯陸", 59.9139, 10.7522},
	{"DK", "Copenhagen", "denmark|copenhagen|丹麦|丹麥|哥本哈根", 55.6761, 12.5683},
	{"IE", "Dublin", "ireland|dublin|爱尔兰|愛爾蘭|都柏林", 53.3498, -6.2603},
	{"PL", "Warsaw", "poland|warsaw|波兰|波蘭|华沙|華沙", 52.2297, 21.0122},
	{"AT", "Vienna", "austria|vienna|奥地利|奧地利|维也纳|維也納", 48.2082, 16.3738},
	{"PT", "Lisbon", "portugal|lisbon|葡萄牙|里斯本", 38.7223, -9.1393},
	{"BE", "Brussels", "belgium|brussels|比利时|比利時|布鲁塞尔|布魯塞爾", 50.8503, 4.3517},
	{"UA", "Kyiv", "ukraine|kyiv|乌克兰|烏克蘭|基辅|基輔", 50.4501, 30.5234},
	{"IL", "Tel Aviv", "israel|tel aviv|以色列|特拉维夫|特拉維夫", 32.0853, 34.7818},
	{"MX", "Mexico City", "mexico|墨西哥", 19.4326, -99.1332},
	{"CL", "Santiago", "chile|santiago|智利|圣地亚哥|聖地牙哥", -33.4489, -70.6693},
}

var countryAliases = map[string]string{
	"JP": "japan|日本", "US": "united states|usa|america|美国|美國",
	"TW": "taiwan|台湾|台灣|臺灣", "DE": "germany|deutschland|德国|德國",
	"CA": "canada|加拿大", "AU": "australia|澳大利亚|澳大利亞|澳洲",
	"IN": "india|印度", "VN": "vietnam|越南", "CN": "china|中国|中國",
}

// These countries have multiple city entries. A city match should outrank a
// country name within the same location label.
func matchScore(p place, alias string) int {
	if aliases := countryAliases[p.code]; aliases != "" && !strings.Contains("|"+aliases+"|", "|"+alias+"|") {
		return 100 + len(alias)
	}
	return len(alias)
}

func countryGeo(code string) geo {
	region, err := language.ParseRegion(code)
	if len(code) != 2 || err != nil || !region.IsCountry() {
		return geo{}
	}
	name := display.English.Regions().Name(region)
	// The dashboard uses common short names.
	switch code {
	case "TW":
		name = "Taiwan"
	case "HK":
		name = "Hong Kong"
	case "MO":
		name = "Macao"
	}
	for _, p := range places {
		if p.code == code {
			return geo{code, name, p.city, p.lat, p.lng, true}
		}
	}
	return geo{code: code, country: name}
}

func flagCode(name string) string {
	var previous rune
	for _, r := range name {
		if previous >= '🇦' && previous <= '🇿' && r >= '🇦' && r <= '🇿' {
			code := string([]rune{'A' + previous - '🇦', 'A' + r - '🇦'})
			if region, err := language.ParseRegion(code); err == nil && region.IsCountry() {
				return code
			}
		}
		previous = r
	}
	return ""
}

func resolveGeo(name string) geo {
	defaultGeo := countryGeo(flagCode(name))
	lower := strings.ToLower(name)
	bestLen := 0
	var best place
	for _, p := range places {
		if defaultGeo.code != "" && p.code != defaultGeo.code {
			continue
		}
		for _, alias := range strings.Split(p.aliases, "|") {
			if score := matchScore(p, alias); score > bestLen && matchesPlace(lower, alias) {
				best, bestLen = p, score
			}
		}
	}
	if bestLen > 0 {
		base := countryGeo(best.code)
		base.city, base.lat, base.lng, base.located = best.city, best.lat, best.lng, true
		return base
	}
	if defaultGeo.code != "" {
		return defaultGeo
	}
	for _, token := range strings.FieldsFunc(name, func(r rune) bool {
		return !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z')
	}) {
		if len(token) != 2 || token == "in" || token == "es" || token == "it" {
			continue
		}
		if value := countryGeo(strings.ToUpper(token)); value.located {
			return value
		}
	}
	return geo{}
}

func matchesPlace(name, alias string) bool {
	for _, r := range alias {
		if unicode.Is(unicode.Han, r) {
			return strings.Contains(name, alias)
		}
	}
	for offset := 0; offset < len(name); {
		i := strings.Index(name[offset:], alias)
		if i < 0 {
			break
		}
		i += offset
		end := i + len(alias)
		letter := func(ch byte) bool { return ch >= 'a' && ch <= 'z' }
		if (i == 0 || !letter(name[i-1])) && (end == len(name) || !letter(name[end])) {
			return true
		}
		offset = i + 1
	}
	return false
}
