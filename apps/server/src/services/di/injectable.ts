import 'reflect-metadata';

export const INJECT_METADATA_KEY = Symbol('INJECT_METADATA_KEY');
export const INJECTABLE_METADATA_KEY = Symbol('INJECTABLE_METADATA_KEY');

export function Injectable() {
  return function (target: any) {
    Reflect.defineMetadata(INJECTABLE_METADATA_KEY, true, target);
    return target;
  };
}

export function Inject(token: string): ParameterDecorator {
  return function (target: any, propertyKey: string | symbol | undefined, parameterIndex: number) {
    Reflect.defineMetadata(INJECT_METADATA_KEY, token, target, `param:${parameterIndex}`);
    return target;
  };
}

export class Container {
  private static instance: Container;
  private services: Map<string, any> = new Map();

  private constructor() {}

  static getInstance(): Container {
    if (!Container.instance) {
      Container.instance = new Container();
    }
    return Container.instance;
  }

  register(token: string, instance: any) {
    this.services.set(token, instance);
  }

  get<T>(token: string): T {
    const service = this.services.get(token);
    if (!service) {
      throw new Error(`Service ${token} not found`);
    }
    return service;
  }

  resolve<T>(target: any): T {
    if (!Reflect.getMetadata(INJECTABLE_METADATA_KEY, target)) {
      throw new Error(`${target.name} is not injectable`);
    }

    const params = Reflect.getMetadata('design:paramtypes', target) || [];
    const injections = params.map((param: any, index: number) => {
      const token = Reflect.getMetadata(INJECT_METADATA_KEY, target, `param:${index}`);
      if (!token) {
        throw new Error(`No injection token found for parameter ${index} of ${target.name}`);
      }
      return this.get(token);
    });

    return new target(...injections);
  }
} 