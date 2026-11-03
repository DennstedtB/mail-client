# Local test mail server

From M1 on, the app is developed against a local [Stalwart](https://github.com/stalwartlabs/stalwart) server instead of a real mailbox. In M0 the app shows sample data only and doesn't connect to it yet. One container provides IMAP, SMTP submission and CalDAV, so a bug in "delete" can never touch real mail.

> Written from the Stalwart 1.0 documentation and not yet run on the Mac. If a wizard screen looks different, follow the screen and update this file.

## Requirements

Docker Desktop or OrbStack on the Mac.

## First start

```sh
npm run mailserver:up
```

On its first start the server runs in bootstrap mode and prints a temporary admin password:

```sh
docker logs mailclient-stalwart 2>&1 | grep -A8 'bootstrap mode'
```

Open <http://127.0.0.1:18080/admin> and sign in as `admin` with that password. The setup wizard opens:

| Screen          | Value                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Server identity | Hostname `localhost`, domain `mailclient.test`. There is no public domain, so the server uses a self-signed certificate. |
| Storage         | Keep the default (RocksDB)                                                                                               |
| Directory       | Use the internal directory                                                                                               |
| Logging         | Console, ANSI colors off                                                                                                 |
| DNS management  | Manual. Nothing needs to be published for local use.                                                                     |

Note the `admin@mailclient.test` password shown at the end. It is shown only once. Then restart:

```sh
docker restart mailclient-stalwart
```

## Test accounts

Sign in at <https://127.0.0.1:8443/admin>. Expect a certificate warning: the certificate is self-signed.

1. Open Management › Directory › Accounts and create `alice` and `bob` on `mailclient.test`.
2. For each one, set a password under Authentication › Credentials › Add item (at least 8 characters).

Two accounts let you send mail from one to the other and test both sides.

## Connection settings

| Service           | Host        | Port | Security |
| ----------------- | ----------- | ---- | -------- |
| IMAP              | `127.0.0.1` | 1993 | TLS      |
| SMTP submission   | `127.0.0.1` | 1465 | TLS      |
| CalDAV, web admin | `127.0.0.1` | 8443 | HTTPS    |

User name: the full address, for example `alice@mailclient.test`.

The certificate is self-signed. From M1 on, the app gets a development-only option to trust it for `127.0.0.1`. Never use that option for real servers.

## Everyday commands

```sh
npm run mailserver:up     # start
npm run mailserver:down   # stop (data is kept in Docker volumes)
npm run mailserver:logs   # follow the log
```

To start over completely, remove the volumes: `docker compose -f dev/stalwart/compose.yaml down -v`.
