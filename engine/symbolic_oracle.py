"""AnalogVerifier-style numerical symbolic oracle. Reads one JSON document from stdin."""
import json
import math
import sys
import sympy as sp

request = json.load(sys.stdin)
metrics = request.get("metrics", {})
spec = request.get("spec", {})

gain = sp.Float(metrics.get("gain", 0))
ugbw = sp.Float(metrics.get("ugbw", 0))
phase = sp.Float(metrics.get("phase", 0))
power = sp.Float(metrics.get("power", 0))
noise = sp.Float(metrics.get("noise", 0))

checks = [
    ("gain", gain >= sp.Float(spec.get("gainTarget", 0))),
    ("ugbw", ugbw >= sp.Float(spec.get("ugbwTarget", 0))),
    ("phase", phase >= sp.Float(spec.get("phaseTarget", 0))),
    ("power", power <= sp.Float(spec.get("powerTarget", math.inf))),
    ("noise", noise <= sp.Float(spec.get("noiseTarget", math.inf))),
]

# These identities are retained as exact SymPy expressions and are exposed to
# the caller as provenance for numerical threshold decisions.
gm, ro, cc, vdd, idd = sp.symbols("gm ro Cc VDD IDD", positive=True)
formulas = {
    "gain": str(20 * sp.log(gm * ro, 10)),
    "ugbw": str(gm / (2 * sp.pi * cc)),
    "power": str(vdd * idd),
}

result = {
    "engine": "SymPy",
    "passed": {name: bool(value) for name, value in checks},
    "allPassed": all(bool(value) for _, value in checks),
    "formulas": formulas,
}
print(json.dumps(result))
