use clap::Parser;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use tiny_keccak::{Hasher, Keccak};

const BATCH_SIZE: usize = 50_000;
const BATCH_SIZE_U64: u64 = BATCH_SIZE as u64;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Args {
    /// Block index
    #[arg(short, long)]
    index: u32,

    /// Previous block hash (hex string)
    #[arg(short, long)]
    entropy: String,

    /// Number of leading zeros required
    #[arg(short, long)]
    min_zeros: u32,
}

#[inline(always)]
fn check_difficulty(hash: &[u8], difficulty: u32) -> bool {
    let first_bytes = u128::from_be_bytes(hash[0..16].try_into().unwrap());
    first_bytes.leading_zeros() >= difficulty * 4
}

fn main() {
    let counter = Arc::new(AtomicU64::new(0));

    let args = Args::parse();

    let index = args.index;
    let entropy: [u8; 32] = hex::decode(args.entropy).unwrap().try_into().unwrap();
    let min_zeros = args.min_zeros;

    let num_threads = num_cpus::get() - 2;

    let mut handles = vec![];

    let mut hash_array = [0; 84];

    // TODO miner arg needs to be dynamic

    let miner = [
        230, 176, 128, 57, 227, 78, 11, 209, 32, 158, 142, 132, 67, 186, 160, 200, 27, 223, 43, 48,
        123, 4, 44, 51, 19, 36, 162, 64, 141, 139, 60, 248,
    ];

    hash_array[..4].copy_from_slice(&index.to_be_bytes());
    hash_array[20..20 + 32].copy_from_slice(&entropy);
    hash_array[52..].copy_from_slice(&miner);

    // Spawn worker threads
    for thread_nonce in 0..num_threads {
        let counter = counter.clone();
        let handle = thread::spawn(move || {
            let mut hash = [0u8; 32];
            let mut nonce = thread_nonce;

            loop {
                // Process entire batch
                for _ in 0..BATCH_SIZE {
                    hash_array[4..4 + 16].copy_from_slice(&(nonce as u128).to_be_bytes());

                    let mut keccak = Keccak::v256();
                    keccak.update(&hash_array);
                    keccak.finalize(&mut hash);

                    if check_difficulty(&hash, min_zeros) {
                        println!("[{}, \"{}\"]", nonce, hex::encode(hash));
                        counter.fetch_add(1, Ordering::Relaxed); // Count the final hash
                        std::process::exit(0);
                    }

                    nonce += num_threads;
                }

                // Update counter with batch size after processing
                counter.fetch_add(BATCH_SIZE_U64, Ordering::Relaxed);
            }
        });

        handles.push(handle);
    }

    // Monitor hashrate
    let report_thread = thread::spawn({
        let counter = counter.clone();

        move || {
            let mut last_counter = 0u64;
            let mut last_time = Instant::now();

            loop {
                thread::sleep(Duration::from_secs(2));

                let current = counter.load(Ordering::Relaxed);
                let elapsed = last_time.elapsed().as_secs_f64();
                let hashes = (current - last_counter) as f64;

                // Convert to MH/s
                let hashrate = hashes / elapsed / 1_000_000.0;

                println!("Hashrate: {:.2} MH/s", hashrate);

                last_counter = current;
                last_time = Instant::now();
            }
        }
    });

    // Wait for solution
    for handle in handles {
        handle.join().unwrap();
    }

    report_thread.join().unwrap();
}