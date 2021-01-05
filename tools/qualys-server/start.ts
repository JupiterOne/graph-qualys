import express from 'express';
import xmlBodyParser from 'express-xml-bodyparser';
import onFinished from 'on-finished';
import path from 'path';
import { URL } from 'url';

import { generateHostData } from './data';
import { initializeEngine } from './templates';

async function start() {
  const hostData = generateHostData();
  // const hostData = generateHostData({
  //   numDesiredHosts: 76000,
  //   numDesiredDetections: 2500000,
  //   numDetectionsPerHostMin: 3,
  // });

  // Change this to represent the concurrency limit of a subscription.
  const detectionsConcurrencyLimit = 15;

  // Change this to non-zero value to simulate other scripts consuming
  // concurrency.
  const detectionsOtherRunning = 0;

  console.log(
    {
      detectionsConcurrencyLimit,
      detectionsOtherRunning,
      numHosts: hostData.numHosts,
      numDetections: hostData.numDetections,
      hostIdRange: hostData.hostIdRange,

      /**
       * Uncomment the following to get a view of the distribution of detections
       * across the hosts.
       */
      // distribution: hostData.hosts.reduce(
      //   (acc, e) => {
      //     const numHosts = acc.get(e.numDetections) || 0;
      //     acc.set(e.numDetections, numHosts + 1);
      //     return acc;
      //   },
      //   new Map<number, number>(),
      // ),
    },
    'Generated hosts, restart to get new set',
  );

  const app = express();
  const port = 8080;

  app.engine('mustache', await initializeEngine());
  app.set('views', path.join(__dirname, 'templates'));
  app.set('view engine', 'mustache');

  app.use(express.text());
  app.use(express.urlencoded({ extended: false }));
  app.use(xmlBodyParser());

  app.use((req, res, next) => {
    res.setHeader('x-ratelimit-limit', 10000);
    res.setHeader('x-ratelimit-remaining', 10000);
    res.setHeader('x-ratelimit-window-sec', 3600);
    res.setHeader('x-ratelimit-towait-sec', 0);
    next();
  });

  if (process.env.LOG_REQUESTS) {
    app.use((req, res, next) => {
      console.log(Date.now(), req.url, 'received request');
      onFinished(res, (err, res) => {
        console.log(Date.now(), req.url, 'response finished');
      });
      next();
    });
  }

  app.get('/api/2.0/fo/activity_log/', (req, res) => {
    res.setHeader('content-type', 'text/csv;charset=UTF-8');
    res.render('activity-log');
  });

  app.get('/qps/rest/portal/version', (req, res) => {
    res.setHeader('content-type', 'application/xml');
    res.render('portal-version');
  });

  app.post('/qps/rest/3.0/search/was/webapp', (req, res) => {
    // TODO: Implement pagination responses
    res.setHeader('content-type', 'application/xml');
    res.render('webapp-list');
  });

  app.get('/api/2.0/fo/asset/host/', (req, res) => {
    const truncationLimit = Number(req.query['truncation_limit']);
    const idStart = Number(req.query['id_max']) || hostData.hostIdRange.start;
    const idEnd = idStart + truncationLimit;
    const hosts = hostData.hosts.slice(idStart, idEnd);

    let nextUrl: URL | undefined;
    if (idEnd < hostData.hosts.length) {
      nextUrl = new URL(req.originalUrl, `http://${req.hostname}:8080`);
      nextUrl.searchParams.set('id_max', String(idEnd));
    }

    res.setHeader('content-type', 'text/xml');
    res.render('host-id-list', { hostIds: hosts.map((e) => e.id), nextUrl });
  });

  app.post('/qps/rest/2.0/search/am/hostasset', (req, res) => {
    const qwebHostIds = req.body.servicerequest.filters[0].criteria[0]._;
    const hostIds = qwebHostIds.split(',');
    const hosts = hostIds.map((e) => hostData.hostsById.get(Number(e)));
    res.setHeader('content-type', 'text/xml');
    res.render('host-details-list', { hosts });
  });

  let detectionsConcurrencyRunning = detectionsOtherRunning;
  app.post('/api/2.0/fo/asset/host/vm/detection/', (req, res) => {
    res.setHeader('x-concurrency-limit-limit', detectionsConcurrencyLimit);

    if (detectionsConcurrencyRunning >= detectionsConcurrencyLimit) {
      console.warn('concurrency: ', detectionsConcurrencyRunning, 409);

      // This header becomes an indication of no more concurrency limit
      // remaining in the Qualys API.
      res.setHeader('x-ratelimit-remaining', 0);
      res.setHeader(
        'x-concurrency-limit-running',
        detectionsConcurrencyRunning,
      );
      res.sendStatus(409);
    } else {
      // Increment concurrency running to include this request
      detectionsConcurrencyRunning++;
      console.warn('concurrency: ', detectionsConcurrencyRunning);

      const hostIds = req.body.ids.split(',');
      const hosts = hostIds.map((e) => hostData.hostsById.get(Number(e)));

      const hostTime = Math.random() * 10;
      const maximumTime = 1000 * 10;
      const responseTime = Math.min(
        hostIds.length * hostTime + Math.round(Math.random() * 1000),
        maximumTime,
      );

      res.setHeader(
        'x-concurrency-limit-running',
        detectionsConcurrencyRunning,
      );
      res.setHeader('content-type', 'text/xml');

      setTimeout(() => {
        res.render('host-detection-list', { hosts }, (err, html) => {
          if (err) {
            console.error(err);
            res.status(500);
          } else {
            res.send(Buffer.from(html));
          }
          detectionsConcurrencyRunning--;
        });
      }, responseTime);
    }
  });

  app.post('/api/2.0/fo/knowledge_base/vuln', (req, res) => {
    const ids = req.query.ids as string | undefined;
    const qidList = ids ? ids.split(',') : [];
    res.setHeader('content-type', 'text/xml');
    res.render('vuln-list', { qidList });
  });

  app.listen(port, () => {
    console.log(`Listening at http://localhost:${port}`);
  });
}

start().catch((err) => {
  throw err;
});
