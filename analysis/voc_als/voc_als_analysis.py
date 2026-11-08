"""VOC-ALS: can simple phone-computable voice features flag ALS, track speech severity,
and show anything in ALS patients whose speech is still rated normal?

Data: VOC-ALS (Synapse syn53009474), read-only from Datasets/04_VOC-ALS_Synapse/data/.
153 people (102 ALS, 51 healthy controls), ONE session each, 8 phone recordings each
(5 sustained vowels, fast single-breath /pa/ /ta/ /ka/ repetition), 8 kHz mono 16-bit.

Run from the project folder:
    python -I analysis\\voc_als\\voc_als_analysis.py            (writes results.json only)
    python -I analysis\\voc_als\\voc_als_analysis.py --qc DIR   (also a peak-detection QC
                                                                 figure, written to DIR)

Licence: VOC-ALS must not be redistributed. This script writes ONLY group-level summaries
(counts, medians, AUCs, correlations) to analysis/voc_als/results.json. The optional QC
figure shows individual envelopes, so it is written only to the folder you pass (keep it
out of anything shared).

Data fixes (from Datasets/README.md, re-checked here):
  * CT050 (control) and PZ091 (ALS) are byte-identical in all 8 tasks -> both dropped.
  * PZ064's /a/ is a third copy of that same /a/ -> PZ064 /a/ set to missing.
  * PZ068's /ka/ is 0.7 s of noise -> PZ068 /ka/ (audio and spreadsheet) set to missing.
"""
import site
import sys

# `python -I` drops the user site-packages, where numpy/scipy/sklearn live on this PC.
_USER_SITE = site.getusersitepackages()
if _USER_SITE not in sys.path:
    sys.path.append(_USER_SITE)

import argparse
import hashlib
import json
import wave
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import signal, stats
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
DATA = ROOT / "Datasets" / "04_VOC-ALS_Synapse" / "data"
SEED = 20261107
N_BOOT = 2000
VOWELS = ["A", "E", "I", "O", "U"]
SYLLS = ["PA", "TA", "KA"]
TRIM_S = 0.35  # recorder start-up silence is 0.05-0.33 s in every file
HOP = 0.010
WIN = 0.025


# --------------------------------------------------------------------------- audio
def read_wav(path):
    with wave.open(str(path)) as w:
        assert w.getnchannels() == 1 and w.getsampwidth() == 2
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64)
    clip = float(np.mean(np.abs(x) >= 32760))
    return x / 32768.0, sr, clip


def envelope_db(x, sr):
    """Frame RMS level in dB (25 ms window, 10 ms hop) after a 70 Hz high-pass."""
    b, a = signal.butter(4, 70 / (sr / 2), "high")
    x = signal.filtfilt(b, a, x)
    nwin, nhop = int(WIN * sr), int(HOP * sr)
    nfr = 1 + (len(x) - nwin) // nhop
    if nfr < 5:
        return np.array([]), np.array([])
    idx = np.arange(nwin)[None, :] + nhop * np.arange(nfr)[:, None]
    rms = np.sqrt(np.mean(x[idx] ** 2, axis=1))
    db = 20 * np.log10(rms + 1e-7)
    t = (np.arange(nfr) * nhop + nwin / 2) / sr
    return t, db


def ddk_features(x, sr, prominence=6.0, min_gap_s=0.07):
    """Syllable rate etc. from peaks of the smoothed level envelope (one peak per vowel
    nucleus; the /p/ /t/ /k/ closures make the dips)."""
    x = x[int(TRIM_S * sr):]
    t, db = envelope_db(x, sr)
    out = dict(ddk_rate=np.nan, ddk_n=np.nan, ddk_isi_cv=np.nan, ddk_train_s=np.nan,
               ddk_rate_h1=np.nan, ddk_rate_h2=np.nan)
    if len(db) < 20:
        return out, t, db, np.array([], int)
    dbs = np.convolve(db, np.ones(3) / 3, mode="same")  # 30 ms smoothing
    top = np.percentile(dbs, 95)
    floor = np.percentile(dbs, 10)  # closures + pre/post silence give the noise floor
    # QC (v1 figure) showed clicks and near-floor bumps being counted, so a peak must be
    # >= 10 dB above the floor, within 20 dB of the loudest syllables, and >= 40 ms wide
    # at half its prominence (a click is ~1-2 frames wide).
    pk, _ = signal.find_peaks(dbs, prominence=prominence, distance=int(min_gap_s / HOP),
                              height=max(top - 20, floor + 10), width=4)
    if len(pk) >= 4:
        tp = t[pk]
        isi = np.diff(tp)
        out.update(ddk_rate=(len(pk) - 1) / (tp[-1] - tp[0]), ddk_n=len(pk),
                   ddk_isi_cv=isi.std(ddof=1) / isi.mean(), ddk_train_s=tp[-1] - tp[0])
        h = len(pk) // 2  # split-half: first vs second half of the syllable train
        if h >= 3 and len(pk) - h >= 3:
            out["ddk_rate_h1"] = (h - 1) / (tp[h - 1] - tp[0])
            out["ddk_rate_h2"] = (len(pk) - h - 1) / (tp[-1] - tp[h])
    return out, t, db, pk


def vowel_features(x, sr):
    """Duration of the longest phonation run and its loudness stability."""
    x = x[int(TRIM_S * sr):]
    t, db = envelope_db(x, sr)
    out = dict(vow_dur=np.nan, vow_int_sd=np.nan)
    if len(db) < 20:
        return out
    active = db > np.percentile(db, 95) - 20
    # merge gaps shorter than 150 ms, then take the longest active run
    runs, start = [], None
    for i, a in enumerate(np.append(active, False)):
        if a and start is None:
            start = i
        elif not a and start is not None:
            runs.append([start, i])
            start = None
    merged = []
    for r in runs:
        if merged and (r[0] - merged[-1][1]) * HOP < 0.15:
            merged[-1][1] = r[1]
        else:
            merged.append(r)
    if not merged:
        return out
    s, e = max(merged, key=lambda r: r[1] - r[0])
    out["vow_dur"] = (e - s) * HOP
    n = e - s
    core = db[s + n // 10: e - n // 10]  # middle 80 % (skip onset and offset)
    if len(core) >= 20:
        out["vow_int_sd"] = float(np.std(core, ddof=1))
    return out


def extract_audio_features(ids):
    rows, clip_rows, md5 = [], [], {}
    for pid in ids:
        r = {"ID": pid}
        for v in VOWELS:
            f = DATA / f"phonation{v}" / f"{pid}_phonation{v}.wav"
            x, sr, clip = read_wav(f)
            md5[(pid, "V" + v)] = hashlib.md5(f.read_bytes()).hexdigest()
            for k, val in vowel_features(x, sr).items():
                r[f"{k}_{v}"] = val
            clip_rows.append((pid, "vowel", clip))
        for s in SYLLS:
            f = DATA / f"rhythm{s}" / f"{pid}_rhythm{s}.wav"
            x, sr, clip = read_wav(f)
            md5[(pid, s)] = hashlib.md5(f.read_bytes()).hexdigest()
            feats, *_ = ddk_features(x, sr)
            for k, val in feats.items():
                r[f"{k}_{s}"] = val
            # robustness: same detector with a stricter / looser dip threshold
            r[f"ddk_rate_p8_{s}"] = ddk_features(x, sr, prominence=8.0)[0]["ddk_rate"]
            r[f"ddk_rate_p4_{s}"] = ddk_features(x, sr, prominence=4.0)[0]["ddk_rate"]
            clip_rows.append((pid, "ddk", clip))
        rows.append(r)
    return pd.DataFrame(rows).set_index("ID"), pd.DataFrame(clip_rows, columns=["ID", "kind", "clip"]), md5


# --------------------------------------------------------------------------- stats
def auc(pos, neg):
    """P(score of a random ALS > score of a random control); ties count 1/2."""
    pos, neg = np.asarray(pos, float), np.asarray(neg, float)
    pos, neg = pos[~np.isnan(pos)], neg[~np.isnan(neg)]
    r = stats.rankdata(np.concatenate([pos, neg]))
    return (r[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg))


def auc_ci(pos, neg, rng):
    pos, neg = np.asarray(pos, float), np.asarray(neg, float)
    pos, neg = pos[~np.isnan(pos)], neg[~np.isnan(neg)]
    boots = [auc(rng.choice(pos, len(pos)), rng.choice(neg, len(neg))) for _ in range(N_BOOT)]
    p = stats.mannwhitneyu(pos, neg, alternative="two-sided").pvalue
    return dict(auc=round(auc(pos, neg), 3), ci95=[round(float(np.percentile(boots, 2.5)), 3),
                                                   round(float(np.percentile(boots, 97.5)), 3)],
                p_mannwhitney=float(f"{p:.3g}"), n_als=int(len(pos)), n_hc=int(len(neg)))


def bh(pvals):
    p = np.asarray(pvals, float)
    order = np.argsort(p)
    q = p[order] * len(p) / np.arange(1, len(p) + 1)
    q = np.minimum.accumulate(q[::-1])[::-1]
    out = np.empty_like(q)
    out[order] = np.minimum(q, 1)
    return out


def within_person(df_wide, cols):
    """Two-way (person x stimulus) decomposition over repeated stimuli from ONE session.
    SEM = residual SD after removing person and stimulus means; MDC95 = 1.96*sqrt(2)*SEM.
    ICC(3,1) consistency. Complete cases only."""
    m = df_wide[cols].dropna().to_numpy(float)
    n, k = m.shape
    gm = m.mean()
    ss_rows = k * ((m.mean(1) - gm) ** 2).sum()
    ss_cols = n * ((m.mean(0) - gm) ** 2).sum()
    ss_err = ((m - gm) ** 2).sum() - ss_rows - ss_cols
    ms_rows = ss_rows / (n - 1)
    ms_err = ss_err / ((n - 1) * (k - 1))
    sem = np.sqrt(ms_err)
    icc = (ms_rows - ms_err) / (ms_rows + (k - 1) * ms_err)
    return dict(n=int(n), k_stimuli=int(k), grand_mean=round(float(gm), 3),
                stimulus_means=[round(float(v), 3) for v in m.mean(0)],
                sem=round(float(sem), 3), icc_3_1=round(float(icc), 3),
                mdc95_single=round(float(1.96 * np.sqrt(2) * sem), 3),
                mdc95_mean_of_k=round(float(1.96 * np.sqrt(2) * sem / np.sqrt(k)), 3),
                mdc95_single_pct_of_mean=round(float(100 * 1.96 * np.sqrt(2) * sem / gm), 1))


def split_half(df, a, b):
    d = df[[a, b]].dropna()
    diff = d[a] - d[b]
    sem = diff.std(ddof=1) / np.sqrt(2)
    return dict(n=int(len(d)), mean_first_half=round(float(d[a].mean()), 3),
                mean_second_half=round(float(d[b].mean()), 3),
                mean_change=round(float((d[b] - d[a]).mean()), 3),
                sem=round(float(sem), 3), mdc95=round(float(1.96 * np.sqrt(2) * sem), 3))


def med_iqr(s):
    s = pd.Series(s).dropna()
    return [round(float(s.median()), 3), round(float(s.quantile(0.25)), 3),
            round(float(s.quantile(0.75)), 3), int(len(s))]


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--qc", help="folder for an individual-level QC figure (do not share)")
    args = ap.parse_args()
    rng = np.random.default_rng(SEED)

    meta = pd.read_excel(DATA / "VOC-ALS.xlsx", sheet_name="VOC-ALS_Data", header=1)
    meta.columns = [c.strip() for c in meta.columns]
    meta = meta.set_index("ID")
    ids = list(meta.index)

    audio, clips, md5 = extract_audio_features(ids)

    # ---- duplicate check (re-verify README claims from file hashes)
    dup_pairs = sorted({(a[0], b[0]) for a, ha in md5.items() for b, hb in md5.items()
                        if ha == hb and a[0] < b[0]})
    drop = ["CT050", "PZ091"]
    for c in [c for c in audio.columns if c.endswith("_A")]:
        audio.loc["PZ064", c] = np.nan
    for c in [c for c in audio.columns if c.endswith("_KA")]:
        audio.loc["PZ068", c] = np.nan

    pre = meta.copy()
    feat_cols_pre = [c for c in meta.columns if any(c.startswith(p) for p in
                     ["meanF0Hz_", "stdevF0Hz_", "HNR_", "localJitter_", "localShimmer_"])]
    for c in [c for c in feat_cols_pre if c.endswith("_A")]:
        pre.loc["PZ064", c] = np.nan
    for c in [c for c in feat_cols_pre if c.endswith("_KA")]:
        pre.loc["PZ068", c] = np.nan

    df = pre.join(audio).drop(index=drop)
    df["is_als"] = (df["Category"] == "ALS").astype(int)
    speech = pd.to_numeric(df["ALSFRS-R_SpeechSubscore"], errors="coerce")
    df["speech_item"] = speech
    bulbar = sum(pd.to_numeric(df[c], errors="coerce") for c in
                 ["ALSFRS-R_SpeechSubscore", "ALSFRS-R_SalivationSubscore", "ALSFRS-R_SwallowingSubscore"])
    df["bulbar_subscore"] = bulbar
    df["pumns_bulbar"] = pd.to_numeric(df["PUMNS_BulbarSubscore"], errors="coerce").where(lambda s: s <= 4)
    df["female"] = (df["Sex"] == "F").astype(int)

    # ---- per-person summary features a phone app could compute
    for s in SYLLS:
        df[f"f0cv_{s}"] = df[f"stdevF0Hz_{s}"] / df[f"meanF0Hz_{s}"]
    for v in VOWELS:
        df[f"f0cv_{v}"] = df[f"stdevF0Hz_{v}"] / df[f"meanF0Hz_{v}"]
    summary = {
        # name: (columns averaged, expected direction in ALS, description)
        "ddk_rate": ([f"ddk_rate_{s}" for s in SYLLS], -1, "syllables per second, mean of /pa/ /ta/ /ka/ (own envelope peak count)"),
        "ddk_isi_cv": ([f"ddk_isi_cv_{s}" for s in SYLLS], +1, "irregularity of syllable timing (CV of intervals), mean of 3"),
        "ddk_n": ([f"ddk_n_{s}" for s in SYLLS], -1, "syllables produced in one breath, mean of 3"),
        "vowel_duration_s": ([f"vow_dur_{v}" for v in VOWELS], -1, "seconds of sustained vowel, mean of 5 (task asked for >=5 s, so NOT maximum phonation time)"),
        "vowel_loudness_sd_db": ([f"vow_int_sd_{v}" for v in VOWELS], +1, "loudness wobble during a vowel (SD of frame level, dB), mean of 5"),
        "f0cv_ddk": ([f"f0cv_{s}" for s in SYLLS], +1, "pitch variability during /pa/ /ta/ /ka/ (Praat stdevF0/meanF0, spreadsheet), mean of 3"),
        "f0cv_vowels": ([f"f0cv_{v}" for v in VOWELS], +1, "pitch unsteadiness in vowels (stdevF0/meanF0, spreadsheet), mean of 5"),
        "hnr_vowels": ([f"HNR_{v}" for v in VOWELS], -1, "harmonics-to-noise ratio, vowels (spreadsheet), mean of 5"),
        "jitter_vowels": ([f"localJitter_{v}" for v in VOWELS], +1, "local jitter, vowels (spreadsheet), mean of 5"),
        "shimmer_vowels": ([f"localShimmer_{v}" for v in VOWELS], +1, "local shimmer, vowels (spreadsheet), mean of 5"),
    }
    for name, (cols, _, _) in summary.items():
        df[name] = df[cols].mean(axis=1, skipna=True)

    hc = df[df.is_als == 0]
    als = df[df.is_als == 1]
    als_sp4 = als[als.speech_item == 4]
    # stricter "no bulbar symptoms at all": speech, salivation and swallowing all 4
    als_bulbar_clean = als[als.bulbar_subscore == 12]

    res = {"dataset": "VOC-ALS (Synapse syn53009474), single session per person, Naples ALS centre",
           "seed": SEED, "n_boot": N_BOOT,
           "data_fixes": {"identical_recordings_found_by_md5": [list(p) for p in dup_pairs],
                          "dropped_people": drop,
                          "set_missing": ["PZ064 /a/ (copy of CT050/PZ091 /a/)", "PZ068 /ka/ (noise only)"]},
           "n": {"hc": int(len(hc)), "als": int(len(als)), "als_speech_item_4": int(len(als_sp4)),
                 "als_speech_4_and_no_saliva_swallow_symptoms": int(len(als_bulbar_clean)),
                 "als_by_speech_item": {int(k): int(v) for k, v in als.speech_item.value_counts().sort_index().items()},
                 "als_onset": als["OnsetRegion"].value_counts().to_dict(),
                 "als_speech4_onset": als_sp4["OnsetRegion"].value_counts().to_dict()}}

    # ---- confounder checks
    def grp_desc(g):
        return {"n": int(len(g)), "age_median": float(g["Age (years)"].median()),
                "female_pct": round(100 * g.female.mean(), 1)}
    res["confounders"] = {
        "hc": grp_desc(hc), "als": grp_desc(als), "als_speech4": grp_desc(als_sp4),
        "auc_age_als_vs_hc": auc_ci(als["Age (years)"], hc["Age (years)"], rng)["auc"],
        "auc_age_speech4_vs_hc": auc_ci(als_sp4["Age (years)"], hc["Age (years)"], rng)["auc"],
        "als_disease_duration_months_median_iqr": med_iqr(pd.to_numeric(als["DiseaseDuration"], errors="coerce")),
        "als_speech4_disease_duration_months_median_iqr": med_iqr(pd.to_numeric(als_sp4["DiseaseDuration"], errors="coerce")),
        "als_speech4_alsfrs_total_median_iqr": med_iqr(pd.to_numeric(als_sp4["ALSFRS-R_TotalScore"], errors="coerce")),
        "als_speech4_with_any_bulbar_umn_sign_pumns_gt0": int((als_sp4.pumns_bulbar > 0).sum()),
        "als_speech4_with_head_mrc_below_15": int((pd.to_numeric(als_sp4["MRC_HeadMuscles"], errors="coerce") < 15).sum()),
        "pct_recordings_with_clipping_gt_0.1pct": {
            k: round(100 * float((g["clip"] > 0.001).mean()), 1)
            for k, g in clips[~clips.ID.isin(drop)].assign(grp=lambda d: d.ID.str[:2] + "_" + d.kind).groupby("grp")},
    }

    # ---- detector sanity / robustness
    res["ddk_detector_check"] = {
        "hc_rate_median_iqr_by_syllable": {s: med_iqr(hc[f"ddk_rate_{s}"]) for s in SYLLS},
        "spearman_rate_prominence6_vs_8dB": round(float(stats.spearmanr(
            df[[f"ddk_rate_{s}" for s in SYLLS]].mean(1), df[[f"ddk_rate_p8_{s}" for s in SYLLS]].mean(1),
            nan_policy="omit")[0]), 3),
        "spearman_rate_prominence6_vs_4dB": round(float(stats.spearmanr(
            df[[f"ddk_rate_{s}" for s in SYLLS]].mean(1), df[[f"ddk_rate_p4_{s}" for s in SYLLS]].mean(1),
            nan_policy="omit")[0]), 3),
        "auc_als_vs_hc_rate_prominence8": round(1 - auc(als[[f"ddk_rate_p8_{s}" for s in SYLLS]].mean(1),
                                                        hc[[f"ddk_rate_p8_{s}" for s in SYLLS]].mean(1)), 3),
        "auc_als_vs_hc_rate_prominence4": round(1 - auc(als[[f"ddk_rate_p4_{s}" for s in SYLLS]].mean(1),
                                                        hc[[f"ddk_rate_p4_{s}" for s in SYLLS]].mean(1)), 3),
        "recordings_with_<4_peaks": int(df[[f"ddk_rate_{s}" for s in SYLLS]].isna().sum().sum()),
    }

    # ---- Q1: pre-specified phone features. AUC oriented by the PRE-STATED direction
    # (so AUC > 0.5 means ALS differs the expected way; < 0.5 means the opposite).
    q1 = {}
    for name, (cols, sign, desc) in summary.items():
        f = lambda g: sign * g[name]
        sp = stats.spearmanr(als[name], als.speech_item, nan_policy="omit")
        sb = stats.spearmanr(als[name], als.bulbar_subscore, nan_policy="omit")
        q1[name] = {
            "description": desc, "expected_direction_in_als": "higher" if sign > 0 else "lower",
            "median_iqr_n": {"hc": med_iqr(hc[name]),
                             **{f"als_speech_{k}": med_iqr(als.loc[als.speech_item == k, name]) for k in [4, 3, 2, 1]}},
            "auc_als_vs_hc": auc_ci(f(als), f(hc), rng),
            "auc_speech_normal_als_vs_hc": auc_ci(f(als_sp4), f(hc), rng),
            "auc_no_bulbar_symptom_als_vs_hc": auc_ci(f(als_bulbar_clean), f(hc), rng),
            "spearman_with_speech_item_in_als": {"rho": round(float(sp[0]), 3), "p": float(f"{sp[1]:.3g}"),
                                                 "n": int(als[[name, "speech_item"]].dropna().shape[0]),
                                                 "note": "speech item 4 = normal; negative rho means feature rises as speech worsens"},
            "spearman_with_bulbar_subscore_0_12_in_als": {"rho": round(float(sb[0]), 3), "p": float(f"{sb[1]:.3g}")},
        }
    res["q1_phone_features"] = q1

    # ---- sex-stratified check of the strongest single features
    res["sex_stratified_auc_als_vs_hc"] = {
        name: {sx: round(float((auc(summary[name][1] * als.loc[als.Sex == sx, name],
                                    summary[name][1] * hc.loc[hc.Sex == sx, name]))), 3) for sx in ["M", "F"]}
        for name in summary}

    # ---- multivariable model: all-ALS vs HC, repeated 5-fold CV; also scored on the
    # speech-normal subgroup (model never trained to target that subgroup specifically)
    feats = list(summary.keys())
    X = df[feats].copy()
    for c in ["jitter_vowels", "shimmer_vowels", "f0cv_ddk", "f0cv_vowels", "ddk_isi_cv"]:
        X[c] = np.log(X[c])
    y = df.is_als.to_numpy()
    reps = 20
    oof = np.zeros((reps, len(df)))
    for r in range(reps):
        skf = StratifiedKFold(5, shuffle=True, random_state=SEED + r)
        for tr, te in skf.split(X, y):
            Xtr = X.iloc[tr].fillna(X.iloc[tr].median())
            Xte = X.iloc[te].fillna(X.iloc[tr].median())
            mdl = make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=2000))
            mdl.fit(Xtr, y[tr])
            oof[r, te] = mdl.predict_proba(Xte)[:, 1]
    per_rep = [auc(o[y == 1], o[y == 0]) for o in oof]
    sp4_mask = (df.speech_item == 4).to_numpy()
    per_rep_sp4 = [auc(o[sp4_mask], o[y == 0]) for o in oof]
    mean_oof = oof.mean(0)
    full = make_pipeline(StandardScaler(), LogisticRegression(C=0.5, max_iter=2000)).fit(X.fillna(X.median()), y)
    res["q1_model_10_features_logistic"] = {
        "features": feats, "cv": "5-fold stratified, 20 repeats, out-of-fold predictions",
        "auc_als_vs_hc_mean_over_repeats": round(float(np.mean(per_rep)), 3),
        "auc_als_vs_hc_ci95_bootstrap_of_averaged_oof": auc_ci(mean_oof[y == 1], mean_oof[y == 0], rng)["ci95"],
        "auc_speech_normal_als_vs_hc_mean_over_repeats": round(float(np.mean(per_rep_sp4)), 3),
        "auc_speech_normal_als_vs_hc_ci95": auc_ci(mean_oof[sp4_mask], mean_oof[y == 0], rng)["ci95"],
        "auc_by_speech_item": {int(k): round(float(auc(mean_oof[(df.speech_item == k).to_numpy()], mean_oof[y == 0])), 3)
                               for k in [4, 3, 2, 1]},
        "standardised_coefficients_full_fit": {f: round(float(c), 3) for f, c in zip(feats, full[-1].coef_[0])},
        "sensitivity_at_90pct_specificity_speech_normal": None,
    }
    thr = np.quantile(mean_oof[y == 0], 0.90)
    res["q1_model_10_features_logistic"]["sensitivity_at_90pct_specificity_all_als"] = round(float((mean_oof[y == 1] > thr).mean()), 3)
    res["q1_model_10_features_logistic"]["sensitivity_at_90pct_specificity_speech_normal"] = round(float((mean_oof[sp4_mask] > thr).mean()), 3)

    # ---- screen of every spreadsheet feature (incl. 3 speech tasks whose audio is not shared)
    screen = []
    for c in feat_cols_pre:
        a = auc(als[c], hc[c])
        p = stats.mannwhitneyu(als[c].dropna(), hc[c].dropna()).pvalue
        a4 = auc(als_sp4[c], hc[c])
        p4 = stats.mannwhitneyu(als_sp4[c].dropna(), hc[c].dropna()).pvalue
        screen.append((c, a, p, a4, p4))
    sc = pd.DataFrame(screen, columns=["feature", "auc_als_gt_hc", "p", "auc_sp4_gt_hc", "p_sp4"])
    sc["q_bh"] = bh(sc.p)
    sc["q_bh_sp4"] = bh(sc.p_sp4)
    sc["dist_from_half"] = (sc.auc_als_gt_hc - 0.5).abs()
    sc = sc.sort_values("dist_from_half", ascending=False)
    res["spreadsheet_feature_screen"] = {
        "note": "AUC = P(ALS value > control value); <0.5 means lower in ALS. 55 tests; q = Benjamini-Hochberg.",
        "n_features": int(len(sc)), "n_q_lt_0.05_all_als": int((sc.q_bh < 0.05).sum()),
        "n_q_lt_0.05_speech_normal": int((sc.q_bh_sp4 < 0.05).sum()),
        "top10": [{k: (round(float(v), 4) if not isinstance(v, str) else v) for k, v in row.items() if k != "dist_from_half"}
                  for row in sc.head(10).to_dict("records")],
        "best_speech_normal": [{k: (round(float(v), 4) if not isinstance(v, str) else v) for k, v in row.items() if k != "dist_from_half"}
                               for row in sc.assign(d4=(sc.auc_sp4_gt_hc - 0.5).abs()).sort_values("d4", ascending=False)
                               .drop(columns="d4").head(5).to_dict("records")],
    }

    # ---- Q2: within-person variability (no repeated sessions exist -> proxies only)
    res["q2_within_person_variability"] = {
        "warning": ("VOC-ALS has ONE session per person, so no true test-retest exists. These are "
                    "same-session proxies: across the 3 syllables (or 5 vowels) after removing each "
                    "stimulus' average, and first vs second half of one syllable train. Week-to-week "
                    "variability (day, placement, motivation, device) will be larger, so treat these "
                    "MDCs as a floor."),
        "ddk_rate_across_pa_ta_ka": {"hc": within_person(hc, [f"ddk_rate_{s}" for s in SYLLS]),
                                     "als": within_person(als, [f"ddk_rate_{s}" for s in SYLLS])},
        "ddk_rate_split_half_within_train": {s: {"hc": split_half(hc, f"ddk_rate_h1_{s}", f"ddk_rate_h2_{s}"),
                                                 "als": split_half(als, f"ddk_rate_h1_{s}", f"ddk_rate_h2_{s}")}
                                             for s in ["PA"]},
        "vowel_duration_across_5_vowels": {"hc": within_person(hc, [f"vow_dur_{v}" for v in VOWELS]),
                                           "als": within_person(als, [f"vow_dur_{v}" for v in VOWELS])},
        "f0cv_across_pa_ta_ka": {"hc": within_person(hc, [f"f0cv_{s}" for s in SYLLS]),
                                 "als": within_person(als, [f"f0cv_{s}" for s in SYLLS])},
    }
    # how big are real group gaps compared with the MDC of the 3-syllable mean?
    mdc3 = res["q2_within_person_variability"]["ddk_rate_across_pa_ta_ka"]["hc"]["mdc95_mean_of_k"]
    med = {k: q1["ddk_rate"]["median_iqr_n"][k][0] for k in q1["ddk_rate"]["median_iqr_n"]}
    res["q2_within_person_variability"]["ddk_rate_group_gaps_vs_mdc"] = {
        "mdc95_mean_of_3_syllables_hc": mdc3,
        "median_gap_hc_minus_speech4": round(med["hc"] - med["als_speech_4"], 3),
        "median_gap_speech4_minus_speech3": round(med["als_speech_4"] - med["als_speech_3"], 3),
        "median_gap_speech3_minus_speech2": round(med["als_speech_3"] - med["als_speech_2"], 3),
    }

    out = HERE / "results.json"
    out.write_text(json.dumps(res, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o)))
    print("wrote", out)

    if args.qc:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        picks = [hc.index[0], hc.index[10], als_sp4.index[0]] + \
                [als.index[(als.speech_item == k).to_numpy()][0] for k in [3, 2, 1]]
        fig, axes = plt.subplots(len(picks), 1, figsize=(12, 2.2 * len(picks)))
        for ax, pid in zip(axes, picks):
            x, sr, _ = read_wav(DATA / "rhythmPA" / f"{pid}_rhythmPA.wav")
            feats_, t, db, pk = ddk_features(x, sr)
            ax.plot(t, db, lw=0.7)
            ax.plot(t[pk], db[pk], "rv", ms=4)
            ax.set_title(f"{pid} /pa/ speech={df.loc[pid, 'speech_item'] if pid in df.index else '?'} "
                         f"rate={feats_['ddk_rate']:.2f}/s n={feats_['ddk_n']}", fontsize=8)
        fig.tight_layout()
        qc = Path(args.qc) / "voc_ddk_peak_qc_DO_NOT_SHARE.png"
        fig.savefig(qc, dpi=80)
        print("QC figure (individual-level, keep private):", qc)


if __name__ == "__main__":
    main()
