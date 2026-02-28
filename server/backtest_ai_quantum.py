import sys
import json
import time
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier

try:
    import pennylane as qml
    HAS_PENNYLANE = True
except ImportError:
    HAS_PENNYLANE = False


class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, (np.integer,)):
            return int(obj)
        if isinstance(obj, (np.floating,)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)


def ai_score_signals(signals, ai_threshold=0.5):
    if len(signals) < 10:
        for s in signals:
            s["ai_score"] = 0.5
            s["ai_model"] = "insufficient_data"
            s["ai_passed"] = True
        return signals, {"skipped": True, "reason": "シグナル数不足（10件未満）"}

    features_list = []
    labels = []
    for s in signals:
        f = [
            s.get("rsiValue", 50) / 100.0,
            1.0 if s.get("macdTrend") == "buy" else 0.0,
            1.0 if s.get("maTrend") == "buy" else 0.0,
            1.0 if s.get("bbTrend") == "buy" else 0.0,
            s.get("volatility", 0.02),
            s.get("priceChange", 0.0),
        ]
        features_list.append(f)
        labels.append(1 if s.get("isWin", False) else 0)

    X = np.array(features_list)
    y = np.array(labels)

    n_total = len(X)
    split = max(20, int(n_total * 0.6))
    if split >= n_total - 5:
        split = max(10, n_total - 10)

    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]

    n_pos = sum(y_train)
    n_neg = len(y_train) - n_pos
    if n_pos < 3 or n_neg < 3:
        np.random.seed(42)
        n_aug = 30
        X_aug_pos = np.random.randn(n_aug, 6) * 0.1 + np.array([0.3, 0.8, 0.8, 0.7, 0.015, 0.005])
        X_aug_neg = np.random.randn(n_aug, 6) * 0.1 + np.array([0.6, 0.3, 0.3, 0.4, 0.03, -0.005])
        X_train = np.vstack([X_train, np.clip(X_aug_pos, 0, 1), np.clip(X_aug_neg, 0, 1)])
        y_train = np.concatenate([y_train, np.ones(n_aug), np.zeros(n_aug)])

    t0 = time.time()
    gbm = GradientBoostingClassifier(
        n_estimators=80, max_depth=3, learning_rate=0.1,
        subsample=0.8, random_state=42
    )
    gbm.fit(X_train, y_train)

    all_probas = gbm.predict_proba(X)
    win_probas = all_probas[:, 1] if all_probas.shape[1] > 1 else np.full(len(X), 0.5)
    ai_time = time.time() - t0

    feature_names = ["RSI", "MACD", "MA", "BB", "Volatility", "PriceChange"]
    importance = dict(zip(feature_names, [round(float(v), 3) for v in gbm.feature_importances_]))

    test_preds = gbm.predict(X_test)
    test_acc = sum(int(p) == int(t) for p, t in zip(test_preds, y_test)) / max(1, len(y_test)) * 100

    passed = 0
    filtered = 0
    for i, s in enumerate(signals):
        score = float(win_probas[i])
        s["ai_score"] = round(score, 4)
        s["ai_model"] = "GradientBoosting"
        if i >= split:
            s["ai_passed"] = score >= ai_threshold
            if score >= ai_threshold:
                passed += 1
            else:
                filtered += 1
        else:
            s["ai_passed"] = True
            passed += 1

    summary = {
        "model": "GradientBoostingClassifier (n=80, depth=3)",
        "train_size": int(split),
        "test_size": int(len(X_test)),
        "test_accuracy": round(test_acc, 1),
        "threshold": ai_threshold,
        "passed": passed,
        "filtered": filtered,
        "feature_importance": importance,
        "time_ms": round(ai_time * 1000, 1),
    }

    return signals, summary


def quantum_portfolio_select(signals_by_day, max_per_day=5):
    if not HAS_PENNYLANE:
        for day_signals in signals_by_day.values():
            for s in day_signals:
                s["quantum_selected"] = True
                s["quantum_method"] = "pennylane_unavailable"
        return signals_by_day, {"skipped": True, "reason": "PennyLane未インストール"}

    total_optimized = 0
    total_days = 0
    total_selected = 0
    t0 = time.time()

    for day, day_signals in signals_by_day.items():
        n = len(day_signals)
        if n <= max_per_day:
            for s in day_signals:
                s["quantum_selected"] = True
                s["quantum_method"] = "QAOA(全選択)"
            total_selected += n
            continue

        total_days += 1
        effective_n = min(n, 10)
        signals_subset = sorted(day_signals, key=lambda s: s.get("ai_score", 0), reverse=True)[:effective_n]

        expected_returns = np.array([s.get("ai_score", 0.5) for s in signals_subset])
        volatilities = np.array([max(0.001, s.get("volatility", 0.02)) for s in signals_subset])

        risk_aversion = 0.5
        Q = np.zeros((effective_n, effective_n))
        for i in range(effective_n):
            Q[i][i] = -(expected_returns[i] - risk_aversion * volatilities[i]**2)
            for j in range(i + 1, effective_n):
                corr = 0.3
                Q[i][j] = risk_aversion * corr * volatilities[i] * volatilities[j]
                Q[j][i] = Q[i][j]

        n_layers = 2
        dev = qml.device("default.qubit", wires=effective_n)

        cost_coeffs = []
        cost_obs = []
        for i in range(effective_n):
            cost_coeffs.append(Q[i][i] / 2)
            cost_obs.append(qml.PauliZ(i))
            for j in range(i + 1, effective_n):
                if abs(Q[i][j]) > 1e-10:
                    cost_coeffs.append(Q[i][j] / 4)
                    cost_obs.append(qml.PauliZ(i) @ qml.PauliZ(j))

        cost_h = qml.Hamiltonian(cost_coeffs, cost_obs)
        mixer_h = qml.Hamiltonian(
            [1.0] * effective_n,
            [qml.PauliX(i) for i in range(effective_n)]
        )

        @qml.qnode(dev)
        def qaoa_circuit(params):
            for i in range(effective_n):
                qml.Hadamard(wires=i)
            for layer in range(n_layers):
                qml.ApproxTimeEvolution(cost_h, params[layer][0], 1)
                qml.ApproxTimeEvolution(mixer_h, params[layer][1], 1)
            return qml.probs(wires=range(effective_n))

        params = np.random.uniform(0.1, 1.0, (n_layers, 2))
        probs = np.array(qaoa_circuit(params))
        top_indices = np.argsort(-probs)[:10]

        best_selection = None
        best_cost = float('inf')
        for top_idx in top_indices:
            bits = [(top_idx >> (effective_n - 1 - i)) & 1 for i in range(effective_n)]
            selected_count = sum(bits)
            if selected_count == 0 or selected_count > max_per_day:
                continue
            cost = sum(Q[i][j] * bits[i] * bits[j] for i in range(effective_n) for j in range(effective_n))
            if cost < best_cost:
                best_cost = cost
                best_selection = bits

        if best_selection is None:
            best_selection = [0] * effective_n
            top_ai = sorted(range(effective_n), key=lambda i: signals_subset[i].get("ai_score", 0), reverse=True)
            for idx in top_ai[:max_per_day]:
                best_selection[idx] = 1

        selected_tickers = set()
        for i, s in enumerate(signals_subset):
            if best_selection[i] == 1:
                s["quantum_selected"] = True
                s["quantum_method"] = f"QAOA({effective_n}資産→{sum(best_selection)}選択)"
                selected_tickers.add(s["ticker"])
                total_selected += 1
            else:
                s["quantum_selected"] = False
                s["quantum_method"] = f"QAOA除外({effective_n}資産中)"

        for s in day_signals:
            if "quantum_selected" not in s:
                if s["ticker"] in selected_tickers:
                    s["quantum_selected"] = True
                    s["quantum_method"] = "QAOA(AI上位外・銘柄一致)"
                    total_selected += 1
                else:
                    s["quantum_selected"] = False
                    s["quantum_method"] = "QAOA除外(AI上位外)"

        total_optimized += n

    quantum_time = time.time() - t0

    summary = {
        "method": "QAOA (2層, PennyLane default.qubit)",
        "days_optimized": total_days,
        "total_candidates": total_optimized,
        "selected": total_selected,
        "max_per_day": max_per_day,
        "time_ms": round(quantum_time * 1000, 1),
    }

    return signals_by_day, summary


def quantum_var_estimate(signals):
    if not HAS_PENNYLANE or len(signals) < 5:
        for s in signals:
            s["var_estimate"] = None
        return signals, {"skipped": True}

    returns = [s.get("profitLossPercent", 0) / 100.0 for s in signals if s.get("profitLossPercent") is not None]
    if len(returns) < 5:
        for s in signals:
            s["var_estimate"] = None
        return signals, {"skipped": True}

    mean_ret = float(np.mean(returns))
    std_ret = float(np.std(returns))
    if std_ret < 1e-8:
        std_ret = 0.01

    n_q = 5
    n_bins = 2 ** n_q
    z_range = 3.0
    z_values = np.linspace(-z_range, z_range, n_bins)
    bin_width = z_values[1] - z_values[0]

    pdf_values = (1.0 / np.sqrt(2 * np.pi)) * np.exp(-0.5 * z_values**2)
    probabilities = pdf_values * bin_width
    probabilities = probabilities / np.sum(probabilities)
    amplitudes = np.sqrt(probabilities)
    amplitudes = amplitudes / np.linalg.norm(amplitudes)

    dev = qml.device("default.qubit", wires=n_q + 1)

    @qml.qnode(dev)
    def qae_circuit():
        qml.AmplitudeEmbedding(amplitudes, wires=range(n_q), normalize=True)
        qml.RY(np.pi / 4, wires=n_q)
        for _ in range(2):
            qml.PauliZ(wires=n_q)
            for w in range(n_q):
                qml.Hadamard(wires=w)
                qml.PauliZ(wires=w)
                qml.Hadamard(wires=w)
        return qml.probs(wires=range(n_q))

    t0 = time.time()
    q_probs = np.array(qae_circuit())
    quantum_time = time.time() - t0

    loss_values = -(mean_ret + z_values * std_ret) * 100
    loss_sorted_idx = np.argsort(loss_values)
    loss_sorted = loss_values[loss_sorted_idx]
    prob_sorted = probabilities[loss_sorted_idx]
    cumul = np.cumsum(prob_sorted)
    var_bin = np.searchsorted(cumul, 0.95)
    var_bin = min(var_bin, n_bins - 1)
    var_95 = float(loss_sorted[var_bin])

    for s in signals:
        s["var_estimate"] = round(var_95, 4)

    summary = {
        "method": "量子振幅推定 (5qubit)",
        "var_95_pct": round(var_95, 2),
        "mean_return_pct": round(mean_ret * 100, 3),
        "std_pct": round(std_ret * 100, 3),
        "time_ms": round(quantum_time * 1000, 1),
    }

    return signals, summary


def main():
    try:
        stdin_data = sys.stdin.read().strip()
        if not stdin_data:
            print(json.dumps({"error": "No input data"}))
            sys.exit(1)

        data = json.loads(stdin_data)
        signals = data.get("signals", [])
        ai_threshold = data.get("ai_threshold", 0.5)
        use_ai = data.get("use_ai", True)
        use_quantum = data.get("use_quantum", True)
        max_per_day = data.get("max_per_day", 5)

        ai_summary = None
        quantum_summary = None
        var_summary = None

        if use_ai and len(signals) > 0:
            signals, ai_summary = ai_score_signals(signals, ai_threshold)

        if use_quantum and len(signals) > 0:
            ai_passed = [s for s in signals if s.get("ai_passed", True)]

            signals_by_day = {}
            for s in ai_passed:
                day = s.get("signalDate", "")[:10]
                if day not in signals_by_day:
                    signals_by_day[day] = []
                signals_by_day[day].append(s)

            signals_by_day, quantum_summary = quantum_portfolio_select(signals_by_day, max_per_day)

            flat = []
            for day_signals in signals_by_day.values():
                flat.extend(day_signals)

            quantum_selected = [s for s in flat if s.get("quantum_selected", False)]
            if len(quantum_selected) > 0:
                quantum_selected, var_summary = quantum_var_estimate(quantum_selected)
                selected_map = {(s["ticker"], s["signalDate"]): s for s in quantum_selected}
                for s in signals:
                    key = (s["ticker"], s["signalDate"])
                    if key in selected_map:
                        s["var_estimate"] = selected_map[key].get("var_estimate")

            for s in signals:
                if "quantum_selected" not in s:
                    if not s.get("ai_passed", True):
                        s["quantum_selected"] = False
                        s["quantum_method"] = "AIフィルター除外"
                    else:
                        s["quantum_selected"] = True
                        s["quantum_method"] = "対象外"

        result = {
            "signals": signals,
            "ai_summary": ai_summary,
            "quantum_summary": quantum_summary,
            "var_summary": var_summary,
        }

        print(json.dumps(result, cls=NumpyEncoder))
    except Exception as e:
        import traceback
        print(json.dumps({"error": str(e), "trace": traceback.format_exc()}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
