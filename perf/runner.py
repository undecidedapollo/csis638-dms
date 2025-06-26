import os
import subprocess
import re
import csv
import time
from datetime import datetime
import sys

USE_CASES = ["catalog"]

CONCURRENCY_LEVELS = [1, 2, 4, 8, 16, 32, 64]

SECONDS_PER_RUN = 4

REPEAT_COUNT = 3

DOCKER_IMAGE = "postgres:17.5"
DOCKER_CONTAINER_NAME = "some-postgres"
DB_PASSWORD = "mysecretpassword"

RESULTS_CSV = "performance_results.csv"
DEBUG_CMD=False

def run_command(command, capture_output=False):
    if DEBUG_CMD:
        print(f"Executing: {' '.join(command)}")
    try:
        if capture_output:
            result = subprocess.run(command, check=True, capture_output=True, text=True)
            return result.stdout
        else:
            subprocess.run(command, check=True)
            return ""
    except subprocess.CalledProcessError as e:
        print(f"Error executing command: {' '.join(command)}")
        print(f"Stderr: {e.stderr}")
        print(f"Stdout: {e.stdout}")
        return None
    except FileNotFoundError as e:
        print(f"Error: Command not found. Is psql or docker installed and in your PATH? - {e}")
        return None


def prune_docker_volumes():
    print("--- Pruning unused Docker volumes ---")
    run_command(["docker", "volume", "prune", "-f"])


def start_postgres_container():
    print("--- Starting PostgreSQL Container ---")
    run_command(["docker", "rm", "-f", DOCKER_CONTAINER_NAME])
    run_command([
        "docker", "run", "--name", DOCKER_CONTAINER_NAME,
        "-e", f"POSTGRES_PASSWORD={DB_PASSWORD}",
        "-d", "--rm", "-p", "5432:5432",
        "--cpus=2.0", "--memory=4g", "--memory-reservation=4g",
        DOCKER_IMAGE
    ])
    print("Waiting for PostgreSQL to initialize...")
    time.sleep(1)


def setup_database(use_case, schema_type):
    print(f"--- Setting up database for {use_case} ({schema_type}) ---")
    setup_file = os.path.join( use_case, f"{schema_type}_setup.sql")
    if not os.path.exists(setup_file):
        print(f"Warning: Setup file not found, skipping: {setup_file}")
        return
    
    env = os.environ.copy()
    env["PGPASSWORD"] = DB_PASSWORD
    
    max_attempts = 5
    for attempt in range(1, max_attempts + 1):
        try:
            subprocess.run(["psql", "-h", "localhost", "-U", "postgres", "-f", setup_file], env=env, check=True)
            if attempt > 1:
                print(f"Database setup succeeded on attempt {attempt}")
            return
        except subprocess.CalledProcessError as e:
            if attempt < max_attempts:
                print(f"Database setup attempt {attempt} failed, retrying in 0.2 seconds...")
                time.sleep(0.2)
            else:
                print(f"Database setup failed after {max_attempts} attempts")
                raise

def parse_pgbench_output(output):
    tps_match = re.search(r"tps = ([\d\.]+) \(without initial connection time\)", output)
    if not tps_match:
        tps_match = re.search(r"tps = ([\d\.]+) \(including connections establishing\)", output)
    
    latency_match = re.search(r"latency average = ([\d\.]+) ms", output)
    
    tps = float(tps_match.group(1)) if tps_match else None
    latency = float(latency_match.group(1)) if latency_match else None
    
    return tps, latency

def run_pgbench_test(use_case, schema_type, test_name, concurrency):
    print(f"--- Running pgbench: {use_case}/{test_name}, concurrency={concurrency} ---")
    test_file = os.path.join(use_case, f"{schema_type}_{test_name}.sql")
    if not os.path.exists(test_file):
        print(f"Warning: Test file not found, skipping: {test_file}")
        return None, None

    command = [
        "pgbench", "-h", "localhost", "-U", "postgres",
        "-n",
        "-c", str(concurrency),
        "-j", str(concurrency),
        "-T", str(SECONDS_PER_RUN),
        "-f", test_file
    ]
    
    env = os.environ.copy()
    env["PGPASSWORD"] = DB_PASSWORD

    try:
        result = subprocess.run(command, check=False, capture_output=True, text=True, env=env)
        return parse_pgbench_output(result.stdout)
    except subprocess.CalledProcessError as e:
        print(f"Error running pgbench for {test_file}")
        print(f"Stderr: {e.stderr}")
        return None, None


def get_completed_tests():
    completed_tests = set()
    
    if not os.path.isfile(RESULTS_CSV):
        return completed_tests
    
    try:
        with open(RESULTS_CSV, 'r', newline='') as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if len(row) >= 6:
                    test_key = (row[1], row[2], row[3], int(row[4]), int(row[5]))
                    completed_tests.add(test_key)
        
        print(f"Found {len(completed_tests)} already completed test combinations")
    except Exception as e:
        print(f"Error reading existing results file: {e}")
        print("Continuing with empty completed tests set")
    
    return completed_tests

def main():
    prune_docker_volumes()
    
    completed_tests = get_completed_tests()
    
    file_exists = os.path.isfile(RESULTS_CSV)
    with open(RESULTS_CSV, 'a', newline='') as f:
        writer = csv.writer(f)
        if not file_exists:
            writer.writerow([
                "timestamp", "use_case", "schema_type", "test_name",
                "concurrency", "run_number", "tps", "avg_latency_ms"
            ])
        
        iteration_count = 0
        skipped_count = 0
        
        for use_case in USE_CASES:
            print(f"\n{'='*20} STARTING USE CASE: {use_case.upper()} {'='*20}")
            
            use_case_dir = os.path.join(use_case)
            files = [f for f in os.listdir(use_case_dir) if f.endswith('.sql')]
            test_names = sorted(list(set(
                f.replace("denorm_", "").replace("norm_", "").replace(".sql", "")
                for f in files if "setup" not in f and "plan" not in f
            )))
            
            print(f"Found test workloads: {test_names}")

            for i in range(1, REPEAT_COUNT + 1):
                for concurrency in CONCURRENCY_LEVELS:
                    for test_name in test_names:
                        for schema_type in ["norm", "denorm"]:
                            test_key = (use_case, schema_type, test_name, concurrency, i)
                            if test_key in completed_tests:
                                print(f"\n--- SKIPPING Test Run {i}/{REPEAT_COUNT} for {use_case}/{schema_type}/{test_name} @ C{concurrency} (already completed) ---")
                                skipped_count += 1
                                continue
                                
                            print(f"\n--- Test Run {i}/{REPEAT_COUNT} for {use_case}/{schema_type}/{test_name} @ C{concurrency} ---")
                            
                            iteration_count += 1
                            
                            if iteration_count % 10 == 0:
                                prune_docker_volumes()
                            
                            start_postgres_container()
                            setup_database(use_case, schema_type)
                            tps, latency = run_pgbench_test(use_case, schema_type, test_name, concurrency)

                            if tps is not None and latency is not None:
                                timestamp = datetime.now().isoformat()
                                writer.writerow([
                                    timestamp, use_case, schema_type, test_name,
                                    concurrency, i, tps, latency
                                ])
                                f.flush()
                                completed_tests.add(test_key)
                            else:
                                print("Skipping result due to error in test run.")
        
        print(f"\nSkipped {skipped_count} already completed test combinations")

    print("\nAll tests completed. Results saved to performance_results.csv")
    print(f"Total tests run: {iteration_count}, Total tests skipped: {skipped_count}")

if __name__ == "__main__":
    main()
