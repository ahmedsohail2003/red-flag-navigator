"""ALS progression data (Efron and Hastie, CASI ch. 17; DREAM / PRO-ACT challenge 2012).

Data (read-only): Datasets/02_ALS_Progression_Efron_Hastie/ALS.txt, 1,822 patients x 371
columns. `testset` is the official split (TRUE = test, 625 rows), `dFRS` is the target.

Run from the project folder:
    python -I analysis\\progression\\progression_analysis.py

Writes only inside analysis/progression/: results.json and fig_onset_vs_dfrs.png.

What the columns mean (checked against the data below, not just assumed):
  * Every measurement summary covers the first 3 months of the trial only (all
    `last.*.date` <= 91 days); dFRS is the later rate of change (CASI: "rate of
    progression of an ALS functional rating score").
  * ALSFRS scores top out at 40, so the scale is the original 10-item ALSFRS (0-40),
    not the 48-point ALSFRS-R. Only 9 items are given (no respiratory item).
  * `*.slope` columns are points per month with a 30.4367-day month: 1 point over
    28 days shows up as 1.087024. `alsfrs.score.slope` = (last - first) / (last date -
    first date), and `slope.*` columns are visit-to-visit rates (checked on row 0).
  * `Onset.Delta` = days from first symptom to trial entry (negative). PRO-ACT
    names it that way; CASI's text loosely calls it "time since diagnosis".
  * There are no missing values: the challenge winners imputed them. `no.*` and
    `lessthan2.*` columns flag missing or sparse data, and Sex / Study.Arm are often
    0 in both columns (unknown).
"""
import site
import sys

# `python -I` drops the user site-packages, where numpy/pandas/sklearn live here.
_USER_SITE = site.getusersitepackages()
if _USER_SITE not in sys.path:
    sys.path.append(_USER_SITE)

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LassoCV, LinearRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

OUT = Path(__file__).resolve().parent
ROOT = OUT.parent.parent
DATA = ROOT / "Datasets" / "02_ALS_Progression_Efron_Hastie" / "ALS.txt"
RESULTS = OUT / "results.json"
FIG = OUT / "fig_onset_vs_dfrs.png"

SEED = 20261107
DPM = 30.4367            # days per month used by the slope columns (inferred, see docstring)
ALSFRS_MAX = 40          # original ALSFRS
ITEMS = ["speech", "salivation", "swallowing", "handwriting", "cutting", "dressing",
         "turning", "walking", "climbing.stairs"]
RELATIVES = ["Aunt", "Aunt..Maternal.", "Cousin", "Father", "Grandfather..Maternal.",
             "Grandmother", "Grandmother..Maternal.", "Mother", "Uncle", "Uncle..Maternal.",
             "Uncle..Paternal.", "Son", "Daughter", "Sister", "Brother", "Family"]
MEASURES = {"alsfrs.score": "alsfrs_total", "fvc.liters": "fvc", "svc.liters": "svc",
            "weight": "weight", "height": "height", "resp.rate": "vitals",
            "bp.diastolic": "vitals", "bp.systolic": "vitals"}


def r(x, nd=4):
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    x = float(x)
    if x != 0 and abs(x) < 1e-3:
        return float(f"{x:.3g}")
    return round(x, nd)


def q(x):
    x = np.asarray(x, float)
    return {"n": int(len(x)), "median": r(np.median(x)),
            "iqr": [r(np.percentile(x, 25)), r(np.percentile(x, 75))]}


def spearman(x, y):
    rho, p = stats.spearmanr(x, y)
    n = len(x)
    se = 1.06 / np.sqrt(n - 3)  # Fieller et al. approximation for Spearman
    lo, hi = np.tanh(np.arctanh(rho) - 1.96 * se), np.tanh(np.arctanh(rho) + 1.96 * se)
    return {"n": int(n), "rho": r(rho), "ci95": [r(lo), r(hi)], "p": r(p)}


def ols(y, X, names):
    """OLS with classical standard errors (statsmodels is not installed)."""
    X1 = np.column_stack([np.ones(len(y)), X])
    beta, *_ = np.linalg.lstsq(X1, y, rcond=None)
    resid = y - X1 @ beta
    dof = len(y) - X1.shape[1]
    s2 = resid @ resid / dof
    se = np.sqrt(np.diag(s2 * np.linalg.inv(X1.T @ X1)))
    out = {}
    for nm, b, s in zip(["intercept"] + names, beta, se):
        p = 2 * stats.t.sf(abs(b / s), dof)
        out[nm] = {"coef": r(b), "ci95": [r(b - 1.96 * s), r(b + 1.96 * s)], "p": r(p)}
    out["_n"] = int(len(y))
    out["_r2"] = r(1 - resid @ resid / np.sum((y - y.mean()) ** 2))
    return out


def group_of(c):
    if c in ("testset", "dFRS"):
        return None
    if c == "Onset.Delta":
        return "onset_timing"
    if c.startswith("Site.of.Onset"):
        return "onset_site"
    if c.startswith("Symptom."):
        return "onset_symptoms"
    if c == "Age" or c.startswith("Sex.") or c.startswith("Race"):
        return "demographics"
    if c in RELATIVES:
        return "family_history_relatives"
    if c.startswith("Neurological.Disease"):
        return "family_history_neuro_disease"
    if c.startswith("Study.Arm"):
        return "trial_arm"
    visit_slope = any(f"slope.{m}" in c for m in list(MEASURES) + ITEMS)
    for m, g in MEASURES.items():
        if m in c:
            return g + ("_visit_to_visit_slopes" if visit_slope else "")
    for it in ITEMS:
        if it in c:
            return "alsfrs_items" + ("_visit_to_visit_slopes" if visit_slope else "")
    return "other"


def reconstruct3(df, v, last_col, sum_col, integer):
    """Rebuild the 3 visits of people with exactly 3 visits of measure `v`.

    s3 = last, s1 = last - slope * T, s2 = sum - s1 - s3; the gap times come from the
    two visit-to-visit slopes. Returns the residual of the middle visit from the
    first-to-last line, scaled to one visit's noise variance (independent errors:
    var(e) = sigma^2 * (1 + w^2 + (1-w)^2), w = t1 / T), plus validation counts.
    """
    # Keep only rows whose visit-to-visit slope summaries cover exactly the 2 gaps of
    # the 3 counted visits; rows with 3 such slopes (an extra visit outside the
    # counted window) break the reconstruction (checked: their gap times do not add up).
    nv = df[f"num.{v}.visits"]
    d = df[(nv == 3) & (df[f"num.slope.{v}.visits"] == 2)]
    T = (d[f"last.{v}.date"] - d[f"first.{v}.date"]).to_numpy(float)
    s3 = d[last_col].to_numpy(float)
    s1 = s3 - d[f"{v}.slope"].to_numpy(float) * T / DPM
    s2 = d[sum_col].to_numpy(float) - s1 - s3
    r2 = d[f"last.slope.{v}"].to_numpy(float)
    r1 = d[f"sum.slope.{v}"].to_numpy(float) - r2
    with np.errstate(divide="ignore", invalid="ignore"):
        t1 = np.where(np.abs(r1) > 1e-9, (s2 - s1) / r1 * DPM, np.nan)
        t2 = np.where(np.abs(r2) > 1e-9, (s3 - s2) / r2 * DPM, np.nan)
    both = ~np.isnan(t1) & ~np.isnan(t2)
    t1 = np.where(np.isnan(t1) & ~np.isnan(t2), T - t2, t1)
    flat = np.isnan(t1)                                   # both rates 0 -> s1 = s2 = s3
    t1 = np.where(flat, T / 2, t1)
    ok = (T >= 14) & (t1 > 0.5) & (t1 < T - 0.5)          # >= 2 weeks span, real gaps
    timing_ok = np.abs(t1 + np.where(both, t2, T - t1) - T) < 1.0
    ok &= timing_ok
    if integer:
        ok &= (np.abs(s1 - np.round(s1)) < 0.02) & (np.abs(s2 - np.round(s2)) < 0.02)
    w = t1 / T
    e = s2 - (s1 + (s3 - s1) * w)
    sig2 = e ** 2 / (1 + w ** 2 + (1 - w) ** 2)
    keep = ok & np.isfinite(sig2)
    sigma = float(np.sqrt(np.mean(sig2[keep])))
    # robust version: median |e| scaled to one visit, / 0.6745 (normal-theory MAD)
    sigma_rob = float(np.median(np.sqrt(sig2[keep])) / 0.6745)
    return {
        "n_with_3_visits": int(len(d)),
        "n_reconstructed_and_validated": int(keep.sum()),
        "n_both_gap_times_computable": int(both.sum()),
        "n_where_both_gap_times_agree_with_span": int((both & timing_ok).sum()),
        "sigma_robust_median_based": r(sigma_rob),
        "mdc95_robust": r(1.96 * np.sqrt(2) * sigma_rob),
        "span_days_median": r(np.median(T[keep])),
        "middle_visit_abs_residual_median": r(np.median(np.abs(e[keep]))),
        "pct_middle_visit_off_line_by_ge_2": r(100 * np.mean(np.abs(e[keep]) >= 2)) if integer else None,
        "sigma_single_visit_noise": r(sigma),
        "mdc95_between_two_visits": r(1.96 * np.sqrt(2) * sigma),
    }


def main():
    df = pd.read_csv(DATA, sep=r"\s+")
    res = {"source": "Datasets/02_ALS_Progression_Efron_Hastie/ALS.txt (DREAM-ALS / PRO-ACT, "
                     "via Efron & Hastie CASI ch. 17)",
           "n_patients": int(len(df)), "n_columns": int(df.shape[1]),
           "split": {"train": int((~df.testset).sum()), "test": int(df.testset.sum())},
           "n_missing_values": int(df.isna().sum().sum())}

    # ---------------- 1. predictors and the target ----------------
    groups = {}
    for c in df.columns:
        g = group_of(c)
        if g:
            groups.setdefault(g, []).append(c)
    res["predictor_groups"] = {g: {"n_columns": len(cs), "examples": cs[:4]}
                               for g, cs in sorted(groups.items())}
    res["predictor_groups_note"] = (
        "No laboratory columns exist in this version (the PRO-ACT labs were not kept). "
        "Each measured variable has summaries of the first 3 months: max, min, last, mean, "
        "sum, meansquares, sd, number of visits, first/last date, first-to-last slope; the "
        "'visit_to_visit_slopes' groups summarise the rates between consecutive visits.")
    res["scale_checks"] = {
        "max_alsfrs_total_seen": int(df["max.alsfrs.score"].max()),
        "max_last_alsfrs_date_days": int(df["last.alsfrs.score.date"].max()),
        "pct_sex_unknown": r(100 * np.mean((df["Sex.Male"] + df["Sex.Female"]) == 0), 1),
        "pct_trial_arm_unknown": r(100 * np.mean((df["Study.Arm.PLACEBO"] + df["Study.Arm.ACTIVE"]) == 0), 1),
        "pct_bulbar_onset": r(100 * df["Site.of.Onset.Onset..Bulbar"].mean(), 1),
    }
    y = df["dFRS"].to_numpy(float)
    bulbar = df["Site.of.Onset.Onset..Bulbar"].to_numpy() == 1
    limb = df["Site.of.Onset.Onset..Limb"].to_numpy() == 1
    res["dFRS_points_per_month"] = {
        "all": q(y) | {"mean": r(y.mean()), "sd": r(y.std(ddof=1)),
                       "pct_zero_or_improving": r(100 * np.mean(y >= 0), 1)},
        "bulbar_onset": q(y[bulbar]), "limb_onset": q(y[limb]),
        "bulbar_vs_limb_mannwhitney_p": r(stats.mannwhitneyu(y[bulbar], y[limb]).pvalue),
        "train": q(y[~df.testset]), "test": q(y[df.testset]),
    }

    # ---------------- 2. baseline models on the official split ----------------
    X = df.drop(columns=["testset", "dFRS"])
    tr, te = ~df.testset.to_numpy(), df.testset.to_numpy()
    Xtr, Xte, ytr, yte = X[tr], X[te], y[tr], y[te]

    def perf(pred):
        return {"test_mse": r(np.mean((yte - pred) ** 2)),
                "test_r2": r(1 - np.mean((yte - pred) ** 2) / np.mean((yte - ytr.mean()) ** 2)),
                "pearson_r_pred_vs_actual": r(stats.pearsonr(pred, yte)[0]),
                "spearman_r_pred_vs_actual": r(stats.spearmanr(pred, yte)[0])}

    models = {"predict_training_mean": {"test_mse": r(np.mean((yte - ytr.mean()) ** 2))}}
    rf = RandomForestRegressor(n_estimators=500, max_features=1 / 3, min_samples_leaf=5,
                               oob_score=True, n_jobs=-1, random_state=SEED).fit(Xtr, ytr)
    models["random_forest"] = perf(rf.predict(Xte)) | {
        "settings": "500 trees, mtry = p/3, min leaf 5 (R randomForest defaults)",
        "oob_mse_train": r(np.mean((ytr - rf.oob_prediction_) ** 2))}
    gb = GradientBoostingRegressor(learning_rate=0.02, n_estimators=500, max_leaf_nodes=5,
                                   subsample=0.5, random_state=SEED).fit(Xtr, ytr)
    staged = np.array([np.mean((yte - p) ** 2) for p in gb.staged_predict(Xte)])
    gb_pred300 = list(gb.staged_predict(Xte))[299]
    models["gradient_boosting"] = perf(gb_pred300) | {
        "settings": "CASI Fig 17.8 settings fixed in advance: shrinkage 0.02, 4 splits per tree "
                    "(5 leaves), 50% subsample, 300 trees",
        "test_mse_at_500_trees": r(staged[-1]),
        "best_test_mse_over_1_to_500_trees_optimistic": r(staged.min()),
        "best_n_trees_optimistic": int(staged.argmin() + 1)}
    lasso = make_pipeline(StandardScaler(), LassoCV(cv=10, random_state=SEED, max_iter=50000,
                                                    n_jobs=-1)).fit(Xtr, ytr)
    models["lasso_10fold_cv"] = perf(lasso.predict(Xte)) | {
        "n_nonzero_coefs": int(np.sum(lasso[-1].coef_ != 0))}

    # simple, explainable model: 4 numbers a clinic would have
    first_score = (df["last.alsfrs.score"] - df["alsfrs.score.slope"]
                   * (df["last.alsfrs.score.date"] - df["first.alsfrs.score.date"]) / DPM)
    months = -df["Onset.Delta"].to_numpy(float) / DPM
    pre_slope = (ALSFRS_MAX - first_score.to_numpy()) / months   # Kimura's delta-FS, 40-point scale
    simple = np.column_stack([np.log(months), pre_slope, df["alsfrs.score.slope"], bulbar])
    lin = LinearRegression().fit(simple[tr], ytr)
    models["linear_4_features"] = perf(lin.predict(simple[te])) | {
        "features": ["log(months since onset)", "pre-entry slope (40 - first ALSFRS) / months",
                     "first-3-month ALSFRS slope", "bulbar onset"]}
    models["casi_benchmark_note"] = ("CASI Fig 17.6 plots test MSE for boosting, random forest "
                                     "and lasso between 0.25 and 0.30 on this split, boosting "
                                     "lowest; exact values are only shown graphically.")
    res["models_official_split"] = models

    imp = pd.Series(rf.feature_importances_, index=X.columns).sort_values(ascending=False)
    res["rf_top10_impurity_importance"] = [{"feature": k, "importance": r(v)}
                                           for k, v in imp.head(10).items()]
    gimp = pd.Series(gb.feature_importances_, index=X.columns).sort_values(ascending=False)
    res["gb_top10_impurity_importance"] = [{"feature": k, "importance": r(v)}
                                           for k, v in gimp.head(10).items()]

    # grouped permutation importance on the test set (permute a whole group together)
    rng = np.random.default_rng(SEED)
    base = np.mean((yte - rf.predict(Xte)) ** 2)
    gperm = {}
    for g, cs in groups.items():
        incs = []
        for _ in range(10):
            Xp = Xte.copy()
            idx = rng.permutation(len(Xp))
            Xp[cs] = Xte[cs].to_numpy()[idx]
            incs.append(np.mean((yte - rf.predict(Xp)) ** 2) - base)
        gperm[g] = {"n_columns": len(cs), "test_mse_increase_mean": r(np.mean(incs)),
                    "sd_over_10_repeats": r(np.std(incs, ddof=1))}
    res["rf_grouped_permutation_importance_test"] = dict(
        sorted(gperm.items(), key=lambda kv: -kv[1]["test_mse_increase_mean"]))

    # ---------------- 3. time from onset to trial entry ----------------
    o = {"months_since_onset_at_entry": q(months),
         "spearman_months_vs_dFRS_all": spearman(months, y),
         "spearman_months_vs_dFRS_bulbar": spearman(months[bulbar], y[bulbar]),
         "spearman_months_vs_dFRS_limb": spearman(months[limb], y[limb])}
    bins = [0, 12, 24, 36, np.inf]
    labels = ["<12", "12-24", "24-36", ">=36"]
    cut = pd.cut(months, bins, right=False, labels=labels)
    o["dFRS_by_months_since_onset"] = {
        lab: q(y[cut == lab]) | {"pct_bulbar": r(100 * bulbar[cut == lab].mean(), 1),
                                 "first_alsfrs_median": r(np.median(first_score[cut == lab])),
                                 "pre_entry_slope_median": r(np.median(pre_slope[cut == lab]))}
        for lab in labels}
    o["pre_entry_slope_points_per_month"] = q(pre_slope)
    o["spearman_pre_entry_slope_vs_dFRS"] = spearman(pre_slope, y)
    two = df["num.alsfrs.score.visits"].to_numpy() >= 2
    o["spearman_first_3_month_slope_vs_dFRS"] = spearman(df["alsfrs.score.slope"][two], y[two])
    age = df["Age"].to_numpy(float)
    o["ols_dFRS_on_log2_months_adjusted"] = ols(
        y, np.column_stack([np.log2(months), bulbar, age, first_score]),
        ["log2_months_since_onset", "bulbar", "age", "first_alsfrs"])
    o["ols_dFRS_on_log2_months_plus_pre_entry_slope"] = ols(
        y, np.column_stack([np.log2(months), bulbar, age, first_score, pre_slope]),
        ["log2_months_since_onset", "bulbar", "age", "first_alsfrs", "pre_entry_slope"])
    o["caveats"] = [
        "Onset.Delta is symptom onset to TRIAL ENTRY, not to diagnosis; it includes the "
        "diagnostic delay plus time from diagnosis to enrolment.",
        "Left truncation: trials enrol people still well enough to qualify, so anyone enrolled "
        "years after onset must be a slow progressor. This builds the association in.",
        "Direction: slow disease is diagnosed later (subtle symptoms), so delay mostly marks "
        "slow biology; it does not show that diagnosing earlier changes the course."]
    res["onset_to_entry"] = o

    # ---------------- 4. noise and months until a decline beats it ----------------
    noise = {"alsfrs_total": reconstruct3(df, "alsfrs.score", "last.alsfrs.score",
                                          "sum.alsfrs.score", integer=True),
             "weight_kg": reconstruct3(df, "weight", "last.weight", "sum.weight", integer=False),
             "fvc_liters": reconstruct3(df, "fvc.liters", "last.fvc.liters", "sum.fvc.liters",
                                        integer=False)}
    mdc = noise["alsfrs_total"]["mdc95_between_two_visits"]
    rates = {"slow_progressor_p75_dFRS": np.percentile(y, 75), "median": np.median(y),
             "fast_progressor_p25_dFRS": np.percentile(y, 25)}
    mdc_rob = noise["alsfrs_total"]["mdc95_robust"]
    noise["months_until_alsfrs_drop_exceeds_mdc95"] = {
        k: {"rate_points_per_month": r(v), "months": r(mdc / -v, 1) if v < 0 else None,
            "months_with_robust_mdc": r(mdc_rob / -v, 1) if v < 0 else None}
        for k, v in rates.items()}
    long_delay = months >= 36
    v_slow = np.median(y[long_delay])
    noise["months_until_mdc95_for_onset_to_entry_ge_36_months_group"] = {
        "n": int(long_delay.sum()), "median_dFRS": r(v_slow),
        "months": r(mdc / -v_slow, 1), "months_with_robust_mdc": r(mdc_rob / -v_slow, 1)}
    span = (df["last.alsfrs.score.date"] - df["first.alsfrs.score.date"]).to_numpy(float)
    drop = (first_score - df["last.alsfrs.score"]).to_numpy(float)
    long_span = span >= 60
    noise["observed_first_3_months"] = {
        "n_with_span_ge_60_days": int(long_span.sum()),
        "span_days_median": r(np.median(span[long_span])),
        "pct_drop_ge_mdc95": r(100 * np.mean(drop[long_span] >= mdc), 1),
        "pct_no_drop_or_rise": r(100 * np.mean(drop[long_span] <= 0), 1)}
    noise["early_slopes_first_3_months"] = {
        "weight_kg_per_month": q(df["weight.slope"][df["num.weight.visits"] >= 2]),
        "fvc_liters_per_month": q(df["fvc.liters.slope"][df["num.fvc.liters.visits"] >= 2])}
    noise["note"] = ("Noise = scatter of the middle of 3 visits around the first-to-last line "
                     "within ~3 months (rater error + real day-to-day change). MDC95 = 1.96 * "
                     "sqrt(2) * sigma. Scale is the 40-point ALSFRS; the 48-point ALSFRS-R adds "
                     "respiratory items, so treat these as approximate for ALSFRS-R.")
    res["noise_and_detectability"] = noise

    # ---------------- figure ----------------
    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    ax.scatter(months[limb], y[limb], s=6, alpha=0.35, color="#5b8db8", label="limb onset")
    ax.scatter(months[bulbar], y[bulbar], s=6, alpha=0.45, color="#d08c60", label="bulbar onset")
    mids, meds = [], []
    for lo_, hi_ in zip(bins[:-1], bins[1:]):
        m = (months >= lo_) & (months < hi_)
        mids.append(np.median(months[m]))
        meds.append(np.median(y[m]))
    ax.plot(mids, meds, "k-o", lw=2, label="median per band")
    ax.set_xscale("log")
    ax.set_xlabel("months from first symptom to trial entry (log scale)")
    ax.set_ylabel("dFRS: later ALSFRS change (points / month)")
    ax.axhline(0, color="grey", lw=0.6)
    ax.set_title(f"Longer onset-to-entry, slower later decline (n = {len(df)})")
    ax.legend(fontsize=8, loc="lower right")
    fig.tight_layout()
    fig.savefig(FIG, dpi=140)

    RESULTS.write_text(json.dumps(res, indent=2))
    print(json.dumps(res, indent=1)[:200000])


if __name__ == "__main__":
    main()
