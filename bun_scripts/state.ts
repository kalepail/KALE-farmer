import type { FarmerState } from './types';

// Initial state for the farmer
export const initialState: FarmerState = {
  contractData: { index: 0, block: undefined, pail: undefined },
  process: undefined,
  previousIndex: undefined,
  isBooting: false,
  hasPlanted: false,
  hasWorked: false,
  errorCount: 0,
  isFirstRun: true,
  timestamp: new Date(0),
  timeDifference: 0,
  minutesElapsed: 0,
  secondsElapsed: 0,
};
