import { noop } from 'lodash';
import PQueue from 'p-queue';
import sax from 'sax';

import { parseStringPropertyValue } from '@jupiterone/integration-sdk-core';

import { ResourceIteratee, vmpc } from '../types';

export function parseHostDetectionsStream({
  xmlStream,
  iteratee,
  onIterateeError,
  onUnhandledError,
  onComplete,
  iterateeErrorLimit = 10,
  debugSax = false,
}: {
  xmlStream: NodeJS.ReadableStream;

  iteratee: ResourceIteratee<vmpc.HostDetections>;

  /**
   * Invoked when there is an error calling the iteratee. Parsing will continue
   * depending on `interateeErrorLimit`.
   */
  onIterateeError: (err: Error, hostDetections: vmpc.HostDetections) => void;

  /**
   * Invoked when there is an unexpected error.
   */
  onUnhandledError: (err: Error) => void;

  /**
   * Invoked when parsing is going to complete, and any time additional requests
   * to complete are made from a parser event.
   *
   * @param event the parsing event that started the completion process
   */
  onComplete: (event: string) => void;

  /**
   * The number of errors to accept, from the start, before giving up. This is
   * meant to catch the situation where the iteratee is broken (such as a bad
   * converter function).
   */
  iterateeErrorLimit?: number;

  /**
   * Enable debug logging for stream processing development. This is super
   * noisy, goes to the console.log, and should only be enable in development.
   */
  debugSax?: boolean;
}): Promise<void> {
  const logSaxEvent = debugSax ? console.log : noop;

  return new Promise((resolve, reject) => {
    let terminating = false;
    let iterateeErrorCount = 0;
    let iterateeSuccessCount = 0;

    const iterateeQueue = new PQueue();

    let host: any,
      detections: any[],
      detection: any,
      propertyValue: string[] | undefined;
    const propertyTargets: any[] = [];

    const saxStream = sax.createStream();

    // TODO put 2 minute onIdle socket timeout because qualys said they will
    // send something every 56 seconds to keep the connection open.
    // TODO: test `onComplete`, multiple invocations
    const completePromises = async (event: string, unhandledError?: Error) => {
      logSaxEvent('completePromises', {
        event,
        unhandledError,
        iterateePromiseCount: iterateeQueue.size,
        terminating,
      });

      if (unhandledError) onUnhandledError(unhandledError);

      onComplete(event);

      if (terminating) {
        await iterateeQueue.onIdle();
        return;
      } else {
        terminating = true;
        xmlStream.pause();
        xmlStream.unpipe(saxStream);
        await iterateeQueue.onIdle();
        return unhandledError ? reject(unhandledError) : resolve();
      }
    };

    saxStream.on('close', () => {
      logSaxEvent('close', { terminating });
      void completePromises('close');
    });

    // TODO test XML parsing error
    saxStream.on('error', function (err) {
      logSaxEvent('error', { err, terminating });
      void completePromises('error', err);
    });

    saxStream.on('opentag', function (tag) {
      logSaxEvent('opentag', { tag, terminating });

      if (tag.name === 'HOST') {
        host = {};
        propertyTargets.unshift(host);
      } else if (tag.name === 'DETECTION_LIST') {
        detections = [];
      } else if (tag.name === 'DETECTION') {
        detection = {};
        detections.push(detection);
        propertyTargets.unshift(detection);
      } else if (propertyTargets.length > 0) {
        propertyValue = [];
      }
    });

    saxStream.on('text', function (text) {
      logSaxEvent('text', { text, propertyValue, terminating });

      if (propertyValue && propertyTargets.length > 0) {
        propertyValue.push(text);
      }
    });

    saxStream.on('cdata', function (cdata) {
      logSaxEvent('cdata', { cdata, propertyValue, terminating });

      if (propertyValue && propertyTargets.length > 0) {
        propertyValue.push(cdata);
      }
    });

    saxStream.on('closetag', function (tag) {
      logSaxEvent('closetag', {
        tag,
        propertyTargets,
        propertyValue,
        host,
        detections,
        terminating,
      });

      if (terminating) return;

      if (propertyValue && propertyTargets.length > 0) {
        propertyTargets[0][tag] = parseStringPropertyValue(
          propertyValue.join('').trim(),
        );
        propertyValue = undefined;
      }

      if (tag === 'DETECTION') {
        propertyTargets.shift();
      } else if (tag === 'HOST') {
        propertyTargets.shift();

        const hostDetections: vmpc.HostDetections = {
          host,
          detections,
        };

        iterateeQueue
          .add(async () => {
            await iteratee(hostDetections);
            iterateeSuccessCount++;
          })
          .catch((err) => {
            iterateeErrorCount++;

            logSaxEvent('iterateeError', {
              err,
              iterateeErrorLimit,
              iterateeErrorCount,
              hostDetections,
              terminating,
            });

            onIterateeError(err, hostDetections);

            if (
              !iterateeSuccessCount &&
              iterateeErrorLimit &&
              iterateeErrorCount >= iterateeErrorLimit
            ) {
              void completePromises(
                'closetag',
                new Error(
                  `Exceeded iteratee error limit ${iterateeErrorLimit}`,
                ),
              );
            }
          });
      }
    });

    saxStream.on('end', function () {
      logSaxEvent('end');
      void completePromises('end');
    });

    xmlStream.pipe(saxStream);
  });
}
