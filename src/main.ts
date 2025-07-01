import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  app.enableCors({
    origin: [
      /^(https?:\/\/)?localhost(:\d+)?$/,
      /^https?:\/\/(.*\.)?gitclaim\.axlabs\.com(:\d+)?$/
    ],
    credentials: true,
  });
  await app.listen(3000);
}
bootstrap();
