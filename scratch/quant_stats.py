# -*- coding: utf-8 -*-
"""
Flow-State Quant Engine - Statsmodels Diagnostic Suite (V1.0)
Strictly adheres to the Naked Data Rule (directives/03_quant_logic.md)
"""

import os
import sys
import numpy as np
import pandas as pd
import statsmodels.api as sm
import statsmodels.formula.api as smf
from statsmodels.discrete.discrete_model import Logit
from statsmodels.stats.diagnostic import het_breuschpagan, acorr_ljungbox
from statsmodels.stats.outliers_influence import variance_inflation_factor

# Force standard UTF-8 encoding for standard outputs if supported
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')


def generate_synthetic_ipda_data(n_samples=500):
    """
    Generates synthetic historical order flow and price data mimicking the 
    structure returned by the Next.js 'GET Market Data API Handler' (V8.2 payload).
    Used to demonstrate the statsmodels capabilities on our IPDA parameters.
    """
    np.random.seed(42)
    
    # 1. Base variables representing institutional delivery
    taker_buy_vol = np.random.gamma(shape=2, scale=1000, size=n_samples)
    taker_sell_vol = np.random.gamma(shape=2, scale=1000, size=n_samples)
    volume = taker_buy_vol + taker_sell_vol
    volume_delta = taker_buy_vol - taker_sell_vol
    
    # Anomaly Multiplier (Displacement engine metric)
    avg_vol_14 = pd.Series(volume).rolling(window=14, min_periods=1).mean().values
    anomaly_multiplier = volume / (avg_vol_14 + 1e-5)
    
    # Open Interest (OI) Momentum
    open_interest = 10_000_000 + np.cumsum(np.random.normal(5000, 50000, n_samples))
    oi_change = np.diff(np.insert(open_interest, 0, open_interest[0]))
    oi_momentum = oi_change / open_interest
    
    # Session hour (Cairo UTC+3 / NY Midnight anchor)
    hour = np.random.randint(0, 24, size=n_samples)
    is_killzone = np.isin(hour, [3, 4, 5, 6, 9, 10, 11, 15, 16, 17, 20, 21]).astype(int)
    is_dead_zone = np.isin(hour, [12, 13, 14]).astype(int)
    
    # Premium vs Discount state (1 = Premium, 0 = Discount)
    premium_pricing = np.random.choice([0, 1], size=n_samples, p=[0.5, 0.5])
    
    # FVG Formation probability influenced by displacement (volume anomaly) and killzones
    fvg_prob = 1 / (1 + np.exp(-(0.8 * anomaly_multiplier + 1.2 * is_killzone - 2.5)))
    fvg_formed = np.random.binomial(1, fvg_prob)
    
    # 2. Outcomes
    # Subsequent returns (1-period forward return)
    # Institutional sponsorship (displacement) + volume delta drives subsequent price return
    future_return = (0.0005 * volume_delta / 1000) + (0.001 * anomaly_multiplier * (1 - is_dead_zone)) + np.random.normal(0, 0.002, n_samples)
    
    # Successful Market Structure Shift (MSS)
    # Success is highly dependent on active sponsorship (displacement), OI momentum, and killzone execution
    mss_success_prob = 1 / (1 + np.exp(-(1.5 * anomaly_multiplier + 2.0 * oi_momentum * 100 + 1.0 * is_killzone - 2.5)))
    mss_success = np.random.binomial(1, mss_success_prob)
    
    df = pd.DataFrame({
        'taker_buy_vol': taker_buy_vol,
        'taker_sell_vol': taker_sell_vol,
        'volume': volume,
        'volume_delta': volume_delta,
        'anomaly_multiplier': anomaly_multiplier,
        'oi_momentum': oi_momentum,
        'hour': hour,
        'is_killzone': is_killzone,
        'is_dead_zone': is_dead_zone,
        'premium_pricing': premium_pricing,
        'fvg_formed': fvg_formed,
        'future_return': future_return,
        'mss_success': mss_success
    })
    
    return df


def run_ols_displacement_analysis(df):
    """
    1. LINEAR REGRESSION (OLS)
    Tests whether the Volume Anomaly Multiplier (sponsorship) and Volume Delta
    have a statistically significant relationship with forward price returns.
    """
    print("\n" + "="*80)
    print("1. LINEAR REGRESSION (OLS): MODELING PRICE DISPLACEMENT RETURNS")
    print("="*80)
    
    # Prepare features and target
    model = smf.ols('future_return ~ anomaly_multiplier + volume_delta + is_dead_zone', data=df)
    results = model.fit()
    
    print(results.summary())
    
    # Diagnostics: Test for Heteroskedasticity (Breusch-Pagan)
    X_design = sm.add_constant(df[['anomaly_multiplier', 'volume_delta', 'is_dead_zone']])
    bp_test = het_breuschpagan(results.resid, X_design)
    print("\n--- Model Diagnostics ---")
    print(f"Breusch-Pagan Heteroskedasticity p-value: {bp_test[1]:.6f}")
    if bp_test[1] < 0.05:
        print("[!] HETEROSKEDASTICITY DETECTED: Standard errors might be biased!")
        print("--> Refitting model with Heteroskedasticity-Consistent Standard Errors (HC3)...")
        robust_results = model.fit(cov_type='HC3')
        print(robust_results.summary())
    else:
        print("[+] No significant heteroskedasticity detected.")
        
    return results


def run_logit_mss_success(df):
    """
    2. DISCRETE CHOICE MODEL (LOGISTIC REGRESSION)
    Predicts the likelihood of a successful Market Structure Shift (MSS) based on:
    - anomaly_multiplier (sponsorship)
    - oi_momentum (Open Interest change)
    - is_killzone (Time window alignment)
    """
    print("\n" + "="*80)
    print("2. LOGISTIC REGRESSION (LOGIT): MSS SUCCESS PROBABILITY")
    print("="*80)
    
    # Model specification
    model = smf.logit('mss_success ~ anomaly_multiplier + oi_momentum + is_killzone', data=df)
    results = model.fit()
    
    print(results.summary())
    
    # Interpret Odds Ratios
    odds_ratios = np.exp(results.params)
    print("\n--- Algorithmic Odds Ratios ---")
    for idx, val in odds_ratios.items():
        if idx == 'Intercept':
            continue
        print(f"--> {idx}: {val:.4f}x increase in MSS success probability per unit change")
        
    # Marginal Effects
    margeff = results.get_margeff()
    print("\n--- Average Marginal Effects ---")
    print(margeff.summary())
    
    return results


def run_glm_fvg_frequency(df):
    """
    3. GENERALIZED LINEAR MODEL (GLM) - POISSON / NEGATIVE BINOMIAL
    Models the frequency of Fair Value Gap (FVG) formation.
    Since FVG formation is a binary event per candle, count aggregation over 
    sessions is usually Poisson. Here we run a GLM with a Binomial/Poisson family.
    """
    print("\n" + "="*80)
    print("3. GLM (BINOMIAL): PREDICTING FVG FORMATION DYNAMICS")
    print("="*80)
    
    # Using Logistic Link function via Binomial Family
    model = smf.glm('fvg_formed ~ anomaly_multiplier + is_killzone + is_dead_zone', 
                    data=df, 
                    family=sm.families.Binomial())
    results = model.fit()
    
    print(results.summary())
    
    # Check dispersion / goodness of fit
    pearson_chi2 = results.pearson_chi2
    df_resid = results.df_resid
    dispersion = pearson_chi2 / df_resid
    print(f"\nDispersion Ratio: {dispersion:.4f}")
    
    return results


def main():
    print("="*80)
    print("  FLOW-STATE QUANT ENGINE - STATSMODELS CORE DIAGNOSTIC RUNNER  ")
    print("="*80)
    
    # Generate mock IPDA dataset
    df = generate_synthetic_ipda_data(n_samples=1000)
    
    # Save dataset temporarily to review
    os.makedirs('scratch', exist_ok=True)
    df.to_csv('scratch/synthetic_ipda_metrics.csv', index=False)
    print(f"[+] Generated 1,000 algorithmic candles and saved to: 'scratch/synthetic_ipda_metrics.csv'")
    
    # Run the models
    run_ols_displacement_analysis(df)
    run_logit_mss_success(df)
    run_glm_fvg_frequency(df)


if __name__ == '__main__':
    main()
