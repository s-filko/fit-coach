import 'reflect-metadata';

export const INJECT_METADATA_KEY = Symbol('INJECT_METADATA_KEY');
export const INJECTABLE_METADATA_KEY = Symbol('INJECTABLE_METADATA_KEY');

export function Injectable() {
  return function (target: any) {
    console.log(`Making ${target.name} injectable`);
    Reflect.defineMetadata(INJECTABLE_METADATA_KEY, true, target);
    return target;
  };
}

export function Inject(token: string): ParameterDecorator {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    console.log(`Injecting ${token} into ${target.name} at parameter ${parameterIndex}`);
    Reflect.defineMetadata(INJECT_METADATA_KEY, token, target, `param:${parameterIndex}`);
    return target;
  };
}

export class Container {
  private static instance: Container;
  private services: Map<string, any> = new Map();
  private factories: Map<string, (container: Container) => any> = new Map();

  private constructor() {}

  static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  register(token: string, instance: any) {
    console.log(`Registering service: ${token}`);
    this.services.set(token, instance);
  }

  registerFactory(token: string, factory: (container: Container) => any) {
    console.log(`Registering factory for: ${token}`);
    this.factories.set(token, factory);
  }

  get<T>(token: string): T {
    console.log(`Getting service: ${token}`);
    
    // Check if service exists
    if (this.services.has(token)) {
      return this.services.get(token);
    }

    // Check if factory exists
    if (this.factories.has(token)) {
      const factory = this.factories.get(token)!;
      const instance = factory(this);
      this.services.set(token, instance);
      return instance;
    }

    console.error(`Service ${token} not found in container. Available services:`, Array.from(this.services.keys()));
    throw new Error(`Service ${token} not found`);
  }

  resolve<T>(target: any): T {
    console.log(`Resolving dependencies for: ${target.name}`);
    
    if (!Reflect.getMetadata(INJECTABLE_METADATA_KEY, target)) {
      console.error(`${target.name} is not injectable`);
      throw new Error(`${target.name} is not injectable`);
    }

    const params = Reflect.getMetadata('design:paramtypes', target) || [];
    console.log(`Found ${params.length} parameters to inject for ${target.name}`);

    const injections = params.map((param: any, index: number) => {
      const token = Reflect.getMetadata(INJECT_METADATA_KEY, target, `param:${index}`);
      if (!token) {
        console.error(`No injection token found for parameter ${index} of ${target.name}`);
        throw new Error(`No injection token found for parameter ${index} of ${target.name}`);
      }
      console.log(`Injecting ${token} into ${target.name}`);
      return this.get(token);
    });

    console.log(`Creating instance of ${target.name}`);
    return new target(...injections);
  }
} 