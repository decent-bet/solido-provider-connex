// eslint-disable-next-line spaced-comment
/// <reference types="@vechain/connex" />

import { abi } from 'thor-devkit';
import {
  IMethodOrEventCall,
  EventFilter,
  SolidoProviderType,
  ProviderInstance,
  IMethodConfig
} from '@decent-bet/solido';
import { ConnexSigner } from './ConnexSigner';
import { ConnexSettings } from './ConnexSettings';
import { SolidoContract, SolidoSigner } from '@decent-bet/solido';
import { SolidoProvider } from '@decent-bet/solido';
import { SolidoTopic } from '@decent-bet/solido';
import { Observable, Subject, from } from 'rxjs';
import { switchMap, tap, pluck } from 'rxjs/operators';
import { blockConfirmationUntil } from './operators';

export interface MapAction {
  [key: string]: {
    getter: string,
    onFilter: string,
    mutation: (data: { e: Array<any>, contract: ConnexPlugin }) => Observable<object>
  };
}

export interface ReactiveContractStore {
  mapActions?: MapAction,
  state: object;
}


/**
 * ConnexPlugin provider for Solido
 */

export class ConnexPlugin extends SolidoProvider implements SolidoContract {
  public connex: Connex;
  public chainTag: string;
  public defaultAccount: string;
  public address: string;
  private store: ReactiveContractStore = {
    mapActions: {},
    state: {}
  };
  private _subscriber: Subject<object>;

  public describe(): string {
    return `
    contract address: ${this.address}\r\n
    chain tag: ${this.chainTag}\r\n
    owner: ${this.defaultAccount}\r\n    
    `;
  }
  public getProviderType(): SolidoProviderType {
    return SolidoProviderType.Connex;
  }

  public async prepareSigning(
    methodCall: any,
    options: IMethodOrEventCall,
    args: any[]
  ): Promise<SolidoSigner> {
    const connex = this.connex;
    const signingService = connex.vendor.sign('tx');
    signingService.signer(options.from || this.defaultAccount);
    signingService.gas(options.gas || 300_000); // Set maximum gas

    const payload = methodCall.asClause(...args);

    let onMapAction = (res) => { };
    const mapActionName = (<any>options).dispatch;
    const mapAction = this.store.mapActions[mapActionName];

    if (mapAction) {
      onMapAction = async ({ txid }) => {
        await blockConfirmationUntil(txid);

        try {
          const mutateRes = await mapAction.mutation({
            contract: this,
            e: [...args],
          }).toPromise();
          this._subscriber.next({
            ...this.store.state,
            [mapAction.getter]: mutateRes,
          });
        } catch (e) {
          console.log('mutation error');
        }
      }
    }

    const signer = new ConnexSigner(signingService, payload);
    const res = await signer.requestSigning();
    await onMapAction(res);
    return res;
  }

  subscribe(key: string, fn: any) {
    if (Object.keys(this.store.state).find(i => i === key)) {
      return this._subscriber.pipe(pluck(key)).subscribe(fn);
    }
  }

  public createGasExplainer(methodCall: any) {
    return (...args: any[]) => {
      return (config: IMethodConfig = {}) => {
        const explainer = this.connex.thor.explain();
        explainer.gas(config.gas || 300_000).caller(config.from || this.defaultAccount);

        const payload = methodCall.asClause(...args);

        return explainer.execute([payload]);
      };
    };
  }

  public onReady<T>(settings: T & ConnexSettings): void {
    const { store, connex, chainTag, defaultAccount } = settings;
    this.connex = connex;
    this.chainTag = chainTag;
    this.defaultAccount = defaultAccount;
    this.store = store;
    this.connect();
  }

  public connect() {
    if (this.store) {
      this._subscriber = new Subject();
      this._subscriber.subscribe((state) => {
        this.store.state = state;
      });
    }
    if (this.connex && this.chainTag && this.defaultAccount) {
      this.address = this.contractImport.address[this.chainTag];
    } else {
      throw new Error('Missing onReady settings');
    }
  }

  public setInstanceOptions(settings: ProviderInstance) {
    this.connex = settings.provider;
    if (settings.options.chainTag) {
      this.chainTag = settings.options.chainTag;
    }
    if (settings.options.defaultAccount) {
      this.defaultAccount = settings.options.defaultAccount;
    }
    if (settings.options.store) {
      this._subscriber = new Subject();
      this.store = settings.options.store;
    }
  }

  public getAbiMethod(name: string, address?: string): object {
    let addr;
    if (!address) {
      addr = this.contractImport.address[this.chainTag];
    }
    return this.abi.filter(i => i.name === name)[0];
  }

  /**
   * Gets a Connex Method object
   * @param address contract address
   * @param methodAbi method ABI
   */
  public getMethod(name: string, address?: string): any {
    let addr;
    addr = this.contractImport.address[this.chainTag];
    const acc = this.connex.thor.account(addr);
    let methodAbi: any = name;
    if (typeof name === 'string') {
      methodAbi = this.abi.filter(
        i => i.name === name
      )[0] as abi.Function.Definition;
    }

    const connexMethod = acc.method(methodAbi as object);
    const gasExplainer = this.createGasExplainer(connexMethod);
    return Object.assign({}, connexMethod, { gasExplainer });
  }

  public callMethod(name: string, args: any[]): any {
    let addr = this.contractImport.address[this.chainTag];
    const acc = this.connex.thor.account(addr);
    let methodAbi: any = name;
    if (typeof name === 'string') {
      methodAbi = this.abi.filter(
        i => i.name === name
      )[0] as abi.Function.Definition;
    }
    return acc.method(methodAbi as object).call(...args);
  }
  /**
   * Gets a Connex Event object
   * @param address contract address
   * @param eventAbi event ABI
   */
  public getEvent(name: string): any {
    let addr = this.contractImport.address[this.chainTag];
    const acc = this.connex.thor.account(addr);

    let eventAbi: any;
    if (typeof name === 'string') {
      eventAbi = this.abi.filter(
        i => i.name === name
      )[0] as abi.Event.Definition;
    }
    return acc.event(eventAbi as any);
  }

  public async getEvents<P, T>(
    name: string,
    eventFilter?: EventFilter<T & object[]>
  ): Promise<(P & Connex.Thor.Event)[]> {
    const event: Connex.Thor.EventVisitor = this.getEvent(name);

    // default page options
    let offset = 0;
    let limit = 25;

    if (eventFilter) {
      const { range, filter, order, pageOptions, topics } = eventFilter;
      let connexFilter: Connex.Thor.Filter<'event'> = event.filter(
        filter || []
      );

      if (topics) {
        let criteria = (topics as SolidoTopic).get();
        connexFilter = connexFilter.criteria(criteria);
      }

      if (range) {
        const { unit, to, from } = range;
        connexFilter = connexFilter.range({
          unit,
          from,
          to
        });
      }

      connexFilter = connexFilter.order(order || 'desc');

      if (pageOptions) {
        offset = pageOptions.offset;
        limit = pageOptions.limit;
      }
      return (await connexFilter.apply(offset, limit)) as (P &
        Connex.Thor.Event)[];
    }

    return (await event.filter([]).apply(offset, limit)) as (P &
      Connex.Thor.Event)[];
  }
}
