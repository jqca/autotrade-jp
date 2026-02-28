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

    pdf_values = (1.0 / np.sqrt(2 * np.pi)) * np.exp(-0.5 * z_values**2)
    probabilities = pdf_values * bin_width
    probabilities = probabilities / np.sum(probabilities)

    amplitudes = np.sqrt(probabilities)

    dev = qml.device("default.qubit", wires=n_qubits + 1)

    @qml.qnode(dev)
    def amplitude_estimation_circuit(threshold_idx):
        qml.AmplitudeEmbedding(amplitudes, wires=range(n_qubits), normalize=True)

        for i in range(n_qubits):
            bit_val = (threshold_idx >> (n_qubits - 1 - i)) & 1
            if bit_val == 0:
                qml.PauliX(wires=i)

        qml.ctrl(qml.PauliX, control=list(range(n_qubits)))(wires=n_qubits)

        for i in range(n_qubits):
            bit_val = (threshold_idx >> (n_qubits - 1 - i)) & 1
            if bit_val == 0:
                qml.PauliX(wires=i)

        return qml.probs(wires=range(n_qubits))

    var_z = z_values[int(n_bins * confidence_level)]
    var_loss = -(portfolio_mean + var_z * portfolio_std) * portfolio_value

    threshold_idx = int(n_bins * confidence_level)
    threshold_idx = min(threshold_idx, n_bins - 1)

    quantum_probs = amplitude_estimation_circuit(threshold_idx)
    quantum_probs = np.array(quantum_probs)

    tail_prob = float(np.sum(quantum_probs[threshold_idx:]))

    tail_z_values = z_values[threshold_idx:]
    tail_probs = quantum_probs[threshold_idx:]
    tail_sum = np.sum(tail_probs)
    if tail_sum > 0:
        expected_tail_z = float(np.sum(tail_z_values * tail_probs) / tail_sum)
    else:
        expected_tail_z = var_z

    cvar_loss = -(portfolio_mean + expected_tail_z * portfolio_std) * portfolio_value

    grover_iterations = int(np.pi / (4 * np.arcsin(np.sqrt(max(1e-10, tail_prob))))) if tail_prob > 0 else 0

    amplitude_estimates = []
    for i in range(min(n_bins, 16)):
        loss_val = -(portfolio_mean + z_values[i] * portfolio_std) * portfolio_value
        amplitude_estimates.append({
            "bin": i,
            "z_value": round(float(z_values[i]), 3),
            "probability": round(float(quantum_probs[i]), 6),
            "loss": round(float(loss_val), 2),
        })

    return {
        "var": round(float(var_loss), 2),
        "cvar": round(float(cvar_loss), 2),
        "n_qubits": n_qubits,
        "n_shots": n_shots,
        "amplitude_estimates": amplitude_estimates,
        "quantum_probabilities": [round(float(p), 6) for p in quantum_probs[:16]],
        "mean_return": round(float(portfolio_mean) * 100, 4),
        "std_return": round(float(portfolio_std) * 100, 4),
        "tail_probability": round(float(tail_prob), 6),
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
