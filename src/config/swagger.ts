import path from 'path';
import swaggerJsdoc from 'swagger-jsdoc';

const ext = path.extname(__filename);

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'E-Commerce Backend API',
      version: '0.1.0',
      description: 'API documentation for the e-commerce backend.',
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
  },
  apis: [path.join(__dirname, `../modules/**/*.routes${ext}`)],
};

export const swaggerSpec = swaggerJsdoc(options);
