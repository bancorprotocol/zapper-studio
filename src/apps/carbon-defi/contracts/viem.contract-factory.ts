import { Injectable, Inject } from '@nestjs/common';

import { IAppToolkit, APP_TOOLKIT } from '~app-toolkit/app-toolkit.interface';
import { Network } from '~types/network.interface';

import { CarbonController__factory, Voucher__factory } from './viem';

type ContractOpts = { address: string; network: Network; };

@Injectable()
export class CarbonDefiViemContractFactory {
  constructor(@Inject(APP_TOOLKIT) protected readonly appToolkit: IAppToolkit) { }

  carbonController({ address, network }: ContractOpts) {
    return CarbonController__factory.connect(address, this.appToolkit.getViemNetworkProvider(network));
  }
  voucher({ address, network }: ContractOpts) {
    return Voucher__factory.connect(address, this.appToolkit.getViemNetworkProvider(network));
  }
}
