import { Injectable, Inject } from '@nestjs/common';

import { IAppToolkit, APP_TOOLKIT } from '~app-toolkit/app-toolkit.interface';
import { Network } from '~types/network.interface';

import { CarbonController__factory, Voucher__factory } from './viem';

@Injectable()
export class CarbonDefiViemContractFactory {
  constructor(@Inject(APP_TOOLKIT) protected readonly appToolkit: IAppToolkit) { }

  carbonController() {
    const address = '0xc537e898cd774e2dcba3b14ea6f34c93d5ea45e1';
    const network = Network.ETHEREUM_MAINNET;
    return CarbonController__factory.connect(address, this.appToolkit.getViemNetworkProvider(network));
  }
  voucher() {
    const address = '0x3660f04b79751e31128f6378eac70807e38f554e';
    const network = Network.ETHEREUM_MAINNET;
    return Voucher__factory.connect(address, this.appToolkit.getViemNetworkProvider(network));
  }
}
