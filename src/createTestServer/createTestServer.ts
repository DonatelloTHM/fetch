import fastifyCors, { FastifyCorsOptions } from '@fastify/cors';
import Fastify from 'fastify';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface TestServer extends ReturnType<typeof Fastify> {
  silenceErrors: () => void;
}

// ```Shell
// openssl req -nodes -x509 -days 36500 -newkey rsa:2048 -sha256 -keyout createServer.key -out createServer.cert -subj '/CN=localhost' -addext "subjectAltName=IP:127.0.0.1"
// ```
//
// Based on:
//
// - Examples from https://www.openssl.org/docs/man1.1.1/man1/openssl-req.html
// - https://stackoverflow.com/q/10175812
// - https://docs.gandi.net/en/ssl/common_operations/csr.html#running-the-command
//
// - `-nodes`
//   If this option is specified then if a private key is created it will not be encrypted.
//   https://stackoverflow.com/a/41366949
//
// - `-x509`
//   This option outputs a self signed certificate instead of a certificate request. This is typically used to generate a test certificate or a self signed root CA.
//
// - `-days`
//   When the -x509 option is being used this specifies the number of days to certify the certificate for, otherwise it is ignored. The default is 30 days.
//
// - `-rsa:2048`
//   https://security.stackexchange.com/a/65180
//
// - `-sha256`
//   https://stackoverflow.com/a/26462803
//
// - File names: `.key` is for the private key, `.cert` is for the certificate. Both file extensions are given appropriate icons by VSCode, unlike `.pem` and `.csr`
//
const privateKey = readFileSync(path.join(__dirname, 'createTestServer.key'));
const certificate = readFileSync(path.join(__dirname, 'createTestServer.cert'));

interface Options {
  https?: boolean;
  http2?: boolean;
  corsOrigin?: FastifyCorsOptions['origin']; // https://stackoverflow.com/a/41075862
}

const defaults = {
  https: true,
  http2: false,
  corsOrigin: true
} as const;

// Why use Fastify instead of Express?
// Fastify uses async/await syntax and thus simplifies this implementation a lot
export function createTestServer(options?: Options) {
  const { https, http2, corsOrigin } = { ...defaults, ...options };

  const server = Fastify({
    logger: false,

    // @ts-ignore
    // eslint-disable-next-line unicorn/no-null
    https: https ? { key: privateKey, cert: certificate } : null,

    // whatwg-fetch uses XHR implementation from jsdom.
    // And jsdom does not support HTTP/2 because it relies on request:
    // https://github.com/jsdom/jsdom/blob/16.4.0/lib/jsdom/living/xhr/xhr-utils.js#L3, https://github.com/jsdom/jsdom/issues/2792
    // And request is deprecated and does not support HTTP/2: https://github.com/request/request/issues/2033
    //
    // node-fetch does not support HTTP/2: https://github.com/node-fetch/node-fetch/issues/342
    http2
  }) as unknown as TestServer;

  // Needed by whatwg-fetch, not by node-fetch
  server.register(fastifyCors, { origin: corsOrigin });

  // With the default error handler from Fastify we don't see
  // Jest errors from expect() inside handlers
  // https://www.fastify.io/docs/v4.1.x/Reference/Errors/#catching-uncaught-errors-in-fastify
  // https://github.com/fastify/fastify/blob/v4.1.0/lib/error-handler.js#L68
  // FYI Express needs the same hack: http://expressjs.com/en/guide/error-handling.html#the-default-error-handler
  // FYI http.createServer() doesn't need it
  // istanbul ignore next
  server.setErrorHandler((error, request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    process.stderr.write(error.stack!);

    // ["To access the default handler, you can access instance.errorHandler"](https://www.fastify.io/docs/v4.1.x/Reference/Routes/#routes-options)
    // https://www.fastify.io/docs/v4.1.x/Reference/Server/#errorhandler
    // FIXME
    // @ts-ignore
    if (fastify.errorHandler) fastify.errorHandler(error, request, reply);
  });

  // Do not print Fastify errors to the console when throwing inside an handler
  // You cannot later re-enable errors, you need to restart Fastify:
  // Should be done before calling listen(): "Cannot call "setErrorHandler" when fastify instance is already started!"
  server.silenceErrors = () => {
    // https://github.com/fastify/fastify/blob/v4.1.0/lib/error-handler.js#L68
    server.setErrorHandler((error, _request, reply) => {
      reply.send(error);
      //return reply; // For Fastify 4.1.0
    });
  };

  return server;
}
