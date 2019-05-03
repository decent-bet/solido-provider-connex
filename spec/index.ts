import { SolidoModule } from '@decent-bet/solido';
import { ConnexPlugin } from '../src';
import { EnergyTokenContract, EnergyContractImport } from './EnergyContract';
// Create Solido Module
export const module = new SolidoModule([
    {
        name: 'ConnexToken',
        import: EnergyContractImport,
        entity: EnergyTokenContract,
        provider: ConnexPlugin
    },
]);
