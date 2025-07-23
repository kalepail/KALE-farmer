import { xdr } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";

const kaleContract = 'CC4BOYZHXNBMT75SLTZX6BG4JDP5S2HGF45SDKBORNMFALHLNPMGQ5UV'

const rpc = new Server('https://rpc-futurenet.stellar.org')

const data = await rpc.getContractData(kaleContract, xdr.ScVal.scvLedgerKeyContractInstance())

console.log(data.key.toXDR('base64'))