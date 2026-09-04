#!/usr/bin/env python3
"""Build the Lê Duẩn × Lê Lợi · Cầu Sông Hàn pocket from OSM.

Directed links follow OSM way geometry and oneway/lanes tags. Never pair()
both directions. Caps the pocket at 20 signalized junctions (west→east spine
plus a connected arterial fill). Unsignalized stubs remain for spawn.
"""
from __future__ import annotations

import json
import math
from collections import Counter, defaultdict, deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OSM_PATH = ROOT / "data" / "danang-overpass.json"
OUT = ROOT / "src" / "sim" / "mapGraph.json"

LAT0, LON0 = 16.06, 108.23
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 110540.0

HW_SKIP = {"footway", "path", "steps", "pedestrian", "cycleway", "service"}
HW_RANK = {
    "motorway": 4,
    "trunk": 4,
    "primary": 3,
    "secondary": 2,
    "tertiary": 1,
    "residential": 0,
    "unclassified": 0,
    "living_street": 0,
    "primary_link": 3,
    "trunk_link": 4,
    "secondary_link": 2,
    "tertiary_link": 1,
}
HW_KEEP = set(HW_RANK)

SIGNAL_CAP = 20
SNAP_M = 30.0
ABUT_SNAP_M = 70.0
STUB_SNAP_M = 42.0
INNER_PAD = 90.0
STUB_PAD = 220.0
FABRIC_M = 520.0
PAD = 52.0
RDP_EPS = 2.4
MIN_PT = 1.4
MAX_GAP = 12.0
CONTEXT_RDP = 5.0
MIN_LINK_M = 14.0

# Must-keep spine + preferred arterial fill. 20 names, west→east-ish.
# (name, lat, lon, streets, extra_snap_m)
TARGETS: list[tuple[str, float, float, tuple[str, ...], float]] = [
    # west→east spine
    ("Lê Duẩn × Ông Ích Khiêm", 16.07019, 108.21353, ("Lê Duẩn", "Ông Ích Khiêm"), 0),
    ("Lê Duẩn × Ngô Gia Tự", 16.07092, 108.21693, ("Lê Duẩn", "Ngô Gia Tự"), 0),
    ("Lê Duẩn × Lê Lợi", 16.07133, 108.22041, ("Lê Duẩn", "Lê Lợi"), 0),
    ("Lê Duẩn × Nguyễn Chí Thanh", 16.07146, 108.22110, ("Lê Duẩn", "Nguyễn Chí Thanh"), 0),
    ("Lê Duẩn", 16.07161, 108.22271, ("Lê Duẩn",), 0),
    ("Cầu Sông Hàn Tây", 16.07189, 108.22484, ("Cầu Sông Hàn", "Lê Duẩn"), ABUT_SNAP_M - SNAP_M),
    ("Cầu Sông Hàn Đông", 16.07274, 108.23056, ("Cầu Sông Hàn", "Ngô Quyền", "Phạm Văn Đồng"), ABUT_SNAP_M - SNAP_M),
    # north Lê Lợi / Quang Trung
    ("Lê Lợi × Hải Phòng", 16.07264, 108.22023, ("Hải Phòng", "Lê Lợi"), 0),
    ("Lê Lợi × Quang Trung", 16.07479, 108.21994, ("Lê Lợi", "Quang Trung"), 0),
    ("Quang Trung × Nguyễn Chí Thanh", 16.07495, 108.22063, ("Nguyễn Chí Thanh", "Quang Trung"), 0),
    ("Quang Trung × Trần Phú", 16.07551, 108.22350, ("Quang Trung", "Trần Phú"), 0),
    ("Quang Trung × Bạch Đằng", 16.07565, 108.22428, ("Bạch Đằng", "Quang Trung"), 0),
    # south Hùng Vương
    ("Hùng Vương × Ông Ích Khiêm", 16.06723, 108.21406, ("Hùng Vương", "Ông Ích Khiêm"), 0),
    ("Hùng Vương × Ngô Gia Tự", 16.06798, 108.21761, ("Hùng Vương", "Ngô Gia Tự"), 0),
    ("Hùng Vương × Phan Châu Trinh", 16.06862, 108.22034, ("Hùng Vương", "Phan Châu Trinh"), 0),
    ("Hùng Vương × Nguyễn Chí Thanh", 16.06861, 108.22106, ("Hùng Vương", "Nguyễn Chí Thanh"), 0),
    ("Hùng Vương × Trần Phú", 16.06861, 108.22392, ("Hùng Vương", "Trần Phú"), 0),
    ("Hùng Vương × Bạch Đằng", 16.06862, 108.22498, ("Bạch Đằng", "Hùng Vương"), 0),
    # connectors
    ("Hải Phòng × Nguyễn Chí Thanh", 16.07273, 108.22092, ("Hải Phòng", "Nguyễn Chí Thanh"), 0),
    # east of the bridge (Ngô Quyền north of the east abutment)
    ("Ngô Quyền", 16.07546, 108.23065, ("Ngô Quyền",), 20),
]

# Extra unsignalized named crossings kept as ticks / spawn (not in the 20).
UNSIG_CROSS: list[tuple[str, float, float, tuple[str, ...]]] = [
    ("Chi Lăng × Lê Duẩn", 16.07054, 108.21510, ("Chi Lăng", "Lê Duẩn")),
    ("Lê Lợi × Phan Châu Trinh", 16.07057, 108.22051, ("Lê Lợi", "Phan Châu Trinh")),
    ("Hải Phòng × Ngô Gia Tự", 16.07217, 108.21664, ("Hải Phòng", "Ngô Gia Tự")),
    ("Hải Phòng × Ông Ích Khiêm", 16.07169, 108.21317, ("Hải Phòng", "Ông Ích Khiêm")),
    ("Ông Ích Khiêm × Quang Trung", 16.07335, 108.21286, ("Quang Trung", "Ông Ích Khiêm")),
]


def proj(lat: float, lon: float) -> tuple[float, float]:
    # Y-down canvas: north = smaller y. OSM lat decreasing south → y increasing.
    return ((lon - LON0) * MX, (LAT0 - lat) * MY)


def dist(a, b) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def poly_len(pts) -> float:
    s = 0.0
    for i in range(1, len(pts)):
        s += dist(pts[i - 1], pts[i])
    return s


def short_name(n: str) -> str:
    return (n or "").replace("Đường ", "").replace("đường ", "").strip()


def rdp(pts, eps: float):
    if len(pts) < 3:
        return list(pts)
    a, b = pts[0], pts[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    den = math.hypot(dx, dy) or 1.0
    maxd, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = abs(dy * px - dx * py + b[0] * a[1] - b[1] * a[0]) / den
        if d > maxd:
            maxd, idx = d, i
    if maxd > eps:
        left = rdp(pts[: idx + 1], eps)
        right = rdp(pts[idx:], eps)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def densify_min(pts, min_pt: float):
    if not pts:
        return pts
    out = [pts[0]]
    for p in pts[1:]:
        if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) >= min_pt:
            out.append(p)
        else:
            out[-1] = p
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    if len(out) == 1:
        out.append(pts[-1])
    return out


def densify_max(pts, max_gap: float):
    if len(pts) < 2:
        return list(pts)
    out = [pts[0]]
    for p in pts[1:]:
        a = out[-1]
        d = math.hypot(p[0] - a[0], p[1] - a[1])
        n = max(1, int(math.ceil(d / max_gap)))
        for i in range(1, n):
            t = i / n
            out.append((a[0] + (p[0] - a[0]) * t, a[1] + (p[1] - a[1]) * t))
        out.append(p)
    return out


def oneway_dir(tags: dict) -> int:
    o = str(tags.get("oneway") or "no").lower()
    if o in ("yes", "true", "1"):
        return 1
    if o in ("-1", "reverse"):
        return -1
    return 0


def parse_lanes(tags: dict, rank: int, bridge: bool) -> int:
    raw = tags.get("lanes")
    if raw:
        try:
            n = int(float(str(raw).split(";")[0].split("|")[0]))
            if 1 <= n <= 8:
                return n
        except ValueError:
            pass
    if bridge or rank >= 3:
        return 2
    if rank >= 2:
        return 2
    return 1


def clip_poly_bbox(pts, minx, miny, maxx, maxy, slack=40.0):
    if len(pts) < 2:
        return []
    x0, y0, x1, y1 = minx - slack, miny - slack, maxx + slack, maxy + slack

    def inside(p):
        return x0 <= p[0] <= x1 and y0 <= p[1] <= y1

    runs = []
    cur = []
    for i, p in enumerate(pts):
        if inside(p):
            if not cur and i > 0:
                cur.append(pts[i - 1])
            cur.append(p)
        else:
            if cur:
                cur.append(p)
                if len(cur) >= 2:
                    runs.append(cur)
                cur = []
    if len(cur) >= 2:
        runs.append(cur)
    return runs


def load_osm():
    data = json.loads(OSM_PATH.read_text())
    nodes: dict[int, dict] = {}
    ways = []
    for e in data["elements"]:
        if e["type"] == "node":
            nid = e["id"]
            if nid not in nodes:
                nodes[nid] = {
                    "id": nid,
                    "lat": e.get("lat"),
                    "lon": e.get("lon"),
                    "tags": dict(e.get("tags") or {}),
                }
            else:
                if "lat" in e:
                    nodes[nid]["lat"] = e["lat"]
                    nodes[nid]["lon"] = e["lon"]
                nodes[nid]["tags"].update(e.get("tags") or {})
        elif e["type"] == "way":
            ways.append(e)
    return nodes, ways


class Keep:
    def __init__(self, name: str, x: float, y: float, streets: list[str], signalized: bool, snap: float):
        self.name = name
        self.x = x
        self.y = y
        self.streets = streets
        self.signalized = signalized
        self.snap = snap
        self.stub = False
        self.rank = 1


def main():
    osm_nodes, osm_ways = load_osm()
    xy: dict[int, tuple[float, float]] = {}
    for nid, n in osm_nodes.items():
        if n.get("lat") is not None and n.get("lon") is not None:
            xy[nid] = proj(n["lat"], n["lon"])

    node_streets: dict[int, set[str]] = defaultdict(set)
    hwy_ways = []
    river_pts = []
    for w in osm_ways:
        t = w.get("tags") or {}
        if t.get("name") == "Sông Hàn" and t.get("waterway") == "river":
            river_pts = [xy[nid] for nid in (w.get("nodes") or []) if nid in xy]
        h = t.get("highway")
        if not h or h in HW_SKIP or h not in HW_KEEP:
            continue
        name = short_name(t.get("name") or t.get("name:vi") or "")
        ns = [nid for nid in (w.get("nodes") or []) if nid in xy]
        if len(ns) < 2:
            continue
        hwy_ways.append({"nodes": ns, "name": name, "highway": h, "tags": t})
        for nid in ns:
            if name:
                node_streets[nid].add(name)

    def nearest_named(lat, lon, streets, maxd=90.0):
        px, py = proj(lat, lon)
        best, bd = None, 1e18
        prefer, pd = None, 1e18
        for nid, p in xy.items():
            d = dist(p, (px, py))
            if d < bd:
                bd, best = d, nid
            if streets and d < pd:
                sts = node_streets.get(nid, set())
                blob = " ".join(sts)
                if all(s in blob for s in streets if s):
                    pd, prefer = d, nid
                elif any(s in blob for s in streets if s) and d < maxd * 0.7:
                    if prefer is None or d < pd:
                        pd, prefer = d, nid
        if prefer is not None and pd <= maxd:
            return prefer, pd
        if best is not None and bd <= maxd:
            return best, bd
        return None, bd

    keeps: list[Keep] = []
    for name, lat, lon, streets, extra in TARGETS:
        nid, d = nearest_named(lat, lon, streets, maxd=90 + extra)
        if nid is None:
            x, y = proj(lat, lon)
            print(f"WARN: no OSM snap for {name}, using target coords")
        else:
            x, y = xy[nid]
            print(f"snap {name:32s}  {d:5.1f}m  streets={sorted(node_streets.get(nid, set()))}")
        sts = list(streets)
        extra_sts = sorted(node_streets.get(nid, set())) if nid else []
        for s in extra_sts:
            if s not in sts:
                sts.append(s)
        keeps.append(Keep(name, x, y, sts[:5], True, SNAP_M + extra))

    assert len(keeps) == SIGNAL_CAP, f"expected {SIGNAL_CAP} signals, got {len(keeps)}"

    for name, lat, lon, streets in UNSIG_CROSS:
        nid, d = nearest_named(lat, lon, streets, maxd=80)
        if nid is None:
            continue
        x, y = xy[nid]
        # skip if already near a signal
        if any(dist((x, y), (k.x, k.y)) < 40 for k in keeps):
            continue
        sts = list(streets)
        for s in sorted(node_streets.get(nid, set())):
            if s not in sts:
                sts.append(s)
        k = Keep(name, x, y, sts[:5], False, SNAP_M)
        k.rank = 2
        keeps.append(k)
        print(f"unstig {name:32s}  {d:5.1f}m")

    sig_xy = [(k.x, k.y) for k in keeps if k.signalized]
    minx_i = min(p[0] for p in sig_xy) - INNER_PAD
    maxx_i = max(p[0] for p in sig_xy) + INNER_PAD
    miny_i = min(p[1] for p in sig_xy) - INNER_PAD
    maxy_i = max(p[1] for p in sig_xy) + INNER_PAD
    minx_s = minx_i - STUB_PAD
    maxx_s = maxx_i + STUB_PAD
    miny_s = miny_i - STUB_PAD
    maxy_s = maxy_i + STUB_PAD

    def in_inner(p):
        return minx_i <= p[0] <= maxx_i and miny_i <= p[1] <= maxy_i

    def in_stub(p):
        return minx_s <= p[0] <= maxx_s and miny_s <= p[1] <= maxy_s

    def snap_keep(p, extra=0.0):
        best, bd = None, 1e18
        for i, k in enumerate(keeps):
            d = dist(p, (k.x, k.y))
            lim = k.snap + extra
            if d < bd and d <= lim:
                bd, best = d, i
        return best, bd

    # Border stubs: last OSM node of a way as it leaves the inner bbox.
    stub_cands = []
    for w in hwy_ways:
        ns = w["nodes"]
        pts = [xy[nid] for nid in ns]
        inside = [in_inner(p) for p in pts]
        if not any(inside):
            continue
        for i, p in enumerate(pts):
            if inside[i]:
                continue
            if not in_stub(p):
                continue
            # adjacent to an inside node
            near_in = (i > 0 and inside[i - 1]) or (i + 1 < len(pts) and inside[i + 1])
            if not near_in:
                continue
            sk, sd = snap_keep(p, extra=8)
            if sk is not None and sd <= STUB_SNAP_M:
                continue
            stub_cands.append((p, w["name"], w["highway"], node_streets.get(ns[i], set())))

    # cluster stubs
    used = [False] * len(stub_cands)
    for i, (p, name, h, sts) in enumerate(stub_cands):
        if used[i]:
            continue
        mem = [i]
        used[i] = True
        for j in range(i + 1, len(stub_cands)):
            if used[j]:
                continue
            if dist(p, stub_cands[j][0]) <= STUB_SNAP_M:
                mem.append(j)
                used[j] = True
        xs = [stub_cands[m][0][0] for m in mem]
        ys = [stub_cands[m][0][1] for m in mem]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        names = []
        for m in mem:
            nm = stub_cands[m][1]
            if nm and nm not in names:
                names.append(nm)
        rank = max(HW_RANK.get(stub_cands[m][2], 0) for m in mem)
        label = names[0] if names else "Stub"
        if len(names) >= 2:
            label = f"{names[0]} × {names[1]}"
        k = Keep(label, cx, cy, names[:4], False, STUB_SNAP_M)
        k.stub = True
        k.rank = rank
        keeps.append(k)

    print(f"keeps: signals={sum(1 for k in keeps if k.signalized)} unsig={sum(1 for k in keeps if not k.signalized)} stubs={sum(1 for k in keeps if k.stub)}")

    raw_links = []  # dicts

    def emit(a, b, pts, tags, oneway_flag: bool):
        if a == b or len(pts) < 2:
            return
        ka, kb = keeps[a], keeps[b]
        poly = [(ka.x, ka.y)] + list(pts[1:-1]) + [(kb.x, kb.y)]
        poly = densify_min(densify_max(densify_min(poly, 1.0), MAX_GAP), MIN_PT)
        plen = poly_len(poly)
        if plen < MIN_LINK_M:
            return
        name = short_name(tags.get("name") or tags.get("name:vi") or "")
        h = tags.get("highway") or "tertiary"
        rank = HW_RANK.get(h, 1)
        bridge = bool(tags.get("bridge") and tags.get("bridge") != "no")
        lanes = parse_lanes(tags, rank, bridge)
        raw_links.append(
            {
                "fr": a,
                "to": b,
                "poly": poly,
                "name": name,
                "rank": rank,
                "bridge": bridge,
                "hwy": h,
                "lanes": lanes,
                "oneway": oneway_flag,
                "length": plen,
            }
        )

    # Directed OSM micrograph. Walk keep→keep so links survive way splits.
    adj = defaultdict(list)  # nid -> [(nid2, tags)]
    for w in hwy_ways:
        tags = w["tags"]
        ns = w["nodes"]
        od = oneway_dir(tags)
        for a, b in zip(ns, ns[1:]):
            pa, pb = xy[a], xy[b]
            if dist(pa, pb) < 0.4:
                continue
            if not (in_stub(pa) or in_stub(pb) or in_inner(pa) or in_inner(pb)):
                continue
            if od >= 0:
                adj[a].append((b, tags))
            if od <= 0:
                adj[b].append((a, tags))

    osm_keep = {}
    keep_osms = defaultdict(list)
    for nid, p in xy.items():
        kid, d = snap_keep(p)
        if kid is None:
            continue
        osm_keep[nid] = kid
        keep_osms[kid].append(nid)

    def tags_pick(tag_list):
        if not tag_list:
            return {}
        named = [t for t in tag_list if t.get("name") or t.get("name:vi")]
        pool = named or tag_list
        # prefer the most frequent street name
        names = [short_name(t.get("name") or t.get("name:vi") or "") for t in pool]
        names = [n for n in names if n]
        if names:
            top = Counter(names).most_common(1)[0][0]
            for t in pool:
                if short_name(t.get("name") or t.get("name:vi") or "") == top:
                    return t
        return pool[0]

    for kid in range(len(keeps)):
        starts = keep_osms.get(kid, [])
        if not starts:
            continue
        q = deque()
        prev = {}  # nid -> (prev_nid, tags)
        distm = {}
        for s in starts:
            distm[s] = 0.0
            prev[s] = (None, None)
            q.append(s)
        found = {}  # other_keep -> terminal nid
        while q:
            u = q.popleft()
            if u in osm_keep and osm_keep[u] != kid:
                continue  # terminal, don't expand
            for v, tags in adj[u]:
                if v in distm:
                    continue
                distm[v] = distm[u] + dist(xy[u], xy[v])
                prev[v] = (u, tags)
                if v in osm_keep and osm_keep[v] != kid:
                    bk = osm_keep[v]
                    if bk not in found:
                        found[bk] = v
                    # don't expand other keeps
                    continue
                q.append(v)
        for bk, term in found.items():
            nids = []
            tgs = []
            cur = term
            guard = 0
            while cur is not None and guard < 10000:
                nids.append(cur)
                pr, tg = prev[cur]
                if tg is not None:
                    tgs.append(tg)
                cur = pr
                guard += 1
            nids.reverse()
            tgs.reverse()
            pts = [xy[n] for n in nids]
            tags = tags_pick(tgs)
            if any((tg.get("bridge") and tg.get("bridge") != "no") for tg in tgs):
                tags = dict(tags)
                tags["bridge"] = "yes"
            emit(kid, bk, pts, tags, True)

    # Dedupe same-direction same-name: keep longest / most points.
    # Divided carriageways that share from-to-name collapse to one directed link.
    best: dict[tuple, dict] = {}
    for L in raw_links:
        key = (L["fr"], L["to"], L["name"])
        prev = best.get(key)
        if prev is None or L["length"] > prev["length"] + 1 or (
            abs(L["length"] - prev["length"]) < 1 and len(L["poly"]) > len(prev["poly"])
        ):
            if prev is not None:
                L["lanes"] = max(L["lanes"], prev["lanes"])
            best[key] = L
        else:
            prev["lanes"] = max(prev["lanes"], L["lanes"])
            prev["bridge"] = prev["bridge"] or L["bridge"]
    links = list(best.values())

    # If both A→B and B→A exist, they are two-way (or a divided pair). Mark
    # oneway only when the reverse is absent.
    pair = {(L["fr"], L["to"]) for L in links}
    for L in links:
        has_rev = (L["to"], L["fr"]) in pair
        if has_rev:
            L["oneway"] = False
        else:
            L["oneway"] = True

    # Collapse unsignalized degree-2 nodes (preserve oneway + polyline).
    def collapse_pass(links):
        und = defaultdict(set)
        dout = defaultdict(list)
        for i, L in enumerate(links):
            und[L["fr"]].add(L["to"])
            und[L["to"]].add(L["fr"])
            dout[L["fr"]].append(i)
        used = set()
        for L in links:
            used.add(L["fr"])
            used.add(L["to"])
        skip = set()
        new_links = []
        collapsed = 0
        for root in list(used):
            k = keeps[root]
            if k.signalized:
                continue
            nbs = und[root]
            if len(nbs) != 2:
                continue
            a, b = tuple(nbs)
            if a == b:
                continue

            def find_dir(u, v):
                for i in dout[u]:
                    if i in skip:
                        continue
                    if links[i]["to"] == v:
                        return i
                return None

            did = False
            for u, v in ((a, b), (b, a)):
                i1 = find_dir(u, root)
                i2 = find_dir(root, v)
                if i1 is None or i2 is None:
                    continue
                L1, L2 = links[i1], links[i2]
                poly = L1["poly"][:-1] + L2["poly"]
                poly = densify_min(rdp(poly, RDP_EPS), MIN_PT)
                poly = densify_max(poly, MAX_GAP)

                def pref_name(na, nb):
                    for s in (na, nb):
                        if s.startswith("Cầu") or "Sông Hàn" in s:
                            return s
                    return na or nb

                new_links.append(
                    {
                        "fr": u,
                        "to": v,
                        "poly": poly,
                        "name": pref_name(L1["name"], L2["name"]),
                        "rank": max(L1["rank"], L2["rank"]),
                        "bridge": L1["bridge"] or L2["bridge"],
                        "hwy": L1["hwy"] if L1["rank"] >= L2["rank"] else L2["hwy"],
                        "lanes": max(L1["lanes"], L2["lanes"]),
                        "oneway": L1["oneway"] or L2["oneway"],
                        "length": poly_len(poly),
                    }
                )
                skip.add(i1)
                skip.add(i2)
                did = True
            if did:
                collapsed += 1
                for i, L in enumerate(links):
                    if L["fr"] == root or L["to"] == root:
                        skip.add(i)
        kept = [L for i, L in enumerate(links) if i not in skip]
        return kept + new_links, collapsed

    for _ in range(24):
        links, n = collapse_pass(links)
        if n == 0:
            break

    # Drop unused keeps; drop very short leftovers.
    cleaned = []
    used_k = set()
    for L in links:
        plen = poly_len(L["poly"])
        if plen < MIN_LINK_M:
            continue
        L["length"] = plen
        cleaned.append(L)
        used_k.add(L["fr"])
        used_k.add(L["to"])
    links = cleaned
    for i, k in enumerate(keeps):
        if k.signalized:
            used_k.add(i)

    # Weakly-connected component covering the signals; drop leftover islands.
    und = defaultdict(set)
    for L in links:
        und[L["fr"]].add(L["to"])
        und[L["to"]].add(L["fr"])
    sig_ids = [i for i, k in enumerate(keeps) if k.signalized]
    focus = next((i for i, k in enumerate(keeps) if k.name == "Lê Duẩn × Lê Lợi"), sig_ids[0])
    seen = {focus}
    q = deque([focus])
    while q:
        u = q.popleft()
        for v in und[u]:
            if v not in seen:
                seen.add(v)
                q.append(v)
    missing = [keeps[i].name for i in sig_ids if i not in seen]
    if missing:
        print("WARN: signals not in FOCUS component:", missing)
        # still keep them; try to attach later via unused links
    used_k = {i for i in used_k if i in seen or keeps[i].signalized}
    links = [L for L in links if L["fr"] in used_k and L["to"] in used_k]

    used_list = sorted(used_k, key=lambda i: (keeps[i].x, keeps[i].y))
    # signalized first by west→east (x), then y
    sig_order = sorted((i for i in used_list if keeps[i].signalized), key=lambda i: (keeps[i].x, keeps[i].y))
    rest = [i for i in used_list if not keeps[i].signalized]
    used_list = sig_order + rest
    assert len(sig_order) == SIGNAL_CAP, f"signalized kept {len(sig_order)}"

    # World bounds from nodes + links + context later; first shift after context.
    # Build node/link payload in pocket metres, then translate.

    # Context ways (visual only)
    xs = [keeps[i].x for i in used_list]
    ys = [keeps[i].y for i in used_list]
    cminx, cmaxx = min(xs) - FABRIC_M, max(xs) + FABRIC_M
    cminy, cmaxy = min(ys) - FABRIC_M, max(ys) + FABRIC_M
    context = []
    seen_ctx = set()
    for w in hwy_ways:
        raw = [xy[nid] for nid in w["nodes"]]
        runs = clip_poly_bbox(raw, cminx, cminy, cmaxx, cmaxy, slack=30)
        h = w["highway"]
        rank = HW_RANK.get(h, 1)
        bridge = bool(w["tags"].get("bridge") and w["tags"].get("bridge") != "no")
        if bridge:
            rank = max(rank, 3)
        name = w["name"]
        for run in runs:
            run = densify_min(rdp(run, CONTEXT_RDP), 6.0)
            if len(run) < 2 or poly_len(run) < 28:
                continue
            sig = (round(run[0][0], 0), round(run[0][1], 0), round(run[-1][0], 0), round(run[-1][1], 0), name, len(run))
            if sig in seen_ctx:
                continue
            seen_ctx.add(sig)
            context.append(
                {
                    "name": name,
                    "highway": h,
                    "rank": rank,
                    "bridge": bridge,
                    "poly": run,
                }
            )

    river_pocket = river_pts[:]
    river_runs = clip_poly_bbox(river_pocket, cminx, cminy, cmaxx, cmaxy, slack=180) if river_pocket else []
    if river_runs:
        river = max(river_runs, key=poly_len)
        if river[0][1] > river[-1][1]:
            river = list(reversed(river))
    else:
        river = []

    allx, ally = list(xs), list(ys)
    for c in context:
        for p in c["poly"]:
            allx.append(p[0])
            ally.append(p[1])
    for p in river:
        allx.append(p[0])
        ally.append(p[1])
    minx, maxx = min(allx) - PAD, max(allx) + PAD
    miny, maxy = min(ally) - PAD, max(ally) + PAD
    minx = max(minx, min(xs) - FABRIC_M - 40)
    maxx = min(maxx, max(xs) + FABRIC_M + 40)
    miny = max(miny, min(ys) - FABRIC_M - 40)
    maxy = min(maxy, max(ys) + FABRIC_M + 40)
    worldW = maxx - minx
    worldH = maxy - miny

    def T(p):
        return [round(p[0] - minx, 2), round(p[1] - miny, 2)]

    old_to_new = {old: i for i, old in enumerate(used_list)}
    RIVER_X_LOCAL = (108.227 - LON0) * MX - minx

    out_nodes = []
    for i, old in enumerate(used_list):
        k = keeps[old]
        x, y = T((k.x, k.y))
        uniq = []
        for s in k.streets:
            if s and s not in uniq:
                uniq.append(s)
        district = "Hải Châu" if (k.x - minx) < RIVER_X_LOCAL else "Sơn Trà"
        sig = k.signalized
        sigId = sig_order.index(old) if sig else -1
        out_nodes.append(
            {
                "x": x,
                "y": y,
                "name": k.name,
                "district": district,
                "arterial": k.rank >= 2 or sig or any(
                    s in (k.name + " " + " ".join(uniq))
                    for s in ("Lê Duẩn", "Cầu Sông Hàn", "Ngô Quyền", "Trần Phú", "Bạch Đằng")
                ),
                "signalized": sig,
                "sigId": sigId,
                "rank": max(k.rank, 3 if sig else k.rank),
                "streets": uniq[:4] or [k.name],
            }
        )

    sig_names = {n["name"] for n in out_nodes if n["signalized"]}
    for n in out_nodes:
        if not n["signalized"] and n["name"] in sig_names:
            n["name"] = n["name"] + " (stub)"

    # Recompute oneway after collapse (reverse may have been lost/gained).
    pair = {(old_to_new[L["fr"]], old_to_new[L["to"]]) for L in links if L["fr"] in old_to_new and L["to"] in old_to_new}

    out_links = []
    cx, cy = worldW * 0.5, worldH * 0.5
    undeg = defaultdict(int)
    tmp = []
    for L in links:
        if L["fr"] not in old_to_new or L["to"] not in old_to_new:
            continue
        fr, to = old_to_new[L["fr"]], old_to_new[L["to"]]
        poly = [T(p) for p in L["poly"]]
        length = 0.0
        for i in range(1, len(poly)):
            length += math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1])
        oneway = (to, fr) not in pair
        tmp.append((fr, to, poly, L, length, oneway))
        undeg[fr] += 1
        undeg[to] += 1

    by_pair = {}
    for i, (fr, to, poly, L, length, oneway) in enumerate(tmp):
        by_pair[(fr, to)] = i
    for fr, to, poly, L, length, oneway in tmp:
        if oneway:
            continue
        j = by_pair.get((to, fr))
        if j is None:
            continue
        L2 = tmp[j][3]
        mx = max(L["lanes"], L2["lanes"])
        L["lanes"] = mx
        L2["lanes"] = mx
        if L2.get("bridge") or L.get("bridge"):
            L["bridge"] = True
            L2["bridge"] = True

    edge = 240.0
    for fr, to, poly, L, length, oneway in tmp:
        n0 = out_nodes[fr]
        n1 = out_nodes[to]
        near = (
            n0["x"] < edge
            or n0["y"] < edge
            or n0["x"] > worldW - edge
            or n0["y"] > worldH - edge
            or undeg[fr] <= 2
            or (not n0["signalized"] and (n0["x"] < 80 or n0["y"] < 80 or n0["x"] > worldW - 80 or n0["y"] > worldH - 80))
        )
        inward = (n1["x"] - n0["x"]) * (cx - n0["x"]) + (n1["y"] - n0["y"]) * (cy - n0["y"])
        spawn = bool(near and inward > 40)
        rec = {
            "from": fr,
            "to": to,
            "poly": poly,
            "name": L["name"],
            "arterial": L["rank"] >= 2 or L["bridge"],
            "bridge": L["bridge"],
            "speedLimit": 13.5 if L["rank"] >= 3 or L["bridge"] else (12.0 if L["rank"] == 2 else 10.5),
            "length": round(length, 2),
            "spawn": spawn,
            "lanes": int(L["lanes"]),
            "widthM": round(max(3.5, L["lanes"] * 3.5), 1),
        }
        if oneway:
            rec["oneway"] = True
        out_links.append(rec)

    for c in context:
        c["poly"] = [T(p) for p in c["poly"]]
    context = [c for c in context if len(c["poly"]) >= 2]
    river = [T(p) for p in river]
    riverX = sum(p[0] for p in river) / max(1, len(river)) if river else RIVER_X_LOCAL

    notes = [
        "Directed links follow OSM oneway (no pair() both-ways)",
        "Lê Lợi is OSM oneway=yes southbound (node order north→south; y-down canvas)",
        "Unsignalized degree-2 vertices collapsed into polylines",
        "20 signalized junctions around Lê Duẩn × Lê Lợi feeding Cầu Sông Hàn",
        "Visual OSM context layer (not simulated) ~500 m around the pocket",
        "Unsignalized stubs kept for spawn onto legal outgoing directions only",
    ]

    out = {
        "source": "OpenStreetMap © contributors",
        "area": "Đà Nẵng · Lê Duẩn × Lê Lợi · Cầu Sông Hàn · 20 đèn",
        "bbox": [16.038, 16.080, 108.208, 108.252],
        "worldW": round(worldW, 2),
        "worldH": round(worldH, 2),
        "riverX": round(riverX, 2),
        "river": river,
        "nodes": out_nodes,
        "links": out_links,
        "context": context,
        "signalCount": SIGNAL_CAP,
        "simplifications": {
            "pocket": "Lê Duẩn × Lê Lợi feeding Cầu Sông Hàn",
            "signalsCapped": SIGNAL_CAP,
            "contextWays": len(context),
            "onewayFromOsm": True,
            "notes": notes,
        },
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2))

    nsig = sum(1 for n in out_nodes if n["signalized"])
    print(f"wrote {OUT}")
    print(f"world {worldW:.0f} x {worldH:.0f} m  nodes={len(out_nodes)} links={len(out_links)} signals={nsig} context={len(context)} spawn={sum(1 for L in out_links if L['spawn'])}")
    print("junctions:")
    for n in out_nodes:
        if n["signalized"]:
            print(f"  sigId {n['sigId']:2d}  {n['name']:36s}  ({n['x']:.0f},{n['y']:.0f}) {n['district']}")

    # Verify Lê Lợi
    leloi = [L for L in out_links if "Lê Lợi" in (L["name"] or "")]
    print(f"\nLê Lợi links: {len(leloi)}")
    revs = 0
    for L in leloi:
        a, b = out_nodes[L["from"]], out_nodes[L["to"]]
        dy = b["y"] - a["y"]
        ow = L.get("oneway")
        print(f"  {a['name'][:28]:28s} → {b['name'][:28]:28s}  dy={dy:+7.1f}  lanes={L['lanes']} oneway={ow} spawn={L['spawn']}")
        if dy < -15:
            revs += 1
    print(f"Lê Lợi northbound (illegal) count: {revs}")

    for street in ("Bạch Đằng", "Trần Phú", "Nguyễn Chí Thanh", "Ngô Quyền"):
        sl = [L for L in out_links if street in (L["name"] or "")]
        both = 0
        dirs = []
        seen_pair = set()
        for L in sl:
            key = (min(L["from"], L["to"]), max(L["from"], L["to"]))
            has_rev = any(o["from"] == L["to"] and o["to"] == L["from"] for o in sl)
            if has_rev:
                both += 1
            a, b = out_nodes[L["from"]], out_nodes[L["to"]]
            dirs.append((a["name"], b["name"], b["y"] - a["y"], b["x"] - a["x"], L.get("oneway"), has_rev))
        print(f"{street}: {len(sl)} links, bidirectional-pairs={both//2}")
        for d in dirs:
            print(f"    {d[0][:24]:24s} → {d[1][:24]:24s}  dy={d[2]:+7.1f} dx={d[3]:+7.1f} oneway={d[4]} rev={d[5]}")

    # weakly connected
    und2 = defaultdict(set)
    for L in out_links:
        und2[L["from"]].add(L["to"])
        und2[L["to"]].add(L["from"])
    s0 = next(i for i, n in enumerate(out_nodes) if n["signalized"])
    seen2 = {s0}
    q = deque([s0])
    while q:
        u = q.popleft()
        for v in und2[u]:
            if v not in seen2:
                seen2.add(v)
                q.append(v)
    print(f"weakly connected {len(seen2)}/{len(out_nodes)}")
    orphan_sig = [n["name"] for i, n in enumerate(out_nodes) if n["signalized"] and i not in seen2]
    if orphan_sig:
        print("ORPHAN SIGNALS", orphan_sig)

    print("oneway links", sum(1 for L in out_links if L.get("oneway")), "/", len(out_links))
    print("poly pts", dict(Counter(len(L["poly"]) for L in out_links)))
    print("lanes", dict(Counter(L["lanes"] for L in out_links)))


if __name__ == "__main__":
    main()
