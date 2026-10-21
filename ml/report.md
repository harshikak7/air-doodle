# Model report

Training strokes: 14000 (2000/class synthetic)
Held-out test: 400 fresh synthetic strokes per class. Stress: 400 per class with ~2x hand wobble.

| Model | Held-out test | Stress test |
|---|---|---|
| Logistic regression (baseline) | 98.3% | 88.1% |
| MLP 64-32 (shipped) | 98.9% | 90.4% |

## Per-class (MLP, held-out test)
```
              precision    recall  f1-score   support

      circle      0.995     0.998     0.996       400
    triangle      0.997     0.995     0.996       400
      square      0.997     0.988     0.992       400
        star      0.995     0.995     0.995       400
       heart      0.990     0.995     0.993       400
        line      0.973     0.985     0.979       400
    squiggle      0.975     0.968     0.971       400

    accuracy                          0.989      2800
   macro avg      0.989     0.989     0.989      2800
weighted avg      0.989     0.989     0.989      2800

```

## Per-class (MLP, stress test)
```
              precision    recall  f1-score   support

      circle      0.971     0.838     0.899       400
    triangle      0.984     0.897     0.939       400
      square      0.897     0.955     0.925       400
        star      0.918     0.955     0.936       400
       heart      0.990     0.968     0.979       400
        line      0.968     0.755     0.848       400
    squiggle      0.706     0.963     0.815       400

    accuracy                          0.904      2800
   macro avg      0.919     0.904     0.906      2800
weighted avg      0.919     0.904     0.906      2800

```

Caveat: these numbers are on synthetic strokes. Real hand-drawn strokes will score lower until the
model is retrained with real data (export from the app, then `python ml/train.py --extra strokes.json`).
