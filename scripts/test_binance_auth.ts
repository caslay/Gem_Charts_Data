import crypto from 'crypto';

async function testBinanceAuth() {
  console.log(`\n===============================================================`);
  console.log(` 🔑 TESTING BINANCE FUTURES API REST AUTHENTICATION`);
  console.log(`===============================================================\n`);

  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;
  const baseUrl = process.env.BINANCE_BASE_URL || 'https://fapi.binance.com';

  if (!apiKey || !apiSecret) {
    console.error('❌ BINANCE_API_KEY or BINANCE_API_SECRET is missing from environment.');
    process.exit(1);
  }

  console.log(`📡 Base URL: ${baseUrl}`);
  console.log(`🔑 API Key:  ${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 6)}`);

  const timestamp = Date.now();
  const queryString = `timestamp=${timestamp}&recvWindow=10000`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(queryString)
    .digest('hex');

  const endpoint = `${baseUrl}/fapi/v2/account?${queryString}&signature=${signature}`;

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error(`❌ Binance Auth FAILED with HTTP ${response.status}:`, data);
      process.exit(1);
    }

    console.log(`✅ [PASS] Binance Futures Account Authenticated Successfully!`);
    console.log(`   • Can Trade:           ${data.canTrade ? '✅ YES' : '❌ NO'}`);
    console.log(`   • Can Deposit:         ${data.canDeposit ? '✅ YES' : '❌ NO'}`);
    console.log(`   • Can Withdraw:        ${data.canWithdraw ? '⚠️ YES' : '✅ NO (Strictly Disabled as Recommended)'}`);
    console.log(`   • Fee Tier:            ${data.feeTier}`);
    console.log(`   • Total Wallet Balance: $${parseFloat(data.totalWalletBalance || '0').toFixed(2)} USD`);
    console.log(`   • Total Unrealized PnL: $${parseFloat(data.totalUnrealizedProfit || '0').toFixed(2)} USD`);

    // Filter non-zero assets
    const activeAssets = (data.assets || []).filter((a: any) => parseFloat(a.walletBalance) > 0);
    if (activeAssets.length > 0) {
      console.log(`\n💼 Active Assets:`);
      for (const asset of activeAssets) {
        console.log(`   - ${asset.asset}: ${parseFloat(asset.walletBalance).toFixed(4)} (Available: ${parseFloat(asset.availableBalance).toFixed(4)})`);
      }
    }

    console.log(`\n===============================================================`);
    console.log(` 🎉 BINANCE FUTURES API AUTHENTICATION FULLY VERIFIED!`);
    console.log(`===============================================================\n`);
  } catch (err: any) {
    console.error('❌ Network / Request Error:', err.message || err);
    process.exit(1);
  }
}

testBinanceAuth();
