import { Address, Keypair, scValToNative, xdr } from "@stellar/stellar-sdk/minimal";
import { AssembledTransaction, basicNodeSigner } from "@stellar/stellar-sdk/minimal/contract";
import type { Tx } from "@stellar/stellar-sdk/minimal/contract";
import { Durability, Server } from "@stellar/stellar-sdk/minimal/rpc";
import { Client } from 'kale-sc-sdk';
import { version } from './package.json';

const INDEX_filename = `.INDEX.${Bun.env.ENV}.${Bun.env.CONTRACT_ID}`;

export interface Block {
    timestamp?: bigint,
    min_gap: number,
    min_stake: bigint,
    min_zeros: number,
    max_gap: number,
    max_stake: bigint,
    max_zeros: number,
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

export const rpc = new Server(Bun.env.RPC_URL);
export const farmerSigner = basicNodeSigner(Keypair.fromSecret(Bun.env.FARMER_SK), Bun.env.NETWORK_PASSPHRASE)

export const contract = new Client({
    rpcUrl: Bun.env.RPC_URL,
    contractId: Bun.env.CONTRACT_ID,
    networkPassphrase: Bun.env.NETWORK_PASSPHRASE,
})

export async function send<T>(txn: AssembledTransaction<T> | Tx | string, fee?: number) {
    const data = new FormData();

    if (txn instanceof AssembledTransaction) {
        txn = txn.built!.toXDR()
    } else if (typeof txn !== 'string') {
        txn = txn.toXDR()
    }

    data.set('xdr', txn);

    if (fee)
        data.set('fee', fee.toString());

    return fetch(Bun.env.LAUNCHTUBE_URL, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${Bun.env.LAUNCHTUBE_JWT}`,
            'X-Client-Name': 'rust-kale-farmer',
            'X-Client-Version': version
        },
        body: data
    }).then(async (res) => {
        if (res.ok)
            return res.json()
        else throw await res.text()
    })
}

export async function getIndex() {
    let index: number = 0;

    await rpc.getContractData(
        Bun.env.CONTRACT_ID,
        xdr.ScVal.scvLedgerKeyContractInstance()
    ).then(({ val }) =>
        val.contractData()
            .val()
            .instance()
            .storage()
    ).then((storage) => {
        return storage?.map((entry) => {
            const key: string = scValToNative(entry.key())[0]

            if (key === 'FarmIndex') {
                index = entry.val().u32()
            }

            // if (key === 'FarmBlock') {
            //     console.log(
            //         'FarmBlock',
            //         scValToNative(entry.val())
            //     );
            // }
        })
    })

    return index;
}

export async function getBlock(index: number) {
    let block: Block | undefined;

    await rpc.getContractData(Bun.env.CONTRACT_ID, xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Block'),
        xdr.ScVal.scvU32(Number(index))
    ]), Durability.Temporary)
        .then((res) => {
            // console.log(
            //     // res.val.toXDR('base64')

            //     // 'Block key size', val.contractData().key().toXDR().length,
            //     // 'Block val size', val.contractData().val().toXDR().length

            //     // 'Key size', res.key.toXDR().length,
            //     // 'Val size', res.val.toXDR().length,

            //     res.key.contractData().key().toXDR().length,
            //     res.val.contractData().val().toXDR().length,
            //     // res.val.contractData().key().toXDR().length,
            //     // res.val.contractData().val().toXDR().length,
            // );

            block = scValToNative(res.val.contractData().val())
        })

    return block
}

export async function getPail(index: number) {
    let pail: Pail | undefined;

    await rpc.getContractData(Bun.env.CONTRACT_ID, xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol('Pail'),
        Address.fromString(Bun.env.FARMER_PK).toScVal(),
        xdr.ScVal.scvU32(Number(index))
    ]), Durability.Temporary)
        .then(({ val }) => {
            pail = scValToNative(val.contractData().val())
        })

    return pail
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

    return { index, block, pail }
}

export async function readINDEX() {
    const file = Bun.file(INDEX_filename)

    if (await file.exists()) {
        return file.text().then((index) => Number(index ?? 0));
    } else {
        return 0;
    }
}

export async function writeINDEX(index: number) {
    return Bun.write(INDEX_filename, index.toString());
}