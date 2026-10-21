// node tests/parity.js strokes.json -> prints JSON {features:[...], probs:[...]} per stroke (used by tests/test_parity.py)
const fs = require('fs'), path = require('path');
const M = require('../js/shapes-model.js');
const model = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'model', 'model.json')));
const strokes = JSON.parse(fs.readFileSync(process.argv[2]));
console.log(JSON.stringify(strokes.map(s => ({ features: M.features(s), probs: M.predict(model, M.features(s)) }))));
