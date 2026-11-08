"""Analysis B: how long does an ALS diagnosis take in real data?

Months from first symptom to diagnosis, overall and by site of onset, from two
local datasets (read-only). Only group summaries are written; no row-level data.
ALS Focus data must not leave this machine: this script only reads it locally.

  1. ALS Focus Wave 4 (Harvard Dataverse), ALSFocusWave4_Demographics.csv
     - p4_onset_date  "Date of first symptom - Derived" (M/D/YYYY; built from
                      p4_onset_month/p4_onset_year, day is always 1)
     - p5_diag_date   "Date of diagnosis - Derived" (same format)
     - p3_onset_location "Location of first symptom onset": Bulbar (tongue and
                      face) / Upper limb (arm) / Lower limb (leg) / Multiple site
                      onset / I don't know / Prefer not to answer
     Opt-in US online survey; Demographics survey open 2020-02-13 to 2021-10-11.
  2. Seattle ALS Patient Profile Database v3, Wide (person-level) data/DHX_person.csv
     - DHXsx1D  "First ALS symptom", days relative to Visit 1
     - DHXdx1D  "First ALS diagnosis", days relative to Visit 1
     - DHXsx1   "First ALS symptom" category (Codebook "ALS SYMPTOM CODES")
     Clinic and support-group cohort enrolled 1987-88 (prevalent cases).

Run from the working folder:
    python -I analysis\\diagnostic_delay.py
Writes only the "delay" key of analysis/results.json (other keys are kept).
"""
import site
import sys

# `python -I` leaves out the user site-packages, where numpy/pandas/scipy live on
# this machine; add back that one directory only.
_USER_SITE = site.getusersitepackages()
if _USER_SITE not in sys.path:
    sys.path.append(_USER_SITE)

import json
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import mannwhitneyu

ROOT = Path(__file__).resolve().parent.parent
FOCUS = ROOT / "Datasets" / "01_ALS_Focus_Harvard_Dataverse" / "data" / "ALSFocusWave4_Demographics.csv"
SEATTLE = (ROOT / "Datasets" / "07_Seattle_ALS_Patient_Profile_Mendeley" / "v3_latest_2026-03"
           / "Wide (person-level) data" / "DHX_person.csv")
RESULTS = ROOT / "analysis" / "results.json"

DAYS_PER_MONTH = 365.25 / 12
# ALS Focus file description: these 4 IDs completed the wrong survey set.
FOCUS_WRONG_SURVEY_IDS = {"279", "322", "1409", "2050"}
# Seattle missing-data codes (Data Dictionary, "Missing data codes").
SEATTLE_MISSING = [-99999, -88888, -77777, -66666, -55555, -44444, -33333, -22222]
# Seattle Codebook "ALS SYMPTOM CODES" grouped by site.
SEATTLE_BULBAR = {1: "Swallowing", 2: "Speech/voice", 14: "Difficulty with saliva"}
SEATTLE_LIMB = {3: "Hands", 4: "Feet/legs", 6: "Arm", 10: "Shoulder"}
# every other code (balance, generalized weakness, weight loss, fasciculations,
# cramps, shortness of breath, back trouble, incontinence) -> "other / not site-specific"


def summ(months):
    m = np.asarray(months, float)
    if len(m) == 0:
        return {"n": 0}
    q1, med, q3 = np.percentile(m, [25, 50, 75])
    return {"n": int(len(m)), "median_months": round(float(med), 1),
            "iqr_months": [round(float(q1), 1), round(float(q3), 1)],
            "pct_over_12_months": round(100 * float(np.mean(m > 12)), 1)}


def mw_p(a, b):
    return float(f"{mannwhitneyu(a, b, alternative='two-sided').pvalue:.3g}")


def als_focus():
    d = pd.read_csv(FOCUS, dtype=str, keep_default_na=False)
    pals = d[d["Group"] == "Person with ALS"]
    n_pals = len(pals)
    pals = pals[~pals["Subject_ID"].isin(FOCUS_WRONG_SURVEY_IDS)]
    onset = pd.to_datetime(pals["p4_onset_date"], format="%m/%d/%Y", errors="coerce")
    diag = pd.to_datetime(pals["p5_diag_date"], format="%m/%d/%Y", errors="coerce")
    months = (diag.dt.year - onset.dt.year) * 12 + (diag.dt.month - onset.dt.month)
    both = months.notna()
    neg = both & (months < 0)
    ok = both & ~neg
    m = months[ok].astype(float)
    loc = pals.loc[ok, "p3_onset_location"]
    sites = {"bulbar": loc == "Bulbar (tongue and face)",
             "upper_limb": loc == "Upper limb (arm)",
             "lower_limb": loc == "Lower limb (leg)",
             "multiple_sites": loc == "Multiple site onset"}
    sites["limb_upper_or_lower"] = sites["upper_limb"] | sites["lower_limb"]
    unknown = ~(sites["bulbar"] | sites["limb_upper_or_lower"] | sites["multiple_sites"])
    return {
        "source": "ALS Focus Wave 4, ALSFocusWave4_Demographics.csv (opt-in US online "
                  "survey of people with ALS, 2020-02-13 to 2021-10-11)",
        "variables": {"onset": "p4_onset_date (derived from p4_onset_month, p4_onset_year)",
                      "diagnosis": "p5_diag_date (derived from p5_diag_month, p5_diag_year)",
                      "site": "p3_onset_location"},
        "interval_rule": "whole calendar months between the month of first symptom and "
                         "the month of diagnosis (dates are only known to the month)",
        "n_people_with_als": n_pals,
        "excluded_wrong_survey_ids": n_pals - len(pals),
        "n_missing_a_date": int((~both).sum()),
        "n_excluded_diagnosis_before_onset": int(neg.sum()),
        "n_zero_months": int((m == 0).sum()),
        "overall": summ(m),
        "by_onset_site": {k: summ(m[v]) for k, v in sites.items()},
        "n_site_unknown_or_declined": int(unknown.sum()),
        "bulbar_vs_limb_mannwhitney_p": mw_p(m[sites["bulbar"]], m[sites["limb_upper_or_lower"]]),
    }


def seattle():
    d = pd.read_csv(SEATTLE)
    n_all = len(d)
    sx = d["DHXsx1D"].where(~d["DHXsx1D"].isin(SEATTLE_MISSING))
    dx = d["DHXdx1D"].where(~d["DHXdx1D"].isin(SEATTLE_MISSING))
    days = dx - sx
    both = days.notna()
    neg = both & (days < 0)
    ok = both & ~neg
    m = days[ok] / DAYS_PER_MONTH
    code = d.loc[ok, "DHXsx1"]
    sites = {"bulbar": code.isin(list(SEATTLE_BULBAR)),
             "limb": code.isin(list(SEATTLE_LIMB))}
    sites["other_not_site_specific"] = ~(sites["bulbar"] | sites["limb"])
    return {
        "source": "Seattle ALS Patient Profile Database v3, DHX_person.csv (patients from 3 "
                  "hospital ALS clinics and support groups, enrolled 1987-88; prevalent cases)",
        "variables": {"onset": "DHXsx1D (First ALS symptom, days relative to Visit 1)",
                      "diagnosis": "DHXdx1D (First ALS diagnosis, days relative to Visit 1)",
                      "site": "DHXsx1 (First ALS symptom, Codebook ALS SYMPTOM CODES)"},
        "site_coding": {"bulbar": SEATTLE_BULBAR, "limb": SEATTLE_LIMB,
                        "other_not_site_specific": "all other codes"},
        "interval_rule": f"(DHXdx1D - DHXsx1D) days / {DAYS_PER_MONTH:.4f}",
        "n_patients": n_all,
        "n_missing_a_date": int((~both).sum()),
        "n_excluded_diagnosis_before_onset": int(neg.sum()),
        "overall": summ(m),
        "max_months": round(float(m.max()), 1),
        "by_onset_site": {k: summ(m[v]) for k, v in sites.items()},
        "bulbar_vs_limb_mannwhitney_p": mw_p(m[sites["bulbar"]], m[sites["limb"]]),
    }


def main():
    delay = {"als_focus": als_focus(), "seattle": seattle(),
             "note": "Both are people already diagnosed with ALS, recalling or recording "
                     "when symptoms began; dates of first symptom are self-reported."}
    results = json.loads(RESULTS.read_text()) if RESULTS.exists() else {}
    results["delay"] = delay
    RESULTS.write_text(json.dumps(results, indent=2))
    for k, v in delay.items():
        if isinstance(v, dict):
            print(f"== {k}")
            for kk, vv in v.items():
                if kk not in ("source", "variables", "site_coding", "interval_rule"):
                    print(f"  {kk}: {vv}")


if __name__ == "__main__":
    main()
