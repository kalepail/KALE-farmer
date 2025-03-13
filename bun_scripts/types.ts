import type { Subprocess } from 'bun';
import type { Block, Pail } from './utils';

// Data from the contract
export interface ContractData {
  index: number; // Current block index
  block: Block | undefined; // Block details
  pail: Pail | undefined; // Pail details
}

// Type for the farming process
export type FarmerProcess = Subprocess<'ignore', 'pipe', 'inherit'>;

// All state needed to run the farmer
export interface FarmerState {
  contractData: ContractData; // Current contract info
  process: FarmerProcess | undefined; // Running farming process
  previousIndex: number | undefined; // Last processed block index
  isBooting: boolean; // Is a new process starting?
  hasPlanted: boolean; // Has planting occurred?
  hasWorked: boolean; // Has work been completed?
  errorCount: number; // Number of errors encountered
  isFirstRun: boolean; // Is this the initial run?
  timestamp: Date; // Current block timestamp
  timeDifference: number; // Time since block started (ms)
  minutesElapsed: number; // Minutes since block started
  secondsElapsed: number; // Seconds within the current minute
}

// Environment variables expected from .env
export interface EnvConfig {
  MAX_ERROR_LIMIT: string; // Maximum allowed errors before shutdown
  CHECK_EVERY_MS: string; // Interval to check for new blocks (ms)
  HARVEST_DELAY_MS: string; // Delay before harvesting (ms)
  FARMER_PK: string; // Farmer's public key
  WORK_WAIT_TIME: string; // Time to wait before starting work (ms)
  NONCE_COUNT: string; // Number of nonces to process
  STAKE_AMOUNT: string; // Amount to stake
}

// Function signatures
export type StartFarmingFn = (initialState: FarmerState) => void;
export type RunCycleFn = (state: FarmerState) => Promise<FarmerState>;
export type ProcessNewBlockFn = (
  state: FarmerState,
  index: number,
  block: Block | undefined,
  entropy: string,
  pail: Pail | undefined
) => FarmerState;
export type ShowStatusFn = (
  index: number,
  minutes: number,
  seconds: number,
  hasPlanted: boolean,
  hasWorked: boolean,
  process: FarmerProcess | undefined
) => void;
export type StartWorkFn = (
  state: FarmerState,
  index: number,
  entropy: string,
  timeDifference: number,
  plantFn: PlantFn
) => Promise<FarmerState>;
export type HandleStreamFn = (
  state: FarmerState,
  reader: ReadableStream<Uint8Array>,
  handleWorkError: HandleWorkErrorFn
) => Promise<FarmerState>;
export type HandleWorkErrorFn = (
  state: FarmerState,
  error: string
) => FarmerState;
export type PlantFn = (state: FarmerState) => Promise<FarmerState>;
export type HandlePlantErrorFn = (
  state: FarmerState,
  error: string
) => FarmerState;
export type CalculateTimeFn = (block: Block | undefined) => {
  timestamp: Date;
  timeDifference: number;
  minutesElapsed: number;
  secondsElapsed: number;
};
