import { Inject } from '@nestjs/common';
import { BigNumberish } from 'ethers';
import { sumBy } from 'lodash';

import { APP_TOOLKIT, IAppToolkit } from '~app-toolkit/app-toolkit.interface';
import { ETH_ADDR_ALIAS, ZERO_ADDRESS } from '~app-toolkit/constants/address';
import { PositionTemplate } from '~app-toolkit/decorators/position-template.decorator';
import { drillBalance } from '~app-toolkit/helpers/drill-balance.helper';
import { ContractPositionBalance } from '~position/position-balance.interface';
import { ContractPosition, MetaType } from '~position/position.interface';
import { ContractPositionTemplatePositionFetcher } from '~position/template/contract-position.template.position-fetcher';
import {
  DefaultContractPositionDefinition,
  UnderlyingTokenDefinition,
  GetTokenBalancesParams,
  GetTokenDefinitionsParams,
  GetDisplayPropsParams,
  GetDataPropsParams,
} from '~position/template/contract-position.template.types';

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
export class EthereumCarbonDefiStrategyContractPositionFetcher extends ContractPositionTemplatePositionFetcher<
  CarbonController,
  StrategyProps,
  StrategyDefinition
> {
  groupId = 'strategy';
  groupLabel = 'Carbon Defi';

  constructor(
    @Inject(APP_TOOLKIT) protected readonly appToolkit: IAppToolkit,
    @Inject(CarbonDefiViemContractFactory) protected readonly factory: CarbonDefiViemContractFactory,
  ) {
    super(appToolkit);
  }

  getContract() {
    return this.factory.carbonController();
  }

  override async getDataProps(params: GetDataPropsParams<CarbonController, StrategyProps, StrategyDefinition>) {
    return { strategy: params.definition.strategy };
  }

  override async filterPositionsForAddress(
    address: string,
    positions: ContractPosition<StrategyProps>[],
  ): Promise<ContractPosition<StrategyProps>[]> {
    return positions.filter(position => {
      const owner = position.dataProps.strategy.owner;
      return owner.toLowerCase() === address.toLowerCase();
    });
  }

  // Override the getBalance query to keep token with budget set to 0
  override async getBalances(address: string): Promise<ContractPositionBalance<StrategyProps>[]> {
    const multicall = this.appToolkit.getViemMulticall(this.network);
    if (address === ZERO_ADDRESS) return [];

    const contractPositions = await this.getPositionsForBalances();
    const filteredPositions = await this.filterPositionsForAddress(address, contractPositions);

    const balances = await Promise.all(
      filteredPositions.map(async contractPosition => {
        const contract = multicall.wrap(this.getContract());
        const balancesRaw = await this.getTokenBalancesPerPosition({ address, contract, contractPosition, multicall });
        const tokens = contractPosition.tokens.map((cp, idx) =>
          drillBalance(cp, balancesRaw[idx]?.toString() ?? '0', { isDebt: cp.metaType === MetaType.BORROWED }),
        );
        return {
          ...contractPosition,
          balanceUSD: sumBy(tokens, t => t.balanceUSD),
          tokens,
        };
      }),
    );

    return balances;
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

  async getTokenBalancesPerPosition(
    params: GetTokenBalancesParams<CarbonController, StrategyProps>,
  ): Promise<BigNumberish[]> {
    const strategy = params.contractPosition.dataProps.strategy;
    const [buy, sell] = strategy.orders;
    return [buy.y, sell.y];
  }
}
