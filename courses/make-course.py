import urllib.request, sys, re, xml.etree.ElementTree as ET

def route(pts, profile="hiking-beta"):
    ll = "|".join(f"{lon},{lat}" for lat, lon in pts)
    u = f"https://brouter.de/brouter?lonlats={ll}&profile={profile}&alternativeidx=0&format=gpx"
    x = urllib.request.urlopen(u, timeout=60).read().decode()
    m = re.search(r"track-length = (\d+)", x)
    return x, int(m.group(1)) if m else None

def merge(gpxs, name):
    """여러 BRouter 응답을 하나의 trk로 합침 (Garmin 코스는 단일 트랙이어야 함)."""
    NS = "http://www.topografix.com/GPX/1/1"
    ET.register_namespace("", NS)
    out = ET.Element(f"{{{NS}}}gpx", {"version": "1.1", "creator": "running-dashboard"})
    meta = ET.SubElement(out, f"{{{NS}}}metadata"); ET.SubElement(meta, f"{{{NS}}}name").text = name
    trk = ET.SubElement(out, f"{{{NS}}}trk"); ET.SubElement(trk, f"{{{NS}}}name").text = name
    seg = ET.SubElement(trk, f"{{{NS}}}trkseg")
    last = None
    for g in gpxs:
        for p in ET.fromstring(g).iter(f"{{{NS}}}trkpt"):
            key = (p.get("lat"), p.get("lon"))
            if key == last: continue          # 이어붙이는 지점의 중복 좌표 제거
            last = key
            seg.append(p)
    return ET.ElementTree(out)

BAR  = (-33.8584893, 151.2011648)   # 바랑가루 리저브 (주차/출발)
WALSH= (-33.8551809, 151.2052887)
DAWES= (-33.8552501, 151.2091868)
QUAY = (-33.8613593, 151.2107193)
OPERA= (-33.857198,  151.2151234)
RBG  = (-33.8627694, 151.215711)
PYRB = (-33.8707317, 151.2015198)   # 피어몬트 브리지
PYBAY= (-33.8681871, 151.1971382)
PIRR = (-33.8642704, 151.1915099)   # 피어몬트 포인트(Pirrama Park)
BWB  = (-33.8725202, 151.1853721)   # Blackwattle Bay Park

# 좌표는 OSM(Overpass)에서 실제 보행로 way를 뽑아 씀.
# 교훈: 경유점은 적게, 물가 위 노드로. 많이 넣으면 서로 충돌해 지그재그가 생기고,
# 곶 북단 같은 "되돌아가야 하는" 점을 앞에 넣으면 BRouter가 내륙으로 크게 돈다.
NORTH = [BAR,
         (-33.85520, 151.20908),   # Dawes Point (하버브리지 아래)
         (-33.85704, 151.20952),   # Campbells Cove — 이게 있어야 The Rocks로 안 샘
         QUAY,
         OPERA]
SOUTH = [BAR,
         (-33.86171, 151.20064),   # Wulugul Walk 중간
         (-33.86586, 151.20126),   # Wulugul Walk 남단
         (-33.87450, 151.20050),   # 달링하버 남단 — 평지로 거리 벌기 (Blackwattle Bay 쪽은 언덕)
         PYRB, PYBAY,
         (-33.86838, 151.19661),   # Pirrama Rd 해안
         (-33.86699, 151.19552),
         (-33.86616, 151.19460),
         (-33.86373, 151.19171)]   # Pirrama Park

def outback(pts):
    a, da = route(pts)
    b, db = route(list(reversed(pts)))
    return [a, b], da + db

if __name__ == "__main__":
    n, dn = outback(NORTH)
    s, ds = outback(SOUTH)
    print(f"북쪽 왕복 {dn/1000:.2f}km / 남쪽 왕복 {ds/1000:.2f}km / 합계 {(dn+ds)/1000:.2f}km")
    merge(n + s, "윤호 14km — 바랑가루 롱런").write("yunho-14km.gpx", encoding="UTF-8", xml_declaration=True)
    merge(s, "제니 8km — 바랑가루 롱런").write("jenny-8km.gpx", encoding="UTF-8", xml_declaration=True)
    print("yunho-14km.gpx, jenny-8km.gpx 생성")


# --- 목표 거리에서 자르고 되돌아오는 왕복 코스 만들기 ---
import math
def _hav(a, b):
    R = 6371000; p1, p2 = map(math.radians, (a[0], b[0]))
    dl = math.radians(b[1] - a[1]); dp = p2 - p1
    return 2 * R * math.asin(math.sqrt(math.sin(dp/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2))

def elevation_gain(tree):
    """BRouter가 일부 점의 <ele>를 빼먹어서 직전 값으로 메움."""
    NS = "{http://www.topografix.com/GPX/1/1}"
    e = []
    for p in tree.getroot().iter(NS + "trkpt"):
        t = p.find(NS + "ele")
        e.append(float(t.text) if t is not None else (e[-1] if e else 0.0))
    return sum(max(0, e[i] - e[i-1]) for i in range(1, len(e)))

def _trkpts(gpx):
    NS = "http://www.topografix.com/GPX/1/1"
    return [p for p in ET.fromstring(gpx).iter(f"{{{NS}}}trkpt")]

def outback_exact(wps, half_m, name):
    """편도를 half_m에서 자르고 역순으로 붙여 정확히 2*half_m 코스를 만든다."""
    P = _trkpts(route(wps)[0])
    coords = [(float(p.get("lat")), float(p.get("lon"))) for p in P]
    d = 0.0; cut = len(P) - 1
    for i in range(1, len(P)):
        d += _hav(coords[i-1], coords[i])
        if d >= half_m:
            cut = i; break
    out = P[:cut+1]
    NS = "http://www.topografix.com/GPX/1/1"
    ET.register_namespace("", NS)
    gpx = ET.Element(f"{{{NS}}}gpx", {"version": "1.1", "creator": "running-dashboard"})
    meta = ET.SubElement(gpx, f"{{{NS}}}metadata"); ET.SubElement(meta, f"{{{NS}}}name").text = name
    trk = ET.SubElement(gpx, f"{{{NS}}}trk"); ET.SubElement(trk, f"{{{NS}}}name").text = name
    seg = ET.SubElement(trk, f"{{{NS}}}trkseg")
    for p in out: seg.append(p)
    for p in reversed(out[:-1]):        # 반환점 중복 없이 되돌아오기
        q = ET.Element(f"{{{NS}}}trkpt", {"lat": p.get("lat"), "lon": p.get("lon")})
        for c in p: q.append(c)
        seg.append(q)
    total = sum(_hav(coords[i-1], coords[i]) for i in range(1, cut+1)) * 2
    return ET.ElementTree(gpx), total, coords[cut]
