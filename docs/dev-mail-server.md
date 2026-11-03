# Local test mail server

The app is developed against a local [Stalwart](https://github.com/stalwartlabs/stalwart) server instead of a real mailbox. One container provides IMAP, SMTP submission and CalDAV, so a bug in "delete" can never touch real mail.

> Checked step by step with Stalwart 1.0.2. The Docker port mapping was simulated, not run under Docker Desktop itself. If a screen looks different, follow the screen and update this file.

## Requirements

Docker Desktop or OrbStack on the Mac. Ports 443, 8080, 1993 and 1465 must be free on `127.0.0.1`.

## 1. Start the server

```sh
npm run mailserver:up
```

On its first start the server runs in setup mode and prints a temporary admin password:

```sh
docker logs mailclient-stalwart 2>&1 | grep -A8 'bootstrap mode'
```

## 2. Run the setup wizard

Open <http://localhost:8080/admin>, enter `admin`, then the temporary password. The wizard has five screens:

| Screen          | What to choose                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server identity | Hostname `localhost`, default email domain `mailclient.test`. Turn off both switches (TLS certificate and email signing keys): there is no public domain. |
| Storage         | Keep the defaults (RocksDB)                                                                                                                               |
| Directory       | Use the internal directory                                                                                                                                |
| Logging         | Type Console, "Use ANSI colors" off                                                                                                                       |
| DNS management  | Manual DNS server management                                                                                                                              |

Click **Finish setup**. The last screen shows the `admin@mailclient.test` password **once**; write it down. Then restart:

```sh
docker restart mailclient-stalwart
```

## 3. Create test accounts

Open <https://localhost/admin>. Use `localhost`, not `127.0.0.1`: the sign-in fails at any other address with "Client metadata documents are disabled". Accept the certificate warning; the certificate is self-signed.

Sign in as `admin@mailclient.test`, then:

1. Go to **Directory › Accounts** and click **Create user**.
2. Username `alice`, domain `mailclient.test`.
3. Under **Authentication › Credentials**, click **Add item** and enter a password.
4. Click **Create**. Repeat for `bob`.

Two accounts let you send mail from one to the other and test both sides.

## 4. Add the account in MailClient

In the app (`npm run dev`), click **Add account**, then **Fill in the local test server**, and enter alice's password. That fills in:

| Service         | Host        | Port | Security |
| --------------- | ----------- | ---- | -------- |
| IMAP            | `127.0.0.1` | 1993 | TLS      |
| SMTP submission | `127.0.0.1` | 1465 | TLS      |

User name: the full address, `alice@mailclient.test`. "Trust the self-signed certificate of this local server" is ticked. The app only allows that option for servers on this Mac.

## Test mail

Send a message from bob to alice, so alice's inbox has something unread:

```sh
npm run mailserver:send-test -- --password 'BOB_PASSWORD'
```

Replace `BOB_PASSWORD` with bob's password; the single quotes keep the shell from interpreting special characters. Options: `--from`, `--to`, `--subject`. The script only talks to `127.0.0.1`.

## Live tests

Some tests run against this server, and are skipped unless you pass alice's password:

```sh
MAILCLIENT_LIVE_PASSWORD='ALICE_PASSWORD' npx vitest run live-server
```

## Everyday commands

```sh
npm run mailserver:up     # start
npm run mailserver:down   # stop (data is kept in Docker volumes)
npm run mailserver:logs   # follow the log
```

To start over completely, remove the volumes: `docker compose -f dev/stalwart/compose.yaml down -v`.
