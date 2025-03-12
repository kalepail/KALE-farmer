# `KALE` Farmer

### Step 1: Install Rust

> https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup

### Step 2: Run `make build`

### Step 3: Install Bun

> https://bun.sh

### Step 4: Run `bun install`

### Step 5: Run `bun run farm`

---

_Optional if you want to contribute to the project_

### Install the Stellar CLI

> https://developers.stellar.org/docs/build/smart-contracts/getting-started/setup

### Add a `mainnet` network to the Stellar CLI

```bash
stellar network add mainnet \
    --rpc-url "https://mainnet.sorobanrpc.com" \
    --network-passphrase "Public Global Stellar Network ; September 2015" \
    --global
```

### Build the `kale-sc-sdk`

```bash
make bindings-mainnet

# 1. this builds `kale-sc-sdk__raw`
# 2. copy `./bun_scripts/kale-sc-sdk__raw/src/index.ts` to `./bun_scripts/kale-sc-sdk/src/index.ts`
```

> Once you've done steps 1 and 2 above

```bash
cd ./bun_scripts/kale-sc-sdk
bun run build
cd ..
bun install --force
```
