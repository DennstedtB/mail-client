#!/usr/bin/env node
// Sends a test message through the local Stalwart server (docs/dev-mail-server.md).
//
//   npm run mailserver:send-test -- --password <bob's password>
//
// Options: --from (bob@mailclient.test), --to (alice@mailclient.test),
// --subject, --port (1465). Only talks to 127.0.0.1 and accepts the server's
// self-signed certificate, so it can't be pointed at a real server by mistake.
import { parseArgs } from 'node:util'
import nodemailer from 'nodemailer'

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: 'bob@mailclient.test' },
    to: { type: 'string', default: 'alice@mailclient.test' },
    password: { type: 'string' },
    subject: { type: 'string', default: `Test message ${new Date().toLocaleString()}` },
    port: { type: 'string', default: '1465' },
  },
})

if (!values.password) {
  console.error('Missing --password: the password of the sending test account.')
  process.exit(1)
}

const transport = nodemailer.createTransport({
  host: '127.0.0.1',
  port: Number(values.port),
  secure: true,
  auth: { user: values.from, pass: values.password },
  tls: { rejectUnauthorized: false },
})

try {
  const info = await transport.sendMail({
    from: values.from,
    to: values.to,
    subject: values.subject,
    text: `This message was sent through the local test server at ${new Date().toISOString()}.`,
  })
  console.log(`Sent "${values.subject}" from ${values.from} to ${values.to}: ${info.response}`)
} catch (error) {
  console.error(`Sending failed: ${error.message}`)
  process.exitCode = 1
} finally {
  transport.close()
}
