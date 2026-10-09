import sys, os, math
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
OUT = sys.argv[1]
F = os.path.join(os.path.dirname(__file__), "fonts")
M = lambda w: TTFont(f"{F}/fontsource-montserrat-5.0.8/package/files/montserrat-latin-{w}-normal.woff")
E = lambda w: TTFont(f"{F}/fontsource-exo-2-5.0.8/package/files/exo-2-latin-{w}-normal.woff")
fonts = {"m700": M(700), "m600": M(600), "e300": E(300), "e400": E(400)}

def run(font, s, size, tracking=0.0):
    gs = font.getGlyphSet(); cmap = font.getBestCmap(); upm = font["head"].unitsPerEm
    sc = size/upm; x = 0; parts = []
    for i, ch in enumerate(s):
        g = cmap[ord(ch)]
        parts.append((g, x))
        x += gs[g].width*sc + (tracking if i < len(s)-1 else 0)
    return parts, x, sc, gs

def draw(font, s, size, ox, oy, tracking=0.0):
    parts, w, sc, gs = run(font, s, size, tracking)
    pen = SVGPathPen(gs)
    for g, x in parts:
        gs[g].draw(TransformPen(pen, (sc, 0, 0, -sc, ox + x, oy)))
    return pen.getCommands(), w

def width(font, s, size, tracking=0.0): return run(font, s, size, tracking)[1]

def wordmark(x, y, anchor="start", dark=False):
    """Allianz(202) on line 1, NETWORK justified to the same width on line 2."""
    a_sz, n_sz, gap = 52, 33, 5
    wa = width(fonts["m700"], "Allianz", a_sz)
    wn = width(fonts["m600"], "202", n_sz)
    total = wa + gap + wn
    unit = width(fonts["e400"], "NETWORK", 1)
    net_sz = total / (unit + 6*0.14)
    track = 0.14*net_sz
    if anchor == "middle": x = x - total/2
    d1, _ = draw(fonts["m700"], "Allianz", a_sz, x, y)
    d2, _ = draw(fonts["m600"], "202", n_sz, x + wa + gap, y)
    d3, _ = draw(fonts["e400"], "NETWORK", net_sz, x + 1, y + 8 + net_sz*0.72, track)
    blue = "#FFFFFF" if dark else "#1D4E9E"
    teal = "url(#gTextD)" if dark else "url(#gText)"
    return (f'<path d="{d1}" fill="{blue}"/>\n<path d="{d2}" fill="{blue}"/>\n'
            f'<path d="{d3}" fill="{teal}"/>'), total

DEFS = '''<defs>
  <linearGradient id="gText" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2B7FCF"/><stop offset="1" stop-color="#3DBFC0"/></linearGradient>
  <linearGradient id="gTextD" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5AA8F0"/><stop offset="1" stop-color="#5FD8D2"/></linearGradient>
  <linearGradient id="gMarkD" gradientUnits="userSpaceOnUse" x1="0" y1="120" x2="120" y2="0"><stop offset="0" stop-color="#4C8CE8"/><stop offset=".55" stop-color="#3FA6E6"/><stop offset="1" stop-color="#5FD8D2"/></linearGradient>
  <linearGradient id="gMark" gradientUnits="userSpaceOnUse" x1="0" y1="120" x2="120" y2="0"><stop offset="0" stop-color="#1D4E9E"/><stop offset=".55" stop-color="#2A86D2"/><stop offset="1" stop-color="#3DBFC0"/></linearGradient>
</defs>'''

def svg(w, h, body, title, dark=False):
    bg = '<rect width="100%" height="100%" fill="#0F1E3A"/>' if dark else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h}" width="{w:.0f}" height="{h}" role="img" aria-label="Allianz202 Network">\n'
            f'<title>Allianz202 Network – {title}</title>\n{DEFS}\n{bg}\n{body}\n</svg>\n')

def hexpts(cx, cy, r, rot=-90):
    return [(cx + r*math.cos(math.radians(rot+60*i)), cy + r*math.sin(math.radians(rot+60*i))) for i in range(6)]
def poly(pts, close=True):
    return "M" + " L".join(f"{x:.2f} {y:.2f}" for x, y in pts) + (" Z" if close else "")
def lerp(a, b, t): return (a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)

C = (60, 60)
P = hexpts(*C, 50)  # pointy top: P0 top, P1 upper-right, P2 lower-right, P3 bottom, P4 lower-left, P5 upper-left

def icon_cube_echo():
    C = (70, 64); P = hexpts(*C, 46)
    # hexagon + isometric "Y" with gaps (cube), plus two echo strokes of the upper-left edge
    hexp = poly(P)
    gapY = lambda p: lerp(C, p, 0.78)
    y = f"M{C[0]} {C[1]} L{gapY(P[0])[0]:.2f} {gapY(P[0])[1]:.2f} " \
        f"M{C[0]} {C[1]} L{gapY(P[2])[0]:.2f} {gapY(P[2])[1]:.2f} " \
        f"M{C[0]} {C[1]} L{gapY(P[4])[0]:.2f} {gapY(P[4])[1]:.2f}"
    # echo of edge P5->P0 offset outward
    dx, dy = P[0][0]-P[5][0], P[0][1]-P[5][1]; L = math.hypot(dx, dy); nx, ny = dy/L, -dx/L
    ech = ""
    for k, (off, t0, t1, op) in enumerate([(14, 0.0, 0.62, .85), (26, 0.0, 0.34, .5)]):
        a = lerp(P[5], P[0], t0); b = lerp(P[5], P[0], t1)
        ech += f'<path d="M{a[0]+nx*off:.2f} {a[1]+ny*off:.2f} L{b[0]+nx*off:.2f} {b[1]+ny*off:.2f}" stroke="#3DBFC0" stroke-width="5" opacity="{op}"/>'
    return (f'<g fill="none" stroke-linejoin="miter" stroke-linecap="butt">{ech}'
            f'<path d="{hexp}" stroke="url(#gMark)" stroke-width="9"/>'
            f'<path d="{y}" stroke="url(#gMark)" stroke-width="7"/></g>')

def icon_three_chevrons():
    # hexagon split into three V-segments with gaps at alternate vertices
    segs = ""
    cols = ["#1D4E9E", "#2A86D2", "#3DBFC0"]
    for i in range(3):
        a, b, c = P[(2*i) % 6], P[(2*i+1) % 6], P[(2*i+2) % 6]
        a2 = lerp(a, b, 0.16); c2 = lerp(c, b, 0.16)
        segs += f'<path d="{poly([a2, b, c2], False)}" stroke="{cols[i]}"/>'
    return f'<g fill="none" stroke-width="11" stroke-linejoin="miter" stroke-linecap="butt">{segs}</g>'

def icon_solid_cube():
    # isometric cube in three tones inside a thin hexagon frame
    Q = hexpts(*C, 38)
    top = poly([Q[0], Q[1], C, Q[5]]); right = poly([C, Q[1], Q[2], Q[3]]); left = poly([C, Q[3], Q[4], Q[5]])
    return (f'<path d="{poly(P)}" fill="none" stroke="url(#gMark)" stroke-width="5"/>'
            f'<g stroke="#FFFFFF" stroke-width="3" stroke-linejoin="round">'
            f'<path d="{top}" fill="#3DBFC0"/><path d="{right}" fill="#2A86D2"/><path d="{left}" fill="#1D4E9E"/></g>')

def icon_striped_hex():
    # filled hexagon cut into diagonal bands (echoes the stripes of logo 1)
    bands = ""
    cols = ["#3DBFC0", "#33A2CB", "#2A86D2", "#2369B9", "#1D4E9E"]
    n = 5; gap = 4.5
    for i in range(n):
        y0 = 10 + i*(100/n) + (gap/2 if i else 0); y1 = 10 + (i+1)*(100/n) - (gap/2 if i < n-1 else 0)
        bands += f'<rect x="0" y="{y0:.2f}" width="120" height="{y1-y0:.2f}" fill="{cols[i]}"/>'
    return (f'<clipPath id="hc"><path d="{poly(P)}"/></clipPath>'
            f'<g clip-path="url(#hc)" transform="rotate(-30 60 60)"><g transform="rotate(30 60 60)" clip-path="url(#hc)"></g></g>'
            f'<g clip-path="url(#hc)"><g transform="rotate(-30 60 60) translate(-20 0) scale(1.35 1)">{bands}</g></g>')

def arc(cx, cy, r, a0, a1):
    p0 = (cx + r*math.cos(math.radians(a0)), cy + r*math.sin(math.radians(a0)))
    p1 = (cx + r*math.cos(math.radians(a1)), cy + r*math.sin(math.radians(a1)))
    large = 1 if abs(a1-a0) > 180 else 0
    return f"M{p0[0]:.2f} {p0[1]:.2f} A{r} {r} 0 {large} 1 {p1[0]:.2f} {p1[1]:.2f}"

def icon_ribbons(ox=0, oy=0):
    # concentric ribbons cut by two parallel diagonals: refined, asymmetric take on logo 2
    cx, cy = 66 + ox, 104 + oy
    clip = f'<clipPath id="rc"><path d="M{cx-58} {cy+12} L{cx+8} {cy-87} L{cx+118} {cy-87} L{cx+52} {cy+12} Z"/></clipPath>'
    out = ""; cols = ["#3DBFC0", "#2A86D2", "#1D4E9E"]
    for i, r in enumerate([66, 48, 30]):
        out += f'<path d="{arc(cx, cy, r, 180, 360)}" stroke="{cols[i]}"/>'
    return f'{clip}<g fill="none" stroke-width="11" stroke-linecap="butt" clip-path="url(#rc)">{out}</g>'

def icon_twist():
    # two arcs crossing with a knockout gap: over/under ribbon
    back = arc(60, 128, 70, 222, 306)
    front = arc(60, -8, 70, 54, 126)
    return (f'<g fill="none" stroke-linecap="butt">'
            f'<path d="M14 30 C40 6 80 6 106 30" stroke="#3DBFC0" stroke-width="11"/>'
            f'<path d="M14 90 C40 66 80 66 106 90" stroke="#1D4E9E" stroke-width="11"/>'
            f'<path d="M14 60 C40 84 80 84 106 60" stroke="#FFFFFF" stroke-width="19"/>'
            f'<path d="M14 60 C40 84 80 84 106 60" stroke="#2A86D2" stroke-width="11"/>'
            f'</g>')

def recolor(icon, dark):
    if not dark: return icon
    for a, b in [("#1D4E9E", "#4C8CE8"), ("#2A86D2", "#3FA6E6"), ("#3DBFC0", "#5FD8D2"), ("#2369B9", "#4699E7"), ("#33A2CB", "#52BFDC"), ("url(#gMark)", "url(#gMarkD)"), ('stroke="#FFFFFF"', 'stroke="#0F1E3A"')]:
        icon = icon.replace(a, b)
    return icon

def horizontal(icon, title, dark=False, iw=120, pad=26):
    icon = recolor(icon, dark)
    wm, tw = wordmark(iw + pad, 64, dark=dark)
    return svg(iw + pad + tw + 4, 120, f'{icon}\n{wm}', title, dark)

def stacked(icon, title, iw=150, ih=110, dark=False):
    icon = recolor(icon, dark)
    wm, tw = wordmark(0, 0, dark=dark)
    W = max(tw, iw) + 20; cx = W/2
    wm, _ = wordmark(cx, ih + 74, anchor="middle", dark=dark)
    return svg(W, ih + 128, f'<g transform="translate({cx - iw/2:.2f} 0)">{icon}</g>\n{wm}', title, dark)

logos = [
  ("01-esagono-cubo", "Esagono cubo", lambda d: horizontal(icon_cube_echo(), "Esagono cubo", d)),
  ("02-esagono-tre-segmenti", "Esagono a tre segmenti", lambda d: horizontal(icon_three_chevrons(), "Esagono a tre segmenti", d)),
  ("03-cubo-pieno", "Cubo pieno", lambda d: horizontal(icon_solid_cube(), "Cubo pieno", d)),
  ("04-esagono-bande", "Esagono a bande", lambda d: horizontal(icon_striped_hex(), "Esagono a bande", d)),
  ("05-nastri", "Nastri", lambda d: stacked(f'<g transform="translate(-36 -14) scale(1.3)">{icon_ribbons(16, 8)}</g>', "Nastri", 150, 130, d)),
  ("06-nastri-orizzontale", "Nastri orizzontale", lambda d: horizontal(f'<g transform="translate(-6 -2)">{icon_ribbons(0,0)}</g>', "Nastri orizzontale", d)),
]
for f in os.listdir(OUT):
    if f.endswith(".svg") or f.startswith("anteprima"): os.remove(os.path.join(OUT, f))
for n, t, fn in logos:
    open(f"{OUT}/{n}.svg", "w").write(fn(False))
    open(f"{OUT}/{n}-negativo.svg", "w").write(fn(True))
cards = "\n".join(f'<figure><div class="t"><img src="{n}.svg" alt="{t}"></div><div class="t d"><img src="{n}-negativo.svg" alt="{t} negativo"></div><figcaption>{n[:2]} · {t}</figcaption></figure>' for n, t, _ in logos)
open(f"{OUT}/anteprima.html", "w").write(f'''<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Concept loghi</title>
<style>body{{margin:0;padding:32px 16px;font-family:system-ui,sans-serif;background:#EEF1F6;color:#1B2B4A}}h1{{font-size:20px;margin:0 0 24px}}
.g{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,460px),1fr));gap:20px}}figure{{margin:0;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08)}}
.t{{display:flex;align-items:center;justify-content:center;padding:36px 28px;height:170px}}.t img{{max-width:100%;max-height:100%}}.d{{background:#0F1E3A}}figcaption{{padding:12px 18px;font-weight:600;font-size:13px}}</style></head>
<body><h1>Allianz202 Network — concept loghi (v2)</h1><div class="g">{cards}</div></body></html>''')
