import { readTradingFxCatalog } from './trading-fx-catalog.mjs';
import { TRADING_FX_MIGRATIONS } from './trading-fx-migrations.mjs';
import { runReviewedMigrationTransaction } from './reviewed-migration-transaction.mjs';

export function runTradingFxTransaction(input) {
  return runReviewedMigrationTransaction(input, {
    reviewedMigrations: TRADING_FX_MIGRATIONS, readCatalog: readTradingFxCatalog, errorPrefix: 'TRADING_FX',
  });
}
