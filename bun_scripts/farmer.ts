import { initialState } from './state';
import { runCycle } from './farming';
import { log } from './utils';

// Start the farming loop
const startFarming: StartFarmingFn = (state) => {
  let currentState = state;
  const farmingLoop = async () => {
    currentState = await runCycle(currentState);
    const checkEveryMs = Number(Bun.env.CHECK_EVERY_MS) || 5000; // Fallback to 5s
    setTimeout(farmingLoop, checkEveryMs);
  };
  void farmingLoop();
};

// Begin farming
startFarming(initialState);
