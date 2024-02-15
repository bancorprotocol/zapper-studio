import { Module } from '@nestjs/common';

import { AbstractApp } from '~app/app.dynamic-module';

import { CarbonDefiViemContractFactory } from './contracts';
import { EthereumCarbonDefiStrategyContractPositionFetcher } from './ethereum/carbon-defi.strategy.contract-position-fetcher';

@Module({
  providers: [CarbonDefiViemContractFactory, EthereumCarbonDefiStrategyContractPositionFetcher],
})
export class CarbonDefiAppModule extends AbstractApp() { }
