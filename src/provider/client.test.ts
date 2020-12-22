import xmlParser from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';

import { IntegrationValidationError } from '@jupiterone/integration-sdk-core';
import { Recording } from '@jupiterone/integration-sdk-testing';
import { Request } from '@pollyjs/core';

import { config } from '../../test/config';
import { setupQualysRecording } from '../../test/recording';
import {
  assets,
  ClientDelayedRequestEvent,
  ClientRequestEvent,
  ClientResponseEvent,
  DEFAULT_RATE_LIMIT_CONFIG,
  DEFAULT_RETRY_CONFIG,
  QualysAPIClient,
  QWebHostId,
  STANDARD_RATE_LIMIT_STATE,
  vmpc,
  was,
} from './client';

jest.setTimeout(1000 * 60 * 1);

const createClient = (): QualysAPIClient => {
  return new QualysAPIClient({
    config,
  });
};

let recording: Recording;

afterEach(async () => {
  if (recording) {
    await recording.stop();
  }
});

describe('events', () => {
  let client: QualysAPIClient;
  const url = 'https://example.com/api/test';

  beforeEach(() => {
    client = new QualysAPIClient({ config });

    recording = setupQualysRecording({
      directory: __dirname,
      name: 'events',
    });
  });

  test('request', async () => {
    recording.server.any().intercept((req, res) => {
      res.sendStatus(200);
    });

    let requestEvent: ClientRequestEvent | undefined;
    client.onRequest((event) => {
      requestEvent = event;
    });

    await client.executeAuthenticatedAPIRequest(url, {});

    expect(requestEvent).toEqual({
      rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
      rateLimitState: STANDARD_RATE_LIMIT_STATE,
      rateLimitedAttempts: 0,
      retryAttempts: 0,
      retryConfig: DEFAULT_RETRY_CONFIG,
      retryable: true,
      totalAttempts: 0,
      url,
      hash: expect.any(String),
    });
  });

  test('response', async () => {
    recording.server.any().intercept((req, res) => {
      res
        .setHeaders({
          'x-ratelimit-limit': String(123),
          'x-ratelimit-remaining': String(99),
          'x-ratelimit-towait-sec': String(2),
          'x-ratelimit-window-sec': String(2400),
          'x-concurrency-limit-limit': String(6),
          'x-concurrency-limit-running': String(3),
        })
        .sendStatus(200);
    });

    let responseEvent: ClientResponseEvent | undefined;
    client.onResponse((event) => {
      responseEvent = event;
    });

    await client.executeAuthenticatedAPIRequest(url, {});

    expect(responseEvent).toEqual({
      rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
      rateLimitState: {
        concurrency: 6,
        concurrencyRunning: 3,
        limit: 123,
        limitRemaining: 99,
        limitWindowSeconds: 2400,
        toWaitSeconds: 2,
      },
      rateLimitedAttempts: 0,
      retryAttempts: 0,
      retryConfig: DEFAULT_RETRY_CONFIG,
      retryable: true,
      totalAttempts: 1,
      url,
      hash: expect.any(String),
      completed: true,
      status: 200,
      statusText: 'OK',
    });
  });

  test('retry', async () => {
    recording.server.any().intercept((req, res) => {
      res.sendStatus(409);
    });

    const requestEvents: ClientRequestEvent[] = [];
    client.onRequest((event) => {
      requestEvents.push(event);
    });

    const responseEvents: ClientResponseEvent[] = [];
    client.onResponse((event) => {
      responseEvents.push(event);
    });

    await expect(
      client.executeAuthenticatedAPIRequest(url, {}),
    ).rejects.toThrow(/Could not complete/);

    expect(requestEvents).toEqual([
      {
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 0,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        totalAttempts: 0,
        url,
        hash: expect.any(String),
      },
      {
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 1,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        totalAttempts: 1,
        url,
        hash: expect.any(String),
      },
      {
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 2,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        totalAttempts: 2,
        url,
        hash: expect.any(String),
      },
      {
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 3,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        totalAttempts: 3,
        url,
        hash: expect.any(String),
      },
      {
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 4,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        totalAttempts: 4,
        url,
        hash: expect.any(String),
      },
    ]);

    expect(responseEvents).toEqual([
      {
        completed: false,
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 1,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        status: 409,
        statusText: 'Conflict',
        totalAttempts: 1,
        url,
        hash: expect.any(String),
      },
      {
        completed: false,
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 2,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        status: 409,
        statusText: 'Conflict',
        totalAttempts: 2,
        url,
        hash: expect.any(String),
      },
      {
        completed: false,
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 3,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        status: 409,
        statusText: 'Conflict',
        totalAttempts: 3,
        url,
        hash: expect.any(String),
      },
      {
        completed: false,
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 4,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        status: 409,
        statusText: 'Conflict',
        totalAttempts: 4,
        url,
        hash: expect.any(String),
      },
      {
        completed: false,
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 5,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        status: 409,
        statusText: 'Conflict',
        totalAttempts: 5,
        url,
        hash: expect.any(String),
      },
    ]);
  });

  test('delay', async () => {
    let requestTimes = 0;
    recording.server.any().intercept((req, res) => {
      requestTimes++;
      if (requestTimes === 1) {
        res
          .setHeaders({
            'x-ratelimit-limit': String(10),
            'x-ratelimit-remaining': String(0),
            'x-ratelimit-towait-sec': String(1),
          })
          .sendStatus(409);
      } else {
        res.sendStatus(200);
      }
    });

    const requestEvents: ClientRequestEvent[] = [];
    client.onRequest((event) => {
      requestEvents.push(event);
    });

    const delayedRequestEvents: ClientDelayedRequestEvent[] = [];
    client.onDelayedRequest((event) => {
      delayedRequestEvents.push(event);
    });

    const responseEvents: ClientResponseEvent[] = [];
    client.onResponse((event) => {
      responseEvents.push(event);
    });

    const startTime = Date.now();
    await client.executeAuthenticatedAPIRequest(url, {});

    expect(Date.now() - startTime).toBeGreaterThanOrEqual(1000);

    expect(requestEvents).toEqual([
      {
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: STANDARD_RATE_LIMIT_STATE,
        rateLimitedAttempts: 0,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        totalAttempts: 0,
        url,
        hash: expect.any(String),
      },
      {
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: {
          ...STANDARD_RATE_LIMIT_STATE,
          limit: 10,
          limitRemaining: 0,
          toWaitSeconds: 1,
        },
        rateLimitedAttempts: 1,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        totalAttempts: 1,
        url,
        hash: expect.any(String),
      },
    ]);

    expect(delayedRequestEvents).toEqual([
      {
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: {
          ...STANDARD_RATE_LIMIT_STATE,
          limit: 10,
          limitRemaining: 0,
          toWaitSeconds: 1,
        },
        rateLimitedAttempts: 1,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        delay: 1000,
        totalAttempts: 1,
        url,
        hash: expect.any(String),
      },
    ]);

    expect(responseEvents).toEqual([
      {
        completed: false,
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: {
          ...STANDARD_RATE_LIMIT_STATE,
          limit: 10,
          limitRemaining: 0,
          toWaitSeconds: 1,
        },
        rateLimitedAttempts: 1,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        status: 409,
        statusText: 'Conflict',
        totalAttempts: 1,
        url,
        hash: expect.any(String),
      },
      {
        completed: true,
        rateLimitConfig: DEFAULT_RATE_LIMIT_CONFIG,
        rateLimitState: {
          ...STANDARD_RATE_LIMIT_STATE,
          limit: 10,
          limitRemaining: 0,
          toWaitSeconds: 1,
        },
        rateLimitedAttempts: 1,
        retryAttempts: 0,
        retryConfig: DEFAULT_RETRY_CONFIG,
        retryable: true,
        status: 200,
        statusText: 'OK',
        totalAttempts: 2,
        url,
        hash: expect.any(String),
      },
    ]);
  });
});

describe('verifyAuthentication', () => {
  test('inaccessible', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'verifyAuthenticationInaccesible',
      options: { recordFailedRequests: true },
    });

    let requestCount = 0;
    recording.server.any().on('request', (_req) => {
      requestCount++;
    });

    const client = new QualysAPIClient({
      config: { ...config, qualysUsername: 'testing-failure' },
    });

    await expect(client.verifyAuthentication()).rejects.toThrow(
      'Provider authentication failed at /api/2.0/fo/activity_log/: 401 Unauthorized',
    );

    expect(requestCount).toBe(1);
  });

  test('accessible', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'verifyAuthentication',
      options: { recordFailedRequests: true },
    });

    await expect(
      createClient().verifyAuthentication(),
    ).resolves.not.toThrowError();
  });

  test('expired', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'verifyAuthenticationExpired',
      options: { recordFailedRequests: true },
    });

    const rejects = expect(createClient().verifyAuthentication()).rejects;
    await rejects.toBeInstanceOf(IntegrationValidationError);
    await rejects.toThrow(/authentication/);
  });
});

describe('fetchPortalInfo', () => {
  test('info', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'fetchPortalInfo',
    });

    await expect(createClient().fetchPortalInfo()).resolves.toMatchObject({
      'Portal-Version': expect.any(Object),
      'QWeb-Version': expect.any(Object),
    });
  });
});

describe('iterateWebApps', () => {
  test('invalid filter value', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebAppsInvalidFilterValue',
    });

    await expect(
      createClient().iterateWebApps(
        (_webApp) => {
          // noop
        },
        {
          filters: { isScanned: undefined },
        },
      ),
    ).rejects.toThrow('INVALID_REQUEST');
  });

  test('pagination', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebAppsPagination',
    });

    const webApps: was.WebApp[] = [];
    await createClient().iterateWebApps(
      (webApp) => {
        webApps.push(webApp);
      },
      {
        pagination: {
          limit: 1,
        },
      },
    );

    expect(webApps.length).toBeGreaterThan(1);
    webApps.forEach((w) => {
      expect(w.url).toMatch(/^http/);
    });
  });

  test('scanned', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebApps',
    });

    const webApps: was.WebApp[] = [];
    await createClient().iterateWebApps(
      (webApp) => {
        webApps.push(webApp);
      },
      {
        filters: {
          isScanned: true,
        },
      },
    );

    expect(webApps.length).toBeGreaterThan(0);
    webApps.forEach((w) => {
      expect(w.url).toMatch(/^http/);
    });
  });

  test('mocked, unknown content type', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebAppsMocked',
    });

    recording.server.any().intercept((req, res) => {
      res.setHeader('content-type', 'text/html').status(200).send('WUT');
    });

    const iteratee = jest.fn();
    const client = createClient();

    await expect(client.iterateWebApps(iteratee)).rejects.toThrow(
      /Content-Type/,
    );
    expect(iteratee).not.toHaveBeenCalled();
  });
});

describe('fetchScannedWebAppIds', () => {
  test('none', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'fetchScannedWebAppIdsNone',
    });

    await expect(createClient().fetchScannedWebAppIds()).resolves.toEqual([]);
  });

  test('some', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'fetchScannedWebAppIds',
    });

    const webAppId = 81221901;
    await expect(createClient().fetchScannedWebAppIds()).resolves.toEqual([
      webAppId,
    ]);
  });

  test('mocked, unknown content type', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'fetchScannedWebAppIdsMocked',
    });

    recording.server.any().intercept((req, res) => {
      res.setHeader('content-type', 'text/html').status(200).send('WUT');
    });

    const client = createClient();

    await expect(client.fetchScannedWebAppIds()).rejects.toThrow(
      /Content-Type/,
    );
  });
});

describe('iterateWebAppFindings', () => {
  test('none', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebAppFindingsNone',
    });

    const onRequestError = jest.fn();
    const findings: was.WebAppFinding[] = [];

    await createClient().iterateWebAppFindings(
      [],
      (webapp) => {
        findings.push(webapp);
      },
      {
        onRequestError,
      },
    );

    expect(onRequestError).not.toHaveBeenCalled();
    expect(findings.length).toBe(0);
  });

  test('unknown webapp id', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebAppFindingsUnknownId',
    });

    const onRequestError = jest.fn();
    const findings: was.WebAppFinding[] = [];

    await createClient().iterateWebAppFindings(
      [123],
      (webapp) => {
        findings.push(webapp);
      },
      {
        onRequestError,
      },
    );

    expect(onRequestError).not.toHaveBeenCalled();
    expect(findings.length).toBe(0);
  });

  test('bad webapp id', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebAppFindingsBadId',
      options: { recordFailedRequests: true },
    });

    const onRequestError = jest.fn();
    await createClient().iterateWebAppFindings(
      [('abc123' as unknown) as number],
      async (_) => {
        // noop
      },
      {
        onRequestError,
      },
    );
    expect(onRequestError).toHaveBeenCalledTimes(1);
    expect(onRequestError).toHaveBeenCalledWith(['abc123'], expect.any(Error));
  });

  test('mocked', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebAppFindingsMocked',
    });

    const set1Responses = [
      `
      <?xml version="1.0" encoding="UTF-8"?>
<ServiceResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xsi:noNamespaceSchemaLocation="https://qualysapi.qualys.com/qps/xsd/3.0/was/finding.xsd">
 <responseCode>SUCCESS</responseCode>
 <count>2</count>
 <hasMoreRecords>true</hasMoreRecords>
 <data>
 <Finding>
 <id>156582</id>
 <uniqueId>8a2c4d51-6d28-2b92-e053-2943720a74ab</uniqueId>
 <qid>150124</qid>
 <severity>3</severity>
 <url>
 <![CDATA[http://funkytown.vuln.qa.qualys.com/cassium/xss/]]>
 </url>
 <status>ACTIVE</status>
 <firstDetectedDate>2017-04-28T09:36:13Z</firstDetectedDate>
 <lastDetectedDate>2018-02-21T09:03:32Z</lastDetectedDate>
 <lastTestedDate>2018-02-21T09:03:32Z</lastTestedDate>
 <timesDetected>3</timesDetected>
 </Finding>
 <Finding>
 <id>156583</id>
 <uniqueId>22222222-6d28-2b92-e053-2943720a74ab</uniqueId>
 <qid>150125</qid>
 <severity>3</severity>
 <url>
 <![CDATA[http://funkytown.vuln.qa.qualys.com/cassium/xss/]]>
 </url>
 <status>ACTIVE</status>
 <firstDetectedDate>2017-04-28T09:36:13Z</firstDetectedDate>
 <lastDetectedDate>2018-02-21T09:03:32Z</lastDetectedDate>
 <lastTestedDate>2018-02-21T09:03:32Z</lastTestedDate>
 <timesDetected>3</timesDetected>
 </Finding>
 </data>
</ServiceResponse>
      `,
      `
      <?xml version="1.0" encoding="UTF-8"?>
<ServiceResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xsi:noNamespaceSchemaLocation="https://qualysapi.qualys.com/qps/xsd/3.0/was/finding.xsd">
 <responseCode>SUCCESS</responseCode>
 <count>1</count>
 <hasMoreRecords>false</hasMoreRecords>
 <data>
 <Finding>
 <id>156584</id>
 <uniqueId>33333333-6d28-2b92-e053-2943720a74ab</uniqueId>
 <qid>150126</qid>
 <severity>3</severity>
 <url>
 <![CDATA[http://funkytown.vuln.qa.qualys.com/cassium/xss/]]>
 </url>
 <status>ACTIVE</status>
 <firstDetectedDate>2017-04-28T09:36:13Z</firstDetectedDate>
 <lastDetectedDate>2018-02-21T09:03:32Z</lastDetectedDate>
 <lastTestedDate>2018-02-21T09:03:32Z</lastTestedDate>
 <timesDetected>3</timesDetected>
 </Finding>
 </data>
</ServiceResponse>
      `,
    ].reverse();

    const set2Responses = [
      `
      <?xml version="1.0" encoding="UTF-8"?>
<ServiceResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xsi:noNamespaceSchemaLocation="https://qualysapi.qualys.com/qps/xsd/3.0/was/finding.xsd">
 <responseCode>SUCCESS</responseCode>
 <count>0</count>
 <hasMoreRecords>false</hasMoreRecords>
</ServiceResponse>
      `,
    ].reverse();

    recording.server.any().intercept((req, res) => {
      res.setHeader('content-type', 'text/xml');

      if (/1,2,3,4,5,6,7,8,9,10/.test(req.body)) {
        if (set1Responses.length === 0)
          throw 'No more responses to give from set1Responses';
        res.status(200).send(set1Responses.pop());
      } else if (/11,12/.test(req.body)) {
        if (set2Responses.length === 0)
          throw 'No more responses to give from set2Responses';
        res.status(200).send(set2Responses.pop());
      } else {
        throw 'Unexpected request';
      }
    });

    const onRequestError = jest.fn();
    const client = createClient();
    const findings: was.WebAppFinding[] = [];

    await client.iterateWebAppFindings(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      (webapp) => {
        findings.push(webapp);
      },
      { pagination: { limit: 2 }, onRequestError },
    );

    expect(onRequestError).not.toHaveBeenCalled();
    expect(findings.length).toEqual(3);
  });

  test('mocked, with date filter', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebAppFindingsMocked',
    });

    let receivedBody: string | undefined;
    recording.server.any().intercept((req, res) => {
      receivedBody = req.body;

      res.setHeader('content-type', 'text/xml').status(200).send(`
        <?xml version="1.0" encoding="UTF-8"?>
  <ServiceResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:noNamespaceSchemaLocation="https://qualysapi.qualys.com/qps/xsd/3.0/was/finding.xsd">
   <responseCode>SUCCESS</responseCode>
   <count>0</count>
   <hasMoreRecords>false</hasMoreRecords>
  </ServiceResponse>
        `);
    });

    const onRequestError = jest.fn();
    const client = createClient();
    const findings: was.WebAppFinding[] = [];

    await client.iterateWebAppFindings(
      [1],
      (webapp) => {
        findings.push(webapp);
      },
      { filters: { lastDetectedDate: '2020-09-11T23:00:30Z' }, onRequestError },
    );

    expect(onRequestError).not.toHaveBeenCalled();
    expect(findings.length).toEqual(0);
    expect(receivedBody).toMatch(
      /<Criteria field="lastDetectedDate" operator="EQUALS">2020-09-11T23:00:30Z<\/Criteria>/,
    );
  });

  test('mocked, unknown content type', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateWebAppFindingsMocked',
    });

    recording.server.any().intercept((req, res) => {
      res.setHeader('content-type', 'text/html').status(200).send('WUT');
    });

    const iteratee = jest.fn();
    const onRequestError = jest.fn();
    const client = createClient();

    await client.iterateWebAppFindings([1], iteratee, { onRequestError });

    expect(iteratee).not.toHaveBeenCalled();
    expect(onRequestError).toHaveBeenCalledWith([1], expect.any(Error));
  });

  // TODO enable once trial account is working again, re-record with pagination
  // test('some', async () => {
  //   recording = setupQualysRecording({
  //     directory: __dirname,
  //     name: 'iterateWebAppFindings',
  //   });

  //   const client = createClient();
  //   const webappIds = await client.fetchScannedWebAppIds();

  //   const findings: was.WebAppFinding[] = [];

  //   await client.iterateWebAppFindings(webappIds, (webapp) => {
  //     findings.push(webapp);
  //   });

  //   expect(findings.length).toBeGreaterThan(0);
  // });
});

describe('fetchScannedHostIds', () => {
  test('none', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'fetchScannedHostIdsNone',
    });

    await expect(createClient().fetchScannedHostIds()).resolves.toEqual([]);
  });

  test('some', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'fetchScannedHostIds',
    });

    const hostId = 107800671;
    await expect(createClient().fetchScannedHostIds()).resolves.toEqual([
      hostId,
    ]);
  });
});

describe('iterateScannedHostIds', () => {
  type PageData = {
    details?: string;
    limit: number;
    idMin: number;
    ids: QWebHostId[];
    nextId: QWebHostId;
    urlRegExp: RegExp;
  };

  const allHostIds = [...Array(23).keys()];

  // https://www.qualys.com/docs/qualys-api-vmpc-user-guide.pdf
  // Those docs only indicate this kind of response.
  const hostList = (ids: number[]): string =>
    `<HOST_LIST>${ids
      .map((e) => `<HOST><ID>${e}</ID></HOST>`)
      .join('')}</HOST_LIST>`;

  // https://github.com/QualysAPI/Qualys-API-Doc-Center/blob/master/Host%20List%20Detection%20API%20samples/Multithreading/multi_thread_hd.py
  // That prescribed approach indicates this kind of response, and it is the
  // recorded response structure when the orginal fetchScannedHostIds was
  // written and recorded.
  const idSet = (ids: number[]): string =>
    `<ID_SET>${ids.map((e) => `<ID>${e}</ID>`).join('')}</ID_SET>`;

  const paginateWarning = (pageData: PageData): string => `<WARNING>
          <CODE>1980</CODE>
          <TEXT>1000 record limit exceeded. Use URL to get next batch of results.</TEXT>
          <URL><![CDATA[${
            config.qualysApiUrl
          }/api/2.0/fo/asset/host/?action=list${
    pageData.details ? `&details=${pageData.details}` : ''
  }&truncation_limit=${pageData.limit}&id_min=${pageData.nextId}]]></URL>
        </WARNING>`;

  const hostListOutput = (
    listFunction: (ids: number[]) => string,
    pageData: PageData,
  ): string => `
      <HOST_LIST_OUTPUT>
        <RESPONSE>
          ${listFunction(pageData.ids)}
          ${
            pageData.nextId < allHostIds.length - 1
              ? paginateWarning(pageData)
              : ''
          }
        </RESPONSE>
      </HOST_LIST_OUTPUT>
      `;

  const pageData = (req: Request): PageData => {
    const details = req.query['details'] as string;
    const limit = Number(req.query['truncation_limit']);
    const idMin = Number(req.query['id_min']) || 0;

    return {
      details,
      limit,
      idMin,
      ids: allHostIds.slice(idMin, idMin + limit),
      nextId: idMin + limit,
      urlRegExp: new RegExp(
        `${
          config.qualysApiUrl
        }/api/2.0/fo/asset/host/\\?action=list&details=None&truncation_limit=\\d+${
          req.query['id_min'] ? '&id_min=\\d+' : ''
        }`,
      ),
    };
  };

  test('mocked HOST_LIST response', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateScannedHostIdsHostList',
    });

    recording.server.any().intercept((req, res) => {
      const pd = pageData(req);
      expect(req.absoluteUrl).toMatch(pd.urlRegExp);
      res
        .status(200)
        .setHeader('content-type', 'text/xml')
        .send(hostListOutput(hostList, pd));
    });

    const hostIds: number[] = [];
    await createClient().iterateScannedHostIds(
      (ids) => {
        ids.forEach((e) => hostIds.push(e));
      },
      { pagination: { limit: 10 } },
    );

    expect(hostIds).toEqual(allHostIds);
  });

  test('mocked ID_SET response', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateScannedHostIdsIdSet',
    });

    recording.server.any().intercept((req, res) => {
      const pd = pageData(req);
      expect(req.absoluteUrl).toMatch(pd.urlRegExp);
      res
        .status(200)
        .setHeader('content-type', 'text/xml')
        .send(hostListOutput(idSet, pd));
    });

    const hostIds: number[] = [];
    await createClient().iterateScannedHostIds(
      (ids) => {
        ids.forEach((e) => hostIds.push(e));
      },
      { pagination: { limit: 10 } },
    );

    expect(hostIds).toEqual(allHostIds);
  });
});

describe('iterateHostDetails', () => {
  test('none', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetailsNone',
    });

    const hosts: assets.HostAsset[] = [];

    await createClient().iterateHostDetails([], (host) => {
      hosts.push(host);
    });

    expect(hosts.length).toBe(0);
  });

  test('unknown host id', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetailsUnknownId',
    });

    const hosts: assets.HostAsset[] = [];

    await createClient().iterateHostDetails([123], (host) => {
      hosts.push(host);
    });

    expect(hosts.length).toBe(0);
  });

  test('bad host id', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetailsBadId',
      options: { recordFailedRequests: true },
    });

    const onRequestError = jest.fn();
    await createClient().iterateHostDetails(
      [('abc123' as unknown) as number],
      async (_) => {
        // noop
      },
      {
        onRequestError,
      },
    );
    expect(onRequestError).toHaveBeenCalledTimes(1);
    expect(onRequestError).toHaveBeenCalledWith(['abc123'], expect.any(Error));
  });

  test('some', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetails',
    });

    const client = createClient();
    const hostIds = await client.fetchScannedHostIds();

    const hosts: assets.HostAsset[] = [];

    await client.iterateHostDetails(hostIds, (host) => {
      hosts.push(host);
    });

    expect(hosts.length).toBeGreaterThan(0);
  });

  test('mocked many', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetailsMocked',
    });

    const responseBody = `
      <?xml version="1.0" encoding="UTF-8"?>
      <ServiceResponse xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="https://qualysapi.qualys.com/qps/xsd/2.0/am/hostasset.xsd">
        <responseCode>SUCCESS</responseCode>
        <count>1</count>
        <data>
          <HostAsset>
            <id>2020094</id>
            <name>Updated Name</name>
            <os>Windows</os>
            <dnsHostName>win95.old.corp.net</dnsHostName>
            <created>2018-09-06T19:16:35Z</created>
            <modified>2018-09-06T19:16:35Z</modified>
            <type>HOST</type>
            <tags><list /></tags>
            <sourceInfo><list/></sourceInfo>
            <netbiosName>TEST</netbiosName>
            <netbiosNetworkId>10</netbiosNetworkId>
            <networkGuid>66bf43c8-7392-4257-b856-a320fde231eb</networkGuid>
            <address>127.0.0.1</address>
            <trackingMethod>INSTANCE_ID</trackingMethod>
            <openPort><list/></openPort>
            <software><list/></software>
            <vuln><list/></vuln>
          </HostAsset>
        </data>
      </ServiceResponse>
    `;

    const hostIds = [1, 2, 3];
    const requests: string[] = [];
    recording.server.any().intercept((req, res) => {
      requests.push(req.body);
      res.status(200).send(responseBody);
    });

    await createClient().iterateHostDetails(hostIds, (host) => {
      // noop
    });

    expect(requests.length).toEqual(1);
    expect(xmlParser.parse(requests[0])).toEqual(
      xmlParser.parse(`<ServiceRequest>
  <preferences>
    <limitResults>3</limitResults>
  </preferences>
  <filters>
    <Criteria field="qwebHostId" operator="IN">1,2,3</Criteria>
  </filters>
</ServiceRequest>`),
    );
  });
});

describe('fetchHostDetails', () => {
  test('some', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'fetchHostDetails',
    });

    const client = createClient();
    const hostIds = await client.fetchScannedHostIds();
    expect(hostIds.length).toBeGreaterThan(0);

    const hostDetails = await client.fetchHostDetails(hostIds[0]);
    expect(hostDetails).toMatchObject({
      qwebHostId: hostIds[0],
      sourceInfo: expect.objectContaining({
        list: expect.objectContaining({
          Ec2AssetSourceSimple: expect.any(Object),
        }),
      }),
    });
  });
});

describe('iterateHostDetections', () => {
  test('none', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetectionsNone',
    });

    const onRequestError = jest.fn();
    const hosts: vmpc.DetectionHost[] = [];

    await createClient().iterateHostDetections(
      [],
      ({ host, detections }) => {
        hosts.push(host);
      },
      { onRequestError },
    );

    expect(onRequestError).not.toHaveBeenCalled();
    expect(hosts.length).toBe(0);
  });

  test('unknown host id', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetectionsUnknownId',
    });

    const onRequestError = jest.fn();
    const hosts: vmpc.DetectionHost[] = [];

    await createClient().iterateHostDetections(
      [123],
      ({ host, detections }) => {
        hosts.push(host);
      },
      { onRequestError },
    );

    expect(onRequestError).not.toHaveBeenCalled();
    expect(hosts.length).toBe(0);
  });

  test('bad host id', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetectionsBadId',
      options: { recordFailedRequests: true },
    });

    let requestCount = 0;
    recording.server.any().on('request', (_req) => {
      requestCount++;
    });

    const onRequestError = jest.fn();
    await createClient().iterateHostDetections(
      [('abc123' as unknown) as number],
      async (_) => {
        // noop
      },
      {
        onRequestError,
      },
    );

    expect(requestCount).toBe(1);
    expect(onRequestError).toHaveBeenCalledTimes(1);
    expect(onRequestError).toHaveBeenCalledWith(['abc123'], expect.any(Error));
  });

  test('some', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetections',
    });

    const onRequestError = jest.fn();
    const client = createClient();
    const hostIds = await client.fetchScannedHostIds();

    const hosts: vmpc.DetectionHost[] = [];

    await client.iterateHostDetections(
      hostIds,
      ({ host, detections }) => {
        hosts.push(host);
      },
      { onRequestError },
    );

    expect(onRequestError).not.toHaveBeenCalled();
    // TODO: Get some actual vulnerability scans working
    // expect(hosts.length).toBeGreaterThan(0);
  });

  test('some mocked', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetectionsMocked',
    });

    const onRequestError = jest.fn();

    const detectionsXml = fs
      .readFileSync(
        path.join(__dirname, '..', '..', 'test', 'fixtures', 'detections.xml'),
      )
      .toString('utf8');

    const requests = [/%2C298%2C299$/, /ids=300%2C301$/].reverse();

    recording.server.any().intercept((req, res) => {
      const expectedBody = requests.pop();
      if (!expectedBody) throw 'no more requests expected';
      expect(req.method).toBe('POST');
      expect(req.body).toMatch(expectedBody);
      res.status(200).type('application/xml').send(detectionsXml);
    });

    const hosts: vmpc.DetectionHost[] = [];
    await createClient().iterateHostDetections(
      [...Array(302)].map((_, i) => i),
      ({ host, detections }) => {
        hosts.push(host);
      },
      {
        pagination: { limit: 300 },
        onRequestError,
      },
    );

    expect(onRequestError).not.toHaveBeenCalled();
    expect(hosts.length).toBe(2);
  });

  test('some mocked, date filter', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateHostDetectionsMocked',
    });

    const onRequestError = jest.fn();

    const detectionsXml = fs
      .readFileSync(
        path.join(__dirname, '..', '..', 'test', 'fixtures', 'detections.xml'),
      )
      .toString('utf8');

    const requests = [
      /detection_updated_since=2020-09-11T23%3A00%3A30Z/,
    ].reverse();

    recording.server.any().intercept((req, res) => {
      const expectedBody = requests.pop();
      if (!expectedBody) throw 'no more requests expected';
      expect(req.method).toBe('POST');
      expect(req.body).toMatch(expectedBody);
      res.status(200).type('application/xml').send(detectionsXml);
    });

    const hosts: vmpc.DetectionHost[] = [];
    await createClient().iterateHostDetections(
      [1],
      ({ host, detections }) => {
        hosts.push(host);
      },
      {
        filters: { detection_updated_since: '2020-09-11T23:00:30Z' },
        onRequestError,
      },
    );

    expect(onRequestError).not.toHaveBeenCalled();
    expect(hosts.length).toBeGreaterThan(0);
  });
});

describe('iterateVulnerabilities', () => {
  test('none', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateVulnerabilitiesNone',
    });

    const vulns: vmpc.Vuln[] = [];

    await createClient().iterateVulnerabilities([], (vuln) => {
      vulns.push(vuln);
    });

    expect(vulns.length).toBe(0);
  });

  test('unknown id', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateVulnerabilitiesUnknownId',
      options: { recordFailedRequests: true },
    });

    const vulns: vmpc.Vuln[] = [];

    await createClient().iterateVulnerabilities([123], (vuln) => {
      vulns.push(vuln);
    });

    expect(vulns.length).toBe(0);
  });

  test('bad id', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateVulnerabilitiesBadId',
      options: { recordFailedRequests: true },
    });

    await expect(
      createClient().iterateVulnerabilities(
        [('abc123' as unknown) as number],
        async (_) => {
          // noop
        },
      ),
    ).rejects.toThrow(/Bad Request/);
  });

  test('some', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'iterateVulnerabilities',
    });

    const client = createClient();
    const vulns: vmpc.Vuln[] = [];

    await client.iterateVulnerabilities([316760], (vuln) => {
      vulns.push(vuln);
    });

    expect(vulns.length).toBe(1);
  });
});

// TODO consider aborting if time to next request is over some amount of time
describe('executeAPIRequest', () => {
  const concurrencyLimitXMLBody = `
    <SIMPLE_RETURN>
      <RESPONSE>
      <DATETIME>2017-04-12T14:52:39Z </DATETIME>
      <CODE>1960</CODE>
      <TEXT> This API cannot be run again until 1 currently running API instance has finished.</TEXT>
      <ITEM_LIST>
      <ITEM>
      <KEY>CALLS_TO_FINISH</KEY>
      <VALUE>2</VALUE>
      </ITEM>
      </ITEM_LIST>
      </RESPONSE>
    </SIMPLE_RETURN>`;

  const rateLimitXMLBody = `
    <SIMPLE_RETURN>
      <RESPONSE>
      <DATETIME>2017-04-12T14:52:39Z </DATETIME>
      <CODE>1965</CODE>
      <TEXT> This API cannot be run again for another 23 hours, 57 minutes and 54 seconds.</TEXT>
      <ITEM_LIST>
      <ITEM>
      <KEY>SECONDS_TO_WAIT</KEY>
      <VALUE>68928</VALUE>
      </ITEM>
      </ITEM_LIST>
      </RESPONSE>
    </SIMPLE_RETURN>`;

  const incompleteRegistrationXMLBody = `
    <SIMPLE_RETURN>
      <RESPONSE>
      <DATETIME>2017-04-12T14:52:39Z </DATETIME>
      <CODE>2003</CODE>
      <TEXT>  Registration must be completed before API requests will be served for this account</TEXT>
      <ITEM_LIST>
      <ITEM>
      <KEY>SECONDS_TO_WAIT</KEY>
      <VALUE>68928</VALUE>
      </ITEM>
      </ITEM_LIST>
      </RESPONSE>
    </SIMPLE_RETURN>`;

  const secureIdRequiredXMLBody = `
    <SIMPLE_RETURN>
      <RESPONSE>
      <DATETIME>2017-04-12T14:52:39Z </DATETIME>
      <CODE>2011</CODE>
      <TEXT>   SecureID authentication is required for this account, so API access is blocked</TEXT>
      <ITEM_LIST>
      <ITEM>
      <KEY>SECONDS_TO_WAIT</KEY>
      <VALUE>68928</VALUE>
      </ITEM>
      </ITEM_LIST>
      </RESPONSE>
    </SIMPLE_RETURN>`;

  test('waits towait-sec on 409 rate limit response', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'executeAPIRequest409rateLimit',
      options: { recordFailedRequests: true },
    });

    const requestTimes: number[] = [];
    recording.server.any().on('request', (_req, _event) => {
      requestTimes.push(Date.now());
    });

    const toWaitSec = 1;
    recording.server
      .any()
      .times(1)
      .intercept((_req, res) => {
        res
          .status(409)
          .setHeaders({
            'x-ratelimit-limit': String(300),
            'x-ratelimit-remaining': String(0),
            'x-ratelimit-towait-sec': String(toWaitSec),
          })
          .send(rateLimitXMLBody);
      });

    await createClient().verifyAuthentication();

    expect(requestTimes.length).toBe(2);
    expect(requestTimes[1] - requestTimes[0]).toBeGreaterThan(toWaitSec * 1000);
  });

  test('waits on 409 concurrency limit response', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'executeAPIRequest409concurrencyLimit',
      options: { recordFailedRequests: true },
    });

    const requestTimes: number[] = [];
    recording.server.any().on('request', (_req, _event) => {
      requestTimes.push(Date.now());
    });

    recording.server.any().intercept((_req, res) => {
      res
        .status(409)
        .setHeaders({
          'x-concurrency-limit-limit': String(2),
          'x-concurrency-limit-running': String(2),
        })
        .send(concurrencyLimitXMLBody);
    });

    const client = new QualysAPIClient({
      config,
      rateLimitConfig: {
        maxAttempts: 2,
        concurrencyDelay: 500,
      },
    });

    await expect(client.verifyAuthentication()).rejects.toThrow(/409 Conflict/);

    expect(requestTimes.length).toBe(2);
    expect(requestTimes[1] - requestTimes[0]).toBeGreaterThan(500);
  });

  test('retries 409 response limited times', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'executeAPIRequest409Limit',
      options: { recordFailedRequests: true },
    });

    const requestTimes: number[] = [];
    recording.server.any().on('request', (_req, _event) => {
      requestTimes.push(Date.now());
    });

    recording.server.any().intercept((_req, res) => {
      res.status(409).setHeaders({
        'x-ratelimit-limit': String(300),
        'x-ratelimit-remaining': String(100),
      });
    });

    const client = new QualysAPIClient({
      config,
      rateLimitConfig: {
        maxAttempts: 2,
      },
    });

    await expect(client.verifyAuthentication()).rejects.toThrowError(/2/);

    expect(requestTimes.length).toBe(2);
  });

  test('throttles at specified reserveLimit', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'executeAPIRequestReserveLimit',
      options: { recordFailedRequests: true },
    });

    let limitRemaining = 10;

    recording.server.any().intercept((_req, res) => {
      limitRemaining--;
      res.status(201).setHeaders({
        'x-ratelimit-limit': String(10),
        'x-ratelimit-remaining': String(limitRemaining),
      });
    });

    const client = new QualysAPIClient({
      config,
      rateLimitConfig: {
        reserveLimit: 8,
        cooldownPeriod: 1000,
      },
    });

    const startTime = Date.now();

    await client.verifyAuthentication();
    await client.verifyAuthentication();
    await client.verifyAuthentication();

    expect(Date.now() - startTime).toBeGreaterThanOrEqual(1000);
  });

  test('retries unexpected errors', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'executeAPIRequestRetryUnexpected',
      options: { recordFailedRequests: true },
    });

    let requestCount = 0;
    recording.server.any().intercept((_req, res) => {
      requestCount++;
      res.status(500);
    });

    const client = new QualysAPIClient({
      config,
      retryConfig: {
        maxAttempts: 2,
      },
    });

    await expect(client.verifyAuthentication()).rejects.toThrow(
      /500 Internal Server Error/,
    );

    expect(requestCount).toBe(2);
  });

  test('does not retry bad request', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'executeAPIRequestBadRequest',
      options: { recordFailedRequests: true },
    });

    let requestCount = 0;
    recording.server.any().intercept((_req, res) => {
      requestCount++;
      res.status(400);
    });

    const client = new QualysAPIClient({
      config,
      retryConfig: {
        maxAttempts: 2,
      },
    });

    await expect(client.verifyAuthentication()).rejects.toThrow(
      /400 Bad Request/,
    );

    expect(requestCount).toBe(1);
  });

  test('does not retry authentication error', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'executeAPIRequestUnauthorized',
      options: { recordFailedRequests: true },
    });

    let requestCount = 0;
    recording.server.any().intercept((_req, res) => {
      requestCount++;
      res.status(401);
    });

    const client = new QualysAPIClient({
      config,
      retryConfig: {
        maxAttempts: 2,
      },
    });

    await expect(client.verifyAuthentication()).rejects.toThrow(
      /401 Unauthorized/,
    );

    expect(requestCount).toBe(1);
  });

  test('does not retry incomplete registration error', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'executeAPIRequestIncompleteRegistration',
      options: { recordFailedRequests: true },
    });

    let requestCount = 0;
    recording.server.any().intercept((_req, res) => {
      requestCount++;
      res
        .status(409)
        .setHeader('content-type', 'text/xml')
        .send(incompleteRegistrationXMLBody);
    });

    const client = new QualysAPIClient({
      config,
      retryConfig: {
        maxAttempts: 2,
      },
    });

    await expect(client.verifyAuthentication()).rejects.toThrow(
      /409 Conflict.*?Registration must be completed/,
    );

    expect(requestCount).toBe(1);
  });

  test('does not retry secure ID required error', async () => {
    recording = setupQualysRecording({
      directory: __dirname,
      name: 'executeAPIRequestSecureIdRequired',
      options: { recordFailedRequests: true },
    });

    let requestCount = 0;
    recording.server.any().intercept((_req, res) => {
      requestCount++;
      res
        .status(409)
        .setHeader('content-type', 'text/xml')
        .send(secureIdRequiredXMLBody);
    });

    const client = new QualysAPIClient({
      config,
      retryConfig: {
        maxAttempts: 2,
      },
    });

    await expect(client.verifyAuthentication()).rejects.toThrow(
      /409 Conflict.*?SecureID authentication is required/,
    );

    expect(requestCount).toBe(1);
  });
});
