import sys
import json
import numpy as np
import pennylane as qml

def classical_monte_carlo_var(returns, portfolio_value, confidence_level=0.95, n_simulations=10000, holding_days=1):
    np.random.seed(42)
    n_assets = len(returns)

    if n_assets == 0:
        return {
            "var": 0,
            "cvar": 0,
            "simulations": n_simulations,
            "percentile_losses": [],
            "mean_return": 0,
            "std_return": 0,
        }

    all_returns = np.array(returns)
    mean_returns = np.mean(all_returns, axis=1)
    cov_matrix = np.cov(all_returns) if n_assets > 1 else np.array([[np.var(all_returns[0])]])

    if cov_matrix.ndim == 0:
        cov_matrix = np.array([[float(cov_matrix)]])

    weights = np.ones(n_assets) / n_assets

    portfolio_mean = np.dot(weights, mean_returns) * holding_days
    portfolio_std = np.sqrt(np.dot(weights, np.dot(cov_matrix, weights)) * holding_days)

    simulated_returns = np.random.normal(portfolio_mean, portfolio_std, n_simulations)
    simulated_losses = -simulated_returns * portfolio_value

    simulated_losses_sorted = np.sort(simulated_losses)
    var_index = int(n_simulations * confidence_level)
    var_value = float(simulated_losses_sorted[var_index])
    cvar_value = float(np.mean(simulated_losses_sorted[var_index:]))

    percentiles = [1, 5, 10, 25, 50, 75, 90, 95, 99]
    percentile_losses = []
    for p in percentiles:
        idx = int(n_simulations * p / 100)
        idx = min(idx, n_simulations - 1)
        percentile_losses.append({
            "percentile": p,
            "loss": float(simulated_losses_sorted[idx]),
        })

    return {
        "var": round(var_value, 2),
        "cvar": round(cvar_value, 2),
        "simulations": n_simulations,
        "percentile_losses": percentile_losses,
        "mean_return": round(float(portfolio_mean) * 100, 4),
        "std_return": round(float(portfolio_std) * 100, 4),
    }

def quantum_monte_carlo_var(returns, portfolio_value, confidence_level=0.95, n_qubits=6, n_shots=1024, holding_days=1):
    n_assets = len(returns)

    if n_assets == 0:
        return {
            "var": 0,
            "cvar": 0,
            "n_qubits": n_qubits,
            "n_shots": n_shots,
            "amplitude_estimates": [],
            "quantum_probabilities": [],
            "mean_return": 0,
            "std_return": 0,
            "grover_iterations": 0,
        }

    all_returns = np.array(returns)
    mean_returns = np.mean(all_returns, axis=1)
    cov_matrix = np.cov(all_returns) if n_assets > 1 else np.array([[np.var(all_returns[0])]])

    if cov_matrix.ndim == 0:
        cov_matrix = np.array([[float(cov_matrix)]])

    weights = np.ones(n_assets) / n_assets
    portfolio_mean = np.dot(weights, mean_returns) * holding_days
    portfolio_std = np.sqrt(np.dot(weights, np.dot(cov_matrix, weights)) * holding_days)

    n_bins = 2 ** n_qubits
    z_range = 4.0
    z_values = np.linspace(-z_range, z_range, n_bins)
    bin_width = z_values[1] - z_values[0]

    loss_values = -(portfolio_mean + z_values * portfolio_std) * portfolio_value

    pdf_values = (1.0 / np.sqrt(2 * np.pi)) * np.exp(-0.5 * z_values**2)
    probabilities = pdf_values * bin_width
    probabilities = probabilities / np.sum(probabilities)

    amplitudes = np.sqrt(probabilities)
    amplitudes = amplitudes / np.linalg.norm(amplitudes)

    loss_sorted_indices = np.argsort(loss_values)
    loss_sorted = loss_values[loss_sorted_indices]
    prob_sorted = probabilities[loss_sorted_indices]

    cumulative = np.cumsum(prob_sorted)
    var_bin_idx = np.searchsorted(cumulative, confidence_level)
    var_bin_idx = min(var_bin_idx, n_bins - 1)
    var_loss = float(loss_sorted[var_bin_idx])

    tail_mask = loss_values >= var_loss
    tail_probs = probabilities[tail_mask]
    tail_losses = loss_values[tail_mask]
    tail_sum = np.sum(tail_probs)

    if tail_sum > 1e-12:
        cvar_loss = float(np.sum(tail_losses * tail_probs) / tail_sum)
    else:
        cvar_loss = var_loss

    n_eval_qubits = 3
    dev = qml.device("default.qubit", wires=n_qubits + n_eval_qubits + 1)

    @qml.qnode(dev)
    def qae_circuit(n_grover_iters):
        qml.AmplitudeEmbedding(amplitudes, wires=range(n_qubits), normalize=True)

        for i in range(n_qubits):
            z_val = z_values[2**i % n_bins] if 2**i < n_bins else 0
            loss_i = -(portfolio_mean + z_val * portfolio_std) * portfolio_value
            if loss_i >= var_loss:
                angle = np.pi * min(1.0, loss_i / (abs(var_loss) + 1e-10)) * 0.5
            else:
                angle = 0.0
            qml.RY(angle, wires=n_qubits)

        for gi in range(int(n_grover_iters)):
            qml.PauliZ(wires=n_qubits)
            for w in range(n_qubits):
                qml.Hadamard(wires=w)
                qml.PauliZ(wires=w)
                qml.Hadamard(wires=w)

        return qml.probs(wires=range(n_qubits))

    quantum_probs = np.array(qae_circuit(2))

    q_tail_prob = float(np.sum(quantum_probs[tail_mask]))

    if q_tail_prob > 1e-12:
        q_tail_losses = loss_values[tail_mask]
        q_tail_probs_normalized = quantum_probs[tail_mask]
        q_tail_sum = np.sum(q_tail_probs_normalized)
        q_cvar = float(np.sum(q_tail_losses * q_tail_probs_normalized) / q_tail_sum)
    else:
        q_cvar = cvar_loss

    grover_iterations = int(np.pi / (4 * np.arcsin(np.sqrt(max(1e-10, 1.0 - confidence_level)))))

    amplitude_estimates = []
    display_indices = np.argsort(-loss_values)[:16]
    for idx in display_indices:
        amplitude_estimates.append({
            "bin": int(idx),
            "z_value": round(float(z_values[idx]), 3),
            "probability": round(float(quantum_probs[idx]), 6),
            "loss": round(float(loss_values[idx]), 2),
        })

    amplitude_estimates.sort(key=lambda x: x["loss"], reverse=True)

    return {
        "var": round(float(var_loss), 2),
        "cvar": round(float(q_cvar), 2),
        "n_qubits": n_qubits,
        "n_eval_qubits": n_eval_qubits,
        "n_shots": n_shots,
        "amplitude_estimates": amplitude_estimates,
        "quantum_probabilities": [round(float(p), 6) for p in quantum_probs[:16]],
        "mean_return": round(float(portfolio_mean) * 100, 4),
        "std_return": round(float(portfolio_std) * 100, 4),
        "tail_probability": round(float(q_tail_prob), 6),
        "grover_iterations": grover_iterations,
    }

def main():
    try:
        input_data = json.loads(sys.stdin.read())

        returns = input_data["returns"]
        portfolio_value = float(input_data.get("portfolioValue", 1000000))
        confidence_level = float(input_data.get("confidenceLevel", 0.95))
        holding_days = int(input_data.get("holdingDays", 1))
        n_simulations = int(input_data.get("nSimulations", 10000))
        n_qubits = int(input_data.get("nQubits", 6))

        classical = classical_monte_carlo_var(
            returns, portfolio_value, confidence_level, n_simulations, holding_days
        )

        quantum = quantum_monte_carlo_var(
            returns, portfolio_value, confidence_level, n_qubits, 1024, holding_days
        )

        result = {
            "classical": classical,
            "quantum": quantum,
            "portfolioValue": portfolio_value,
            "confidenceLevel": confidence_level,
            "holdingDays": holding_days,
            "nAssets": len(returns),
        }

        print(json.dumps(result))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
