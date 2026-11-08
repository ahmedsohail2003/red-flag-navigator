"""Analysis A: does a walking test carry an ALS signal?

Data: PhysioNet "Gait in Neurodegenerative Disease" (gaitndd 1.0.0), read-only from
Datasets/03_Gait_Neurodegenerative_Disease_PhysioNet/. Subjects walked a hallway for
5 minutes with force sensors in their shoes (a lab walkway, not a phone).

Run from the working folder:
    python -I analysis\\gait_evidence.py

Writes only analysis/results.json (the "gait" key; other keys are kept) and
analysis/fig_gait_cv.png.

.ts columns (PhysioNet project page "Data Description"):
  1 elapsed time (s)            2 left stride interval (s)   3 right stride interval (s)
  4/5 left/right swing (s)      6/7 left/right swing (% of stride)
  8/9 left/right stance (s)     10/11 left/right stance (% of stride)
  12/13 double support (s, % of stride)
Stance % = 100 - swing % for the same foot (checked below), so only swing % is reported.
"""
import site
import sys

# `python -I` leaves out the user site-packages, which is where numpy, scipy, sklearn
# and matplotlib are installed on this machine. Add back that one directory only
# (the script folder and the current folder stay off sys.path).
_USER_SITE = site.getusersitepackages()
if _USER_SITE not in sys.path:
    sys.path.append(_USER_SITE)

import json
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.stats import mannwhitneyu
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parent.parent
DATA = (ROOT / "Datasets" / "03_Gait_Neurodegenerative_Disease_PhysioNet"
        / "gait-in-neurodegenerative-disease-database-1.0.0")
OUT = ROOT / "analysis"
RESULTS = OUT / "results.json"
FIG = OUT / "fig_gait_cv.png"

# ---- documented processing rules -------------------------------------------------
TRIM_S = 20.0        # drop strides that START before 20 s (gait initiation)
K_MAD = 3.0          # outlier rule: drop |x - median| > 3 * scaled MAD, per subject
MAD_SCALE = 1.4826   # scaled MAD ~ SD for normal data, so the cut is ~3 SD
N_BOOT = 2000        # bootstrap resamples for AUC confidence intervals
SEED = 20261107      # fixed seed (same seed for every CI, so each CI is reproducible)
COL_T, COL_L_STRIDE, COL_R_STRIDE = 0, 1, 2
COL_L_SWING, COL_R_SWING, COL_L_STANCE, COL_R_STANCE = 5, 6, 9, 10

GROUPS = ["control", "als", "park", "hunt"]
LABEL = {"control": "Control", "als": "ALS", "park": "Parkinson's", "hunt": "Huntington's"}
FEATURES = {
    "mean_stride_s": "mean stride time (s)",
    "cv_pct": "stride-time coefficient of variation (CV, %)",
    "swing_pct": "swing time (% of stride); stance % = 100 - swing %",
}


def r(x, nd=4):
    """Round for JSON (keeps p-values readable with significant digits)."""
    if x is None:
        return None
    x = float(x)
    if x != 0 and abs(x) < 1e-3:
        return float(f"{x:.3g}")
    return round(x, nd)


def mad_inliers(x):
    med = np.median(x)
    mad = MAD_SCALE * np.median(np.abs(x - med))
    if mad == 0:
        return np.ones(len(x), dtype=bool)
    return np.abs(x - med) <= K_MAD * mad


def series_features(rows, stride_col, swing_col):
    """Features for one foot of one walk. The outlier rule runs on the stride series;
    swing % then uses the kept strides and gets the same rule on its own values."""
    s = rows[:, stride_col]
    keep = mad_inliers(s)
    s_k = s[keep]
    w = rows[keep, swing_col]
    w_k = w[mad_inliers(w)]
    mean = s_k.mean()
    return {
        "mean_stride_s": mean,
        "cv_pct": 100.0 * s_k.std(ddof=1) / mean,
        "swing_pct": w_k.mean(),
        "n_in": int(len(s)),
        "n_outliers": int((~keep).sum()),
        "n_used": int(keep.sum()),
        "duration_s": float(rows[-1, COL_T] - (rows[0, COL_T] - rows[0, COL_L_STRIDE])),
    }


def read_subject_info():
    """subject-description.txt is tab-delimited; the hunt20 line wraps onto a second
    line (its last field '9' sits alone on the next line), so rejoin it."""
    rows = []
    for ln in (DATA / "subject-description.txt").read_text().splitlines()[1:]:
        if not ln.strip():
            continue
        f = [x.strip() for x in ln.split("\t")]
        if f[0] == "" and rows and len(rows[-1]) < 8:
            rows[-1].extend(f[1:])
        else:
            rows.append(f)
    info = {}
    for f in rows:
        assert len(f) == 8, f
        num = lambda v: None if v.upper() == "MISSING" else float(v)
        info[f[0]] = {"age": num(f[2]), "sex": f[5].lower(), "gait_speed_m_s": num(f[6]),
                      "duration_or_severity": num(f[7])}
    return info


def auc_pairs(pos, neg):
    """P(pos > neg) + 0.5 P(tie) = Mann-Whitney U / (n_pos * n_neg) = ROC AUC."""
    d = pos[:, None] - neg[None, :]
    return float(np.mean((d > 0) + 0.5 * (d == 0)))


def compare(pos, neg, flip=False):
    """pos = ALS. AUC is 'higher value = ALS' unless flip (then 'lower value = ALS')."""
    pos, neg = np.asarray(pos, float), np.asarray(neg, float)
    if flip:
        pos, neg = -pos, -neg
    auc = auc_pairs(pos, neg)
    y = np.r_[np.ones(len(pos)), np.zeros(len(neg))]
    assert abs(auc - roc_auc_score(y, np.r_[pos, neg])) < 1e-12
    rng = np.random.default_rng(SEED)
    boots = np.array([auc_pairs(rng.choice(pos, len(pos)), rng.choice(neg, len(neg)))
                      for _ in range(N_BOOT)])
    lo, hi = np.percentile(boots, [2.5, 97.5])
    allv = np.r_[pos, neg]
    method = "exact" if len(np.unique(allv)) == len(allv) else "asymptotic"
    mw = mannwhitneyu(pos, neg, alternative="two-sided", method=method)
    assert abs(mw.statistic / (len(pos) * len(neg)) - auc) < 1e-12
    return {"n_als": int(len(pos)), "n_other": int(len(neg)), "auc": r(auc, 3),
            "auc_ci95": [r(lo, 3), r(hi, 3)], "mannwhitney_u": r(mw.statistic, 1),
            "p_two_sided": r(mw.pvalue), "mw_method": method}


def group_stats(vals):
    v = np.asarray(vals, float)
    q1, med, q3 = np.percentile(v, [25, 50, 75])
    return {"n": int(len(v)), "median": r(med), "iqr": [r(q1), r(q3)],
            "min": r(v.min()), "max": r(v.max())}


def main():
    info = read_subject_info()
    subj = []
    stance_check = 0.0
    trim_removed = 0
    first_start = []
    for path in DATA.glob("*.ts"):
        m = re.fullmatch(r"(als|control|park|hunt)(\d+)\.ts", path.name)
        if not m:
            continue
        a = np.loadtxt(path)
        assert a.ndim == 2 and a.shape[1] == 13, path.name
        stance_check = max(stance_check,
                           np.abs(a[:, COL_L_SWING] + a[:, COL_L_STANCE] - 100).max())
        start = a[:, COL_T] - a[:, COL_L_STRIDE]   # left-stride start time
        first_start.append(float(start[0]))
        keep = start >= TRIM_S
        trim_removed += int((~keep).sum())
        a = a[keep]
        left = series_features(a, COL_L_STRIDE, COL_L_SWING)
        right = series_features(a, COL_R_STRIDE, COL_R_SWING)
        # test-retest: split the trimmed walk at its time midpoint; each half is then
        # processed on its own (own outlier rule), as two separate short tests would be
        t0, t1 = a[0, COL_T] - a[0, COL_L_STRIDE], a[-1, COL_T]
        mid = (t0 + t1) / 2
        h1 = series_features(a[a[:, COL_T] <= mid], COL_L_STRIDE, COL_L_SWING)
        h2 = series_features(a[a[:, COL_T] > mid], COL_L_STRIDE, COL_L_SWING)
        sid = m.group(1) + m.group(2)
        subj.append({"id": sid, "group": m.group(1), "num": int(m.group(2)),
                     "left": left, "right": right, "half1": h1, "half2": h2,
                     **info[sid]})
    subj.sort(key=lambda s: (GROUPS.index(s["group"]), s["num"]))
    by = {g: [s for s in subj if s["group"] == g] for g in GROUPS}
    n = {g: len(by[g]) for g in GROUPS}
    assert n == {"control": 16, "als": 13, "park": 15, "hunt": 20}, n

    def vals(g, feat, side="left"):
        return np.array([s[side][feat] for s in by[g]])

    # ---- demographics (subject-description.txt) -----------------------------------
    demo = {}
    for g in GROUPS:
        ages = np.array([s["age"] for s in by[g]])
        demo[g] = {"n": n[g], "age_median": r(np.median(ages), 1),
                   "age_range": [r(ages.min(), 0), r(ages.max(), 0)],
                   "n_female": sum(s["sex"] == "f" for s in by[g])}
    months = np.array([s["duration_or_severity"] for s in by["als"]])
    demo["als"]["months_since_diagnosis_median"] = r(np.median(months), 1)
    demo["als"]["months_since_diagnosis_range"] = [r(months.min(), 1), r(months.max(), 1)]

    # ---- per-feature group stats; ALS vs control, older controls, PD, HD ----------
    # Each feature's AUC is oriented in the direction ALS differ from controls
    # (so AUC >= 0.5 vs controls), and the SAME orientation is kept for the other
    # comparisons: AUC near 0.5 or below means that direction does not single out ALS.
    ref_age = min(s["age"] for s in by["als"])
    old_ctrl = [s for s in by["control"] if s["age"] >= ref_age]
    feats = {}
    for f, desc in FEATURES.items():
        als, ctrl = vals("als", f), vals("control", f)
        flip = auc_pairs(als, ctrl) < 0.5
        feats[f] = {
            "description": desc,
            "group_stats": {g: group_stats(vals(g, f)) for g in GROUPS},
            "auc_orientation": "lower value = ALS" if flip else "higher value = ALS",
            "median_difference_als_minus_control": r(np.median(als) - np.median(ctrl)),
            "als_vs_control": compare(als, ctrl, flip),
            "als_vs_controls_aged_at_least_youngest_als": compare(
                als, np.array([s["left"][f] for s in old_ctrl]), flip),
            "als_vs_parkinsons": compare(als, vals("park", f), flip),
            "als_vs_huntingtons": compare(als, vals("hunt", f), flip),
        }

    best = max(FEATURES, key=lambda f: feats[f]["als_vs_control"]["auc"])
    best_block = {
        "feature": best,
        "selected_by": "highest oriented AUC for ALS vs control among the 3 features "
                       "(picked after looking at the data, so its AUC is optimistic)",
        "auc_orientation": feats[best]["auc_orientation"],
        **{k: feats[best][k] for k in ("als_vs_control", "als_vs_parkinsons",
                                       "als_vs_huntingtons",
                                       "als_vs_controls_aged_at_least_youngest_als")},
    }
    older_controls = {"rule": f"controls aged >= youngest ALS patient ({ref_age:.0f} y)",
                      "n": len(old_ctrl),
                      "age_median": r(np.median([s["age"] for s in old_ctrl]), 1)}

    # ---- right-foot sensitivity check (ALS vs control only) -----------------------
    right = {f: compare(vals("als", f, "right"), vals("control", f, "right"),
                        feats[f]["auc_orientation"].startswith("lower"))
             for f in FEATURES}
    right = {f: {"auc": v["auc"], "auc_ci95": v["auc_ci95"], "p_two_sided": v["p_two_sided"]}
             for f, v in right.items()}

    # ---- test-retest noise in controls (two halves of one walk) -------------------
    tr = {}
    c = by["control"]
    for f in FEATURES:
        h1 = np.array([s["half1"][f] for s in c])
        h2 = np.array([s["half2"][f] for s in c])
        d = h2 - h1
        sd_d = d.std(ddof=1)
        sem = sd_d / np.sqrt(2)
        tr[f] = {"n": len(c), "mean_half1": r(h1.mean()), "mean_half2": r(h2.mean()),
                 "mean_diff_half2_minus_half1": r(d.mean()), "sd_of_differences": r(sd_d),
                 "within_subject_sd_sem": r(sem), "mdc95": r(1.96 * np.sqrt(2) * sem),
                 "control_median_full_walk": feats[f]["group_stats"]["control"]["median"]}
    half_dur = [s[h]["duration_s"] for s in c for h in ("half1", "half2")]
    half_n = [s[h]["n_used"] for s in c for h in ("half1", "half2")]

    # ---- outlier bookkeeping ------------------------------------------------------
    pct_out = {g: r(100 * sum(s["left"]["n_outliers"] for s in by[g])
                    / sum(s["left"]["n_in"] for s in by[g]), 2) for g in GROUPS}
    strides_used = {g: [int(np.min([s["left"]["n_used"] for s in by[g]])),
                        int(np.max([s["left"]["n_used"] for s in by[g]]))] for g in GROUPS}

    gait = {
        "dataset": "PhysioNet Gait in Neurodegenerative Disease Database 1.0.0 (.ts files)",
        "n": n,
        "processing": {
            "side": "left foot: .ts column 2 (stride interval) and column 6 (swing %)",
            "trim_rule": f"drop strides starting before {TRIM_S:.0f} s "
                         "(start = elapsed time - left stride interval)",
            "strides_removed_by_trim": trim_removed,
            "first_stride_start_s_range": [r(min(first_start), 2), r(max(first_start), 2)],
            "trim_note": "the distributed .ts files already begin after ~20 s, so the 20-s rule removed nothing",
            "outlier_rule": "per subject: drop strides with |x - median| > 3 x 1.4826 x MAD "
                            "(MAD = median absolute deviation); swing % gets the same rule "
                            "on its own values among the kept strides",
            "pct_strides_removed_as_outliers": pct_out,
            "strides_used_per_subject_range": strides_used,
            "stance_equals_100_minus_swing_max_abs_dev": r(stance_check, 6),
            "auc_ci": f"stratified percentile bootstrap, {N_BOOT} resamples, seed {SEED}",
            "p_values": "two-sided Mann-Whitney U (exact when there are no ties); not corrected for testing 3 features",
        },
        "demographics": demo,
        "older_controls_subset": older_controls,
        "features": feats,
        "best_feature": best_block,
        "sensitivity_right_foot_als_vs_control": right,
        "test_retest_controls": {
            "method": "each control's trimmed walk split at its time midpoint; each half "
                      "processed separately; SEM = SD(half2 - half1)/sqrt(2) (= within-subject SD); "
                      "MDC95 = 1.96 x sqrt(2) x SEM",
            "half_duration_s_median": r(np.median(half_dur), 1),
            "strides_per_half_median": r(np.median(half_n), 0),
            "features": tr,
        },
        "per_subject": [{"id": s["id"], "group": s["group"], "age": s["age"], "sex": s["sex"],
                         "mean_stride_s": r(s["left"]["mean_stride_s"]),
                         "cv_pct": r(s["left"]["cv_pct"]),
                         "swing_pct": r(s["left"]["swing_pct"]),
                         "strides_used": s["left"]["n_used"]} for s in subj],
    }

    results = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
    results["gait"] = gait
    results.setdefault("delay", None)
    RESULTS.write_text(json.dumps(results, indent=2))

    make_figure(by, n, feats["cv_pct"]["als_vs_control"], float(np.median(months)))
    print_summary(gait)


def make_figure(by, n, cv_res, months_dx):
    ink, ink2, grid, surf, dot = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb", "#2a78d6"
    fig, ax = plt.subplots(figsize=(7.2, 4.8), dpi=200)
    fig.patch.set_facecolor(surf)
    ax.set_facecolor(surf)
    data = [[s["left"]["cv_pct"] for s in by[g]] for g in GROUPS]
    ax.boxplot(data, positions=range(len(GROUPS)), widths=0.5, showfliers=False,
               medianprops={"color": ink, "linewidth": 2},
               boxprops={"color": ink2, "linewidth": 1.1},
               whiskerprops={"color": ink2, "linewidth": 1.1},
               capprops={"color": ink2, "linewidth": 1.1}, zorder=2)
    rng = np.random.default_rng(SEED)
    for i, v in enumerate(data):
        ax.scatter(i + rng.uniform(-0.13, 0.13, len(v)), v, s=30, color=dot, alpha=0.9,
                   edgecolors=surf, linewidths=0.8, zorder=3)
    ax.set_xticks(range(len(GROUPS)))
    ax.set_xticklabels([f"{LABEL[g]}\n(n = {n[g]})" for g in GROUPS], color=ink, fontsize=10)
    ax.set_ylabel("Stride-time CV (%)", color=ink, fontsize=10)
    ax.set_ylim(bottom=0)
    ax.yaxis.grid(True, color=grid, linewidth=0.8)
    ax.set_axisbelow(True)
    for sp in ("top", "right"):
        ax.spines[sp].set_visible(False)
    for sp in ("left", "bottom"):
        ax.spines[sp].set_color(ink2)
    ax.tick_params(colors=ink2)
    fig.text(0.02, 0.955, "Stride-time variability (CV%) by group", ha="left",
             fontsize=13, color=ink, fontweight="bold")
    fig.text(0.02, 0.905, "PhysioNet gait database: 5-minute hallway walk, force sensors "
             "in the shoes, left foot. One dot per person.", ha="left", fontsize=8.5,
             color=ink2)
    lo, hi = cv_res["auc_ci95"]
    fig.text(0.02, 0.045,
             f"ALS vs control: AUC {cv_res['auc']:.2f} (95% CI {lo:.2f}-{hi:.2f}), "
             f"Mann-Whitney p = {cv_res['p_two_sided']:.2g}. Box = median and IQR, "
             "whiskers = 1.5 x IQR.", fontsize=7.5, color=ink2, ha="left")
    fig.text(0.02, 0.015,
             f"Outlier strides removed (median +/- 3 scaled MAD). ALS patients already "
             f"diagnosed (median {months_dx:.0f} months). Lab walkway, not a phone.",
             fontsize=7.5, color=ink2, ha="left")
    fig.subplots_adjust(left=0.09, right=0.98, top=0.86, bottom=0.19)
    fig.savefig(FIG, facecolor=surf)
    plt.close(fig)


def print_summary(g):
    print("n:", g["n"])
    print("trim removed:", g["processing"]["strides_removed_by_trim"],
          "first stride start range:", g["processing"]["first_stride_start_s_range"])
    print("outliers removed %:", g["processing"]["pct_strides_removed_as_outliers"])
    print("older controls:", g["older_controls_subset"])
    for f, v in g["features"].items():
        med = {k: x["median"] for k, x in v["group_stats"].items()}
        print(f"{f}: medians {med}; {v['auc_orientation']}; "
              f"ALS-control median diff {v['median_difference_als_minus_control']}")
        for k in ("als_vs_control", "als_vs_controls_aged_at_least_youngest_als",
                  "als_vs_parkinsons", "als_vs_huntingtons"):
            a = v[k]
            print(f"  {k:44s} n={a['n_als']}/{a['n_other']} AUC {a['auc']} {a['auc_ci95']} "
                  f"p={a['p_two_sided']} U={a['mannwhitney_u']} ({a['mw_method']})")
    print("best:", g["best_feature"]["feature"], g["best_feature"]["auc_orientation"])
    print("right foot:", g["sensitivity_right_foot_als_vs_control"])
    t = g["test_retest_controls"]
    print("halves: median duration", t["half_duration_s_median"], "s; strides", t["strides_per_half_median"])
    for f, v in t["features"].items():
        print(f"  {f:14s} {v}")
    print("demographics:", g["demographics"])


if __name__ == "__main__":
    main()
