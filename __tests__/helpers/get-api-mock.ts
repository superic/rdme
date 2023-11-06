import { http } from 'msw';
import nock from 'nock';

import config from '../../src/lib/config.js';
import { getUserAgent } from '../../src/lib/readmeAPIFetch.js';

/**
 * A type describing a raw object of request headers.
 * We use this in our API request mocking to validate that the request
 * contains all the expected headers.
 */
type ReqHeaders = Record<string, unknown>;

/**
 * Returns full ReadMe API path
 */
export function getAPIPath(
  /**
   * API route, must start with slash
   * @example /api/v1
   */
  path: string,
  proxy = '',
) {
  return `${proxy}${config.host}${path}`;
}

/**
 * Nock wrapper that adds required `user-agent` request header
 * so it gets properly picked up by nock.
 * @param proxy Optional proxy URL. Must contain trailing slash.
 */
export default function getAPIMock(reqHeaders = {}, proxy = '') {
  return nock(`${proxy}${config.host}`, {
    reqheaders: {
      'User-Agent': getUserAgent(),
      ...reqHeaders,
    },
  });
}

export function getAPIMockWithVersionHeader(v: string) {
  return getAPIMock({
    'x-readme-version': v,
  });
}

export function validateHeaders(headers: Headers, basicAuthUser: string, expectedReqHeaders: ReqHeaders = {}) {
  // validate all headers in expectedReqHeaders
  Object.keys(expectedReqHeaders).forEach(reqHeaderKey => {
    if (headers.get(reqHeaderKey) !== expectedReqHeaders[reqHeaderKey]) {
      throw new Error(
        `Expected the request header '${expectedReqHeaders[reqHeaderKey]}', received '${headers.get(reqHeaderKey)}'`,
      );
    }
  });

  // validate basic auth header
  if (basicAuthUser) {
    const encodedApiKey = headers.get('Authorization').split(' ')[1];
    const decodedApiKey = Buffer.from(encodedApiKey, 'base64').toString();
    if (decodedApiKey !== `${basicAuthUser}:`) {
      throw new Error(`Expected API key '${basicAuthUser}', received '${decodedApiKey}'`);
    }
  }

  const userAgent = headers.get('user-agent');
  if (userAgent !== getUserAgent()) {
    throw new Error(`Expected user agent '${getUserAgent()}', received '${userAgent}'`);
  }
}

export function getAPIMockMSW(
  /**
   * API route to mock against, must start with slash
   * @example /api/v1
   */
  path: string = '',
  status = 200,
  response?: { json?: unknown; text?: string },
  /**
   * A string which represents the user that's passed via basic authentication.
   * In our case, this will almost always be the user's ReadMe API key.
   */
  basicAuthUser = '',
  /** Any request headers that should be matched. */
  expectedReqHeaders: ReqHeaders = {},
  proxy = '',
) {
  return http.get(getAPIPath(path, proxy), ({ request }) => {
    try {
      validateHeaders(request.headers, basicAuthUser, expectedReqHeaders);
      if (response?.json) {
        return Response.json(response.json, { status });
      } else if (response?.text) {
        return new Response(response.text, { status });
      }
      return new Response(null, { status });
    } catch (e) {
      throw new Error(`Error mocking GET request to https://dash.readme.com${path}: ${e.message}`);
    }
  });
}
