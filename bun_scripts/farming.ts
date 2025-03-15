import { contract, getContractData, send, spawn, log, logError, exit, farmerSigner } from './utils';
import { Keypair } from '@stellar/stellar-sdk/minimal';
import { Api } from '@stellar/stellar-sdk/minimal/rpc';

export const runCycle: RunCycleFn = async (state: FarmerState): Promise<FarmerState> => {
  const maxErrorLimit = Number(Bun.env.MAX_ERROR_LIMIT) || 12;
  if (state.errorCount > maxErrorLimit) {
    log('Too many errors, shutting down');
    exit(1);
    return state;
  }

  const shouldFetch = state.isFirstRun || state.minutesElapsed >= 5;
  if (!state.isFirstRun && shouldFetch) log('Checking for a new block...');
  const contractData = shouldFetch ? await getContractData() : state.contractData;
  const { index, block, pail } = contractData;
  const entropy = block?.entropy?.toString('hex') ?? Buffer.alloc(32).toString('hex');
  const { timestamp, timeDifference, minutesElapsed, secondsElapsed } = calculateTime(block);

  const updatedState = { ...state, contractData, timestamp, timeDifference, minutesElapsed, secondsElapsed };

  if (index !== state.previousIndex) {
    log(state.isFirstRun ? `Starting KALE farming with ${Bun.env.FARMER_PK}` : 'Found a new block of KALE seeds!');
    
    log('Block Info:', index,
      {
        maxGap: block?.max_gap,
        maxZeros: block?.max_zeros,
        minGap: block?.min_gap,
        minStake: block?.min_stake,
        minZeros: block?.min_zeros,
      },
      entropy,
      state.timestamp);
      
    state.process?.kill();

    const newState: FarmerState = {
      ...updatedState,
      process: undefined,
      previousIndex: index,
      hasPlanted: !!(pail?.sequence || pail?.stake),
      hasWorked: !!(pail?.gap || pail?.zeros),
      errorCount: 0,
      isFirstRun: false,
    };

    if (!state.isFirstRun) {
      setTimeout(() => spawn(['bun', 'harvest.ts'], (msg)=>log(msg)), Number(Bun.env.HARVEST_DELAY_MS) || 60000);
    }
    return newState;
  }

  log(
    updatedState.hasPlanted && updatedState.hasWorked
      ? `Finished farming block ${index}, waiting for next...`
      : updatedState.hasPlanted && updatedState.process
      ? `Working on block ${index}...`
      : updatedState.hasPlanted
      ? `Growing block ${index}...`
      : `Planting block ${index}...`,
      `${minutesElapsed}m ${secondsElapsed}s `
  );

  if (!updatedState.isBooting && !updatedState.process && (!updatedState.hasPlanted || !updatedState.hasWorked)) {
    return startWork(updatedState, index, entropy, timeDifference);
  }
  return updatedState;
};

const startWork: StartWorkFn = async (
  state: FarmerState,
  index: number,
  entropy: string,
  timeDifference: number
): Promise<FarmerState> => {
  let currentState = state.hasPlanted ? state : await plant(state);
  const workWaitTime = Number(Bun.env.WORK_WAIT_TIME_MS) || 240000;
  if (currentState.process || currentState.hasWorked || timeDifference <= workWaitTime) return currentState;

  log('Starting work...', `${currentState.minutesElapsed}m ${currentState.secondsElapsed}s`, `Errors: ${currentState.errorCount}`);
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
    log
  );

  currentState = { ...currentState, process: farmerProcess };
  if (farmerProcess.stdout) {
    const output = await Bun.readableStreamToText(farmerProcess.stdout);
    if (output) {
      await Bun.write(Bun.stdout, output);
      const lastLine = output.trim().split('\n').pop();
      if (lastLine) {
        try {
          const [nonce, hash] = JSON.parse(lastLine);
          const zeroCount = hash.match(/^0*/)?.[0].length ?? 0;
          const workResult = await contract.work({ farmer: Bun.env.FARMER_PK, hash: Buffer.from(hash, 'hex'), nonce: BigInt(nonce) });

          if (Api.isSimulationError(workResult.simulation)) {
            return handleError(currentState, workResult.simulation.error, 'Work failed');
          }

          await send(workResult);
          log('Work completed successfully', `[Gaps: ${workResult.result} | Zeros: ${zeroCount}]`);
          return { ...currentState, hasWorked: true };
        } catch (err) {
          return handleError(state, JSON.stringify(err), 'Error Handling Stream')
        }
      }
    }
  }
  return currentState;
};

const plant: PlantFn = async (state: FarmerState): Promise<FarmerState> => {
  const plantResult = await contract.plant({
    farmer: Bun.env.FARMER_PK,
    amount: state.errorCount ? 0n : BigInt(Bun.env.STAKE_AMOUNT || 0),
  });

  if (Api.isSimulationError(plantResult.simulation)) {
    return handleError(state, plantResult.simulation.error, 'Planting failed');
  }

  await plantResult.signAuthEntries({ address: Bun.env.FARMER_PK, signAuthEntry: farmerSigner.signAuthEntry });
  try {
    await send(plantResult);
    log('Planted successfully', Number(Bun.env.STAKE_AMOUNT || 0) / 1e7);
    return { ...state, hasPlanted: true };
  } catch (err) {
    return handleError(state, JSON.stringify(err), 'Planting failed');
  }
};

const handleError: HandleErrorFn = (state: FarmerState, error: string, prefix: string): FarmerState => {
  if (error.includes('Error(Contract, #8)') || error.includes('Error(Contract, #7)')) {
    log(error.includes('Error(Contract, #8)') ? 'Already planted' : 'Work already completed');
    return { ...state, hasPlanted: error.includes('Error(Contract, #8)') };
  }
  logError(`${prefix}:`, error);
  return { ...state, errorCount: state.errorCount + 1 };
};

const calculateTime: CalculateTimeFn = (block): ReturnType<CalculateTimeFn> => {
  const timestamp = block?.timestamp ? new Date(Number(block.timestamp * BigInt(1000))) : new Date(0);
  const timeDifference = Date.now() - timestamp.getTime();
  return {
    timestamp,
    timeDifference,
    minutesElapsed: Math.floor(timeDifference / 60000),
    secondsElapsed: Math.floor((timeDifference % 60000) / 1000),
  };
};