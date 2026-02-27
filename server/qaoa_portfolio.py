import sys
import json
import numpy as np
import pennylane as qml
from pennylane import qaoa

def portfolio_qubo(expected_returns, cov_matrix, risk_aversion=0.5, budget_penalty=2.0, n_assets=None):
    n = n_assets or len(expected_returns)
    Q = np.zeros((n, n))

    for i in range(n):
        for j in range(n):
            Q[i][j] += risk_aversion * cov_matrix[i][j]

    for i in range(n):
        Q[i][i] -= expected_returns[i]

    for i in range(n):
        for j in range(n):
            Q[i][j] += budget_penalty
        Q[i][i] -= 2 * budget_penalty * (n // 2)

    return Q

def solve_qaoa(Q, n_assets, p=2, n_shots=200):
    n = n_assets

    if n > 12:
        return solve_classical(Q, n_assets)

    dev = qml.device("default.qubit", wires=n)

    cost_coeffs = []
    cost_obs = []

    for i in range(n):
        for j in range(i + 1, n):
            if abs(Q[i][j] + Q[j][i]) > 1e-10:
                coeff = (Q[i][j] + Q[j][i]) / 4.0
                cost_coeffs.append(coeff)
                cost_obs.append(qml.PauliZ(i) @ qml.PauliZ(j))

    for i in range(n):
        diag_val = Q[i][i] / 2.0
        off_diag_sum = sum((Q[i][j] + Q[j][i]) / 4.0 for j in range(n) if j != i)
        coeff = -(diag_val + off_diag_sum)
        if abs(coeff) > 1e-10:
            cost_coeffs.append(coeff)
            cost_obs.append(qml.PauliZ(i))

    if len(cost_coeffs) == 0:
        cost_coeffs = [0.0]
        cost_obs = [qml.Identity(0)]

    cost_h = qml.Hamiltonian(cost_coeffs, cost_obs)

    mixer_coeffs = [1.0] * n
    mixer_obs = [qml.PauliX(i) for i in range(n)]
    mixer_h = qml.Hamiltonian(mixer_coeffs, mixer_obs)

    def qaoa_layer(gamma, beta):
        qaoa.cost_layer(gamma, cost_h)
        qaoa.mixer_layer(beta, mixer_h)

    @qml.qnode(dev)
    def cost_function(params):
        for i in range(n):
            qml.Hadamard(wires=i)
        gammas = params[0]
        betas = params[1]
        qml.layer(qaoa_layer, p, gammas, betas)
        return qml.expval(cost_h)

    @qml.qnode(dev)
    def probability_circuit(params):
        for i in range(n):
            qml.Hadamard(wires=i)
        gammas = params[0]
        betas = params[1]
        qml.layer(qaoa_layer, p, gammas, betas)
        return qml.probs(wires=range(n))

    np.random.seed(42)
    init_params = np.array([
        np.random.uniform(0, 2 * np.pi, p),
        np.random.uniform(0, np.pi, p)
    ])

    opt = qml.GradientDescentOptimizer(stepsize=0.4)
    params = init_params

    for step in range(80):
        params = opt.step(cost_function, params)

    probs = probability_circuit(params)
    probs = np.array(probs)

    best_indices = np.argsort(probs)[::-1]
    best_solutions = []

    for idx in best_indices[:min(10, len(best_indices))]:
        if probs[idx] < 0.001:
            continue
        bitstring = format(idx, f'0{n}b')
        selection = [int(b) for b in bitstring]
        cost = sum(Q[i][j] * selection[i] * selection[j] for i in range(n) for j in range(n))
        best_solutions.append({
            "selection": selection,
            "probability": float(probs[idx]),
            "cost": float(cost),
        })

    if not best_solutions:
        return solve_classical(Q, n_assets)

    best_solutions.sort(key=lambda x: x["cost"])
    best = best_solutions[0]

    return {
        "selection": best["selection"],
        "probability": best["probability"],
        "cost": best["cost"],
        "all_solutions": best_solutions[:5],
        "optimal_params": params.tolist(),
        "n_layers": p,
    }

def solve_classical(Q, n_assets):
    n = n_assets
    best_cost = float('inf')
    best_selection = [0] * n

    for mask in range(1, 2**n):
        selection = [(mask >> i) & 1 for i in range(n)]
        cost = sum(Q[i][j] * selection[i] * selection[j] for i in range(n) for j in range(n))
        if cost < best_cost:
            best_cost = cost
            best_selection = selection

    return {
        "selection": best_selection,
        "probability": 1.0,
        "cost": float(best_cost),
        "all_solutions": [{"selection": best_selection, "probability": 1.0, "cost": float(best_cost)}],
        "optimal_params": [],
        "n_layers": 0,
    }

def main():
    try:
        input_data = json.loads(sys.stdin.read())

        expected_returns = np.array(input_data["expectedReturns"])
        cov_matrix = np.array(input_data["covMatrix"])
        risk_aversion = float(input_data.get("riskAversion", 0.5))
        budget_penalty = float(input_data.get("budgetPenalty", 2.0))
        n_assets = len(expected_returns)
        p_layers = int(input_data.get("qaoaLayers", 2))

        Q = portfolio_qubo(expected_returns, cov_matrix, risk_aversion, budget_penalty, n_assets)

        result = solve_qaoa(Q, n_assets, p=p_layers)

        output = {
            "selection": result["selection"],
            "probability": result["probability"],
            "cost": result["cost"],
            "topSolutions": result["all_solutions"],
            "nAssets": n_assets,
            "nLayers": result["n_layers"],
            "method": "qaoa" if result["n_layers"] > 0 else "classical_fallback",
            "quboMatrix": Q.tolist(),
        }

        print(json.dumps(output))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
