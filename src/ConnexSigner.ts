import { SolidoSigner } from '@decent-bet/solido';
import { AskSigning } from './ConnexPlugin';

export class ConnexSigner implements SolidoSigner {
    constructor(private signingService: Connex.Vendor.TxSigningService, public payload: any, public askSigner: AskSigning) { }

    async requestSigning() {
        if (await this.askSigner(this.payload)) {
            return this.signingService.request([
                {
                    ...(this.payload as any)
                }
            ]);
        }
    }
}
