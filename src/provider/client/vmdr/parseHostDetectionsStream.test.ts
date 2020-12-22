import { noop } from 'lodash';
import stream from 'stream';

import { vmpc } from '../types';
import { parseHostDetectionsStream } from './parseHostDetectionsStream';

class ReadableString extends stream.Readable {
  private sent = false;

  constructor(private str: string) {
    super();
  }

  _read() {
    if (!this.sent) {
      this.push(Buffer.from(this.str));
      this.sent = true;
    } else {
      this.push(null);
    }
  }
}

const hostXML1 =
  '<HOST>\
<ID>1</ID>\
<LAST_SCAN_DATETIME>2018-04-13T03:49:05Z</LAST_SCAN_DATETIME>\
<DETECTION_LIST>\
  <DETECTION>\
    <QID>38170</QID>\
    <TYPE>Confirmed</TYPE>\
    <SEVERITY>2</SEVERITY>\
    <PORT>3389</PORT>\
  </DETECTION>\
</DETECTION_LIST>\
</HOST>';

const hostXML2 =
  '<HOST>\
<ID>2</ID>\
<LAST_SCAN_DATETIME>2018-04-13T03:49:05Z</LAST_SCAN_DATETIME>\
<DETECTION_LIST>\
  <DETECTION>\
    <QID>38170</QID>\
    <TYPE>Confirmed</TYPE>\
    <SEVERITY>2</SEVERITY>\
    <PORT>3389</PORT>\
  </DETECTION>\
  <DETECTION>\
    <QID>38171</QID>\
    <TYPE>Unconfirmed</TYPE>\
    <SEVERITY>1</SEVERITY>\
    <PORT>3489</PORT>\
  </DETECTION>\
</DETECTION_LIST>\
</HOST>';

const hostXML3 =
  '<HOST>\
<ID>3</ID>\
<LAST_SCAN_DATETIME>2018-04-13T03:49:05Z</LAST_SCAN_DATETIME>\
<DETECTION_LIST></DETECTION_LIST>\
</HOST>';

const detectionOutputOpenXML =
  '<HOST_LIST_VM_DETECTION_OUTPUT>\
<RESPONSE>\
  <DATETIME>2020-09-27T01:29:21Z</DATETIME>\
  <HOST_LIST>';

const detectionOutputCloseXML =
  '</HOST_LIST>\
</RESPONSE>\
</HOST_LIST_VM_DETECTION_OUTPUT>';

const detectionOutputXML = `${detectionOutputOpenXML}
    ${hostXML1}
    ${hostXML2}
    ${hostXML3}
  ${detectionOutputCloseXML}`;

const hostDetections1: vmpc.HostDetections = {
  host: {
    ID: 1,
    LAST_SCAN_DATETIME: '2018-04-13T03:49:05Z' as any,
  },
  detections: [
    {
      PORT: 3389,
      QID: 38170,
      SEVERITY: 2,
      TYPE: 'Confirmed',
    },
  ],
};

const hostDetections2: vmpc.HostDetections = {
  host: {
    ID: 2,
    LAST_SCAN_DATETIME: '2018-04-13T03:49:05Z' as any,
  },
  detections: [
    {
      PORT: 3389,
      QID: 38170,
      SEVERITY: 2,
      TYPE: 'Confirmed',
    },
    {
      PORT: 3489,
      QID: 38171,
      SEVERITY: 1,
      TYPE: 'Unconfirmed',
    },
  ],
};

const hostDetections3: vmpc.HostDetections = {
  host: {
    ID: 3,
    LAST_SCAN_DATETIME: '2018-04-13T03:49:05Z' as any,
  },
  detections: [],
};

test('unknown xml', async () => {
  const iteratee = jest.fn();
  const onIterateeError = jest.fn();
  const onComplete = jest.fn();
  const onUnhandledError = jest.fn();
  const xmlStream = new ReadableString('<unknown></unknown>');
  await expect(
    parseHostDetectionsStream({
      xmlStream,
      iteratee,
      onIterateeError,
      onUnhandledError,
      onComplete,
    }),
  ).resolves.not.toThrowError();
  expect(onIterateeError).not.toHaveBeenCalled();
  expect(iteratee).not.toHaveBeenCalled();
});

test('no content', async () => {
  const iteratee = jest.fn();
  const onIterateeError = jest.fn();
  const onComplete = jest.fn();
  const onUnhandledError = jest.fn();
  const xmlStream = new ReadableString('');
  await expect(
    parseHostDetectionsStream({
      xmlStream,
      iteratee,
      onIterateeError,
      onUnhandledError,
      onComplete,
    }),
  ).resolves.not.toThrowError();
  expect(onIterateeError).not.toHaveBeenCalled();
  expect(iteratee).not.toHaveBeenCalled();
});

test('empty HOST_LIST', async () => {
  const iteratee = jest.fn();
  const onIterateeError = jest.fn();
  const onComplete = jest.fn();
  const onUnhandledError = jest.fn();
  const xmlStream = new ReadableString(
    '<HOST_LIST_VM_DETECTION_OUTPUT>\
  <RESPONSE>\
     <DATETIME>2020-09-27T01:29:21Z</DATETIME>\
     <HOST_LIST>\
     </HOST_LIST>\
  </RESPONSE>\
</HOST_LIST_VM_DETECTION_OUTPUT>',
  );
  await expect(
    parseHostDetectionsStream({
      xmlStream,
      iteratee,
      onIterateeError,
      onUnhandledError,
      onComplete,
    }),
  ).resolves.not.toThrowError();
  expect(onIterateeError).not.toHaveBeenCalled();
  expect(iteratee).not.toHaveBeenCalled();
});

test('HOST, empty DETECTION_LIST', async () => {
  const iteratee = jest.fn();
  const onIterateeError = jest.fn();
  const onComplete = jest.fn();
  const onUnhandledError = jest.fn();

  const xmlStream = new ReadableString(
    '<HOST_LIST_VM_DETECTION_OUTPUT>\
  <RESPONSE>\
    <DATETIME>2020-09-27T01:29:21Z</DATETIME>\
    <HOST_LIST>\
      <HOST>\
        <ID>123</ID>\
        <IP>10.10.10.11</IP>\
        <OS><![CDATA[Windows 2008 R2 Enterprise Service Pack1]]></OS>\
        <LAST_SCAN_DATETIME>2018-04-13T03:49:05Z</LAST_SCAN_DATETIME>\
        <DETECTION_LIST></DETECTION_LIST>\
      </HOST>\
    </HOST_LIST>\
  </RESPONSE>\
</HOST_LIST_VM_DETECTION_OUTPUT>',
  );

  await expect(
    parseHostDetectionsStream({
      xmlStream,
      iteratee,
      onIterateeError,
      onUnhandledError,
      onComplete,
    }),
  ).resolves.not.toThrowError();

  expect(onIterateeError).not.toHaveBeenCalled();
  expect(onUnhandledError).not.toHaveBeenCalled();
  expect(onComplete).toHaveBeenCalledWith('end');

  expect(iteratee).toHaveBeenCalledWith({
    detections: [],
    host: {
      ID: 123,
      IP: '10.10.10.11',
      LAST_SCAN_DATETIME: '2018-04-13T03:49:05Z',
      OS: 'Windows 2008 R2 Enterprise Service Pack1',
    },
  });
});

test('HOSTs, DETECTIONs', async () => {
  const iteratee = jest.fn();
  const onIterateeError = jest.fn();
  const onComplete = jest.fn();
  const onUnhandledError = jest.fn();

  const xmlStream = new ReadableString(detectionOutputXML);

  await expect(
    parseHostDetectionsStream({
      xmlStream,
      iteratee,
      onIterateeError,
      onUnhandledError,
      onComplete,
    }),
  ).resolves.not.toThrowError();

  expect(onIterateeError).not.toHaveBeenCalled();
  expect(onUnhandledError).not.toHaveBeenCalled();
  expect(onComplete).toHaveBeenCalledWith('end');

  expect(iteratee).toHaveBeenNthCalledWith(1, hostDetections1);
  expect(iteratee).toHaveBeenNthCalledWith(2, hostDetections2);
  expect(iteratee).toHaveBeenNthCalledWith(3, hostDetections3);
});

describe('error', () => {
  test('one failed host iteration does not terminate stream processing', async () => {
    const error = new Error('One failed');
    const iteratee = jest
      .fn()
      .mockRejectedValueOnce(error)
      .mockImplementationOnce(
        () =>
          new Promise((resolve, _reject) => {
            setTimeout(resolve, 500);
          }),
      );
    const onIterateeError = jest.fn();
    const onComplete = jest.fn();
    const onUnhandledError = jest.fn();

    const xmlStream = new ReadableString(detectionOutputXML);

    await expect(
      parseHostDetectionsStream({
        xmlStream,
        iteratee,
        onIterateeError,
        onUnhandledError,
        onComplete,
      }),
    ).resolves.not.toThrowError();

    expect(onIterateeError).toHaveBeenCalledWith(error, hostDetections1);
    expect(onUnhandledError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith('end');

    expect(iteratee).toHaveBeenNthCalledWith(1, hostDetections1);
    expect(iteratee).toHaveBeenNthCalledWith(2, hostDetections2);
    expect(iteratee).toHaveBeenNthCalledWith(3, hostDetections3);
  });

  test('continues processing with intermittent iteratee errors', async () => {
    const error = new Error('Middle failed');
    const iteratee = jest
      .fn()
      .mockResolvedValueOnce(noop)
      .mockRejectedValueOnce(error)
      .mockResolvedValue(noop);

    const onIterateeError = jest.fn();
    const onComplete = jest.fn();
    const onUnhandledError = jest.fn();

    const xmlStream = new stream.PassThrough();

    let parseError: Error | undefined;
    const parsePromise = parseHostDetectionsStream({
      xmlStream,
      iteratee,
      onIterateeError,
      iterateeErrorLimit: 1,
      onUnhandledError,
      onComplete,
    }).catch((err) => {
      parseError = err;
    });

    xmlStream.write(detectionOutputOpenXML);

    xmlStream.write(hostXML1);
    expect(iteratee).toHaveBeenNthCalledWith(1, hostDetections1);
    expect(onIterateeError).not.toHaveBeenCalled();
    expect(onUnhandledError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    xmlStream.write(hostXML2);
    expect(iteratee).toHaveBeenNthCalledWith(2, hostDetections2);

    // Give event loop a tick to address iteratee rejection
    await new Promise((resolve, _reject) => {
      setTimeout(resolve, 1);
    });

    expect(onIterateeError).toHaveBeenCalledWith(error, hostDetections2);
    expect(onUnhandledError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    xmlStream.write(hostXML3);
    expect(iteratee).toHaveBeenNthCalledWith(3, hostDetections3);
    expect(onUnhandledError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    xmlStream.write(detectionOutputCloseXML);
    xmlStream.end();

    await parsePromise;
    expect(parseError).toBeUndefined();
    expect(onUnhandledError).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);

    expect(iteratee).toHaveBeenCalledTimes(3);
  });

  test('stops processing if no successes', async () => {
    const exceededErrorLimitMessage = 'Exceeded iteratee error limit 2';

    const error1 = new Error('One failed');
    const error2 = new Error('Two failed');
    const iteratee = jest
      .fn()
      .mockRejectedValueOnce(error1)
      .mockRejectedValueOnce(error2)
      .mockResolvedValue(noop);

    const onIterateeError = jest.fn();
    const onComplete = jest.fn();
    const onUnhandledError = jest.fn();

    const xmlStream = new stream.PassThrough();

    let parseError: Error | undefined;
    const parsePromise = parseHostDetectionsStream({
      xmlStream,
      iteratee,
      onIterateeError,
      iterateeErrorLimit: 2,
      onComplete,
      onUnhandledError,
    }).catch((err) => {
      parseError = err;
    });

    xmlStream.write(detectionOutputOpenXML);

    xmlStream.write(hostXML1);
    expect(iteratee).toHaveBeenNthCalledWith(1, hostDetections1);
    // Give event loop a tick to address iteratee rejection
    await new Promise((resolve, _reject) => {
      setTimeout(resolve, 1);
    });
    expect(onIterateeError).toHaveBeenNthCalledWith(1, error1, hostDetections1);
    expect(onUnhandledError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    xmlStream.write(hostXML2);
    expect(iteratee).toHaveBeenNthCalledWith(2, hostDetections2);
    // Give event loop a tick to address iteratee rejection
    await new Promise((resolve, _reject) => {
      setTimeout(resolve, 1);
    });
    expect(onIterateeError).toHaveBeenNthCalledWith(2, error2, hostDetections2);
    expect(onUnhandledError).toHaveBeenCalledWith(
      expect.objectContaining({ message: exceededErrorLimitMessage }),
    );
    expect(onComplete).toHaveBeenCalledWith(
      'closetag', // during closing of HOST
    );

    // Prove that additional data on the input stream is ignored
    xmlStream.write(hostXML3);
    xmlStream.write(detectionOutputCloseXML);
    xmlStream.end();

    await parsePromise;

    expect(parseError).toBeDefined();
    expect(parseError?.message).toEqual(exceededErrorLimitMessage);
    expect(onUnhandledError).toHaveBeenCalledWith(
      expect.objectContaining({ message: exceededErrorLimitMessage }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);

    expect(iteratee).toHaveBeenCalledTimes(2);
  });
});
