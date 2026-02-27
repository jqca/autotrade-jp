import sys
import json
import numpy as np
import pennylane as qml

n_qubits = 5
dev = qml.device("default.qubit", wires=n_qubits)

trained_params = np.array([
    [ 0.8, -0.3,  0.5,  1.2, -0.7,  0.4, -1.1,  0.9,  0.2, -0.6],
    [ 1.1, -0.5,  0.3, -0.8,  0.6,  1.3, -0.4,  0.7, -1.0,  0.5],
    [-0.2,  0.9, -0.6,  0.4,  1.0, -0.3,  0.8, -0.5,  1.1, -0.7],
])

@qml.qnode(dev)
def anomaly_circuit(features, params):
    for i in range(n_qubits):
        qml.RY(features[i] * np.pi, wires=i)

    for layer in range(len(params)):
        for i in range(n_qubits):
            qml.RY(params[layer][i], wires=i)
            qml.RZ(params[layer][i + n_qubits], wires=i)
        for i in range(n_qubits - 1):
            qml.CNOT(wires=[i, i + 1])
        qml.CNOT(wires=[n_qubits - 1, 0])

    return [qml.expval(qml.PauliZ(i)) for i in range(n_qubits)]

def normalize_features(volatility, volume_ratio, breadth, rsi_avg, macd_sell_ratio):
    vol_norm = min(1.0, volatility / 0.1)
    vol_r_norm = min(1.0, max(0.0, (volume_ratio - 0.5) / 1.5))
    breadth_norm = min(1.0, breadth)
    rsi_norm = 1.0 - min(1.0, rsi_avg / 100.0)
    macd_norm = min(1.0, macd_sell_ratio)
    return np.array([vol_norm, vol_r_norm, breadth_norm, rsi_norm, macd_norm])

def compute_anomaly_score(features, params):
    expectations = anomaly_circuit(features, params)
    anomaly_raw = sum(1.0 - (e + 1.0) / 2.0 for e in expectations) / n_qubits

    feature_severity = (
        features[0] * 0.25 +
        features[2] * 0.25 +
        features[3] * 0.25 +
        features[4] * 0.15 +
        features[1] * 0.10
    )

    combined = anomaly_raw * 0.4 + feature_severity * 0.6
    score = min(100.0, max(0.0, combined * 100.0))
    return score

def classify_risk(score):
    if score >= 80:
        return "danger"
    elif score >= 60:
        return "warning"
    elif score >= 40:
        return "caution"
    else:
        return "normal"

def main():
    try:
        input_data = json.loads(sys.stdin.read())

        volatility = float(input_data.get("volatility", 0))
        volume_ratio = float(input_data.get("volumeRatio", 0.5))
        breadth = float(input_data.get("breadth", 0))
        rsi_avg = float(input_data.get("rsiAvg", 50))
        macd_sell_ratio = float(input_data.get("macdSellRatio", 0))

        features = normalize_features(volatility, volume_ratio, breadth, rsi_avg, macd_sell_ratio)
        score = compute_anomaly_score(features, trained_params)
        risk_level = classify_risk(score)

        qubit_details = anomaly_circuit(features, trained_params)
        qubit_info = [float(q) for q in qubit_details]

        result = {
            "riskScore": round(score, 1),
            "riskLevel": risk_level,
            "features": {
                "volatility": round(float(features[0]), 4),
                "volumeRatio": round(float(features[1]), 4),
                "breadth": round(float(features[2]), 4),
                "rsiSeverity": round(float(features[3]), 4),
                "macdSellRatio": round(float(features[4]), 4),
            },
            "quantumExpectations": qubit_info,
            "nQubits": n_qubits,
            "nLayers": len(trained_params),
        }

        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
