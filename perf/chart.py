import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats
import os

RESULTS_CSV = "performance_results.csv"
OUTPUT_DIR = "charts"

def perform_t_test(data, use_case, test_name, concurrency):
    norm_data = data[(data['schema_type'] == 'norm') & 
                     (data['use_case'] == use_case) &
                     (data['test_name'] == test_name) &
                     (data['concurrency'] == concurrency)]
                     
    denorm_data = data[(data['schema_type'] == 'denorm') &
                       (data['use_case'] == use_case) &
                       (data['test_name'] == test_name) &
                       (data['concurrency'] == concurrency)]

    if len(norm_data) < 2 or len(denorm_data) < 2:
        return None, None

    tps_test = stats.ttest_ind(norm_data['tps'], denorm_data['tps'], equal_var=False)
    
    latency_test = stats.ttest_ind(norm_data['avg_latency_ms'], denorm_data['avg_latency_ms'], equal_var=False)
    
    return tps_test.pvalue, latency_test.pvalue


def plot_performance_graphs(data):
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    sns.set_theme(style="whitegrid")

    use_cases = data['use_case'].unique()
    test_names = data['test_name'].unique()

    summary_data = []

    for uc in use_cases:
        for tn in test_names:
            subset = data[(data['use_case'] == uc) & (data['test_name'] == tn)]
            if subset.empty:
                continue

            fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 6))
            fig.suptitle(f'Performance Comparison: {uc.title()} - {tn.title()} Workload', fontsize=16)

            sns.lineplot(data=subset, x='concurrency', y='tps', hue='schema_type', marker='o', ax=ax1, errorbar='sd')
            ax1.set_title('Throughput vs. Concurrency')
            ax1.set_xlabel('Concurrent Clients')
            ax1.set_ylabel('Transactions per Second (TPS)')
            ax1.legend(title='Schema Type')

            sns.lineplot(data=subset, x='concurrency', y='avg_latency_ms', hue='schema_type', marker='o', ax=ax2, errorbar='sd')
            ax2.set_title('Latency vs. Concurrency')
            ax2.set_xlabel('Concurrent Clients')
            ax2.set_ylabel('Average Latency (ms)')
            ax2.legend(title='Schema Type')

            plt.tight_layout(rect=[0, 0, 1, 0.96])
            plot_filename = os.path.join(OUTPUT_DIR, f"{uc}_{tn}_performance.png")
            plt.savefig(plot_filename)
            plt.close()
            print(f"Saved plot: {plot_filename}")
            
            grouped = subset.groupby(['concurrency', 'schema_type']).agg(
                mean_tps=('tps', 'mean'),
                std_tps=('tps', 'std'),
                mean_latency=('avg_latency_ms', 'mean'),
                std_latency=('avg_latency_ms', 'std')
            ).reset_index()

            for concurrency in subset['concurrency'].unique():
                 p_tps, p_latency = perform_t_test(subset, uc, tn, concurrency)
                 
                 norm_stats = grouped[(grouped['concurrency'] == concurrency) & (grouped['schema_type'] == 'norm')]
                 denorm_stats = grouped[(grouped['concurrency'] == concurrency) & (grouped['schema_type'] == 'denorm')]

                 if norm_stats.empty or denorm_stats.empty:
                     print(f"Warning: Missing data for {uc}, {tn}, concurrency={concurrency}. Skipping this combination.")
                     continue

                 summary_data.append({
                     'Use Case': uc,
                     'Test Name': tn,
                     'Concurrency': concurrency,
                     'Norm Mean TPS': norm_stats['mean_tps'].iloc[0],
                     'Norm Std TPS': norm_stats['std_tps'].iloc[0],
                     'Denorm Mean TPS': denorm_stats['mean_tps'].iloc[0],
                     'Denorm Std TPS': denorm_stats['std_tps'].iloc[0],
                     'TPS p-value': p_tps,
                     'Norm Mean Latency': norm_stats['mean_latency'].iloc[0],
                     'Norm Std Latency': norm_stats['std_latency'].iloc[0],
                     'Denorm Mean Latency': denorm_stats['mean_latency'].iloc[0],
                     'Denorm Std Latency': denorm_stats['std_latency'].iloc[0],
                     'Latency p-value': p_latency,
                 })

    summary_df = pd.DataFrame(summary_data)
    summary_filename = os.path.join(OUTPUT_DIR, "performance_summary_with_stats.csv")
    summary_df.to_csv(summary_filename, index=False)
    print(f"\nSaved summary statistics table to: {summary_filename}")


def main():
    try:
        data = pd.read_csv(RESULTS_CSV)
    except FileNotFoundError:
        print(f"Error: Results file not found at '{RESULTS_CSV}'.")
        print("Please run the 'Database Performance Test Runner' script first.")
        return

    plot_performance_graphs(data)

if __name__ == "__main__":
    main()
