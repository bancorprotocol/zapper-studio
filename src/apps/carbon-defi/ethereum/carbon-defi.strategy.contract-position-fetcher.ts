import { Inject, NotImplementedException } from '@nestjs/common';
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

type StrategyDefinition = DefaultContractPositionDefinition & {
  /** Used to generate the key, and to keep the strategy id around */
  positionKey: bigint;
  owner: string;
  tokens: readonly [string, string];
};
type StrategyProps = {
  positionKey: bigint;
  owner: string;
};

function isActiveStrategy([buy, sell]: readonly [Order, Order]) {
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

  override async getDataProps(params) {
    const { owner, positionKey } = params.definition;
    return { owner, positionKey };
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
    const definitions: StrategyDefinition[] = [];
    for (const { id, owner, tokens, orders } of strategies) {
      if (!isActiveStrategy(orders)) continue;
      definitions.push({ address, positionKey: id, owner, tokens });
    }
    return definitions;
  }

  async getTokenDefinitions(
    params: GetTokenDefinitionsParams<CarbonController, StrategyDefinition>,
  ): Promise<UnderlyingTokenDefinition[] | null> {
    return params.definition.tokens.map(address => ({
      address: address.toLowerCase().replace(ETH_ADDR_ALIAS, ZERO_ADDRESS),
      metaType: MetaType.SUPPLIED,
      network: this.network,
    }));
  }

  async getBalances(address: string): Promise<ContractPositionBalance<StrategyProps>[]> {
    if (address === ZERO_ADDRESS) return [];
    const controller = this.getContract();
    const positions = await this.appToolkit.getAppContractPositions<StrategyDefinition>({
      appId: this.appId,
      network: this.network,
      groupIds: [this.groupId],
    });
    const ownedPositions = positions.filter(position => {
      return position.dataProps.owner.toLowerCase() === address.toLowerCase();
    });

    const getAllBalances = ownedPositions.map(async position => {
      const { orders } = await controller.read.strategy([position.dataProps.positionKey]);
      const tokens = [
        drillBalance(position.tokens[0], orders[0].y.toString() ?? '0'),
        drillBalance(position.tokens[1], orders[1].y.toString() ?? '0'),
      ];
      return {
        ...position,
        balanceUSD: sumBy(tokens, t => t.balanceUSD),
        tokens,
      };
    });
    return Promise.all(getAllBalances);
  }

  async getRawBalances(address: string): Promise<RawContractPositionBalance[]> {
    if (address === ZERO_ADDRESS) return [];
    const controller = this.getContract();
    const positions = await this.appToolkit.getAppContractPositions<StrategyDefinition>({
      appId: this.appId,
      network: this.network,
      groupIds: [this.groupId],
    });
    const ownedPositions = positions.filter(position => {
      return position.dataProps.owner.toLowerCase() === address.toLowerCase();
    });

    const getAllBalances = ownedPositions.map(async position => {
      const { orders } = await controller.read.strategy([position.dataProps.positionKey]);
      return {
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
      };
    });
    return Promise.all(getAllBalances);
  }

  // Unused since CustomContractPositionTemplatePositionFetcher forces Promise output while it can be sync
  getTokenBalancesPerPosition(): never {
    throw new NotImplementedException();
  }
}
