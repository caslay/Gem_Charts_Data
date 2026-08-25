const fs = require('fs');
let content = fs.readFileSync('src/app/backtest/page.tsx', 'utf8');

const regex = /const fetchBacktestTrades = useCallback\(async \(\) => \{[\s\S]*?\}, \[\]\);/;
const replacement = \const fetchBacktestTrades = useCallback(async () => {
    try {
      const localTrades = useSessionJournalStore.getState().getTradesByMode('BACKTEST');
      const localAccount = useSessionJournalStore.getState().backtestAccount;
      if (localTrades.length > 0) {
        setBacktestTrades(localTrades as unknown as TradeRecord[]);
        setBacktestAccount(localAccount as any);
      }
    } catch (err) {
      console.debug('[Backtest] Fetch trades error:', err);
    }
  }, []);\;

content = content.replace(regex, replacement);
fs.writeFileSync('src/app/backtest/page.tsx', content, 'utf8');
