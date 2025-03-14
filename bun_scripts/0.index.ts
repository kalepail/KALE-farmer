import { Address } from '@stellar/stellar-sdk';

const miner = Address.fromString(
  'GDTLBABZ4NHAXUJAT2HIIQ52UDEBXXZLGB5QILBTCMSKEQENRM6PRIZ5'
)
  .toScVal()
  .toXDR()
  .toJSON().data;
const entropy = Buffer.from(
  'AAAAwnpgwov7BoA88GL3ZcglWKYWcocWvQGq3YsEpSA=',
  'base64'
).toJSON().data;

console.log(`
    [${miner}],
    [${entropy}]
`);
