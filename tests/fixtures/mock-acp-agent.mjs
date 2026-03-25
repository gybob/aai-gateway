import readline from 'node:readline';

let nextSessionId = 1;

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  const message = JSON.parse(trimmed);
  handleMessage(message);
});

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function sendResult(id, result) {
  send({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function sendError(id, message) {
  send({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32000,
      message,
    },
  });
}

function sendUpdate(sessionId, text, status = 'working') {
  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        content: text,
      },
      status,
    },
  });
}

function extractPromptText(params) {
  if (!params || !Array.isArray(params.prompt)) {
    return '';
  }

  return params.prompt
    .filter((item) => item && typeof item === 'object' && item.type === 'text')
    .map((item) => item.text)
    .filter((item) => typeof item === 'string')
    .join('\n');
}

function handleMessage(message) {
  switch (message.method) {
    case 'initialize':
      sendResult(message.id, {
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: {
            image: false,
            embeddedContext: true,
          },
          sessionCapabilities: {
            poll: true,
          },
        },
      });
      return;
    case 'session/new': {
      sendResult(message.id, {
        sessionId: `session-${nextSessionId++}`,
      });
      return;
    }
    case 'session/prompt': {
      const sessionId = message.params?.sessionId;
      const text = extractPromptText(message.params);
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        sendError(message.id, 'missing sessionId');
        return;
      }

      if (text.includes('NO_UPDATE')) {
        setTimeout(() => {
          sendResult(message.id, 'Final answer after wait.');
        }, 80);
        return;
      }

      setTimeout(() => {
        sendUpdate(sessionId, 'Chunk 1.', 'working');
      }, 5);

      setTimeout(() => {
        sendResult(message.id, 'Chunk 2.');
      }, 25);
      return;
    }
    default:
      sendError(message.id, `unsupported method: ${message.method}`);
  }
}
