import * as dotenv from "dotenv";
dotenv.config();

import { Api } from "@stellar/stellar-sdk/minimal/rpc";
import { contract, getIndex, readINDEX, send, sleep, writeINDEX } from "./utils.ts";

// TODO no need to harvest something A) we cannot harvest (too soon) or B) we've already harvested
    
let index = await getIndex() - 1; // Current index will never be able to be harvested
let START_INDEX = index;

await runHarvest(index, START_INDEX);
await writeINDEX(index);

async function runHarvest(index: number, START_INDEX: number) {
    console.log('Harvesting', index);

    const at = await contract.harvest({
        farmer: process.env.FARMER_PK!,
        index
    });

    if (Api.isSimulationError(at.simulation!)) {
        // Don't log the error if...
        if (!(
            at.simulation.error.includes('Error(Contract, #9)') // PailMissing
            || at.simulation.error.includes('Error(Contract, #10)') // WorkMissing
            || at.simulation.error.includes('Error(Contract, #11)') // BlockMissing
            || at.simulation.error.includes('Error(Contract, #14)') // HarvestNotReady
        )) {
            console.error('Harvest Error:', at.simulation.error);
        }
    } else {
        // NOTE this shouldn't be happening much, at all? anymore
        // A stroop is a really small amount and seems like we should be able to get it way before zero if we're doing any work at all
        if (at.result === BigInt(0)) {
            console.log('No reward to harvest', index);
            return;
        }

        await send(at);

        const reward = Number(at.result) / 1e7;

        console.log('Successfully harvested', index, reward);
    }

    index--;

    // 24 hours of 5 minute blocks
    if (
        index >= 0 // nothing negative 
        && index >= await readINDEX() - 6 // always 30 minutes
        && index >= START_INDEX - 288 // default 24 hours
    ) {
        await sleep(500);
        return runHarvest(index, START_INDEX);
    }
}