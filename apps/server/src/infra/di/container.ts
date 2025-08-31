type Factory<T> = (c: Container) => T;

export class Container {
  private static instance: Container;
  private services = new Map<string, any>();
  private factories = new Map<string, Factory<any>>();

  static getInstance() {
    if (!Container.instance) Container.instance = new Container();
    return Container.instance;
  }

  register<T>(token: string, instance: T) {
    this.services.set(token, instance);
  }

  registerFactory<T>(token: string, factory: Factory<T>) {
    this.factories.set(token, factory);
  }

  get<T>(token: string): T {
    if (this.services.has(token)) return this.services.get(token);
    const factory = this.factories.get(token);
    if (!factory) throw new Error(`Service not found: ${token}`);
    const instance = factory(this);
    this.services.set(token, instance);
    return instance;
  }
}


