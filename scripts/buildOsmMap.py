#!/usr/bin/env python3
"""Build a Da Nang arterial graph from Overpass JSON for GreenWave."""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OSM_PATH = ROOT / "data" / "danang-overpass.json"
OUT_PATH = ROOT / "src" / "sim" / "mapGraph.json"

LAT0, LON0 = 16.06, 108.23
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 110540.0
BBOX = (16.038, 16.080, 108.208, 108.252)  # s, n, w, e
HW_KEEP = {"trunk", "primary", "secondary", "tertiary"}
RANK = {"trunk": 4, "primary": 3, "secondary": 2, "tertiary": 1}
MERGE_M = 32.0
SNAP_M = 40.0
SPACING_M = 108.0
TARGET_LO, TARGET_HI = 28, 40
PAD = 120.0
RDP_EPS = 6.0
MIN_PT = 4.0

FORCE_SUBSTR = (
    "Cầu Rồng",
    "Cầu Sông Hàn",
    "Cầu Trần Thị Lý",
    "Bạch Đằng",
    "Võ Nguyên Giáp",
    "Lê Duẩn",
    "Nguyễn Văn Linh",
    "Phạm Văn Đồng",
    "Trần Hưng Đạo",
    "Ngô Quyền",
    "2 Tháng 9",
    "Nguyễn Tất Thành",
    "Trần Phú",
    "Võ Văn Kiệt",
)

NOTABLE_SUBSTR = FORCE_SUBSTR + (
    "Nguyễn Hữu Thọ",
    "Trần Thị Lý",
    "Hùng Vương",
    "Phan Châu Trinh",
    "Quang Trung",
    "Núi Thành",
    "Hồ Xuân Hương",
)


def proj(lat: float, lon: float) -> tuple[float, float]:
    # Y-down (canvas): north = smaller y
    return ((lon - LON0) * MX, (LAT0 - lat) * MY)


def unproj(x: float, y: float) -> tuple[float, float]:
    lon = LON0 + x / MX
    lat = LAT0 - y / MY
    return lat, lon


def in_bbox(lat: float, lon: float, pad_deg: float = 0.004) -> bool:
    s, n, w, e = BBOX
    return (s - pad_deg) <= lat <= (n + pad_deg) and (w - pad_deg) <= lon <= (e + pad_deg)


def short_name(n: str) -> str:
    n = n.replace("Đường ", "").replace("đường ", "")
    return n.strip()


def has_substr(names: list[str] | set[str], needles: tuple[str, ...]) -> bool:
    for nm in names:
        for k in needles:
            if k in nm:
                return True
    return False


def rdp(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts[:]
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


def densify_min(pts: list[tuple[float, float]], min_pt: float) -> list[tuple[float, float]]:
    out = [pts[0]]
    for p in pts[1:]:
        if math.hypot(p[0] - out[-1][0], p[1] - out[-1][1]) >= min_pt:
            out.append(p)
        else:
            out[-1] = p  # keep later (closer to next junction)
    if out[-1] != pts[-1]:
        out.append(pts[-1])
    if len(out) == 1:
        out.append(pts[-1])
    return out


class UF:
    def __init__(self, items):
        self.p = {i: i for i in items}

    def find(self, a):
        p = self.p
        while p[a] != a:
            p[a] = p[p[a]]
            a = p[a]
        return a

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[rb] = ra


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
                    "lat": e["lat"],
                    "lon": e["lon"],
                    "tags": dict(e.get("tags") or {}),
                }
            else:
                nodes[nid]["lat"] = e.get("lat", nodes[nid]["lat"])
                nodes[nid]["lon"] = e.get("lon", nodes[nid]["lon"])
                nodes[nid]["tags"].update(e.get("tags") or {})
        elif e["type"] == "way":
            ways.append(e)
    return nodes, ways


def main():
    nodes, ways = load_osm()
    xy = {}
    for nid, n in nodes.items():
        xy[nid] = proj(n["lat"], n["lon"])

    CLIP = 0.0025

    def node_in(nid, pad=CLIP):
        n = nodes[nid]
        return in_bbox(n["lat"], n["lon"], pad)

    def clip_ns(ns):
        if not ns:
            return []
        inside = [node_in(nid) for nid in ns]
        if not any(inside):
            return []
        keep_i = set()
        for i, ok in enumerate(inside):
            if ok:
                keep_i.add(i)
                if i > 0:
                    keep_i.add(i - 1)
                if i + 1 < len(ns):
                    keep_i.add(i + 1)
        return [ns[i] for i in range(len(ns)) if i in keep_i]

    arterial = []
    river_pts = []
    for w in ways:
        tgs = w.get("tags") or {}
        if tgs.get("name") == "Sông Hàn" and tgs.get("waterway") == "river":
            river_pts = [
                xy[nid]
                for nid in w.get("nodes") or []
                if nid in xy and node_in(nid, 0.012)
            ]
        h = tgs.get("highway")
        if h not in HW_KEEP:
            continue
        ns = clip_ns([nid for nid in (w.get("nodes") or []) if nid in nodes])
        if len(ns) < 2:
            continue
        w = dict(w)
        w["nodes"] = ns
        arterial.append(w)

    # undirected adjacency of OSM nodes
    nbr: dict[int, set[int]] = defaultdict(set)
    way_of: dict[int, list] = defaultdict(list)
    for w in arterial:
        ns = [nid for nid in w["nodes"] if nid in nodes]
        t = w.get("tags") or {}
        for nid in ns:
            way_of[nid].append(t)
        for a, b in zip(ns, ns[1:]):
            nbr[a].add(b)
            nbr[b].add(a)

    sigs = [
        n
        for n in nodes.values()
        if n["tags"].get("highway") in ("traffic_signals", "traffic_signals;crossing")
        or "traffic_signals" in n["tags"].get("highway", "")
    ]

    def nearest_graph(lat, lon):
        x, y = proj(lat, lon)
        best, bd = None, 1e18
        for nid in nbr:
            px, py = xy[nid]
            d = math.hypot(x - px, y - py)
            if d < bd:
                bd, best = d, nid
        return best, bd

    sig_snap: dict[int, float] = {}
    for s in sigs:
        nid, d = nearest_graph(s["lat"], s["lon"])
        if nid is not None and d <= SNAP_M:
            if nid not in sig_snap or d < sig_snap[nid]:
                sig_snap[nid] = d

    # keep vertices: deg != 2 or signal snap
    keep = set()
    for nid, adj in nbr.items():
        if len(adj) != 2 or nid in sig_snap:
            keep.add(nid)

    # merge keep vertices within MERGE_M
    uf = UF(keep)
    keep_list = list(keep)
    cell = MERGE_M
    grid = defaultdict(list)
    for nid in keep_list:
        x, y = xy[nid]
        grid[(int(x // cell), int(y // cell))].append(nid)
    for (cx, cy), arr in list(grid.items()):
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                oth = grid.get((cx + dx, cy + dy), [])
                for a in arr:
                    ax, ay = xy[a]
                    for b in oth:
                        if a >= b:
                            continue
                        bx, by = xy[b]
                        if math.hypot(ax - bx, ay - by) <= MERGE_M:
                            uf.union(a, b)

    clusters: dict = defaultdict(list)
    for nid in keep_list:
        clusters[uf.find(nid)].append(nid)

    # cluster metadata
    def cl_meta(mem):
        xs = [xy[m][0] for m in mem]
        ys = [xy[m][1] for m in mem]
        cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
        names = set()
        rank = 0
        bridge = False
        for m in mem:
            for t in way_of[m]:
                h = t.get("highway")
                rank = max(rank, RANK.get(h, 0))
                if t.get("name"):
                    names.add(t["name"])
                if t.get("bridge") and t.get("bridge") != "no":
                    bridge = True
        has_sig = any(m in sig_snap for m in mem)
        lat, lon = unproj(cx, cy)
        force = has_substr(names, FORCE_SUBSTR)
        notable = has_substr(names, NOTABLE_SUBSTR)
        # undirected degree after merge: unique neighbor clusters + un-kept neighbors
        deg = 0
        seen_nb = set()
        for m in mem:
            for nb in nbr[m]:
                if nb in keep:
                    r = uf.find(nb)
                    if r == uf.find(mem[0]):
                        continue
                    if r not in seen_nb:
                        seen_nb.add(r)
                        deg += 1
                else:
                    # geometry neighbor that isn't a keep — still a connection along a way
                    pass
        return {
            "mem": mem,
            "x": cx,
            "y": cy,
            "lat": lat,
            "lon": lon,
            "names": names,
            "rank": rank,
            "bridge": bridge,
            "has_sig": has_sig,
            "force": force,
            "notable": notable,
            "deg": deg,
        }

    metas = []
    for root, mem in clusters.items():
        m = cl_meta(mem)
        m["root"] = root
        if not in_bbox(m["lat"], m["lon"], 0.006):
            continue
        metas.append(m)

    def score(m):
        s = 0.0
        if m["has_sig"]:
            s += 100
        s += m["rank"] * 16
        if m["bridge"]:
            s += 28
        if m["force"]:
            s += 24
        if m["notable"]:
            s += 10
        if m["deg"] >= 4:
            s += 8
        # Dragon / Han / beach / Bach Dang extra
        blob = " ".join(m["names"])
        if "Cầu Rồng" in blob:
            s += 40
        if "Cầu Sông Hàn" in blob or "Sông Hàn" in blob and "Cầu" in blob:
            s += 30
        if "Cầu Trần Thị Lý" in blob or "Trần Thị Lý" in blob:
            s += 22
        if "Bạch Đằng" in blob:
            s += 18
        if "Võ Nguyên Giáp" in blob:
            s += 22
        return s

    # force-pick clusters near known landmarks
    landmarks = [
        (16.06100, 108.22435, "Dragon W"),
        (16.06120, 108.23145, "Dragon E"),
        (16.07200, 108.22650, "Han Bridge W"),
        (16.07250, 108.23050, "Han Bridge E"),
        (16.05040, 108.22650, "TTL W"),
        (16.05090, 108.23350, "TTL E"),
        (16.0665, 108.2472, "Giap PVD"),
        (16.0614, 108.2478, "Giap My Khe"),
        (16.0540, 108.2475, "Giap mid"),
        (16.0465, 108.2478, "Giap south"),
    ]

    def nearest_meta(lat, lon, maxd=180):
        x, y = proj(lat, lon)
        best, bd = None, 1e18
        for m in metas:
            d = math.hypot(x - m["x"], y - m["y"])
            if d < bd:
                bd, best = d, m
        return best, bd

    forced = []
    used_ids = set()
    for lat, lon, _lab in landmarks:
        m, d = nearest_meta(lat, lon, 180)
        if m is not None and d <= 180 and id(m) not in used_ids:
            forced.append(m)
            used_ids.add(id(m))

    # plus high-score force-name clusters
    for m in metas:
        if m["force"] and m["has_sig"] and id(m) not in used_ids:
            # don't dump all Bach Dang — greedy with spacing later
            pass

    ranked = sorted(metas, key=lambda m: -score(m))
    picked = []
    picked_ids = set()

    def far_enough(m, min_d):
        for p in picked:
            if math.hypot(m["x"] - p["x"], m["y"] - p["y"]) < min_d:
                return False
        return True

    # 1. landmarks
    for m in forced:
        if far_enough(m, 70):
            picked.append(m)
            picked_ids.add(id(m))

    # 2. greedy by score, prefer signaled arterials
    for m in ranked:
        if id(m) in picked_ids:
            continue
        if not (m["has_sig"] or m["bridge"] or m["rank"] >= 3 or (m["force"] and m["rank"] >= 2)):
            continue
        if not far_enough(m, SPACING_M):
            continue
        picked.append(m)
        picked_ids.add(id(m))
        if len(picked) >= TARGET_HI:
            break

    # 2b. force beach (Võ Nguyên Giáp) even if unsignalized in OSM
    for m in ranked:
        if id(m) in picked_ids:
            continue
        if not has_substr(m["names"], ("Võ Nguyên Giáp",)):
            continue
        if not far_enough(m, 140):
            continue
        picked.append(m)
        picked_ids.add(id(m))
        if sum(1 for p in picked if has_substr(p["names"], ("Võ Nguyên Giáp",))) >= 4:
            break

    # 3. fill to TARGET_LO with remaining high rank even without signal
    if len(picked) < TARGET_LO:
        for m in ranked:
            if id(m) in picked_ids:
                continue
            if m["rank"] < 2:
                continue
            if not far_enough(m, SPACING_M * 0.85):
                continue
            picked.append(m)
            picked_ids.add(id(m))
            if len(picked) >= TARGET_LO:
                break

    must, other = [], []
    must_ids = set(id(m) for m in forced)
    for m in picked:
        blob = " ".join(m["names"])
        keep_must = (
            id(m) in must_ids
            or "Võ Nguyên Giáp" in blob
            or "Cầu Rồng" in blob
            or "Cầu Sông Hàn" in blob
            or "Trần Thị Lý" in blob
            or "Bạch Đằng" in blob
            or "Trần Hưng Đạo" in blob
        )
        if keep_must:
            must.append(m)
        else:
            other.append(m)
    other.sort(key=lambda m: -score(m))
    cap = 40
    picked = must + other[: max(0, cap - len(must))]
    if len(picked) > 45:
        picked = picked[:45]

    signal_roots = {m["root"] for m in picked}

    # Map every keep OSM node -> cluster root
    osm_to_root = {nid: uf.find(nid) for nid in keep}

    # Build directed segments split at keep nodes
    # First: map root -> centroid xy
    root_xy = {}
    root_meta = {}
    for m in metas:
        root_xy[m["root"]] = (m["x"], m["y"])
        root_meta[m["root"]] = m
    # clusters outside bbox skipped from metas — still need xy
    for root, mem in clusters.items():
        if root not in root_xy:
            xs = [xy[n][0] for n in mem]
            ys = [xy[n][1] for n in mem]
            root_xy[root] = (sum(xs) / len(xs), sum(ys) / len(ys))
            names = set()
            rank = 0
            for n in mem:
                for t in way_of[n]:
                    rank = max(rank, RANK.get(t.get("highway"), 0))
                    if t.get("name"):
                        names.add(t["name"])
            root_meta[root] = {
                "mem": mem,
                "x": root_xy[root][0],
                "y": root_xy[root][1],
                "names": names,
                "rank": rank,
                "bridge": False,
                "has_sig": any(n in sig_snap for n in mem),
                "force": has_substr(names, FORCE_SUBSTR),
                "notable": has_substr(names, NOTABLE_SUBSTR),
                "lat": unproj(*root_xy[root])[0],
                "lon": unproj(*root_xy[root])[1],
                "deg": 0,
                "root": root,
            }

    def oneway_dir(tags):
        o = (tags.get("oneway") or "no").lower()
        if o in ("yes", "true", "1"):
            return 1
        if o in ("-1", "reverse"):
            return -1
        return 0  # both

    raw_links = []  # dicts with from_root, to_root, poly, name, rank, bridge, hwy

    def emit_seg(a_root, b_root, pts, tags):
        if a_root == b_root:
            return
        if len(pts) < 2:
            return
        # replace endpoints with cluster centroids so links meet
        ax, ay = root_xy[a_root]
        bx, by = root_xy[b_root]
        poly = [(ax, ay)] + pts[1:-1] + [(bx, by)]
        poly = densify_min(rdp(poly, RDP_EPS), MIN_PT)
        if len(poly) < 2:
            poly = [(ax, ay), (bx, by)]
        name = tags.get("name") or tags.get("name:vi") or ""
        h = tags.get("highway") or "tertiary"
        rank = RANK.get(h, 1)
        bridge = bool(tags.get("bridge") and tags.get("bridge") != "no")
        raw_links.append(
            {
                "fr": a_root,
                "to": b_root,
                "poly": poly,
                "name": name,
                "rank": rank,
                "bridge": bridge,
                "hwy": h,
            }
        )

    for w in arterial:
        tags = w.get("tags") or {}
        ns = [nid for nid in w["nodes"] if nid in nodes]
        # split at keep nodes
        splits = []  # indices that are keep
        for i, nid in enumerate(ns):
            if nid in keep:
                splits.append(i)
        if len(splits) < 2:
            # whole way between non-keep — skip or use endpoints as keep
            if ns[0] in keep and ns[-1] in keep:
                splits = [0, len(ns) - 1]
            else:
                continue
        # ensure first/last if they're keep
        od = oneway_dir(tags)
        for i0, i1 in zip(splits, splits[1:]):
            a, b = ns[i0], ns[i1]
            ar, br = osm_to_root[a], osm_to_root[b]
            pts = [xy[ns[k]] for k in range(i0, i1 + 1)]
            if od >= 0:
                emit_seg(ar, br, pts, tags)
            if od <= 0:
                emit_seg(br, ar, list(reversed(pts)), tags)

    # Now collapse unsignalized degree-2 cluster nodes
    # Build undirected neighbor clusters from raw_links
    def build_adj(links):
        und = defaultdict(set)
        dout = defaultdict(list)  # root -> list of link indices
        for i, L in enumerate(links):
            und[L["fr"]].add(L["to"])
            und[L["to"]].add(L["fr"])
            dout[L["fr"]].append(i)
        return und, dout

    links = raw_links

    def collapse_pass(links):
        und, dout = build_adj(links)
        # nodes that appear
        used = set()
        for L in links:
            used.add(L["fr"])
            used.add(L["to"])
        collapsed = set()
        new_links = []
        skip_idx = set()
        for root in list(used):
            if root in signal_roots:
                continue
            nbs = und[root]
            if len(nbs) != 2:
                continue
            a, b = tuple(nbs)
            if a == b:
                continue
            # find A->root and root->B etc
            def find_dir(u, v):
                for i in dout[u]:
                    if i in skip_idx:
                        continue
                    if links[i]["to"] == v:
                        return i
                return None

            # we will mark this root collapsed
            collapsed.add(root)
            for u, v in ((a, b), (b, a)):
                i1 = find_dir(u, root)
                i2 = find_dir(root, v)
                if i1 is None or i2 is None:
                    continue
                L1, L2 = links[i1], links[i2]
                poly = L1["poly"][:-1] + L2["poly"]
                poly = densify_min(rdp(poly, RDP_EPS), MIN_PT)
                def pref_name(a, b):
                    for s in (a, b):
                        if s.startswith("Cầu") or "Rồng" in s or "Sông Hàn" in s:
                            return s
                    return a or b
                new_links.append(
                    {
                        "fr": u,
                        "to": v,
                        "poly": poly,
                        "name": pref_name(L1["name"], L2["name"]),
                        "rank": max(L1["rank"], L2["rank"]),
                        "bridge": L1["bridge"] or L2["bridge"],
                        "hwy": L1["hwy"] if L1["rank"] >= L2["rank"] else L2["hwy"],
                    }
                )
                skip_idx.add(i1)
                skip_idx.add(i2)
            # drop other links involving root
            for i, L in enumerate(links):
                if L["fr"] == root or L["to"] == root:
                    skip_idx.add(i)
        kept = [L for i, L in enumerate(links) if i not in skip_idx]
        return kept + new_links, len(collapsed)

    # iterate collapse
    for _ in range(20):
        links, n = collapse_pass(links)
        if n == 0:
            break

    # Drop unused roots; drop very short links
    used = set()
    cleaned = []
    for L in links:
        plen = 0.0
        p = L["poly"]
        for i in range(1, len(p)):
            plen += math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])
        if plen < 12:
            continue
        L["length"] = plen
        cleaned.append(L)
        used.add(L["fr"])
        used.add(L["to"])
    links = cleaned

    # Reindex nodes
    # Prefer keeping signal_roots even if unused (shouldn't happen)
    for r in signal_roots:
        used.add(r)

    # Sort nodes: signalized first? We'll assign sequential ids, signalized get sigId
    # Order by y then x for stability
    used_list = sorted(used, key=lambda r: (root_xy[r][1], root_xy[r][0]))

    # World bounds from all geometry
    allx, ally = [], []
    for r in used_list:
        allx.append(root_xy[r][0])
        ally.append(root_xy[r][1])
    for L in links:
        for x, y in L["poly"]:
            allx.append(x)
            ally.append(y)
    for x, y in river_pts:
        allx.append(x)
        ally.append(y)
    minx, maxx = min(allx), max(allx)
    miny, maxy = min(ally), max(ally)
    # shift to pad
    ox, oy = minx - PAD, miny - PAD
    world_w = (maxx - minx) + 2 * PAD
    world_h = (maxy - miny) + 2 * PAD

    def S(p):
        return [round(p[0] - ox, 2), round(p[1] - oy, 2)]

    root_id = {r: i for i, r in enumerate(used_list)}

    # signalized among used
    sig_nodes = [r for r in used_list if r in signal_roots]
    # If some picked roots were collapsed away, that's ok
    sig_id_of = {}
    k = 0
    for r in used_list:
        if r in signal_roots:
            sig_id_of[r] = k
            k += 1

    RIVER_X_LOCAL = (108.227 - LON0) * MX - ox  # approx river x in world

    out_nodes = []
    for r in used_list:
        m = root_meta[r]
        x, y = S(root_xy[r])
        names = [short_name(n) for n in sorted(m["names"])]
        # junction label: two crossing streets
        uniq = []
        for n in names:
            if n and n not in uniq:
                uniq.append(n)
        if len(uniq) >= 2:
            label = f"{uniq[0]} × {uniq[1]}"
        elif uniq:
            label = uniq[0]
        else:
            label = "Junction"
        district = "Hải Châu" if (root_xy[r][0] - ox) < RIVER_X_LOCAL else "Sơn Trà"
        # beach / east of Ngô Quyền is Sơn Trà already
        arterial = m["rank"] >= 2
        sig = r in signal_roots
        out_nodes.append(
            {
                "x": x,
                "y": y,
                "name": label,
                "district": district,
                "arterial": arterial,
                "signalized": sig,
                "sigId": sig_id_of.get(r, -1),
                "rank": m["rank"],
                "streets": uniq[:4],
            }
        )

    out_links = []
    for L in links:
        if L["fr"] not in root_id or L["to"] not in root_id:
            continue
        poly = [S(p) for p in L["poly"]]
        # length in world (same as meters)
        length = 0.0
        for i in range(1, len(poly)):
            length += math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1])
        out_links.append(
            {
                "from": root_id[L["fr"]],
                "to": root_id[L["to"]],
                "poly": poly,
                "name": short_name(L["name"]),
                "arterial": L["rank"] >= 2,
                "bridge": L["bridge"],
                "speedLimit": 13.5 if L["rank"] >= 3 else (12.0 if L["rank"] == 2 else 10.5),
                "length": round(length, 2),
            }
        )

    # spawn: from-node near world edge AND link points inward
    cx, cy = world_w * 0.5, world_h * 0.5
    edge = 240.0
    undeg = defaultdict(int)
    for L in out_links:
        undeg[L["from"]] += 1
        undeg[L["to"]] += 1
    for L in out_links:
        n0 = out_nodes[L["from"]]
        n1 = out_nodes[L["to"]]
        near = (
            n0["x"] < edge
            or n0["y"] < edge
            or n0["x"] > world_w - edge
            or n0["y"] > world_h - edge
            or undeg[L["from"]] <= 2
        )
        inward = (n1["x"] - n0["x"]) * (cx - n0["x"]) + (n1["y"] - n0["y"]) * (cy - n0["y"])
        L["spawn"] = bool(near and inward > 40)

    RENAME = [
        (16.06100, 108.22435, "Cầu Rồng Tây", 140),
        (16.06120, 108.23145, "Cầu Rồng Đông", 220),
        (16.07220, 108.22620, "Cầu Sông Hàn Tây", 140),
        (16.07250, 108.23050, "Cầu Sông Hàn Đông", 160),
        (16.05040, 108.22650, "Cầu Trần Thị Lý Tây", 140),
        (16.05090, 108.23350, "Cầu Trần Thị Lý Đông", 140),
        (16.0614, 108.2478, "Mỹ Khê / Võ Nguyên Giáp", 160),
    ]
    for lat, lon, label, rad in RENAME:
        x, y = S(proj(lat, lon))
        best, bd = None, 1e18
        for n in out_nodes:
            d = math.hypot(n["x"] - x, n["y"] - y)
            if d < bd:
                bd, best = d, n
        if best is not None and bd <= rad:
            best["name"] = label

    river = [S(p) for p in river_pts]
    # clip river roughly to world
    river = [p for p in river if -200 < p[0] < world_w + 200 and -200 < p[1] < world_h + 200]

    # stats
    n_sig = sum(1 for n in out_nodes if n["signalized"])
    notable = [n["name"] for n in out_nodes if n["signalized"]]
    print(f"nodes={len(out_nodes)} signalized={n_sig} links={len(out_links)} spawn={sum(1 for L in out_links if L['spawn'])}")
    print(f"world={world_w:.0f}x{world_h:.0f}")
    print("signalized junctions:")
    for n in out_nodes:
        if n["signalized"]:
            print(f"  [{n['sigId']:2d}] {n['name'][:48]:48s} {n['district']:10s} ({n['x']:.0f},{n['y']:.0f})")

    payload = {
        "source": "OpenStreetMap © contributors",
        "area": "Đà Nẵng · Hải Châu–Sơn Trà",
        "bbox": list(BBOX),
        "worldW": round(world_w, 2),
        "worldH": round(world_h, 2),
        "riverX": round(RIVER_X_LOCAL, 2),
        "river": river,
        "nodes": out_nodes,
        "links": out_links,
        "signalCount": n_sig,
        "simplifications": {
            "mergeM": MERGE_M,
            "snapM": SNAP_M,
            "spacingM": SPACING_M,
            "highways": sorted(HW_KEEP),
            "collapsedDegree2": True,
            "signalsCapped": n_sig,
            "notes": [
                "Unsignalized degree-2 vertices collapsed into polylines",
                "Dual carriageways follow OSM oneway tags",
                "Signals snapped to nearest arterial node within 40m then merged at 32m",
                "Cap on arterial skeleton (trunk/primary/secondary + key tertiary/bridges)",
            ],
        },
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    print("wrote", OUT_PATH, "bytes", OUT_PATH.stat().st_size)


if __name__ == "__main__":
    main()
