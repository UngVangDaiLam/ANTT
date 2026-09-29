export default async function healthRoutes(app) {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { status: { type: 'string' } },
            required: ['status'],
            additionalProperties: false,
          },
        },
      },
    },
    async () => ({ status: 'ok' }),
  );
}
