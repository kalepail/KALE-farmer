import * as dotenv from "dotenv";
dotenv.config();

import * as fs from 'fs/promises';
import { Address, Keypair, scValToNative, xdr } from "@stellar/stellar-sdk/minimal";
import { AssembledTransaction, basicNodeSigner } from "@stellar/stellar-sdk/minimal/contract";
import type { Tx } from "@stellar/stellar-sdk/minimal/contract";
import { Durability, Server } from "@stellar/stellar-sdk/minimal/rpc";
import { Client } from 'kale-sc-sdk';

const { version } = JSON.parse(
  await fs.readFile(new URL("./package.json", import.meta.url), "utf8")
);

const INDEX_filename = process.env.ENV === 'mainnet' ? '.INDEX' : '.INDEX.testnet';

export interface Block {
    timestamp?: bigint,
    min_gap: bigint,
    min_stake: bigint,
    min_zeros: bigint,
    max_gap: bigint,
    max_stake: bigint,
    max_zeros: bigint,
    entropy?: Buffer,
    staked_total?: bigint,
    normalized_total?: bigint,
}

export interface Pail {
    sequence: bigint,
    gap: bigint | undefined,
    stake: bigint,
    zeros: bigint | undefined,
}

export const rpc = new Server(process.env.RPC_URL!);
export const farmerSigner = basicNodeSigner(Keypair.fromSecret(process.env.FARMER_SK!), process.env.NETWORK_PASSPHRASE!);

export const contract = new Client({
    rpcUrl: process.env.RPC_URL!,
    contractId: process.env.CONTRACT_ID!,
    networkPassphrase: process.env.NETWORK_PASSPHRASE!,
});

export function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)) };

export async function send<T>(txn: AssembledTransaction<T> | Tx | string, fee?: number) {
    const formData = new FormData();

    if (txn instanceof AssembledTransaction) {
        txn = txn.built!.toXDR();
    } else if (typeof txn !== 'string') {
        txn = txn.toXDR();
    }

    formData.append('xdr', txn);

    if (fee) {
        formData.append('fee', fee.toString());
    }

    const response = await fetch(process.env.LAUNCHTUBE_URL!, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${process.env.LAUNCHTUBE_JWT!}`,
            'X-Client-Name': 'rust-kale-farmer',
            'X-Client-Version': version
        },
        body: formData
    });

    if (response.ok) {
        return response.json();
    } else {
        throw await response.text();
    }
}

export async function getIndex() {
    let index: number = 0;

    await rpc.getContractData(
        process.env.CONTRACT_ID!,
        xdr.ScVal.scvLedgerKeyContractInstance()
    ).then(({ val }) =>
        val.contractData()
            .val()
            .instance()
            .storage()
    ).then((storage) => {
        return storage?.map((entry) => {
            const key: string = scValToNative(entry.key())[0];

            if (key === 'FarmIndex') {
                index = entry.val().u32();
            }
        });
    });

    return index;
}

export async function getBlock(index: number) {
    let block: Block | undefined;

    await rpc.getContractData(process.env.CONTRACT_ID!, xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Block'),
        xdr.ScVal.scvU32(Number(index))
    ]), Durability.Temporary)
        .then(({ val }) => {
            block = scValToNative(val.contractData().val());
        });

    return block;
}

export async function getPail(index: number) {
    let pail: Pail | undefined;

    await rpc.getContractData(process.env.CONTRACT_ID!, xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Pail'),
        Address.fromString(process.env.FARMER_PK!).toScVal(),
        xdr.ScVal.scvU32(Number(index))
    ]), Durability.Temporary)
        .then(({ val }) => {
            pail = scValToNative(val.contractData().val());
        });

    return pail;
}

export async function getContractData() {
    let index: number = 0;
    let block: Block | undefined;
    let pail: Pail | undefined;

    try {
        index = await getIndex();
        block = await getBlock(index);
        pail = await getPail(index);
    } catch { }

    return { index, block, pail };
}

export async function readINDEX() {
    try {
        const data = await fs.readFile(INDEX_filename, { encoding: 'utf-8' });
        return Number(data ?? 0);
    } catch {
        return 0;
    }
}

export async function writeINDEX(index: number) {
    return fs.writeFile(INDEX_filename, index.toString(), { encoding: 'utf-8' });
}