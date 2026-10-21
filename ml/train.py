"""Train the stroke-shape classifier and export it for the serverless API.

    pip install -r ml/requirements.txt
    python ml/train.py                       # synthetic data only
    python ml/train.py --extra strokes.json  # add real strokes exported from the app (verified ones)

Outputs: api/_model.json (weights, used by the API), ml/report.md, ml/confusion_matrix.png
"""
import argparse
import json
import os
import sys

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.neural_network import MLPClassifier

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "api"))
import _ml  # noqa: E402
import shapes  # noqa: E402

CLASSES = shapes.CLASSES


def featurize(strokes):
    return np.array([_ml.features(s) for s in strokes], float)


def load_extra(path, include_unverified, repeat):
    with open(path) as f:
        data = json.load(f)
    samples = data["samples"] if isinstance(data, dict) else data
    strokes, labels = [], []
    for s in samples:
        if s.get("label") in CLASSES and (include_unverified or s.get("verified")):
            try:
                _ml.features(_ml.validate_points(s["points"]))
            except ValueError:
                continue
            strokes += [s["points"]] * repeat
            labels += [CLASSES.index(s["label"])] * repeat
    print(f"added {len(strokes) // repeat} real strokes (x{repeat})")
    return strokes, np.array(labels)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-class", type=int, default=2000)
    ap.add_argument("--extra", help="strokes.json exported from the app")
    ap.add_argument("--include-unverified", action="store_true")
    ap.add_argument("--extra-repeat", type=int, default=15)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    print("generating data...")
    Xtr_s, ytr = shapes.make_dataset(args.per_class, seed=args.seed + 1)
    Xte_s, yte = shapes.make_dataset(400, seed=args.seed + 2)
    Xst_s, yst = shapes.make_dataset(400, seed=args.seed + 3, noise=2.2)   # stress: ~2x wobble
    if args.extra:
        es, ey = load_extra(args.extra, args.include_unverified, args.extra_repeat)
        Xtr_s, ytr = Xtr_s + es, np.r_[ytr, ey]

    print("extracting features...")
    Xtr, Xte, Xst = featurize(Xtr_s), featurize(Xte_s), featurize(Xst_s)
    mean, std = Xtr.mean(0), Xtr.std(0)
    std[std < 1e-6] = 1.0
    z = lambda X: (X - mean) / std

    print("training baseline (logistic regression)...")
    lr = LogisticRegression(max_iter=2000, C=1.0).fit(z(Xtr), ytr)
    print("training MLP...")
    mlp = MLPClassifier(hidden_layer_sizes=(64, 32), alpha=1e-3, max_iter=400, early_stopping=True,
                        n_iter_no_change=15, random_state=args.seed).fit(z(Xtr), ytr)

    res = {}
    for name, clf in (("Logistic regression (baseline)", lr), ("MLP 64-32 (shipped)", mlp)):
        res[name] = (accuracy_score(yte, clf.predict(z(Xte))), accuracy_score(yst, clf.predict(z(Xst))))
        print(f"{name}: test={res[name][0]:.3f} stress={res[name][1]:.3f}")

    # export + check the pure-python server inference matches scikit-learn
    model = {
        "classes": CLASSES, "mean": mean.round(6).tolist(), "std": std.round(6).tolist(),
        "layers": [{"W": W.round(5).tolist(), "b": b.round(5).tolist()} for W, b in zip(mlp.coefs_, mlp.intercepts_)],
        "meta": {"n_train": int(len(ytr)), "test_acc": round(res["MLP 64-32 (shipped)"][0], 4),
                 "stress_acc": round(res["MLP 64-32 (shipped)"][1], 4), "features": _ml.N_FEATURES},
    }
    out = os.path.join(HERE, "..", "api", "_model.json")
    with open(out, "w") as f:
        json.dump(model, f, separators=(",", ":"))
    os.makedirs(os.path.join(HERE, "..", "model"), exist_ok=True)   # copy the browser uses for on-device mode
    with open(os.path.join(HERE, "..", "model", "model.json"), "w") as f:
        json.dump(model, f, separators=(",", ":"))
    served = _ml.Model(model)
    worst = max(np.abs(np.array(served.predict_proba(list(Xte[i]))) - mlp.predict_proba(z(Xte[i:i + 1]))[0]).max() for i in range(0, len(Xte), 50))
    assert worst < 1e-3, f"serving mismatch {worst}"
    print(f"exported {out} ({os.path.getsize(out) / 1024:.0f} KB), max prob diff vs sklearn {worst:.1e}")

    # report
    pred_te, pred_st = mlp.predict(z(Xte)), mlp.predict(z(Xst))
    cm = confusion_matrix(yte, pred_te)
    lines = ["# Model report", "",
             f"Training strokes: {len(ytr)} ({args.per_class}/class synthetic" + (" + real" if args.extra else "") + ")",
             "Held-out test: 400 fresh synthetic strokes per class. Stress: 400 per class with ~2x hand wobble.", "",
             "| Model | Held-out test | Stress test |", "|---|---|---|"]
    lines += [f"| {k} | {v[0]:.1%} | {v[1]:.1%} |" for k, v in res.items()]
    lines += ["", "## Per-class (MLP, held-out test)", "```",
              classification_report(yte, pred_te, target_names=CLASSES, digits=3), "```", "",
              "## Per-class (MLP, stress test)", "```",
              classification_report(yst, pred_st, target_names=CLASSES, digits=3), "```", "",
              "Caveat: these numbers are on synthetic strokes. Real hand-drawn strokes will score lower until the",
              "model is retrained with real data (export from the app, then `python ml/train.py --extra strokes.json`)."]
    with open(os.path.join(HERE, "report.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(5.2, 4.6), dpi=140)
        ax.imshow(cm, cmap="Purples")
        ax.set_xticks(range(len(CLASSES)), CLASSES, rotation=40, ha="right")
        ax.set_yticks(range(len(CLASSES)), CLASSES)
        for i in range(len(CLASSES)):
            for j in range(len(CLASSES)):
                ax.text(j, i, cm[i, j], ha="center", va="center", fontsize=8, color="white" if cm[i, j] > cm.max() / 2 else "#3A3052")
        ax.set_xlabel("predicted"); ax.set_ylabel("true"); ax.set_title("Held-out confusion matrix")
        fig.tight_layout(); fig.savefig(os.path.join(HERE, "confusion_matrix.png")); plt.close(fig)
    except Exception as e:  # plotting is optional
        print("skipped plot:", e)
    print(classification_report(yst, pred_st, target_names=CLASSES, digits=3))


if __name__ == "__main__":
    main()
