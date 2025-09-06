type Factory<T> = (c: Container) => T;
type Token = string | symbol;

export class Container {
  private static instance: Container;
  private services = new Map<Token, unknown>();
  private factories = new Map<Token, Factory<unknown>>();

  static getInstance() {
    if (!Container.instance) {Container.instance = new Container();}
    return Container.instance;
  }

  register<T>(token: Token, instance: T) {
    this.services.set(token, instance);
  }

  registerFactory<T>(token: Token, factory: Factory<T>) {
    this.factories.set(token, factory);
  }

  get<T>(token: Token): T {
    if (this.services.has(token)) {return this.services.get(token) as T;}
    const factory = this.factories.get(token);
    if (!factory) {throw new Error(`Service not found: ${String(token)}`);}
    const instance = factory(this) as T;
    this.services.set(token, instance);
    return instance;
  }

  has(token: Token): boolean {
    return this.services.has(token) || this.factories.has(token);
  }
}

