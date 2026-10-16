"""Optimize a fixed twelve-color palette; no board, contacts, or region areas.

Python 3.10+: numpy==2.2.6 scipy==1.15.3 colour-science==0.4.6.
Optional plots: matplotlib==3.10.1. The perceptual losses use explicit,
unfitted design parameters from games/pupdoku/color-model.json.
Select one color per 30-degree hue family from 288 quantized sRGB samples.
Positive pair costs are linearized with binary selection/McCormick products.
Zero MIP gap proves this finite sampled problem within solver tolerances.
It does not establish continuous-gamut or human-comfort optimality.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import colour
from scipy.optimize import milp, Bounds, LinearConstraint
from scipy.sparse import coo_matrix

ROOT = Path(__file__).resolve().parents[1]
MODEL = json.loads((ROOT / "games/pupdoku/color-model.json").read_text())

M1 = np.array(
    [
        [0.4122214708, 0.5363325363, 0.0514459929],
        [0.2119034982, 0.6806995451, 0.1073969566],
        [0.0883024619, 0.2817188376, 0.6299787005],
    ]
)
M2 = np.array(
    [
        [0.2104542553, 0.793617785, -0.0040720468],
        [1.9779984951, -2.428592205, 0.4505937099],
        [0.0259040371, 0.7827717662, -0.808675766],
    ]
)
I1 = np.linalg.inv(M1)
I2 = np.linalg.inv(M2)
WHITE = "#fffdf6"


def linear_rgb(hexes):
    rgb = np.array([[int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)] for h in hexes])
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def labs(hexes):
    return np.cbrt(linear_rgb(hexes) @ M1.T) @ M2.T


def gamut_max(L, H):
    lo = np.zeros(len(L))
    hi = np.full(len(L), 0.5)
    for _ in range(30):
        mid = (lo + hi) / 2
        _, rgb = rgb_from_lch_any(np.column_stack([L, mid, H]))
        valid = np.all((rgb >= 0) & (rgb <= 1), axis=1)
        lo = np.where(valid, mid, lo)
        hi = np.where(valid, hi, mid)
    return lo


def rgb_from_lch_any(p):
    L, C, H = p.T
    h = np.radians(H)
    lab = np.column_stack([L, C * np.cos(h), C * np.sin(h)])
    return lab, (lab @ I2.T) ** 3 @ I1.T


def metrics(lch):
    lab, rgb = rgb_from_lch_any(lch)
    Cmax = gamut_max(lch[:, 0], lch[:, 2])
    q = lch[:, 1] / Cmax
    whiteY = linear_rgb([WHITE])[0] @ np.array([0.2126, 0.7152, 0.0722])
    contrast = (whiteY + 0.05) / (
        np.sum(rgb * np.array([0.2126, 0.7152, 0.0722]), axis=1) + 0.05
    )
    return lab, rgb, q, contrast


def build_candidates():
    grid = MODEL["grid"]
    hues = (
        np.array(grid["hues"]) if "hues" in grid else np.arange(0, 360, grid["hueStep"])
    )
    L, H, Q = np.meshgrid(
        grid["lightness"],
        hues,
        grid["gamutFractions"],
        indexing="ij",
    )
    L = L.ravel()
    H = H.ravel()
    Q = Q.ravel()
    C = gamut_max(L, H) * Q
    _, rgb = rgb_from_lch_any(np.column_stack([L, C, H]))
    srgb = np.where(
        rgb <= 0.0031308, 12.92 * rgb, 1.055 * np.maximum(rgb, 0) ** (1 / 2.4) - 0.055
    )
    colors = np.array(
        [
            "#" + "".join(f"{v:02x}" for v in row)
            for row in np.clip(np.rint(srgb * 255), 0, 255).astype(int)
        ]
    )
    lab = labs(colors)
    L = lab[:, 0]
    C = np.linalg.norm(lab[:, 1:], axis=1)
    h = np.degrees(np.arctan2(lab[:, 2], lab[:, 1])) % 360
    viewing = MODEL["viewing"]
    bg = np.array([int(viewing["background"][i : i + 2], 16) / 255 for i in (1, 3, 5)])
    Yb = float(colour.sRGB_to_XYZ(bg)[1] * 100)
    srgb = np.array([[int(c[i : i + 2], 16) / 255 for i in (1, 3, 5)] for c in colors])
    cam = colour.XYZ_to_CAM16(
        colour.sRGB_to_XYZ(srgb) * 100,
        np.array(viewing["whiteXYZ"]),
        viewing["adaptingLuminance"],
        Yb,
        discount_illuminant=viewing["discountIlluminant"],
    )
    Y = lambda rgb: np.sum(rgb * np.array([0.2126, 0.7152, 0.0722]), axis=-1)
    contrast = (Y(linear_rgb([WHITE]))[0] + 0.05) / (Y(linear_rgb(colors)) + 0.05)
    records = [
        {
            "hex": str(colors[i]),
            "L": float(L[i]),
            "C": float(C[i]),
            "h": float(h[i]),
            "s": float(cam.s[i]),
            "M": float(cam.M[i]),
            "contrast": float(contrast[i]),
        }
        for i in range(len(colors))
    ]
    return records, lab, (H // grid["hueFamilyWidth"]).astype(int), Yb


def penalties(records):
    m = MODEL
    L = np.array([r["L"] for r in records])
    C = np.array([r["C"] for r in records])
    h = np.array([r["h"] for r in records])
    s = np.array([r["s"] for r in records])
    M = np.array([r["M"] for r in records])
    R = np.array([r["contrast"] for r in records])
    hinge = lambda x: np.maximum(0, x) ** 2
    band = lambda x, p: hinge((p["low"] - x) / p["width"]) + p.get(
        "highWeight", 1
    ) * hinge((x - p["high"]) / p["width"])
    angle = np.abs(h - m["earthyYellow"]["hue"])
    angle = np.minimum(angle, 360 - angle)
    return {
        "gray": 1 / (1 + np.exp((s - m["gray"]["midpoint"]) / m["gray"]["width"])),
        "lightness": band(L, m["lightness"]),
        "brightness": hinge((L - m["brightness"]["high"]) / m["brightness"]["width"]),
        "darkness": hinge((m["darkness"]["low"] - L) / m["darkness"]["width"]),
        "saturationBalance": band(s, m["saturationBalance"]),
        "vivid": hinge(
            (s - m["vivid"]["saturationHigh"]) / m["vivid"]["saturationWidth"]
        )
        + hinge((M - m["vivid"]["colorfulnessHigh"]) / m["vivid"]["colorfulnessWidth"]),
        "whiteMark": hinge((m["whiteMark"]["low"] - R) / m["whiteMark"]["width"]),
        "absoluteChroma": band(C, m["absoluteChroma"]),
        "earthyYellow": np.exp(-0.5 * (angle / m["earthyYellow"]["hueWidth"]) ** 2)
        * hinge((m["earthyYellow"]["lightnessLow"] - L) / m["earthyYellow"]["width"]),
    }


def pair_penalties(dist):
    p = MODEL["palettePair"]
    hinge = lambda x: np.maximum(0, x) ** 2
    return hinge((p["target"] - dist) / p["width"]) + p["nearWeight"] * hinge(
        (p["near"] - dist) / p["nearWidth"]
    )


def spread_penalties(spread):
    model = MODEL["saturationSpread"]
    x = np.maximum(0, (spread - model["target"]) / model["width"])
    segment = np.floor(x)
    return segment**2 + (2 * segment + 1) * (x - segment)


def solve(time_limit):
    records, lab, families, Yb = build_candidates()
    terms = penalties(records)
    unary = sum(MODEL[k]["weight"] * v for k, v in terms.items())
    dist = np.linalg.norm(lab[:, None, :] - lab[None, :, :], axis=2)
    pair = pair_penalties(dist)
    pairs = [
        (i, j)
        for i in range(len(records))
        for j in range(i + 1, len(records))
        if families[i] != families[j] and pair[i, j] > 1e-12
    ]
    risk = [k for k in terms if MODEL[k].get("worstWeight", 0) > 0]
    N = len(records)
    spread_index = N + len(pairs) + len(risk)
    maximum_s, minimum_s = spread_index + 1, spread_index + 2
    V = spread_index + 3
    saturation = np.array([r["s"] for r in records])
    spread_model = MODEL["saturationSpread"]
    spread = spread_penalties(np.abs(saturation[:, None] - saturation[None, :]))
    rows = []
    cols = []
    data = []
    lower = []
    upper = []

    def add(indices, values, lo=-np.inf, hi=np.inf):
        rows.extend([len(lower)] * len(indices))
        cols.extend(indices)
        data.extend(values)
        lower.append(lo)
        upper.append(hi)

    for family in range(12):
        indices = np.flatnonzero(families == family).tolist()
        add(indices, [1] * len(indices), 1, 1)
    for k, (i, j) in enumerate(pairs):
        if dist[i, j] < MODEL["palettePair"]["minimum"]:
            add([i, j], [1, 1], hi=1)
        y = N + k
        add([i, j, y], [1, 1, -1], hi=1)
        # All product coefficients are positive, so minimization supplies
        # y <= min(x_i, x_j); only the McCormick lower bound is needed.
    for family in range(12):
        indices = np.flatnonzero(families == family).tolist()
        # Exactly one candidate per family makes these sums exact at integer
        # solutions, and stronger than per-candidate big-M bounds in the LP.
        for k, name in enumerate(risk):
            add(
                indices + [N + len(pairs) + k],
                [float(terms[name][i]) for i in indices] + [-1],
                hi=0,
            )
        add(indices + [maximum_s], [float(saturation[i]) for i in indices] + [-1], hi=0)
        add(indices + [minimum_s], [float(saturation[i]) for i in indices] + [-1], lo=0)
    add([maximum_s, minimum_s], [1, -1], lo=0)
    # The range cost is DEFINED by linear interpolation of squared values
    # at width-sized knots. These increasing slopes encode it exactly.
    maximum_x = max(
        0, (np.ptp(saturation) - spread_model["target"]) / spread_model["width"]
    )
    for segment in range(int(np.ceil(maximum_x)) + 1):
        slope = (2 * segment + 1) / spread_model["width"]
        intercept = -slope * spread_model["target"] - segment * (segment + 1)
        add([spread_index, maximum_s, minimum_s], [1, -slope, slope], lo=intercept)
    objective = np.r_[
        unary / 12,
        [MODEL["palettePair"]["weight"] * pair[i, j] / 66 for i, j in pairs],
        [MODEL[k]["worstWeight"] for k in risk],
        [spread_model["weight"], 0, 0],
    ]
    high = np.r_[
        np.ones(N + len(pairs)),
        [max(terms[k]) for k in risk],
        [np.max(spread), np.max(saturation), np.max(saturation)],
    ]
    matrix = coo_matrix((data, (rows, cols)), shape=(len(lower), V)).tocsc()
    print(
        json.dumps(
            {"candidates": N, "pairProducts": len(pairs), "constraints": len(lower)}
        ),
        file=sys.stderr,
        flush=True,
    )
    result = milp(
        objective,
        integrality=np.r_[np.ones(N), np.zeros(V - N)],
        bounds=Bounds(np.zeros(V), high),
        constraints=LinearConstraint(matrix, lower, upper),
        options={"time_limit": time_limit, "mip_rel_gap": 0},
    )
    if result.x is None:
        return {"status": result.message, "optimal": False, "model": MODEL}, None
    selected = sorted(
        np.flatnonzero(result.x[:N] > 0.5).tolist(), key=lambda i: families[i]
    )
    assert len(selected) == 12
    losses = {
        k: float(MODEL[k]["weight"] * np.mean(v[selected])) for k, v in terms.items()
    }
    for name in risk:
        losses["worst" + name[0].upper() + name[1:]] = float(
            MODEL[name]["worstWeight"] * max(terms[name][selected])
        )
    losses["pairSimilarity"] = float(
        MODEL["palettePair"]["weight"]
        * np.mean(pair[np.ix_(selected, selected)][np.triu_indices(12, 1)])
    )
    losses["saturationSpread"] = float(
        spread_model["weight"] * np.max(spread[np.ix_(selected, selected)])
    )
    actual = sum(losses.values())
    assert abs(actual - result.fun) < 1e-5
    report = {
        "status": result.message,
        "optimal": bool(result.success and result.mip_gap == 0),
        "mipGap": float(result.mip_gap),
        "objective": float(result.fun),
        "objectiveRecomputed": actual,
        "lowerBound": float(result.mip_dual_bound),
        "candidateCount": N,
        "boardIndependent": True,
        "minimumDistance": float(
            min(dist[i, j] for k, i in enumerate(selected) for j in selected[k + 1 :])
        ),
        "losses": losses,
        "palette": [records[i] for i in selected],
        "viewingBackgroundY": Yb,
        "model": MODEL,
    }
    return report, report["palette"]


def make_plot(report, path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    m = MODEL
    fig, axes = plt.subplots(5, 3, figsize=(12, 15), layout="constrained")
    axes = axes.ravel()
    sq = lambda x: np.maximum(0, x) ** 2
    band = lambda x, p: sq((p["low"] - x) / p["width"]) + p.get("highWeight", 1) * sq(
        (x - p["high"]) / p["width"]
    )
    s = np.linspace(20, 95, 400)
    L = np.linspace(0.50, 0.72, 400)
    R = np.linspace(1.3, 3.5, 400)
    C = np.linspace(0.05, 0.26, 400)
    d = np.linspace(0, 0.23, 400)
    area = np.linspace(0, 0.6, 400)
    spread_range = np.linspace(0, 40, 400)
    panels = [
        (
            s,
            1 / (1 + np.exp((s - m["gray"]["midpoint"]) / m["gray"]["width"])),
            "Grayness (unfitted)",
            "CAM16 saturation s",
        ),
        (L, band(L, m["lightness"]), "Lightness comfort band", "OKLab L"),
        (
            s,
            sq((s - m["vivid"]["saturationHigh"]) / m["vivid"]["saturationWidth"]),
            "Excess saturation (M=50)",
            "CAM16 saturation s",
        ),
        (
            R,
            sq((m["whiteMark"]["low"] - R) / m["whiteMark"]["width"]),
            "White-mark clarity",
            "Contrast ratio",
        ),
        (C, band(C, m["absoluteChroma"]), "Absolute chroma band", "OKLab C"),
        (
            L,
            sq((m["earthyYellow"]["lightnessLow"] - L) / m["earthyYellow"]["width"]),
            "Earthy-yellow preference (h=95)",
            "OKLab L",
        ),
        (d, pair_penalties(d), "Fixed palette similarity", "OKLab distance"),
        (
            d,
            sq(
                (m["dynamic"]["neighbor"]["target"] - d)
                / m["dynamic"]["neighbor"]["width"]
            ),
            "Dynamic neighboring confusion",
            "OKLab distance",
        ),
        (
            area,
            m["dynamic"]["dominance"]["weight"]
            * area**2
            * sq(
                (78 - m["dynamic"]["dominance"]["saturationHigh"])
                / m["dynamic"]["dominance"]["width"]
            ),
            "Dynamic dominance (s=78)",
            "Region area fraction",
        ),
        (
            L,
            sq((L - m["brightness"]["high"]) / m["brightness"]["width"]),
            "Peak brightness (also worst-color risk)",
            "OKLab L",
        ),
        (
            L,
            sq((m["darkness"]["low"] - L) / m["darkness"]["width"]),
            "Darkness (also worst-color risk)",
            "OKLab L",
        ),
        (
            s,
            band(s, m["saturationBalance"]),
            "Saturation balance (also worst-color risk)",
            "CAM16 saturation s",
        ),
        (
            spread_range,
            spread_penalties(spread_range),
            "Palette saturation spread",
            "max(s) - min(s)",
        ),
    ]
    for ax, (x, y, title, label) in zip(axes, panels):
        ax.plot(x, y)
        ax.set(title=title, xlabel=label, ylabel="Penalty")
        ax.grid(alpha=0.2)
    axes[6].set_ylim(0, 8)
    for ax in axes[len(panels) :]:
        ax.set_axis_off()
    fig.suptitle(
        "Explicit loss curves: thresholds and weights are design hypotheses",
        fontsize=12,
    )
    fig.savefig(path, dpi=150)
    plt.close(fig)


def make_swatch(report, path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(10, 3.5), layout="constrained")
    fig.patch.set_facecolor("#faf2e9")
    for i, color in enumerate(report["palette"]):
        x = i % 6
        y = 1 - i // 6
        ax.add_patch(
            plt.Rectangle((x + 0.05, y + 0.12), 0.90, 0.76, color=color["hex"])
        )
        ax.plot(
            [x + 0.39, x + 0.61],
            [y + 0.39, y + 0.61],
            color="#fffdf6",
            lw=4,
            solid_capstyle="round",
        )
        ax.plot(
            [x + 0.39, x + 0.61],
            [y + 0.61, y + 0.39],
            color="#fffdf6",
            lw=4,
            solid_capstyle="round",
        )
        ax.text(
            x + 0.5,
            y + 0.02,
            color["hex"],
            ha="center",
            va="center",
            fontsize=10,
            color="#584851",
        )
    ax.set(xlim=(0, 6), ylim=(-0.05, 2))
    ax.set_axis_off()
    fig.savefig(path, dpi=180)
    plt.close(fig)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--export-palette", type=Path)
    parser.add_argument("--plot", type=Path)
    parser.add_argument("--swatch", type=Path)
    parser.add_argument("--time-limit", type=float, default=55)
    args = parser.parse_args()
    report, palette = solve(args.time_limit)
    output = json.dumps(report, indent=2) + "\n"
    if args.output:
        args.output.write_text(output)
    if args.export_palette:
        if not report["optimal"]:
            raise RuntimeError(
                "Refusing to export a palette without a confirmed optimum"
            )
        certificate = {
            k: report[k]
            for k in [
                "optimal",
                "mipGap",
                "objective",
                "lowerBound",
                "minimumDistance",
                "candidateCount",
                "boardIndependent",
            ]
        }
        args.export_palette.write_text(
            "// Generated by scripts/pupdoku-palette-optimize.py.\nexport const PALETTE = "
            + json.dumps(palette, indent=2)
            + ";\nexport const PALETTE_CERTIFICATE = "
            + json.dumps(certificate, indent=2)
            + ";\n"
        )
    if args.plot:
        make_plot(report, args.plot)
    if args.swatch:
        make_swatch(report, args.swatch)
    print(output, end="")
    if palette is None:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
