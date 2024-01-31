import { Inject } from '@nestjs/common';
import { BigNumberish } from 'ethers';
import { sumBy } from 'lodash';

import { APP_TOOLKIT, IAppToolkit } from '~app-toolkit/app-toolkit.interface';
import { ETH_ADDR_ALIAS, ZERO_ADDRESS } from '~app-toolkit/constants/address';
import { PositionTemplate } from '~app-toolkit/decorators/position-template.decorator';
import { drillBalance } from '~app-toolkit/helpers/drill-balance.helper';
import { ContractPositionBalance, RawContractPositionBalance } from '~position/position-balance.interface';
import { MetaType } from '~position/position.interface';
import {
  DefaultContractPositionDefinition,
  UnderlyingTokenDefinition,
  GetTokenDefinitionsParams,
  GetDisplayPropsParams,
  GetDataPropsParams,
} from '~position/template/contract-position.template.types';
import { CustomContractPositionTemplatePositionFetcher } from '~position/template/custom-contract-position.template.position-fetcher';
import { Network } from '~types';

import { CarbonDefiViemContractFactory } from '../contracts';
import { CarbonController } from '../contracts/viem/CarbonController';

interface Order {
  y: bigint;
  z: bigint;
  A: bigint;
  B: bigint;
}

interface Strategy {
  id: bigint;
  owner: string;
  tokens: readonly [string, string];
  orders: readonly [Order, Order];
}

interface StrategyDefinition extends DefaultContractPositionDefinition {
  strategy: Strategy;
}

type StrategyProps = {
  strategy: Strategy;
};

function isActiveStrategy(strategy: Strategy) {
  const [buy, sell] = strategy.orders;
  return !!buy.A || !!buy.B || !!sell.A || !!sell.B;
}

@PositionTemplate()
export class EthereumCarbonDefiStrategyContractPositionFetcher extends CustomContractPositionTemplatePositionFetcher<
  CarbonController,
  StrategyProps,
  StrategyDefinition
> {
  groupLabel = 'Carbon Defi';

  constructor(
    @Inject(APP_TOOLKIT) protected readonly appToolkit: IAppToolkit,
    @Inject(CarbonDefiViemContractFactory) protected readonly factory: CarbonDefiViemContractFactory,
  ) {
    super(appToolkit);
  }

  getContract() {
    return this.factory.carbonController({
      address: '0xc537e898cd774e2dcba3b14ea6f34c93d5ea45e1',
      network: Network.ETHEREUM_MAINNET,
    });
  }

  override async getDataProps(params: GetDataPropsParams<CarbonController, StrategyProps, StrategyDefinition>) {
    return { strategy: params.definition.strategy };
  }

  async getLabel(params: GetDisplayPropsParams<CarbonController>): Promise<string> {
    const tokens = params.contractPosition.tokens;
    return `${tokens[0].symbol} / ${tokens[1].symbol}`;
  }

  async getDefinitions(): Promise<StrategyDefinition[]> {
    const contract = this.getContract();
    const address = contract.address;
    const pairs = await contract.read.pairs();
    const getStrategies = pairs.map(pair => contract.read.strategiesByPair([...pair, BigInt(0), BigInt(0)]));
    const strategies = await Promise.all(getStrategies).then(matrix => matrix.flat());
    return strategies.filter(isActiveStrategy).map(strategy => ({ address, strategy: strategy }));
  }

  async getTokenDefinitions(
    params: GetTokenDefinitionsParams<CarbonController, StrategyDefinition>,
  ): Promise<UnderlyingTokenDefinition[] | null> {
    return params.definition.strategy.tokens.map(address => ({
      address: address.toLowerCase().replace(ETH_ADDR_ALIAS, ZERO_ADDRESS),
      metaType: MetaType.SUPPLIED,
      network: this.network,
    }));
  }

  async getBalances(address: string): Promise<ContractPositionBalance<StrategyProps>[]> {
    if (address === ZERO_ADDRESS) return [];

    const positions = await this.getPositions();
    const balances: ContractPositionBalance<StrategyProps>[] = [];
    for (const position of positions) {
      const { owner, orders } = position.dataProps.strategy;
      if (owner.toLowerCase() !== address.toLowerCase()) continue;
      const tokens = [
        drillBalance(position.tokens[0], orders[0].y.toString() ?? '0'),
        drillBalance(position.tokens[1], orders[1].y.toString() ?? '0'),
      ];
      balances.push({
        ...position,
        balanceUSD: sumBy(tokens, t => t.balanceUSD),
        tokens,
      });
    }
    return balances;
  }

  async getRawBalances(address: string): Promise<RawContractPositionBalance[]> {
    if (address === ZERO_ADDRESS) return [];

    const positions = await this.getPositions();
    const balances: RawContractPositionBalance[] = [];
    for (const position of positions) {
      const { owner, orders } = position.dataProps.strategy;
      if (owner.toLowerCase() !== address.toLowerCase()) continue;
      balances.push({
        key: this.appToolkit.getPositionKey(position),
        tokens: [
          {
            key: this.appToolkit.getPositionKey(position.tokens[0]),
            balance: orders[0].y.toString(),
          },
          {
            key: this.appToolkit.getPositionKey(position.tokens[1]),
            balance: orders[1].y.toString(),
          },
        ],
      });
    }
    return balances;
  }

  // Unused since CustomContractPositionTemplatePositionFetcher forces Promise output while it can be sync
  async getTokenBalancesPerPosition(): Promise<BigNumberish[]> {
    return [];
  }
}
