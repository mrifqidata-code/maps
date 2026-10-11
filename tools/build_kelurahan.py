"""Bangun data/kelurahan-jabodetabek.json dari data batas desa/kelurahan Dukcapil.

Sumber: https://github.com/pararawendy/border-desa-indonesia-geojson
(indonesia_villages_border.geojson, asal: Portal GIS Dukcapil Kemendagri).

Pemakaian:
    python3 tools/build_kelurahan.py path/ke/indonesia_villages_border.geojson

Output ringkas (koordinat dikali 10.000, disimpan sebagai selisih antar-titik):
    {"v":1, "kab":[nama...], "kec":[[nama, idxKab]...],
     "kel":[[nama, idxKec, [x0,y0,dx,dy,...], [ring lain]...], ...]}
"""
import json
import sys

AREAS = {
    'DKI JAKARTA': None,  # semua kota/kabupaten
    'JAWA BARAT': {'KOTA BEKASI', 'BEKASI', 'KOTA DEPOK', 'KOTA BOGOR', 'BOGOR'},
    'BANTEN': {'KOTA TANGERANG', 'KOTA TANGERANG SELATAN', 'TANGERANG'},
}
# Nama kabupaten diberi awalan supaya tidak tertukar dengan kotanya.
KAB_LABEL = {'BEKASI': 'KAB. BEKASI', 'BOGOR': 'KAB. BOGOR', 'TANGERANG': 'KAB. TANGERANG'}
TOLERANCE = 1.2  # dalam satuan 1e-4 derajat (~13 m)


def simplify(pts, tol):
    """Douglas-Peucker pada list titik integer."""
    if len(pts) < 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        norm = (dx * dx + dy * dy) ** 0.5
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / norm if norm else ((px - ax) ** 2 + (py - ay) ** 2) ** 0.5
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    out = [p for p, k in zip(pts, keep) if k]
    return out if len(out) >= 4 else pts


def encode(ring):
    pts = [(round(x * 10000), round(y * 10000)) for x, y in ring]
    dedup = [pts[0]]
    for p in pts[1:]:
        if p != dedup[-1]:
            dedup.append(p)
    if dedup[0] != dedup[-1]:
        dedup.append(dedup[0])
    s = simplify(dedup, TOLERANCE)
    flat = [s[0][0], s[0][1]]
    for (x0, y0), (x1, y1) in zip(s, s[1:]):
        flat += [x1 - x0, y1 - y0]
    return flat, len(dedup), len(s)


def main(src, dst):
    data = json.load(open(src))
    kab_idx, kec_idx = {}, {}
    kab, kec, kel = [], [], []
    before = after = 0
    for d in data:
        prov, dist = d.get('province'), d.get('district')
        if prov not in AREAS or (AREAS[prov] is not None and dist not in AREAS[prov]):
            continue
        kab_name = KAB_LABEL.get(dist, dist)
        if kab_name not in kab_idx:
            kab_idx[kab_name] = len(kab)
            kab.append(kab_name)
        kkey = (d['sub_district'], kab_name)
        if kkey not in kec_idx:
            kec_idx[kkey] = len(kec)
            kec.append([d['sub_district'], kab_idx[kab_name]])
        border = d['border']
        rings = border if border and isinstance(border[0][0], list) else [border]
        enc = []
        for r in rings:
            if len(r) < 3:
                continue
            flat, b, a = encode(r)
            before += b
            after += a
            enc.append(flat)
        if enc:
            kel.append([d['village'], kec_idx[kkey]] + enc)
    out = {'v': 1, 'src': 'Dukcapil Kemendagri via github.com/pararawendy/border-desa-indonesia-geojson',
           'scale': 10000, 'kab': kab, 'kec': kec, 'kel': kel}
    with open(dst, 'w') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
    print(f'{len(kel)} kelurahan, {len(kec)} kecamatan, {len(kab)} kota/kab; titik {before} -> {after}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'data/kelurahan-jabodetabek.json')
