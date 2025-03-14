// Augment the 'bun' module to add custom Env interface
declare module 'bun' {
  interface Env {
    ENV: string;
    RPC_URL: string;
    NETWORK_PASSPHRASE: string;
    LAUNCHTUBE_URL: string;
    LAUNCHTUBE_JWT: string;
    FARMER_PK: string;
    FARMER_SK: string;
    CONTRACT_ID: string;
    STAKE_AMOUNT: number;
    NONCE_COUNT: number;
    INDEX: number;
    WORK_WAIT_TIME: number;
  }
}

// Global type declarations for the app
declare global {
  // Data from the contract
  interface ContractData {
    index: number; // Current block index
    block: Block | undefined; // Block details
    pail: Pail | undefined; // Pail details
  }

  interface Block {
    timestamp?: bigint;
    min_gap: bigint;
    min_stake: bigint;
    min_zeros: bigint;
    max_gap: bigint;
    max_stake: bigint;
    max_zeros: bigint;
    entropy?: Buffer;
    staked_total?: bigint;
    normalized_total?: bigint;
  }

  interface Pail {
    sequence: bigint;
    gap: bigint | undefined;
    stake: bigint;
    zeros: bigint | undefined;
  }

  // Type for the farming process
  type FarmerProcess = Subprocess<'ignore', 'pipe', 'inherit'>;

  // All state needed to run the farmer
  interface FarmerState {
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
  interface EnvConfig {
    MAX_ERROR_LIMIT: string; // Maximum allowed errors before shutdown
    CHECK_EVERY_MS: string; // Interval to check for new blocks (ms)
    HARVEST_DELAY_MS: string; // Delay before harvesting (ms)
    FARMER_PK: string; // Farmer's public key
    WORK_WAIT_TIME: string; // Time to wait before starting work (ms)
    NONCE_COUNT: string; // Number of nonces to process
    STAKE_AMOUNT: string; // Amount to stake
  }

  // Function signatures
  type StartFarmingFn = (initialState: FarmerState) => void;
  type RunCycleFn = (state: FarmerState) => Promise<FarmerState>;
  type ProcessNewBlockFn = (
    state: FarmerState,
    index: number,
    block: Block | undefined,
    entropy: string,
    pail: Pail | undefined
  ) => FarmerState;
  type ShowStatusFn = (
    index: number,
    minutes: number,
    seconds: number,
    hasPlanted: boolean,
    hasWorked: boolean,
    process: FarmerProcess | undefined
  ) => void;
  type StartWorkFn = (
    state: FarmerState,
    index: number,
    entropy: string,
    timeDifference: number,
    plantFn: PlantFn
  ) => Promise<FarmerState>;
  type HandleStreamFn = (
    state: FarmerState,
    reader: ReadableStream<Uint8Array>,
    handleWorkError: HandleWorkErrorFn
  ) => Promise<FarmerState>;
  type HandleWorkErrorFn = (state: FarmerState, error: string) => FarmerState;
  type PlantFn = (state: FarmerState) => Promise<FarmerState>;
  type HandlePlantErrorFn = (state: FarmerState, error: string) => FarmerState;
  type CalculateTimeFn = (block: Block | undefined) => {
    timestamp: Date;
    timeDifference: number;
    minutesElapsed: number;
    secondsElapsed: number;
  };
}
