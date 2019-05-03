/// <reference types="@vechain/connex" />
import { SolidoSigner } from '@decent-bet/solido';
export declare class ConnexSigner implements SolidoSigner {
    private signingService;
    payload: any;
    constructor(signingService: Connex.Vendor.TxSigningService, payload: any);
    requestSigning(): Promise<any>;
}
