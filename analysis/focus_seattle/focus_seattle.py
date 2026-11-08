"""ALS Focus Wave 4 + Seattle ALS Patient Profile Database: what ELSE can they tell
the ALS red-flag referral tool (beyond the onset-to-diagnosis delay done earlier)?

  A. ALS Focus ALSFRSandVC.csv - repeated self-REPORTS of the most recent ALSFRS-R
     total and vital capacity % (each with the month/year of that test). Note: these
     are patients recalling clinic-measured scores, NOT a home-administered
     questionnaire; there are no item or domain scores.
       -> decline per month, re-report agreement, noise floor (SEM proxy, MDC95),
          baseline progression rate (48 - score) / months since onset.
  B. ALS Focus HealthStatus.csv - repeated self-reported speech, breathing support,
     mobility aid and feeding tube status (domain proxies; no dates, only wave order).
  C. ALS Focus Telehealth.csv - remote care use, tests done remotely, willingness,
     barriers, internet (feasibility of home tests).
  D. Seattle ALS_time.csv + STU_time.csv - ALS Severity Scale (ALSSS; speech,
     swallowing, upper limb, lower limb, each 1-10, clinician-rated) at ~3-monthly
     visits -> per-domain decline per month and visit-to-visit noise.
  E. Seattle DHX/MHX/DEM person files - what happened before diagnosis: per-region
     symptom dates, who made the diagnosis, second opinions, surgeries and
     injuries reported at ages inside the symptom-to-diagnosis window.

Data are read-only. ONLY group-level summaries (counts, medians, quantiles, model
fits) are written to analysis/focus_seattle/results.json. No row-level data is
written anywhere (ALS Focus terms forbid redistribution; Seattle is CC BY-NC).

Run (from any folder):
    python -I "analysis/focus_seattle/focus_seattle.py"
"""
import site
import sys

# `python -I` drops the user site-packages, where numpy/pandas/scipy live on this
# machine; add back that one directory only (same approach as analysis/gait_evidence.py).
_USER_SITE = site.getusersitepackages()
if _USER_SITE not in sys.path:
    sys.path.append(_USER_SITE)

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import mannwhitneyu, spearmanr

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
FOCUS = ROOT / "Datasets" / "01_ALS_Focus_Harvard_Dataverse" / "data"
SEA = ROOT / "Datasets" / "07_Seattle_ALS_Patient_Profile_Mendeley" / "v3_latest_2026-03"
WIDE = SEA / "Wide (person-level) data"
LONG = SEA / "Long (visit-level) data"
OUT = HERE / "results.json"

DPM = 365.25 / 12                      # days per month
Z95_PAIR = 1.96 * np.sqrt(2)           # MDC95 = 1.96 * sqrt(2) * SEM
# ALS Focus FilesDescription.docx: these 4 IDs answered the wrong survey set.
FOCUS_WRONG_SURVEY_IDS = {"279", "322", "1409", "2050"}
# Last calendar month of each ALS Focus wave (FilesDescription.docx), as year*12 + month-1.
WAVE_END = {1: 2020 * 12 + 3, 2: 2020 * 12 + 11, 3: 2021 * 12 + 3, 4: 2021 * 12 + 9}
SEA_MISSING_MAX = -22222               # Seattle missing codes are -22222 ... -99999


# ----------------------------------------------------------------------------- helpers
def summ(x, nd=2):
    x = pd.Series(x, dtype=float).dropna().to_numpy()
    if len(x) == 0:
        return {"n": 0}
    q1, med, q3 = np.percentile(x, [25, 50, 75])
    return {"n": int(len(x)), "median": round(float(med), nd), "q1": round(float(q1), nd),
            "q3": round(float(q3), nd), "mean": round(float(x.mean()), nd)}


def pct(k, n):
    return {"k": int(k), "n": int(n), "pct": round(100.0 * k / n, 1) if n else None}


def lead_int(s):
    """'08' -> 8, '2-28' -> 2, NaN/garbage -> NaN."""
    if pd.isna(s):
        return np.nan
    m = re.match(r"\s*(\d+)", str(s))
    return int(m.group(1)) if m else np.nan


def slope_and_rss(t, y):
    A = np.vstack([np.ones_like(t), t]).T
    coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    r = y - A @ coef
    return float(coef[1]), float(r @ r)


def trend_noise(series):
    """series: {key: (t_months, y)} with >=2 distinct times each.
    Per-person OLS slope, and the pooled residual SD around each person's own line
    (people with >=3 times; dof = sum(n_i - 2)). That SD is a standard-error-of-
    measurement (SEM) proxy: it holds measurement noise PLUS any non-linear real
    change, so it is an upper bound on pure test-retest noise."""
    slopes, rss, dof = {}, 0.0, 0
    for k, (t, y) in series.items():
        b, r = slope_and_rss(np.asarray(t, float), np.asarray(y, float))
        slopes[k] = b
        if len(t) >= 3:
            rss += r
            dof += len(t) - 2
    sem = float(np.sqrt(rss / dof)) if dof else None
    return slopes, sem, dof


def steps_summary(series):
    """Consecutive-measurement changes: share up / flat / down, and the size of rises
    (a rise is mostly noise in ALS, which rarely improves)."""
    dt, dy = [], []
    for t, y in series.values():
        dt += list(np.diff(t))
        dy += list(np.diff(y))
    dt, dy = np.array(dt, float), np.array(dy, float)
    n = len(dy)
    return {
        "n_steps": n,
        "interval_months": summ(dt, 1),
        "up": pct((dy > 0).sum(), n), "flat": pct((dy == 0).sum(), n), "down": pct((dy < 0).sum(), n),
        "change_points": summ(dy, 1),
        "size_of_rises": summ(dy[dy > 0], 1),
        "p95_abs_change_within_4_months": (round(float(np.percentile(np.abs(dy[dt <= 4]), 95)), 1)
                                           if (dt <= 4).sum() >= 10 else None),
        "n_steps_within_4_months": int((dt <= 4).sum()),
    }


# ----------------------------------------------------------------------------- A. ALS Focus scores
def focus_reports():
    a = pd.read_csv(FOCUS / "ALSFocusWave4_ALSFRSandVC.csv", dtype=str, encoding_errors="replace")
    a = a[(a.Group == "Person with ALS") & ~a.Subject_ID.isin(FOCUS_WRONG_SURVEY_IDS)].copy()
    a["wave"] = a.wave.astype(int)
    a["time"] = a.time.astype(int)
    return a


def focus_measure(a, score, month, year, lo, hi):
    d = a[["Subject_ID", "wave", "time"]].copy()
    d["y"] = pd.to_numeric(a[score], errors="coerce")
    d["m"] = a[month].map(lead_int)
    d["yr"] = a[year].map(lead_int)
    d["t"] = d.yr * 12 + d.m - 1
    n_with_value = int(d.y.notna().sum())
    ok = (d.y.between(lo, hi) & d.m.between(1, 12) & d.yr.between(2017, 2021)
          & (d.t <= d.wave.map(WAVE_END)))
    d = d[ok].sort_values(["Subject_ID", "wave", "time"])

    # Re-reports that point at the SAME test month: the score should be identical.
    same = []
    for _, s in d.groupby("Subject_ID"):
        t, y = s.t.to_numpy(), s.y.to_numpy()
        same += [abs(y[i] - y[i - 1]) for i in range(1, len(s)) if t[i] == t[i - 1]]
    same = np.array(same, float)

    # Distinct tests per person (same month reported twice -> mean), ordered by test date.
    ev = d.groupby(["Subject_ID", "t"]).y.mean().reset_index().sort_values(["Subject_ID", "t"])
    series = {}
    for sid, s in ev.groupby("Subject_ID"):
        if len(s) >= 2:
            series[sid] = ((s.t - s.t.iloc[0]).to_numpy(float), s.y.to_numpy(float))
    slopes, sem, dof = trend_noise(series)
    span = {k: v[0][-1] for k, v in series.items()}
    slopes_3m = [b for k, b in slopes.items() if span[k] >= 3]
    res = {
        "reports_with_a_value": n_with_value,
        "usable_reports": int(len(d)),
        "people_with_usable_report": int(d.Subject_ID.nunique()),
        "people_with_2plus_distinct_test_dates": len(series),
        "people_with_3plus_distinct_test_dates": int(sum(len(v[0]) >= 3 for v in series.values())),
        "same_test_month_rereports": {
            "n_pairs": int(len(same)),
            "score_differs": pct((same > 0).sum(), len(same)),
            "abs_difference_when_differs": summ(same[same > 0], 1),
        },
        "followup_span_months": summ(list(span.values()), 1),
        "slope_points_per_month_all": summ(list(slopes.values())),
        "slope_points_per_month_span_ge_3m": summ(slopes_3m),
        "steps_between_distinct_tests": steps_summary(series),
        "noise_floor": {
            "pooled_residual_sd_sem_proxy": round(sem, 2) if sem else None,
            "dof": dof,
            "mdc95_single_pair": round(Z95_PAIR * sem, 1) if sem else None,
        },
    }
    return res, ev, slopes, span


def focus_part_a():
    a = focus_reports()
    out = {"n_pals_reports": int(len(a)), "n_pals_people": int(a.Subject_ID.nunique())}
    # Who knows their score at all? (person level: ever gave a score / only don't-know / never had)
    p = a.groupby("Subject_ID").agg(
        any_score=("o1_aslfrsr_score", lambda s: s.notna().any()),
        any_dk=("o1_alsfrsr_dk", lambda s: s.notna().any()),
        any_nh=("o1_alsfrsr_nh", lambda s: s.notna().any()))
    n = len(p)
    out["alsfrsr_awareness_people"] = {
        "ever_reported_a_score": pct(p.any_score.sum(), n),
        "only_dont_know": pct(((~p.any_score) & p.any_dk).sum(), n),
        "never_had_test_no_score": pct(((~p.any_score) & p.any_nh).sum(), n),
    }
    out["alsfrsr"], ev, slopes, span = focus_measure(
        a, "o1_aslfrsr_score", "o1_alsfrsr_month", "o1_alsfrsr_year", 0, 48)
    # VC%: entry capped at 100 from Wave 2 (programming error), so rises/flat steps near 100 are censored.
    out["vc_percent"], _, _, _ = focus_measure(a, "o2_vc_percent", "o2_vc_month", "o2_vc_year", 1, 150)
    out["vc_percent"]["note"] = "Entry capped at 100% from Wave 2 (dataset note); values are recalled clinic results."

    # Baseline progression rate (Delta-FS) = (48 - first reported score) / months since onset.
    dem = pd.read_csv(FOCUS / "ALSFocusWave4_Demographics.csv", dtype=str, encoding_errors="replace")
    dem = dem[(dem.Group == "Person with ALS") & ~dem.Subject_ID.isin(FOCUS_WRONG_SURVEY_IDS)]
    dem = dem.drop_duplicates("Subject_ID").set_index("Subject_ID")
    on = pd.to_datetime(dem.p4_onset_date, format="%m/%d/%Y", errors="coerce")
    dem["t_on"] = on.dt.year * 12 + on.dt.month - 1
    first = ev.groupby("Subject_ID").first()
    m = first.join(dem[["t_on", "p3_onset_location"]], how="inner")
    m["months"] = m.t - m.t_on
    m = m[m.months >= 3].copy()          # avoid dividing by ~0 months
    m["dfs"] = (48 - m.y) / m.months
    bulbar = m.loc[m.p3_onset_location.str.startswith("Bulbar", na=False), "dfs"]
    limb = m.loc[m.p3_onset_location.str.contains("limb", na=False), "dfs"]
    mw = mannwhitneyu(bulbar, limb) if len(bulbar) >= 5 and len(limb) >= 5 else None
    # Does the baseline rate predict the later measured slope? (people with >=3 months follow-up)
    ids = [k for k in slopes if span[k] >= 3 and k in m.index]
    rho = spearmanr(m.loc[ids, "dfs"], [slopes[k] for k in ids]) if len(ids) >= 10 else None
    out["baseline_rate_deltaFS"] = {
        "definition": "(48 - first reported ALSFRS-R) / months from first symptom to that test",
        "all": summ(m.dfs),
        "months_onset_to_first_test": summ(m.months, 1),
        "bulbar_onset": summ(bulbar), "limb_onset": summ(limb),
        "bulbar_vs_limb_mannwhitney_p": round(float(mw.pvalue), 4) if mw else None,
        "predicts_later_slope_spearman": ({"n": len(ids), "rho": round(float(rho.statistic), 2),
                                           "p": round(float(rho.pvalue), 4)} if rho else None),
    }
    return out


# ----------------------------------------------------------------------------- B. ALS Focus health status
SPEECH = {  # self-reported speech level; the two middle answers share a level (order unclear)
    "I can speak normally without a speech assisting device": 0,
    "I can speak without difficulty, but with a noticeable change in my voice": 1,
    "I can speak without a speech assisting device, but often need to repeat what I say": 2,
    "I can speak without a speech assisting device, but with difficulty and slurring": 2,
    "I can speak with difficulty, but prefer to use a speech assisting device, hand gestures, or other non-verbal ways to communicate": 3,
    "I have lost the ability to speak completely and require a speech assisting device or other non-verbal ways to communicate": 4,
}
RESP = {"No respiratory support": 0, "Respiratory support while sleeping": 1,
        "Respiratory support while awake only": 1, "Respiratory support while sleeping and awake": 2}


def focus_health():
    h = pd.read_csv(FOCUS / "ALSFocusWave4_HealthStatus.csv", dtype=str, encoding_errors="replace")
    h = h[(h.Group == "Person with ALS") & ~h.Subject_ID.isin(FOCUS_WRONG_SURVEY_IDS)].copy()
    h["wave"] = h.wave.astype(int)
    h["time"] = h.time.astype(int)
    h = h.sort_values(["Subject_ID", "wave", "time"])
    h["speech"] = h.q1_speech.map(SPEECH)
    h["resp"] = h.q2_resp.map(RESP)
    mob = pd.DataFrame({c: h[c].notna() * lvl for c, lvl in
                        [("q6_mobile_none", 0), ("q6_cane", 1), ("q6_walker", 2),
                         ("q6_manualwc", 3), ("q6_motorwc", 4)]})
    answered = h[["q6_mobile_none", "q6_cane", "q6_walker", "q6_manualwc", "q6_motorwc"]].notna().any(axis=1)
    h["mobility"] = mob.max(axis=1).where(answered)
    h["tube"] = np.where(h.q8_tube.eq("I do not currently have a feeding tube"), 0,
                         np.where(h.q8_tube.isin(["Percutaneous Endoscopic Gastrostomy (PEG)", "Mic-Key",
                                                  "Gastrojejunal (GJ)",
                                                  "Radioscopically Inserted Percutaneous Gastrostomy (RIG)"]), 1, np.nan))
    out = {"n_reports": int(len(h)), "n_people": int(h.Subject_ID.nunique()),
           "note": "First vs last report per person; no dates (only wave order), so no per-month rates."}
    for dom in ["speech", "resp", "mobility", "tube"]:
        d = h.dropna(subset=[dom])
        g = d.groupby("Subject_ID")[dom].agg(["first", "last", "size"])
        g = g[g["size"] >= 2]
        k = len(g)
        out[dom] = {"people_2plus_reports": k,
                    "worse": pct((g["last"] > g["first"]).sum(), k),
                    "same": pct((g["last"] == g["first"]).sum(), k),
                    "better": pct((g["last"] < g["first"]).sum(), k)}
        # Any reversal anywhere in the sequence (a step back toward normal) = self-report noise.
        rev = d.groupby("Subject_ID")[dom].apply(lambda s: bool((np.diff(s.to_numpy()) < 0).any()) if len(s) >= 2 else np.nan).dropna()
        out[dom]["any_step_back_toward_normal"] = pct(rev.sum(), len(rev))
    latest = h.groupby("Subject_ID").last()
    return out, latest


# ----------------------------------------------------------------------------- C. ALS Focus telehealth
def focus_telehealth(latest_health):
    t = pd.read_csv(FOCUS / "ALSFocusWave4_Telehealth.csv", dtype=str, encoding_errors="replace")
    t = t[(t.Group == "Person with ALS") & ~t.Subject_ID.isin(FOCUS_WRONG_SURVEY_IDS)].copy()
    n = len(t)
    out = {"n_pals": n}
    ap = t.t1_appt.dropna()
    ap = ap[ap != "Prefer not to answer"]
    had = ap.str.startswith("Yes")
    out["had_ALS_telehealth_visit_in_pandemic"] = pct(had.sum(), len(ap))
    out["video_any"] = pct(ap.str.contains("videoconference").sum(), len(ap))
    no = t[t.t1_appt.str.startswith("No", na=False)]
    out["reasons_no_telehealth"] = {"n": len(no), **{c.replace("t2_", ""): int(no[c].notna().sum()) for c in
                                    ["t2_not_offered", "t2_in_person", "t2_communicate", "t2_equipment",
                                     "t2_knowledge", "t2_quality", "t2_cost", "t2_comfort", "t2_privacy",
                                     "t2_reason_other"]}}
    yes = t[t.t1_appt.str.startswith("Yes", na=False)]
    tests = ["oximetry", "alsfrs", "spirometry", "single_breath", "vocalizing", "neuro", "cognitive",
             "muscle_bulk", "muscle_manual", "grip", "record_voice", "test_other", "test_none", "test_dk"]
    out["tests_done_remotely_among_telehealth_users"] = {"n": len(yes), **{x: int(yes["t9_" + x].notna().sum()) for x in tests}}
    out["tests_given_by_caregiver_during_telehealth"] = {"n": len(yes), **{x: int(yes["t10_" + x].notna().sum()) for x in tests}}
    for c, lab in [("t12_time", "time_saved"), ("t11_money", "money_saved"), ("t15_concerns", "explain_concerns"),
                   ("t16_guidance", "understand_guidance"), ("t17_confidence", "confident_in_quality"),
                   ("t18_qualitylife", "improves_quality_of_life"), ("t29_connect", "internet_quality")]:
        v = yes[c].dropna()
        v = v[v != "Prefer not to answer"]
        out[lab] = {"n": int(len(v)), **{k: int(x) for k, x in v.value_counts().items()}}
    w = t.t19_willing.dropna()
    w = w[w != "Prefer not to answer"]
    out["willing_to_use_telehealth_after_pandemic"] = pct(w.isin(["Willing", "Very willing"]).sum(), len(w))
    un = t[t.t19_willing.isin(["Unwilling", "Very unwilling"])]
    out["reasons_unwilling"] = {"n": len(un), **{c.replace("t21_", ""): int(un[c].notna().sum()) for c in
                                ["t21_quality", "t21_communicate", "t21_comfort", "t21_equipment",
                                 "t21_knowledge", "t21_privacy", "t21_unwilling_other"]}}
    out["home_internet"] = {"n": n, **{c.replace("t28_internet_", ""): int(t[c].notna().sum()) for c in
                            ["t28_internet_wire", "t28_internet_broad", "t28_internet_cell",
                             "t28_internet_dial", "t28_internet_dk"]}}
    tr = t[t.t24_trial.eq("Yes")]
    out["trials_in_pandemic"] = {"took_part": pct(len(tr), int(t.t24_trial.isin(["Yes", "No"]).sum())),
                                 "could_NOT_access_without_telehealth": int(tr.t27_trial_access.str.startswith("No", na=False).sum()),
                                 "answered_access_q": int(tr.t27_trial_access.isin(
                                     [x for x in tr.t27_trial_access.dropna().unique() if x != "Prefer not to answer"]).sum())}
    # Willingness by latest self-reported speech (bulbar burden), linked inside ALS Focus only.
    j = t.set_index("Subject_ID").join(latest_health[["speech"]], how="left")
    j = j[j.t19_willing.isin(["Willing", "Very willing", "Unwilling", "Very unwilling"])]
    grp = pd.cut(j.speech, [-0.5, 0.5, 2.5, 4.5], labels=["normal", "impaired_but_speaks", "prefers_device_or_lost"])
    out["willing_by_latest_speech"] = {str(g): pct(s.isin(["Willing", "Very willing"]).sum(), len(s))
                                       for g, s in j.groupby(grp, observed=True).t19_willing}
    out["willing_by_latest_speech"]["no_health_status_report"] = pct(
        j.loc[j.speech.isna(), "t19_willing"].isin(["Willing", "Very willing"]).sum(), int(j.speech.isna().sum()))
    return out


# ----------------------------------------------------------------------------- D. Seattle ALSSS per domain
def seattle_alsss():
    al = pd.read_csv(LONG / "ALS_time.csv")
    st = pd.read_csv(LONG / "STU_time.csv")
    al = al[al.person == "P"].merge(st, on=["id", "time"], how="left")
    al = al[al.time.between(1, 7) & (al.STUvisD >= 0)]
    out = {"note": "ALS Severity Scale (Hillel 1989), clinician-rated 1-10 per domain (10 = normal); visits ~3 months apart, 1987-89."}
    for dom, col, lo in [("speech", "ALSspch", 0), ("swallowing", "ALSswall", 1),
                         ("upper_limb", "ALSupper", 1), ("lower_limb", "ALSlower", 1)]:
        d = al[al[col].between(lo, 10)][["id", "STUvisD", col]].sort_values(["id", "STUvisD"])
        series = {}
        for pid, s in d.groupby("id"):
            if s.STUvisD.nunique() >= 2:
                series[pid] = (s.STUvisD.to_numpy(float) / DPM, s[col].to_numpy(float))
        slopes, sem, dof = trend_noise(series)
        v1 = d.groupby("id").first()[col]
        out[dom] = {
            "people": int(d.id.nunique()), "people_2plus_visits": len(series),
            "visit1_score": summ(v1, 1),
            "visit1_at_ceiling_10": pct((v1 == 10).sum(), len(v1)),
            "slope_points_per_month": summ(list(slopes.values()), 3),
            "people_with_zero_slope": pct(sum(abs(b) < 1e-9 for b in slopes.values()), len(slopes)),
            "steps": steps_summary(series),
            "noise_floor": {"pooled_residual_sd_sem_proxy": round(sem, 2) if sem else None, "dof": dof,
                            "mdc95_single_pair": round(Z95_PAIR * sem, 1) if sem else None},
        }
    return out


# ----------------------------------------------------------------------------- E. Seattle before diagnosis
DOCTOR = {1: "Neurologist/ALS specialist", 2: "Family practitioner", 3: "Internist", 4: "Physiatrist",
          5: "Pulmonologist", 6: "Otolaryngologist", 7: "Neurosurgeon", 8: "Urologist", 9: "OB/GYN",
          10: "Cardiologist", 11: "Gastroenterologist", 12: "Osteopath", 13: "RN"}
SYMPTOM = {1: "Swallowing", 2: "Speech/voice", 3: "Hands", 4: "Feet/legs", 5: "Balance", 6: "Arm",
           7: "Generalized weakness/atrophy", 8: "Weight loss", 9: "Fasciculations/twitching", 10: "Shoulder",
           11: "Cramps/soreness/numbness", 12: "Shortness of breath", 13: "Back trouble",
           14: "Difficulty with saliva", 15: "Stress incontinence/frequent urination"}
REGIONS = {"bulbar": ["DHXspchD", "DHXswllD", "DHXsalD"], "respiratory": ["DHXbrthD"],
           "upper_limb": ["DHXsxlaD", "DHXsxlhD", "DHXsxraD", "DHXsxrhD"],
           "lower_limb": ["DHXsxlfD", "DHXsxllD", "DHXsxrfD", "DHXsxrlD"]}
# Body/Surgery codes at sites where ALS weakness is often blamed on something else.
MSK_SURGERY = {9: "Neck/spine (incl. Cloward)", 24: "Back", 15: "Hand", 13: "Arm", 11: "Shoulder",
               31: "Legs/knee", 33: "Feet"}
# Surgeries caused by ALS care itself (excluded from the "other site" control).
ALS_CARE_SURGERY = {48, 51}  # feeding tube, tracheostomy
# Illness/Accident codes for falls, fractures and injuries.
FALLS_INJURY = {1, 2, 3, 4, 5, 6, 7, 17, 35}


def sea_valid(s):
    s = pd.to_numeric(s, errors="coerce").astype(float)
    return s.where(s > SEA_MISSING_MAX)


def window_rates(ages_codes, onset_age, dx_age, code_set):
    """Events recorded as (integer age, code). Count those at an integer age between
    floor(onset age) and floor(diagnosis age) ('possibly in the symptom-to-diagnosis
    window'; 1-year resolution) vs. adult background (age 20 to the year before onset)."""
    w_ev = b_ev = 0
    w_py = b_py = 0.0
    people_w = 0
    for pid in onset_age.index:
        oa, da = onset_age[pid], dx_age[pid]
        if np.isnan(oa) or np.isnan(da) or da < oa:
            continue
        lo, hi = int(np.floor(oa)), int(np.floor(da))
        w_py += hi - lo + 1
        b_py += max(0, lo - 20)
        hit = 0
        for age, code in ages_codes.get(pid, []):
            if code not in code_set:
                continue
            if lo <= age <= hi:
                w_ev += 1
                hit = 1
            elif 20 <= age < lo:
                b_ev += 1
        people_w += hit
    rr = ((w_ev / w_py) / (b_ev / b_py)) if (w_ev and b_ev) else None
    ci = None
    if rr:
        se = np.sqrt(1 / w_ev + 1 / b_ev)
        ci = [round(float(np.exp(np.log(rr) - 1.96 * se)), 1), round(float(np.exp(np.log(rr) + 1.96 * se)), 1)]
    return {"events_in_window": w_ev, "people_with_event_in_window": people_w,
            "window_person_years": round(w_py, 0), "background_events": b_ev,
            "background_person_years": round(b_py, 0),
            "rate_ratio_window_vs_background": round(rr, 1) if rr else None, "rr_95ci": ci}


def seattle_prediagnosis():
    dh = pd.read_csv(WIDE / "DHX_person.csv").set_index("id")
    out = {"n_patients": int(len(dh))}
    dx = sea_valid(dh.DHXdx1D)
    sx1 = sea_valid(dh.DHXsx1D)
    # First and second ALS symptom (patient-named), all categories.
    out["first_symptom"] = {SYMPTOM.get(int(k), str(k)): int(v) for k, v in
                            dh.DHXsx1[dh.DHXsx1 > 0].value_counts().items()}
    out["second_symptom"] = {SYMPTOM.get(int(k), str(k)): int(v) for k, v in
                             dh.DHXsx2[dh.DHXsx2 > 0].value_counts().items()}
    # Who made the first diagnosis; second opinions; first -> second diagnosis interval.
    doc = dh.DHXdx1MDW[dh.DHXdx1MDW > 0]
    out["first_diagnosis_made_by"] = {DOCTOR.get(int(k), str(k)): int(v) for k, v in doc.value_counts().items()}
    op = dh.DHX2opin[dh.DHX2opin > 0]
    out["second_opinion_obtained"] = pct((op == 1).sum(), len(op))
    dx2 = sea_valid(dh.DHXdx2D)
    gap = ((dx2 - dx) / DPM).dropna()
    out["first_to_second_diagnosis_months"] = summ(gap[gap >= 0], 1)
    out["second_diagnosis_dated_before_first"] = int((gap < 0).sum())
    # When did they first hear of ALS?
    hear = sea_valid(dh.DHX_hearD)
    k = hear.notna() & sx1.notna() & dx.notna()
    out["first_heard_of_ALS"] = {"n": int(k.sum()),
                                 "before_first_symptom": int((hear[k] < sx1[k]).sum()),
                                 "between_symptom_and_diagnosis": int(((hear[k] >= sx1[k]) & (hear[k] < dx[k])).sum()),
                                 "at_or_after_diagnosis": int((hear[k] >= dx[k]).sum())}
    # Body regions: earliest recorded symptom date per region; which were affected before diagnosis.
    R = pd.DataFrame({r: pd.concat([sea_valid(dh[c]) for c in cs], axis=1).min(axis=1) for r, cs in REGIONS.items()})
    ok = dx.notna() & R.notna().any(axis=1)
    Rk, dxk = R[ok], dx[ok]
    at_dx = Rk.le(dxk, axis=0).sum(axis=1)
    six_before = Rk.le(dxk - 6 * DPM, axis=0).sum(axis=1)
    first_region = Rk.idxmin(axis=1)
    srt = np.sort(Rk.to_numpy(), axis=1)               # NaN sorts last
    spread = (srt[:, 1] - srt[:, 0]) / DPM              # months from first to second region
    second_before_dx = srt[:, 1] <= dxk.to_numpy()
    out["regions"] = {
        "definition": "bulbar = speech/swallow/saliva; respiratory = breathing; upper/lower limb = L/R arm+hand / leg+foot. "
                      "A missing region date is treated as not affected, so counts are lower bounds.",
        "n": int(ok.sum()),
        "first_region_by_dates": {k: int(v) for k, v in first_region.value_counts().items()},
        "regions_affected_by_diagnosis": {str(k): int(v) for k, v in at_dx.value_counts().sort_index().items()},
        "two_plus_regions_by_diagnosis": pct((at_dx >= 2).sum(), len(at_dx)),
        "two_plus_regions_6_months_before_diagnosis": pct((six_before >= 2).sum(), len(six_before)),
        "months_first_to_second_region": summ(spread[~np.isnan(spread)], 1),
        "second_region_began_before_diagnosis": pct(int(second_before_dx[~np.isnan(spread)].sum()),
                                                    int((~np.isnan(spread)).sum())),
        "months_second_region_to_diagnosis": summ(((dxk.to_numpy() - srt[:, 1]) / DPM)[~np.isnan(spread) & second_before_dx], 1),
        "affected_before_diagnosis_by_region": {r: pct(int((Rk[r] <= dxk).sum()), len(Rk)) for r in REGIONS},
    }
    wt = sea_valid(dh.DHXwtlD)
    out["weight_loss"] = {"weight_loss_date_recorded": pct(int(wt.notna().sum()), len(wt)),
                          "weight_loss_before_diagnosis": pct(int((wt <= dx).sum()), int((wt.notna() & dx.notna()).sum())),
                          "months_before_diagnosis_when_before": summ(((dx - wt) / DPM)[wt <= dx], 1)}

    # Surgeries and injuries reported at Visit 1, by age, vs. the symptom-to-diagnosis window.
    mh = pd.read_csv(WIDE / "MHX_person.csv")
    mh = mh[mh.person == "P"].set_index("id")
    de = pd.read_csv(WIDE / "DEM_person.csv")
    de = de[de.person == "P"].set_index("id")
    age1 = sea_valid(de.DEMage).reindex(dh.index)
    onset_age = age1 + sx1 / 365.25
    dx_age = age1 + dx / 365.25
    sur, mia = {}, {}
    for pid, r in mh.iterrows():
        sur[pid] = [(int(r[f"MHXsur{i}age"]), int(r[f"MHXsur{i}"])) for i in range(1, 6)
                    if r[f"MHXsur{i}"] > 0 and r[f"MHXsur{i}age"] > 0]
        mia[pid] = [(int(r[f"MHXmia{i}age"]), int(r[f"MHXmia{i}"])) for i in range(1, 8)
                    if r[f"MHXmia{i}"] > 0 and r[f"MHXmia{i}age"] > 0]
    all_sur_codes = {c for v in sur.values() for _, c in v}
    all_mia_codes = {c for v in mia.values() for _, c in v}
    oa, da = onset_age.reindex(mh.index), dx_age.reindex(mh.index)
    msk_in_window = {}
    for pid in mh.index:
        if np.isnan(oa[pid]) or np.isnan(da[pid]):
            continue
        for age, code in sur[pid]:
            if code in MSK_SURGERY and int(np.floor(oa[pid])) <= age <= int(np.floor(da[pid])):
                msk_in_window[MSK_SURGERY[code]] = msk_in_window.get(MSK_SURGERY[code], 0) + 1
    out["surgery_and_injury_vs_window"] = {
        "definition": "Integer age at event between floor(age at first symptom) and floor(age at diagnosis) = "
                      "'possibly in the window' (1-year resolution); background = age 20 to the year before onset. "
                      "Recall favours recent events; compare the 'other' rows as a recall-bias control.",
        "n_patients_with_history": int(len(mh)),
        "msk_site_surgery": window_rates(sur, oa, da, set(MSK_SURGERY)),
        "other_site_surgery": window_rates(sur, oa, da, all_sur_codes - set(MSK_SURGERY) - ALS_CARE_SURGERY),
        "msk_surgeries_in_window_by_site": msk_in_window,
        "falls_fractures_injuries": window_rates(mia, oa, da, FALLS_INJURY),
        "other_major_illness": window_rates(mia, oa, da, all_mia_codes - FALLS_INJURY),
    }
    return out


def main():
    res = {"_about": "Group-level summaries only. ALS Focus Wave 4 (doi:10.7910/DVN/RMBES9, ALS Association; "
                     "no redistribution) and Seattle ALS Patient Profile Database v3 (doi:10.17632/stcztggnnp; "
                     "CC BY-NC 3.0; McDonald et al. 1994). Script: analysis/focus_seattle/focus_seattle.py"}
    res["A_focus_alsfrsr_vc"] = focus_part_a()
    res["B_focus_health_status"], latest = focus_health()
    res["C_focus_telehealth"] = focus_telehealth(latest)
    res["D_seattle_alsss_domains"] = seattle_alsss()
    res["E_seattle_before_diagnosis"] = seattle_prediagnosis()
    OUT.write_text(json.dumps(res, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o)),
                   encoding="utf-8")
    print(json.dumps(res, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)))


if __name__ == "__main__":
    main()
