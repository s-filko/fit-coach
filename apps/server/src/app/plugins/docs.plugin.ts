import path from 'path';

import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { FastifyInstance } from 'fastify';
import { jsonSchemaTransform } from 'fastify-type-provider-zod';

export async function docsPlugin(app: FastifyInstance): Promise<void> {
  // Swagger/OpenAPI
  await app.register(swagger, {
    mode: 'dynamic',
    openapi: {
      openapi: '3.0.3',
      info: { title: 'Fit Coach API', version: '1.0.0' },
      components: {
        securitySchemes: {
          ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Static files (public)
  const rootDir = path.resolve();
  await app.register(fastifyStatic, {
    root: path.join(rootDir, 'public'),
    prefix: '/public/',
  });
}

