import {
  contract,
  getContractData,
  send,
  spawn,
  log,
  logError,
  exit,
  farmerSigner,
} from './utils';
import { Keypair } from '@stellar/stellar-sdk/minimal';
import { Api } from '@stellar/stellar-sdk/minimal/rpc';
import type {
  RunCycleFn,
  ProcessNewBlockFn,
  ShowStatusFn,
  StartWorkFn,
  HandleStreamFn,
  HandleWorkErrorFn,
  PlantFn,
  HandlePlantErrorFn,
  CalculateTimeFn,
} from './types';

// Run one cycle of farming
export const runCycle: RunCycleFn = async (state) => {
  const maxErrorLimit = Number(Bun.env.MAX_ERROR_LIMIT) || 12; // Fallback to 12 if not set
  if (state.errorCount > maxErrorLimit) {
    log('Too many errors, shutting down');
    exit(1);
    return state;
  }

  // Fetch new data every 5 minutes or on first run
  const shouldFetchData = state.isFirstRun || state.minutesElapsed >= 5;
  if (!state.isFirstRun && shouldFetchData) log('Checking for a new block...');
  const contractData = shouldFetchData
    ? await getContractData()
    : state.contractData;

  const { index, block, pail } = contractData;
  const entropy =
    block?.entropy?.toString('hex') ?? Buffer.alloc(32).toString('hex');
  const timeInfo = calculateTime(block);

  const updatedState = { ...state, contractData, ...timeInfo };

  if (index !== state.previousIndex) {
    return processNewBlock(updatedState, index, block, entropy, pail);
  }

  showStatus(
    index,
    updatedState.minutesElapsed,
    updatedState.secondsElapsed,
    updatedState.hasPlanted,
    updatedState.hasWorked,
    updatedState.process
  );
  if (
    !updatedState.isBooting &&
    !updatedState.process &&
    (!updatedState.hasPlanted || !updatedState.hasWorked)
  ) {
    return startWork(
      updatedState,
      index,
      entropy,
      updatedState.timeDifference,
      plant
    );
  }
  return updatedState;
};

// Handle a new block
export const processNewBlock: ProcessNewBlockFn = (
  state,
  index,
  block,
  entropy,
  pail
) => {
  log(
    state.isFirstRun
      ? `Starting KALE farming with ${Bun.env.FARMER_PK}`
      : 'Found a new block of KALE seeds!'
  );
  log(
    'Block Info:',
    index,
    {
      maxGap: block?.max_gap,
      maxZeros: block?.max_zeros,
      minGap: block?.min_gap,
      minStake: block?.min_stake,
      minZeros: block?.min_zeros,
    },
    entropy,
    state.timestamp
  );

  state.process?.kill();

  const newState = {
    ...state,
    process: undefined,
    previousIndex: index,
    hasPlanted: !!(pail?.sequence || pail?.stake),
    hasWorked: !!(pail?.gap || pail?.zeros),
    errorCount: 0,
    isFirstRun: false,
  };

  if (!state.isFirstRun) {
    const harvestDelayMs = Number(Bun.env.HARVEST_DELAY_MS) || 60000; // Fallback to 60s
    setTimeout(
      () => spawn(['bun', 'harvest.ts'], (msg) => log(msg)),
      harvestDelayMs
    );
  }

  return newState;
};

// Display current farming status
export const showStatus: ShowStatusFn = (
  index,
  minutes,
  seconds,
  hasPlanted,
  hasWorked,
  process
) => {
  const time = `${minutes}m ${seconds}s`;
  const status =
    hasPlanted && hasWorked
      ? `Finished farming block ${index}, waiting for next...`
      : hasPlanted && process
      ? `Working on block ${index}...`
      : hasPlanted
      ? `Growing block ${index}...`
      : `Planting block ${index}...`;
  log(status, time);
};

// Start the farming work
export const startWork: StartWorkFn = async (
  state,
  index,
  entropy,
  timeDifference,
  plantFn
) => {
  let currentState = state.hasPlanted ? state : await plantFn(state);
  const workWaitTime = Number(Bun.env.WORK_WAIT_TIME) || 240000; // Fallback to 4 minutes
  if (
    currentState.process ||
    currentState.hasWorked ||
    timeDifference < workWaitTime
  ) {
    return currentState;
  }

  log(
    'Starting work...',
    `${currentState.minutesElapsed}m ${currentState.secondsElapsed}s`,
    `Errors: ${currentState.errorCount}`
  );

  const farmerProcess = spawn(
    [
      '../target/release/kale-farmer',
      '--farmer-hex',
      Keypair.fromPublicKey(Bun.env.FARMER_PK).rawPublicKey().toString('hex'),
      '--index',
      String(index),
      '--entropy-hex',
      entropy,
      '--nonce-count',
      String(Bun.env.NONCE_COUNT),
    ],
    () => {}
  );

  currentState = { ...currentState, process: farmerProcess };
  if (farmerProcess.stdout) {
    currentState = await handleStream(
      currentState,
      farmerProcess.stdout,
      handleWorkError
    );
  }

  return currentState;
};

// Process the output stream from the farmer process
export const handleStream: HandleStreamFn = async (
  state,
  reader,
  handleWorkErrorFn
) => {
  const output = await Bun.readableStreamToText(reader);
  if (!output) {
    log('No output from farmer process');
    return state;
  }

  await Bun.write(Bun.stdout, output);
  const lastLine = output.trim().split('\n').pop();
  if (!lastLine) return state;

  try {
    const [nonce, hash] = JSON.parse(lastLine);
    const zeroCount = hash.match(/^0*/)?.[0].length ?? 0;

    const workResult = await contract.work({
      farmer: Bun.env.FARMER_PK,
      hash: Buffer.from(hash, 'hex'),
      nonce: BigInt(nonce),
    });

    if (Api.isSimulationError(workResult.simulation!)) {
      return handleWorkErrorFn(state, workResult.simulation.error);
    }

    await send(workResult);
    log(
      'Work completed successfully',
      `Gaps: ${workResult.result} | `,
      `Zeros: ${zeroCount}`
    );
    return { ...state, hasWorked: true };
  } catch (err) {
    return state; // Ignore parsing errors, keep state unchanged
  }
};

// Handle errors from work simulation
export const handleWorkError: HandleWorkErrorFn = (state, error) => {
  if (error.includes('Error(Contract, #7)')) {
    log('Work already completed');
    return state;
  }
  logError('Work failed:', error);
  return { ...state, errorCount: state.errorCount + 1 };
};

// Plant seeds for the current block
export const plant: PlantFn = async (state) => {
  const plantResult = await contract.plant({
    farmer: Bun.env.FARMER_PK,
    amount: state.errorCount ? 0n : BigInt(Bun.env.STAKE_AMOUNT || 0),
  });

  if (Api.isSimulationError(plantResult.simulation!)) {
    return handlePlantError(state, plantResult.simulation.error);
  }

  await plantResult.signAuthEntries({
    address: Bun.env.FARMER_PK,
    signAuthEntry: farmerSigner.signAuthEntry,
  });
  await send(plantResult);
  log('Planted successfully', Number(Bun.env.STAKE_AMOUNT || 0) / 1e7);
  return { ...state, hasPlanted: true };
};

// Handle errors from planting
export const handlePlantError: HandlePlantErrorFn = (state, error) => {
  if (error.includes('Error(Contract, #8)')) {
    log('Already planted');
    return state;
  }
  logError('Planting failed:', error);
  return { ...state, errorCount: state.errorCount + 1 };
};

// Calculate time since block started
export const calculateTime: CalculateTimeFn = (block) => {
  const timestamp = block?.timestamp
    ? new Date(Number(block.timestamp * BigInt(1000)))
    : new Date(0);
  const timeDifference = Date.now() - timestamp.getTime();
  const minutesElapsed = Math.floor(timeDifference / 60000);
  const secondsElapsed = Math.floor((timeDifference % 60000) / 1000);
  return { timestamp, timeDifference, minutesElapsed, secondsElapsed };
};
