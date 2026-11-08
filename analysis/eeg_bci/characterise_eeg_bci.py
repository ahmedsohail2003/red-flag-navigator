"""Quick characterisation of the two EEG / brain-computer-interface datasets.

  05 bigP3BCI (PhysioNet, CC BY 4.0): P300 speller EEG, 20 studies. The zip is NOT
     extracted. This script opens it read-only with Python's zipfile and reads only the
     first 256 bytes (the EDF header) of each .edf member, in memory. Nothing is written
     next to the data and no member is extracted to disk.
  06 EEGET-ALS (Figshare, CC0): EEG + eye tracking while eye-typing, 6 ALS + 170 controls.
     Reads info.json, recording_time.json, eeg.json and the TimeStamp column of one
     ET.csv per visit.

Run from the project folder:
    python -I analysis\\eeg_bci\\characterise_eeg_bci.py

Writes only analysis/eeg_bci/results.json. Saves group-level numbers only.
"""
import site
import sys

# `python -I` leaves out the user site-packages (where numpy/pandas live on this PC).
_USER_SITE = site.getusersitepackages()
if _USER_SITE not in sys.path:
    sys.path.append(_USER_SITE)

import collections
import glob
import json
import os
import re
import statistics
import zipfile

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
BIGP3_ZIP = os.path.join(ROOT, "Datasets", "05_bigP3BCI_PhysioNet", "data_zip", "bigp3bci-1.0.0.zip")
EEGET_DIR = os.path.join(ROOT, "Datasets", "06_EEGET-ALS_Figshare", "data", "EEGET-ALS Dataset")
OUT = os.path.join(HERE, "results.json")


def describe(values):
    v = sorted(values)
    if not v:
        return {"n": 0}
    a = np.array(v, dtype=float)
    return {
        "n": len(v),
        "median": float(np.median(a)),
        "q1": float(np.percentile(a, 25)),
        "q3": float(np.percentile(a, 75)),
        "min": float(a.min()),
        "max": float(a.max()),
    }


# --------------------------------------------------------------------------- bigP3BCI
def parse_edf_header(raw):
    """EDF+ header: bytes 8-88 patient id, 88-168 recording id, 252-256 number of signals.
    bigP3BCI puts '<code> <sex> <birthdate> <Race>_<Ethnicity>_<ALS status>' in the patient
    field (PhysioNet page, Table 2). ALS status is NonALS, ALS_<ALSFRS-R 0..48> or ALS_X."""
    patient = raw[8:88].decode("ascii", "replace").strip()
    recording = raw[88:168].decode("ascii", "replace").strip()
    # Real layout (checked on files from all 20 studies):
    #   '<code> <sex> <birthdate> <Race>_<Ethnicity> <ALS status>', e.g. 'F_03 F 01-JAN-1976 X_X ALS_21'.
    # Study B writes plain 'ALS' (no score); a birth year of 2020 means age not available.
    parts = patient.split()
    code = parts[0] if parts else ""
    sex = parts[1] if len(parts) > 1 else "X"
    birth = parts[2] if len(parts) > 2 else "X"
    status_token = parts[-1] if parts else ""
    status, frs = "unknown", None
    m = re.fullmatch(r"NonALS|ALS(?:_(\d+|X))?", status_token)
    if m:
        if status_token == "NonALS":
            status = "NonALS"
        else:
            status = "ALS"
            frs = int(m.group(1)) if m.group(1) and m.group(1) != "X" else None
    by = re.search(r"(\d{4})$", birth)
    # Birth year is date-shifted against an assumed recording date of 01-JAN-2020.
    age = 2020 - int(by.group(1)) if by else None
    if age is not None and age < 18:
        age = None  # placeholder year (all participants are adults per PhysioNet)
    return {
        "code": code, "sex": sex, "age": age, "status": status, "alsfrs_r": frs,
        "patient_field": patient,
    }


def bigp3bci():
    z = zipfile.ZipFile(BIGP3_ZIP)
    members = [i for i in z.infolist() if i.filename.endswith(".edf")]
    rows = []
    for info in members:
        with z.open(info) as fh:
            raw = fh.read(256)
        h = parse_edf_header(raw)
        p = info.filename.split("/")
        # .../bigP3BCI-data/StudyB/B_01/SE001/...
        k = p.index("bigP3BCI-data")
        h.update(study=p[k + 1], subject=p[k + 2], session_dir=p[k + 3])
        rows.append(h)
    df = pd.DataFrame(rows)

    out = {"edf_files_read": int(len(df)), "per_study": {}}
    # One status per subject: a subject is ALS if any of its files says ALS.
    for study, g in df.groupby("study"):
        subj = g.groupby("subject")
        st = subj["status"].agg(lambda s: "ALS" if (s == "ALS").any() else ("NonALS" if (s == "NonALS").any() else "unknown"))
        out["per_study"][study] = {
            "subjects": int(subj.ngroups),
            "subject_sessions": int(g.groupby(["subject", "session_dir"]).ngroups),
            "als_subjects": int((st == "ALS").sum()),
            "nonals_subjects": int((st == "NonALS").sum()),
            "unknown_status_subjects": int((st == "unknown").sum()),
        }

    als = df[df["status"] == "ALS"]
    out["als_studies"] = sorted(als["study"].unique().tolist())
    out["als_subjects_total"] = int(als.groupby(["study", "subject"]).ngroups)

    # Per ALS subject: scores seen across all their files / sessions.
    per_subj = []
    for (study, subject), g in als.groupby(["study", "subject"]):
        scores_by_session = (
            g.dropna(subset=["alsfrs_r"]).groupby("session_dir")["alsfrs_r"]
            .agg(lambda s: sorted(set(int(x) for x in s)))
        )
        all_scores = sorted(set(int(x) for x in g["alsfrs_r"].dropna()))
        per_subj.append({
            "study": study,
            "sessions": int(g["session_dir"].nunique()),
            "scores": all_scores,
            "first_score": scores_by_session.iloc[0][0] if len(scores_by_session) else None,
            "last_score": scores_by_session.iloc[-1][0] if len(scores_by_session) else None,
            "sessions_with_score": int(len(scores_by_session)),
            "age": g["age"].dropna().iloc[0] if g["age"].notna().any() else None,
            "sex": g["sex"].iloc[0],
            "conflict_within_session": bool(any(len(v) > 1 for v in scores_by_session)),
        })
    ps = pd.DataFrame(per_subj)
    scored = ps[ps["first_score"].notna()]
    out["als_subjects_with_alsfrs_r"] = int(len(scored))
    out["als_subjects_alsfrs_r_missing"] = int(ps["first_score"].isna().sum())
    out["alsfrs_r_first_recorded"] = describe(scored["first_score"].astype(int).tolist())
    out["alsfrs_r_first_recorded_by_study"] = {
        s: describe(g["first_score"].astype(int).tolist()) for s, g in scored.groupby("study")
    }
    bins = [(0, 11), (12, 23), (24, 35), (36, 48)]
    out["alsfrs_r_first_recorded_bins"] = {
        f"{lo}-{hi}": int(((scored["first_score"] >= lo) & (scored["first_score"] <= hi)).sum()) for lo, hi in bins
    }
    multi = scored[scored["sessions_with_score"] >= 2]
    changed = multi[multi["scores"].apply(len) > 1]
    out["longitudinal"] = {
        "als_subjects_with_score_in_2plus_sessions": int(len(multi)),
        "of_which_score_changes_between_sessions": int(len(changed)),
        "score_change_last_minus_first": describe((changed["last_score"] - changed["first_score"]).astype(int).tolist()),
        "subjects_with_conflicting_scores_inside_one_session": int(ps["conflict_within_session"].sum()),
    }
    out["als_age_years"] = describe([a for a in ps["age"].dropna().astype(int).tolist()])
    out["als_sex_counts"] = {k: int(v) for k, v in ps["sex"].value_counts().items()}
    nonals_subj = df[df["status"] == "NonALS"].groupby(["study", "subject"]).first()
    out["nonals_subjects_total"] = int(len(nonals_subj))
    out["nonals_age_years"] = describe(nonals_subj["age"].dropna().astype(int).tolist())
    out["note"] = ("Status and ALSFRS-R read from the EDF+ patient field (PhysioNet Table 2: "
                   "ALSFRS-R taken from medical records, if available). Age = 2020 minus the "
                   "date-shifted birth year, so it is approximate.")
    return out


# --------------------------------------------------------------------------- EEGET-ALS
def eeget():
    out = {}
    people = sorted(d for d in os.listdir(EEGET_DIR) if os.path.isdir(os.path.join(EEGET_DIR, d)))
    als = [p for p in people if p.startswith("ALS")]
    ctl = [p for p in people if p.startswith("id")]
    info = {}
    for p in people:
        f = os.path.join(EEGET_DIR, p, "time1", "info.json")
        with open(f, encoding="utf-8") as fh:
            info[p] = json.load(fh)
    out["participants"] = {
        "als_n": len(als), "control_n": len(ctl),
        "als_age_years": describe([info[p]["age"] for p in als]),
        "control_age_years": describe([info[p]["age"] for p in ctl]),
        "als_sex_counts": dict(collections.Counter(info[p]["gender"] for p in als)),
        "control_sex_counts": dict(collections.Counter(info[p]["gender"] for p in ctl)),
        "control_age_bands": {
            "under_19": sum(info[p]["age"] < 19 for p in ctl),
            "19_to_25": sum(19 <= info[p]["age"] <= 25 for p in ctl),
            "26_to_49": sum(26 <= info[p]["age"] <= 49 for p in ctl),
            "50_to_70": sum(50 <= info[p]["age"] <= 70 for p in ctl),
            "over_70": sum(info[p]["age"] > 70 for p in ctl),
        },
    }
    # Visits per ALS patient and follow-up span (recording_time.json gives the week of each visit).
    visits, spans, nonmonotonic = [], [], 0
    for p in als:
        with open(os.path.join(EEGET_DIR, p, "recording_time.json"), encoding="utf-8") as fh:
            rt = json.load(fh)
        weeks = [rt[k] for k in sorted(rt, key=lambda s: int(s[4:]))]
        visits.append(len(weeks))
        if len(weeks) > 1:
            spans.append(max(weeks) - min(weeks))
        if any(b < a for a, b in zip(weeks, weeks[1:])):
            nonmonotonic += 1
    out["als_visits"] = {
        "visits_per_patient": sorted(visits),
        "followup_span_weeks_patients_with_repeat_visits": describe(spans),
        "patients_whose_visit_week_order_is_not_increasing": nonmonotonic,
    }
    # Recording format (all eeg.json) and observed eye-tracker sampling rate.
    fmt = collections.Counter()
    for f in glob.glob(os.path.join(EEGET_DIR, "*", "time*", "scenario*", "eeg.json")):
        with open(f, encoding="utf-8") as fh:
            d = json.load(fh)
        fmt[f"{d.get('SamplingFrequence')} Hz x {d.get('EEGchannelNumber')} ch"] += 1
    out["eeg_format_counts"] = dict(fmt)
    rates = {"ALS": [], "control": []}
    for f in glob.glob(os.path.join(EEGET_DIR, "*", "time*", "scenario1", "ET.csv")):
        grp = "ALS" if os.path.basename(os.path.dirname(os.path.dirname(os.path.dirname(f)))).startswith("ALS") else "control"
        ts = pd.read_csv(f, usecols=[0]).iloc[:, 0].to_numpy(dtype=float)
        if len(ts) > 100 and ts[-1] > ts[0]:
            rates[grp].append((len(ts) - 1) / (ts[-1] - ts[0]))
    out["eye_tracker_rows_per_second_scenario1"] = {k: describe(v) for k, v in rates.items()}
    out["eye_tracker_rate_note"] = ("Paper says Tobii Eye Tracker 5 at 30 Hz; compare with the measured rows per "
                                    "second above before computing any gaze-speed feature.")
    # Numbers reported in the paper (Sci Data 2024;11:664), typed in from the PDF.
    out["from_paper"] = {
        "alsfrs_r_total": {"score_0": 4, "score_1": 2,
                            "note": "Methods: 4 patients ALSFRS-R 0 and 2 patients ALSFRS-R 1, all locked-in. "
                                    "The abstract also says severity ranged 'from partial mobility and weakened "
                                    "speech'; the two statements do not fully agree."},
        "eeg_device": "Emotiv EPOC Flex, 32 saline electrodes, 128 Hz",
        "eye_tracker": "Tobii Eye Tracker 5, 30 Hz",
        "control_age_range_years": [19, 70],
        "mi_classification_trained_on_170_controls": {
            "chance_3_class": 0.333, "chance_4_class": 0.25,
            "test_on_5_held_out_controls_BAC_3class_range": [0.6926, 0.7065],
            "test_on_5_held_out_controls_BAC_4class_range": [0.5518, 0.6043],
            "test_on_ALS_EEG_ITNet_BAC_3class": {"ALS01": 0.6466, "ALS02": 0.5239, "ALS04": 0.5999, "ALS_mean": 0.59},
            "test_on_ALS_EEG_ITNet_BAC_4class": {"ALS01": 0.4896, "ALS02": 0.3652, "ALS04": 0.3936, "ALS_mean": 0.4204},
        },
        "person_identification_accuracy_best": 0.9451,
        "attention_detection_accuracy_approx": 0.80,
        "group_difference_in_EEG_or_eye_metrics_reported": False,
    }
    return out


def main():
    results = {
        "bigP3BCI": bigp3bci(),
        "EEGET_ALS": eeget(),
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, default=lambda o: o.item() if hasattr(o, "item") else str(o))
    print(json.dumps(results, indent=1, default=lambda o: o.item() if hasattr(o, "item") else str(o)))


if __name__ == "__main__":
    main()
