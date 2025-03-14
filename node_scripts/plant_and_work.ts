import * as dotenv from "dotenv";
dotenv.config();

import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { contract, farmerSigner, getContractData, send, type Block, type Pail } from './utils.ts';
import { Keypair } from '@stellar/stellar-sdk/minimal';
import { Api } from '@stellar/stellar-sdk/minimal/rpc';
import type Stream from "stream";

let contractData: { index: number, block: Block | undefined, pail: Pail | undefined };
let proc: ChildProcess | undefined;
let prev_index: number | undefined;
let planting = false;
let booting = false;
let planted = false;
let worked = false;
let errors = 0;

contractData = await getContractData();
run();

setInterval(async () => {
    contractData = await getContractData();
    run();
}, 5000);

async function run() {
    if (errors > 12) {
        console.log('Too many errors, exiting');
        process.exit(1);
    }

    let { index } = contractData;
    const { block, pail } = contractData;
    const entropy = block?.entropy ? block.entropy.toString('hex') : Buffer.alloc(32).toString('hex');
    const timestamp = block?.timestamp ? new Date(Number(block.timestamp * BigInt(1000))) : new Date(0);
    const timeDiff = new Date().getTime() - timestamp.getTime();

    if (index !== prev_index) {
        delete block?.timestamp;
        delete block?.entropy;
        delete block?.normalized_total;
        delete block?.staked_total;
        console.log(index, block, entropy, timestamp);

        if (proc) {
            proc.kill();
            proc = undefined;
        }

        prev_index = index;
        planted = !!pail?.sequence || !!pail?.stake;
        worked = !!pail?.gap || !!pail?.zeros;
        errors = 0;

        spawn('node', ["--import", "./loader.mjs", "harvest.ts"], {
            stdio: ['ignore', 'inherit', 'inherit'],
            env: process.env
        })
    } else {
        const minutes = Math.floor(timeDiff / 60000);
        const seconds = Math.floor((timeDiff % 60000) / 1000);

        console.log('Running...', `${minutes}m ${seconds}s`);
    }

    if (!booting && !proc && (!planted || !worked)) {
        try {
            booting = true;
            await bootProc(index, entropy, timeDiff);
        } catch (err) {
            console.error('Boot Error:', err);
            errors++;
        } finally {
            booting = false;
        }
    }
}

async function bootProc(index: number, entropy: string, timeDiff: number) {
    if (!planted) {
        await plant();
    }

    if (proc || worked || timeDiff < 200000) // don't work till >= 4 minutes after block open
        return;

    console.log('Booting...', errors);

    proc = spawn(
        path.resolve('../target/release/kale-farmer'),
        [
            '--farmer-hex', Keypair.fromPublicKey(process.env.FARMER_PK!).rawPublicKey().toString('hex'),
            '--index', index.toString(),
            '--entropy-hex', entropy,
            '--nonce-count', process.env.NONCE_COUNT!.toString(),
        ],
        { stdio: ['ignore', 'pipe', 'inherit'] }
    );

    if (proc) {
        console.log('Proc booted');
        await readStream(proc.stdout!);
    }
}

async function readStream(readable: Stream.Readable) {
    const chunks: any[] = [];

    readable.on('readable', () => {
        let chunk;
        
        while (null !== (chunk = readable.read())) {
            chunks.push(chunk);
        }
    });

    readable.on('end', async () => {
        const value = chunks.join('');
        
        if (!value) {
            console.log('NO VALUE');
            return;
        }

        console.log(value);

        try {
            const lastLine = Buffer.from(value).toString('utf-8').trim().split('\n').pop();
            const [nonce, hash] = JSON.parse(lastLine!);
            let countZeros = 0;

            for (const char of hash) {
                if (char === '0') {
                    countZeros++;
                } else {
                    break;
                }
            }

            const at = await contract.work({
                farmer: process.env.FARMER_PK!,
                hash: Buffer.from(hash, 'hex'),
                nonce: BigInt(nonce),
            })

            if (Api.isSimulationError(at.simulation!)) {
                if (at.simulation.error.includes('Error(Contract, #7)')) {
                    console.log('Already worked');
                } else {
                    console.error('Work Error:', at.simulation.error);
                    errors++
                    return;
                }
            } else {
                await send(at)
                console.log('Successfully worked', at.result, countZeros);
            }

            worked = true;
        } catch { }
    });
}

async function plant() {
    // TODO more dynamic stake amount
    const at = await contract.plant({
        farmer: process.env.FARMER_PK!,
        amount: errors ? 0n : BigInt(process.env.STAKE_AMOUNT || '0') // don't stake if there are errors
    });

    if (Api.isSimulationError(at.simulation!)) {
        if (at.simulation.error.includes('Error(Contract, #8)')) {
            console.log('Already planted');
        } else {
            console.error('Plant Error:', at.simulation.error);
            errors++;
            return;
        }
    } else {
        await at.signAuthEntries({
            address: process.env.FARMER_PK!,
            signAuthEntry: farmerSigner.signAuthEntry
        });

        await send(at);

        console.log('Successfully planted', Number(process.env.STAKE_AMOUNT || '0') / 1e7);
    }

    planted = true;
}