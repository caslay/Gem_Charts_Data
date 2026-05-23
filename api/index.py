# -*- coding: utf-8 -*-
"""
Flow-State Quant Engine - FastAPI Microservice (V1.0)
Exposes statsmodels OLS displacement validation endpoint.
Strictly adheres to the Naked Data Rule (directives/03_quant_logic.md)
"""

import sys
import numpy as np
import pandas as pd
import statsmodels.api as sm
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional

# Force UTF-8 standard output to avoid Windows console errors
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

app = FastAPI(
    title="Flow-State Quant Engine API",
    description="FastAPI statsmodels OLS wrapper for institutional displacement validation.",
    version="1.0.0"
)

# Enable CORS for Next.js backend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CandleInput(BaseModel):
    t: int = Field(..., description="Unix timestamp in milliseconds")
    o: float = Field(..., description="Open price")
    h: float = Field(..., description="High price")
    l: float = Field(..., description="Low price")
    c: float = Field(..., description="Close price")
    v: Optional[float] = Field(None, description="Total volume")
    taker_buy_vol: float = Field(..., description="Taker buy volume")
    taker_sell_vol: float = Field(..., description="Taker sell volume")


class DisplacementResponse(BaseModel):
    status: str = Field(..., description="ACTIVE_BULLISH, ACTIVE_BEARISH, or INACTIVE")
    anomaly_multiplier: float = Field(..., description="Displacement anomaly ratio")
    volume_delta: float = Field(..., description="Volume difference")
    statistical_validation: dict = Field(..., description="OLS statistical t-statistic and p-value validation")


@app.post("/api/py/calculate-displacement", response_model=DisplacementResponse)
@app.post("/api/index", response_model=DisplacementResponse)
async def calculate_displacement(candles: List[CandleInput], symbol: Optional[str] = None):
    """
    POST endpoint to ingest formatted market candles, perform statsmodels OLS regression,
    and returns a statistically validated InstitutionalSponsorship signature.
    """
    n_candles = len(candles)
    if n_candles < 16:
        raise HTTPException(
            status_code=400,
            detail="Insufficient candle history. Minimum 16 candles required for rolling indicators."
        )

    # 1. Convert inputs to Pandas DataFrame
    data = []
    for c in candles:
        data.append({
            't': c.t,
            'o': c.o,
            'h': c.h,
            'l': c.l,
            'c': c.c,
            'v': c.v if c.v is not None else (c.taker_buy_vol + c.taker_sell_vol),
            'taker_buy_vol': c.taker_buy_vol,
            'taker_sell_vol': c.taker_sell_vol
        })
    df = pd.DataFrame(data)

    # 2. Compute Quant Indicators
    df['volume_delta'] = df['taker_buy_vol'] - df['taker_sell_vol']
    df['rolling_vol_14'] = df['v'].rolling(window=14, min_periods=1).mean()
    df['anomaly_multiplier'] = df['v'] / (df['rolling_vol_14'] + 1e-5)
    
    # Hour extraction using UTC+3 offset Egypt timezone baked in Next.js
    df['hour'] = pd.to_datetime(df['t'], unit='ms').dt.hour
    df['is_dead_zone'] = df['hour'].isin([12, 13, 14]).astype(int)
    
    # Forward 1-candle return for OLS target
    df['future_return'] = df['c'].pct_change(fill_method=None).shift(-1)

    # 3. Volatility Filter Check (Price Range < 0.1% is CONSOLIDATION)
    price_min = df['l'].min()
    price_max = df['h'].max()
    volatility_range = (price_max - price_min) / (price_min + 1e-9)
    is_consolidation = bool(volatility_range < 0.001)

    # 4. Fit Statsmodels OLS model to validate the statistical significance of anomaly_multiplier
    # Drop first 14 elements (rolling warmup) and the last element (current incomplete future return)
    reg_df = df.iloc[14:-1].dropna(subset=['future_return', 'anomaly_multiplier', 'volume_delta', 'is_dead_zone'])
    
    t_statistic = 0.0
    p_value = 1.0
    confidence_interval_95 = "CONSOLIDATION" if is_consolidation else False
    confidence_level = "LOW"

    if is_consolidation:
        t_statistic = 0.0
        p_value = 1.0
        confidence_level = "LOW"
    elif len(reg_df) >= 10:
        try:
            X = reg_df[['anomaly_multiplier', 'volume_delta', 'is_dead_zone']]
            X = sm.add_constant(X, has_constant='add')
            y = reg_df['future_return']
            
            model = sm.OLS(y, X)
            results = model.fit()
            
            t_statistic = float(results.tvalues.get('anomaly_multiplier', 0.0))
            p_value = float(results.pvalues.get('anomaly_multiplier', 1.0))
            
            if p_value < 0.05:
                confidence_level = "HIGH"
            elif p_value < 0.15:
                confidence_level = "MEDIUM"
            else:
                confidence_level = "LOW"
                
            # Backward compatibility: Confidence Interval validation: p-value < 0.15 and t_statistic > 1.96
            confidence_interval_95 = bool(p_value < 0.15 and t_statistic > 1.96)
        except Exception as e:
            # Handle collinearity/singular matrix errors gracefully in low-volatility situations
            pass

    # 5. Compute latest closed candle sponsorship status (index N-2)
    latest_closed = df.iloc[-2]
    prior_14 = df.iloc[-16:-2]

    avg_buy_vol = prior_14['taker_buy_vol'].mean()
    avg_sell_vol = prior_14['taker_sell_vol'].mean()

    latest_buy_vol = latest_closed['taker_buy_vol']
    latest_sell_vol = latest_closed['taker_sell_vol']
    
    is_bullish = latest_closed['c'] > latest_closed['o']
    is_bearish = latest_closed['c'] < latest_closed['o']

    status = 'CONSOLIDATION' if is_consolidation else 'INACTIVE'
    anomaly_multiplier_val = 0.0
    volume_delta_val = float(round(latest_buy_vol - latest_sell_vol, 2))

    # Dynamic multiplier: Calibrated to 2.0 for ETH due to higher 5m liquidity concentration
    is_eth = symbol is not None and "ETH" in symbol.upper()
    vol_multiplier = 2.0 if is_eth else 2.5

    if not is_consolidation:
        if is_bullish and latest_buy_vol > (avg_buy_vol * vol_multiplier) and avg_buy_vol > 0:
            status = 'ACTIVE_BULLISH'
            anomaly_multiplier_val = float(round(latest_buy_vol / avg_buy_vol, 2))
        elif is_bearish and latest_sell_vol > (avg_sell_vol * vol_multiplier) and avg_sell_vol > 0:
            status = 'ACTIVE_BEARISH'
            anomaly_multiplier_val = float(round(latest_sell_vol / avg_sell_vol, 2))

    # Fallback to prevent invalid division in statsmodels values
    if np.isnan(t_statistic) or np.isinf(t_statistic):
        t_statistic = 0.0
    if np.isnan(p_value) or np.isinf(p_value):
        p_value = 1.0
        confidence_level = "LOW"

    return DisplacementResponse(
        status=status,
        anomaly_multiplier=anomaly_multiplier_val,
        volume_delta=volume_delta_val,
        statistical_validation={
            "t_statistic": float(round(t_statistic, 4)),
            "p_value": float(round(p_value, 4)),
            "confidence_level": confidence_level,
            "confidence_interval_95": confidence_interval_95
        }
    )


if __name__ == "__main__":
    import uvicorn
    # Standard startup on port 8000
    uvicorn.run(app, host="127.0.0.1", port=8000)
