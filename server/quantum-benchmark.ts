import { spawn } from "child_process";
import path from "path";

let benchmarkRunning = false;

export interface BenchmarkResult {
  risk: any;
  portfolio: any;
  var: any;
  kernel: any;
  scaling: any;
  error?: string;
}

export function isBenchmarkRunning(): boolean {
  return benchmarkRunning;
}

export async function runQuantumBenchmark(): Promise<BenchmarkResult> {
  if (benchmarkRunning) {
    throw new Error("ベンチマークが既に実行中です");
  }

  benchmarkRunning = true;

  try {
    const result = await new Promise<BenchmarkResult>((resolve, reject) => {
      const scriptPath = path.join(process.cwd(), "server", "quantum_benchmark.py");
      const proc = spawn("python3", [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill("SIGTERM");
          reject(new Error("ベンチマークがタイムアウトしました（180秒）"));
        }
      }, 180000);

      proc.stdout.on("data", (data) => { stdout += data.toString(); });
      proc.stderr.on("data", (data) => { stderr += data.toString(); });

      proc.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`ベンチマークエラー: ${stderr}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(new Error(`ベンチマーク出力パースエラー: ${stdout.slice(0, 200)}`));
        }
      });

      proc.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`ベンチマークプロセスエラー: ${err.message}`));
      });

      proc.stdin.end();
    });

    return result;
  } finally {
    benchmarkRunning = false;
  }
}
