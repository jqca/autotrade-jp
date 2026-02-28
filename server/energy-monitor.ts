import { storage } from "./storage";
import type { InsertEnergyLog } from "@shared/schema";

const POWER_PROFILES = {
  CPU: {
    idle: 15,
    load: 65,
    description: "CPU (古典計算)",
  },
  GPU: {
    idle: 30,
    load: 250,
    description: "GPU (ディープラーニング)",
  },
  QPU: {
    idle: 0.01,
    load: 0.025,
    description: "QPU (量子処理装置)",
  },
  CRYO: {
    idle: 15000,
    load: 25000,
    description: "冷凍機 (希釈冷凍機)",
  },
} as const;

const CO2_GRAMS_PER_WH = 0.423;

export type ProcessorType = "CPU" | "GPU" | "QPU" | "QPU+CRYO";

export interface EnergyEstimate {
  processor: string;
  durationMs: number;
  powerWatts: number;
  energyWh: number;
  co2Grams: number;
}

export function estimateEnergy(
  processor: ProcessorType,
  durationMs: number,
  loadFactor: number = 0.7
): EnergyEstimate {
  const hours = durationMs / 3600000;
  let powerWatts: number;

  if (processor === "QPU+CRYO") {
    const qpuPower = POWER_PROFILES.QPU.idle + (POWER_PROFILES.QPU.load - POWER_PROFILES.QPU.idle) * loadFactor;
    const cryoPower = POWER_PROFILES.CRYO.idle + (POWER_PROFILES.CRYO.load - POWER_PROFILES.CRYO.idle) * loadFactor;
    powerWatts = qpuPower + cryoPower;
  } else if (processor === "QPU") {
    powerWatts = POWER_PROFILES.QPU.idle + (POWER_PROFILES.QPU.load - POWER_PROFILES.QPU.idle) * loadFactor;
  } else {
    const profile = POWER_PROFILES[processor];
    powerWatts = profile.idle + (profile.load - profile.idle) * loadFactor;
  }

  const energyWh = powerWatts * hours;
  const co2Grams = energyWh * CO2_GRAMS_PER_WH;

  return {
    processor,
    durationMs,
    powerWatts: Math.round(powerWatts * 100) / 100,
    energyWh: Math.round(energyWh * 10000) / 10000,
    co2Grams: Math.round(co2Grams * 10000) / 10000,
  };
}

export async function logEnergy(
  taskType: string,
  taskName: string,
  processor: ProcessorType,
  durationMs: number,
  loadFactor: number = 0.7,
  details?: Record<string, any>
): Promise<EnergyEstimate> {
  const estimate = estimateEnergy(processor, durationMs, loadFactor);

  const log: InsertEnergyLog = {
    taskType,
    taskName,
    processor: estimate.processor,
    durationMs: estimate.durationMs,
    powerWatts: estimate.powerWatts,
    energyWh: estimate.energyWh,
    co2Grams: estimate.co2Grams,
    details: details ? JSON.stringify(details) : null,
  };

  await storage.insertEnergyLog(log);
  return estimate;
}

export function getPowerProfiles() {
  return POWER_PROFILES;
}

export function getComparisonEstimate(durationMs: number) {
  const cpuEst = estimateEnergy("CPU", durationMs, 0.8);
  const gpuEst = estimateEnergy("GPU", durationMs, 0.8);
  const qpuOnlyEst = estimateEnergy("QPU", durationMs, 0.8);
  const qpuCryoEst = estimateEnergy("QPU+CRYO", durationMs, 0.8);

  return {
    cpu: cpuEst,
    gpu: gpuEst,
    qpuOnly: qpuOnlyEst,
    qpuWithCryo: qpuCryoEst,
    speedupFactor: {
      description: "量子コンピュータが問題を高速に解ける場合の省エネ効果",
      example10x: {
        quantumDurationMs: durationMs / 10,
        quantumEnergy: estimateEnergy("QPU+CRYO", durationMs / 10, 0.8),
        classicalEnergy: cpuEst,
        savingsPercent: Math.round((1 - estimateEnergy("QPU+CRYO", durationMs / 10, 0.8).energyWh / cpuEst.energyWh) * 100),
      },
      example100x: {
        quantumDurationMs: durationMs / 100,
        quantumEnergy: estimateEnergy("QPU+CRYO", durationMs / 100, 0.8),
        classicalEnergy: cpuEst,
        savingsPercent: Math.round((1 - estimateEnergy("QPU+CRYO", durationMs / 100, 0.8).energyWh / cpuEst.energyWh) * 100),
      },
    },
  };
}
